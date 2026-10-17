import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, readFile, writeFile, chmod, rm, readdir, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runDeployment, verifyModelArtifact } from '../../deploy/document-processing/operator.mjs'
import { publishProfile } from './profiles.mjs'
import { profileDigest, releasePolicyFromEnv } from './release-authorization.mjs'
import { createProcessor } from './processor.mjs'
import { createServer } from './server.mjs'

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'deployment-operator-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const profile = JSON.parse(await readFile(new URL('./profiles/submission/1.0.0.json', import.meta.url), 'utf8'))
  const profilesDir = path.join(directory, 'profiles')
  await publishProfile(profilesDir, profile)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const model = Buffer.from('deterministic synthetic model artifact v1\n')
  const modelSha256 = createHash('sha256').update(model).digest('hex')
  const modelArtifactFile = path.join(directory, 'model.bin')
  const tokenFile = path.join(directory, 'token')
  const keyFile = path.join(directory, 'public.pem')
  const revocationFile = path.join(directory, 'revocations.json')
  await writeFile(modelArtifactFile, model, { mode: 0o444 })
  await writeFile(tokenFile, 'synthetic-private-token-'.repeat(3), { mode: 0o600 })
  await writeFile(keyFile, publicKey.export({ type: 'spki', format: 'pem' }))
  await writeFile(revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: [] }))
  const env = { RELEASE_ENVIRONMENT: 'production', CARRIER_TENANT_ID: 'synthetic-carrier',
    MODEL_NAME: 'synthetic-model@v1', MODEL_ARTIFACT_SHA256: modelSha256,
    LLM_RELEASE_PUBLIC_KEY_FILE: keyFile, LLM_RELEASE_REVOCATION_FILE: revocationFile }
  function receipt(changes = {}) {
    const payload = { schemaVersion: 1, releaseId: 'synthetic-release', tenantId: env.CARRIER_TENANT_ID,
      environment: 'production', approvedBy: 'synthetic-admin', approvedAt: new Date().toISOString(),
      artifacts: { profileId: profile.id, profileVersion: profile.version, profileSha256: profileDigest(profile),
        model: env.MODEL_NAME, modelSha256 }, validationReportSha256: 'a'.repeat(64), ...changes }
    return { payload, signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64url') }
  }
  let calls = 0
  let wrongResponse = false
  const processDocument = createProcessor({ profilesDir, modelUrl: 'http://unused:11434/v1',
    model: env.MODEL_NAME, releasePolicy: await releasePolicyFromEnv(env), request: async () => {
      calls++
      return { choices: [{ finish_reason: 'stop', message: { content: '{"values":[],"conflicts":[]}' } }] }
    } })
  const server = createServer({ token: (await readFile(tokenFile, 'utf8')).trim(),
    processDocument: async input => wrongResponse ? { document: 'DO-NOT-LOG synthetic response' } : processDocument(input) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const config = { profilesDir, modelArtifactFile, recordsDir: path.join(directory, 'records'), tokenFile,
    privateEndpoint: `http://127.0.0.1:${server.address().port}/v1/extract` }
  return { config, env, receipt, revocationFile, modelSha256, profile, calls: () => calls,
    failSmoke: () => { wrongResponse = true } }
}

test('preflight hashes actual bytes; signed activation and rollback exercise private inference and metadata-only records', async t => {
  const f = await fixture(t)
  assert.equal((await runDeployment('preflight', f.config, f.receipt(), f.env)).status, 'preflight-verified')
  await assert.rejects(readFile(path.join(f.config.profilesDir, 'active.json')), /ENOENT/)
  assert.equal(f.calls(), 0)
  assert.equal((await runDeployment('activate', f.config, f.receipt(), f.env)).status, 'smoke-passed')
  const next = { ...f.profile, version: '1.1.0' }
  await publishProfile(f.config.profilesDir, next)
  const artifacts = { ...f.receipt().payload.artifacts, profileVersion: next.version, profileSha256: profileDigest(next) }
  await runDeployment('activate', f.config, f.receipt({ releaseId: 'synthetic-release-2', artifacts }), f.env)
  await runDeployment('rollback', f.config, f.receipt(), f.env)
  assert.equal(JSON.parse(await readFile(path.join(f.config.profilesDir, 'active.json'))).submission, '1.0.0')
  assert.equal(f.calls(), 3)
  const files = await readdir(f.config.recordsDir)
  assert.equal(files.length, 3)
  for (const file of files) {
    const text = await readFile(path.join(f.config.recordsDir, file), 'utf8')
    const record = JSON.parse(text)
    assert.equal(record.status, 'smoke-passed')
    assert.equal(record.modelSha256, f.modelSha256)
    assert.doesNotMatch(text, /textLines|documents|messages|signature|token|DO-NOT-LOG/)
  }
})

test('digest mismatch, mutable files, symlinks, public endpoints and invalid receipts never activate', async t => {
  const f = await fixture(t)
  for (const changedEnv of [{ MODEL_ARTIFACT_SHA256: 'b'.repeat(64) },
    { RELEASE_ENVIRONMENT: 'development' }, { LLM_RELEASE_REVOCATION_FILE: '' }])
    await assert.rejects(runDeployment('activate', f.config, f.receipt(), { ...f.env, ...changedEnv }))
  await assert.rejects(runDeployment('activate', { ...f.config, privateEndpoint: 'http://8.8.8.8/v1/extract' }, f.receipt(), f.env), /private/)
  for (const changed of [{ approvedAt: '2020-01-01T00:00:00.000Z' }, { tenantId: 'other' }, { environment: 'validation' }])
    await assert.rejects(runDeployment('rollback', f.config, f.receipt(changed), f.env))
  const tampered = f.receipt()
  tampered.payload.approvedBy = 'tampered'
  await assert.rejects(runDeployment('activate', f.config, tampered, f.env), /signature/)
  await chmod(f.config.modelArtifactFile, 0o644)
  await assert.rejects(runDeployment('activate', f.config, f.receipt(), f.env), /read-only/)
  await writeFile(f.config.modelArtifactFile, 'different synthetic bytes')
  await chmod(f.config.modelArtifactFile, 0o444)
  await assert.rejects(runDeployment('activate', f.config, f.receipt(), f.env), /SHA256/)
  const link = `${f.config.modelArtifactFile}.link`
  await symlink(f.config.modelArtifactFile, link)
  await assert.rejects(verifyModelArtifact(link, f.modelSha256))
  await assert.rejects(readFile(path.join(f.config.profilesDir, 'active.json')), /ENOENT/)
  assert.equal(f.calls(), 0)
})

test('revoked rollback fails closed; failed smoke creates a sanitized failure record', async t => {
  const f = await fixture(t)
  await writeFile(f.revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: ['synthetic-release'] }))
  await assert.rejects(runDeployment('rollback', f.config, f.receipt(), f.env), /revoked/)
  await writeFile(f.revocationFile, JSON.stringify({ schemaVersion: 1, releaseIds: [] }))
  f.failSmoke()
  await assert.rejects(runDeployment('activate', f.config, f.receipt(), f.env), /Deployment failed/)
  const files = await readdir(f.config.recordsDir)
  assert.equal(files.length, 1)
  const text = await readFile(path.join(f.config.recordsDir, files[0]), 'utf8')
  assert.equal(JSON.parse(text).status, 'failed')
  assert.doesNotMatch(text, /DO-NOT-LOG|documents|token|signature/)
  // Failure does not perform an unsigned or silently authorized rollback.
  assert.equal(JSON.parse(await readFile(path.join(f.config.profilesDir, 'active.json'))).submission, '1.0.0')
})
