import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, verify, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, createSigner } from './signer.mjs'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' })
const token = 't'.repeat(40)
const release = (changes = {}) => {
  const approvedAt = new Date()
  return {
    schemaVersion: 1,
    tenantId: 'carrier-a',
    releaseId: randomUUID(),
    environment: 'production',
    artifacts: { profileId: 'submission', profileVersion: '1.0.0', profileSha256: 'a'.repeat(64), model: 'm', modelSha256: 'b'.repeat(64) },
    approvedBy: randomUUID(),
    approvedAt: approvedAt.toISOString(),
    expiresAt: new Date(approvedAt.getTime() + 7 * 86400000).toISOString(),
    validationReportSha256: 'c'.repeat(64),
    ...changes,
  }
}

test('signs valid requests and appends a hash-chained log entry for each', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const logFile = path.join(directory, 'signatures.jsonl')
  const signRequest = await createSigner({ privateKeyPem, token, logFile, tenantId: 'carrier-a' })
  const payload = release()
  const signature = await signRequest('release-authorization', payload)
  assert.ok(verify(null, Buffer.from(JSON.stringify(payload)), publicKey, Buffer.from(signature, 'base64url')))
  await signRequest('revocation-list', { schemaVersion: 1, tenantId: 'carrier-a', issuedAt: new Date().toISOString(), releaseIds: [payload.releaseId] })
  const lines = (await readFile(logFile, 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].prevHash, null)
  assert.equal(lines[1].prevHash, lines[0].entryHash)
  assert.equal(lines[0].releaseId, payload.releaseId)
  // A restarted signer continues the same chain.
  const restarted = await createSigner({ privateKeyPem, token, logFile, tenantId: 'carrier-a' })
  await restarted('release-authorization', release())
  const third = JSON.parse((await readFile(logFile, 'utf8')).trim().split('\n')[2])
  assert.equal(third.prevHash, lines[1].entryHash)
})

test('refuses requests outside its own rules', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const signRequest = await createSigner({ privateKeyPem, token, logFile: path.join(directory, 'log.jsonl'), tenantId: 'carrier-a' })
  await assert.rejects(signRequest('release-authorization', release({ tenantId: 'carrier-b' })), /different carrier/)
  await assert.rejects(signRequest('release-authorization', release({ validationReportSha256: null })), /validation report/)
  await assert.rejects(signRequest('release-authorization', release({ approvedAt: '2020-01-01T00:00:00.000Z' })), /not current/)
  const longLived = release()
  longLived.expiresAt = new Date(Date.parse(longLived.approvedAt) + 60 * 86400000).toISOString()
  await assert.rejects(signRequest('release-authorization', longLived), /31 days/)
  await assert.rejects(signRequest('anything', release()), /unknown/)
})

test('HTTP endpoint requires the bearer token and never signs without it', async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'signer-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const signRequest = await createSigner({ privateKeyPem, token, logFile: path.join(directory, 'log.jsonl'), tenantId: 'carrier-a' })
  const server = createServer({ token, signRequest }).listen(0, '127.0.0.1')
  t.after(() => server.close())
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}/sign`
  const body = JSON.stringify({ kind: 'release-authorization', payload: release() })
  assert.equal((await fetch(url, { method: 'POST', body, headers: { authorization: 'Bearer wrong' } })).status, 401)
  const ok = await fetch(url, { method: 'POST', body, headers: { authorization: `Bearer ${token}` } })
  assert.equal(ok.status, 200)
  assert.equal(typeof (await ok.json()).signature, 'string')
})
