import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile, mkdtemp, rm, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import {
  profileDigest,
  verifyAuthorization,
  releasePolicyFromEnv,
} from './release-authorization.mjs'
import { publishProfile, activateProfile } from './profiles.mjs'
import { createProcessor } from './processor.mjs'

const profile = JSON.parse(
  await readFile(
    new URL('./profiles/submission/1.0.0.json', import.meta.url),
    'utf8',
  ),
)
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
const policy = {
  publicKey: publicPem,
  tenantId: 'carrier-a',
  environment: 'production',
  model: 'local-v1',
  modelSha256: 'a'.repeat(64),
}
function receipt(environment = 'production', changes = {}) {
  const payload = {
    schemaVersion: 1,
    releaseId: 'release-1',
    tenantId: 'carrier-a',
    environment,
    approvedBy: 'technical-admin',
    approvedAt: new Date().toISOString(),
    artifacts: {
      profileId: profile.id,
      profileVersion: profile.version,
      profileSha256: profileDigest(profile),
      model: 'local-v1',
      modelSha256: 'a'.repeat(64),
    },
    validationReportSha256: 'b'.repeat(64),
    ...changes,
  }
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(JSON.stringify(payload)),
      privateKey,
    ).toString('base64url'),
  }
}
test('signed approval is bound to carrier, environment, profile content and model identity', () => {
  assert.equal(
    verifyAuthorization(receipt(), policy, profile).releaseId,
    'release-1',
  )
  for (const changed of [
    { tenantId: 'carrier-b' },
    { environment: 'validation' },
    { model: 'different' },
    { modelSha256: 'c'.repeat(64) },
  ])
    assert.throws(
      () => verifyAuthorization(receipt(), { ...policy, ...changed }, profile),
      /does not match/,
    )
  assert.throws(
    () =>
      verifyAuthorization(receipt(), policy, {
        ...profile,
        instructions: 'changed',
      }),
    /does not match/,
  )
  const modified = receipt()
  modified.payload.approvedBy = 'someone-else'
  assert.throws(
    () => verifyAuthorization(modified, policy, profile),
    /signature/,
  )
  assert.throws(
    () => verifyAuthorization(receipt('validation'), policy, profile),
    /does not match/,
  )
})
test('gated activation and inference refuse unsigned profiles even when active.json is edited', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'llm-promotion-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await publishProfile(directory, profile)
  await assert.rejects(
    activateProfile(directory, profile.id, profile.version, null, policy),
    /signature/,
  )
  await activateProfile(directory, profile.id, profile.version)
  let invoked = false
  const processor = createProcessor({
    profilesDir: directory,
    modelUrl: 'http://model:11434/v1',
    model: 'local-v1',
    releasePolicy: policy,
    request: async () => {
      invoked = true
      return {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: '{"values":[],"conflicts":[]}' },
          },
        ],
      }
    },
  })
  const input = {
    schemaVersion: 1,
    profile: 'submission',
    documents: [
      {
        id: 'd',
        fileName: 'synthetic.txt',
        mediaType: 'text/plain',
        textLines: ['Synthetic'],
      },
    ],
    schema: { fields: [], variants: [] },
  }
  await assert.rejects(processor(input), /ENOENT/)
  assert.equal(invoked, false)
  await activateProfile(
    directory,
    profile.id,
    profile.version,
    receipt(),
    policy,
  )
  assert.equal((await processor(input)).releaseId, 'release-1')
  policy.revocationFile = path.join(directory, 'revocations.json')
  t.after(() => { delete policy.revocationFile })
  await writeFile(policy.revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: [] }))
  assert.equal((await processor(input)).releaseId, 'release-1')
  invoked = false
  await writeFile(policy.revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: ['release-1'] }))
  await assert.rejects(processor(input), /revoked/)
  assert.equal(invoked, false)
  await writeFile(policy.revocationFile, '{')
  await assert.rejects(processor(input))
  await writeFile(policy.revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: 'invalid' }))
  await assert.rejects(processor(input), /revocation policy/)
  await unlink(policy.revocationFile)
  await assert.rejects(processor(input), /ENOENT/)
  delete policy.revocationFile
  await activateProfile(directory, profile.id, profile.version,
    receipt('production', { approvedAt: '2020-01-01T00:00:00.000Z' }),
    { ...policy, now: () => Date.parse('2020-01-01T00:00:01.000Z') })
  await assert.rejects(processor(input), /expired/)
  assert.equal(invoked, false)
})
test('existing signed v1 payloads expire under local policy without resigning', () => {
  const approvedAt = '2026-01-01T00:00:00.000Z'
  const authorization = receipt('production', { approvedAt })
  const approved = Date.parse(approvedAt)
  assert.equal(verifyAuthorization(authorization, { ...policy, maxAgeSeconds: 60,
    now: () => approved + 59999 }, profile).releaseId, 'release-1')
  assert.throws(() => verifyAuthorization(authorization, { ...policy, maxAgeSeconds: 60,
    now: () => approved + 60000 }, profile), /expired/)
  assert.equal(verifyAuthorization(authorization, { ...policy, maxAgeSeconds: 120,
    now: () => approved + 60000 }, profile).releaseId, 'release-1')
  for (const changes of [{ approvedAt: undefined }, { approvedAt: 'bad' },
    { approvedAt: '2027-01-01T00:00:00.000Z' }, { expiresAt: 'bad' },
    { expiresAt: approvedAt }])
    assert.throws(() => verifyAuthorization(receipt('production', { approvedAt, ...changes }),
      { ...policy, now: () => approved }, profile), /lifetime/)
  assert.throws(() => verifyAuthorization(authorization,
    { ...policy, maxAgeSeconds: 0, now: () => approved }, profile), /lifetime/)
})
test('local environment lifetime and revocation configuration validates fail closed', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'llm-policy-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const keyFile = path.join(directory, 'public.pem')
  await writeFile(keyFile, publicPem)
  const env = { RELEASE_ENVIRONMENT: 'production', CARRIER_TENANT_ID: 'carrier-a',
    MODEL_NAME: 'local-v1', MODEL_ARTIFACT_SHA256: 'a'.repeat(64), LLM_RELEASE_PUBLIC_KEY_FILE: keyFile }
  assert.equal((await releasePolicyFromEnv(env)).maxAgeSeconds, 604800)
  const configured = await releasePolicyFromEnv({ ...env, LLM_RELEASE_MAX_AGE_SECONDS: '3600',
    LLM_RELEASE_REVOCATION_FILE: '/carrier/revocations.json' })
  assert.equal(configured.maxAgeSeconds, 3600)
  assert.equal(configured.revocationFile, '/carrier/revocations.json')
  for (const value of ['', '0', '-1', 'abc', 'Infinity', '1.5', '31536001'])
    await assert.rejects(releasePolicyFromEnv({ ...env, LLM_RELEASE_MAX_AGE_SECONDS: value }), /maximum age/)
})
test('production cannot silently fall back to an ungoverned environment', async () => {
  await assert.rejects(
    releasePolicyFromEnv({ RELEASE_ENVIRONMENT: 'production' }),
    /Configure/,
  )
  await assert.rejects(
    releasePolicyFromEnv({ RELEASE_ENVIRONMENT: 'typo' }),
    /Configure/,
  )
  assert.equal(
    await releasePolicyFromEnv({ RELEASE_ENVIRONMENT: 'development' }),
    null,
  )
})
