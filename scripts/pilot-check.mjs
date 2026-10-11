import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { call, credentials, date, evidence, homeownersPayload, login, percentile, pilotRoot, prepare, profile } from './pilot-lib.mjs'

const { token } = await login()
const checks = []
async function check(name, fn) { await fn(); checks.push(name); console.log(`PASS ${name}`) }
const manifest = JSON.parse(fs.readFileSync(path.join(pilotRoot, 'release.json')))
await prepare(token)
await check('Database, cache, release SHA and schema', async () => {
  const health = await call('GET', '/health')
  assert(health.db && health.cache && health.status === 'ok')
  const version = await call('GET', '/version')
  assert.equal(version.commit, manifest.sha)
  assert.equal(version.schema.schemaAhead, false)
})
await check('Tenant pin, unauthenticated access and demo credential rejection', async () => {
  await call('GET', '/api/v1/policies', { expected: [401] })
  await call('GET', '/api/v1/policies', { token, tenant: 'sample-carrier', expected: [403] })
  await call('POST', '/auth/login', { expected: [401, 403], data: { tenantId: profile.tenantId, username: 'admin', password: 'password' } })
  const ui = await fetch(`${profile.uiUrl}/runtime-config.js`)
  assert(ui.ok)
  const config = await ui.text()
  assert.match(config, /acme-pilot/)
  assert.doesNotMatch(config, /showDemoCredentials"?\s*:\s*true/)
})
await check('Mandatory quote validation', async () => {
  await call('POST', '/api/v1/quotes', { token, expected: [422], data: { ...homeownersPayload(), coverages: [] } })
})
let quote, policy
await check('Reference premium, quote, bind and issue', async () => {
  quote = await call('POST', '/api/v1/quotes', { token, data: homeownersPayload() })
  // Independent pilot fixture: 700 * .95 * .95 * .52 = 328.51,
  // plus 35 fee and 6.57 tax = 370.08. Sample rates, not a regulatory filing.
  assert.equal(quote.premium.total.amount, 370.08)
  assert.equal(quote.underwriting.decision, 'Eligible')
  policy = await call('POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token, data: {} })
  await call('POST', `/api/v1/policies/${policy.policyId}/issue`, { token, data: {} })
})
const prefix = `/api/v1/policies/${policy.policyId}`
await check('Endorsement, cancellation, reinstatement and renewal', async () => {
  const full = await call('GET', `${prefix}/full`, { token })
  full.risks[0].roofAgeYears = 6
  await call('POST', `${prefix}/endorse/preview`, { token, data: { effectiveDate: date(-20), payload: full } })
  await call('POST', `${prefix}/endorse`, { token, data: { effectiveDate: date(-20), payload: full, reason: 'Pilot roof update' } })
  await call('POST', `${prefix}/cancel`, { token, data: { effectiveDate: date(-10), reason: 'insured request' } })
  await call('POST', `${prefix}/reinstate`, { token, data: { effectiveDate: date(-5), reason: 'pilot payment received' } })
  await call('POST', `${prefix}/renew/preview`, { token, data: {} })
  await call('POST', `${prefix}/renew`, { token, data: {} })
})
let documents
await check('Every document contains verified readable content', async () => {
  const list = await call('GET', `${prefix}/documents`, { token })
  documents = list.documents
  assert(documents.length >= 3)
  for (const doc of documents) {
    const { bytes, contentType } = await call('GET', `${prefix}/documents/${doc.documentId}/content`, { token, raw: true })
    assert(bytes.length > 100)
    if (contentType.includes('pdf')) assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    else assert.match(bytes.toString(), /Rating worksheet/)
    doc.measuredHash = crypto.createHash('sha256').update(bytes).digest('hex')
  }
})
await check('Agent cannot administer users', async () => {
  const username = `pilot-agent-${Date.now()}`
  const password = credentials().password
  await call('POST', '/api/v1/admin/users', { token, expected: [201], data: { username, password, roles: ['agent'] } })
  const agent = await call('POST', '/auth/login', { data: { tenantId: profile.tenantId, username, password } })
  await call('GET', '/api/v1/admin/users', { token: agent.token, expected: [403] })
})
const start = performance.now(), timings = { search: [], rating: [], document: [] }, failures = []
let seq = 0
await Promise.all(Array.from({ length: profile.concurrency }, async (_, worker) => {
  while (performance.now() - start < profile.loadDurationSeconds * 1000) {
    const i = seq++, kind = i % 10 < 7 ? 'search' : i % 10 < 9 ? 'rating' : 'document'
    const t = performance.now()
    try {
      if (kind === 'search') await call('GET', '/api/v1/policies?productCode=homeowners&pageSize=25', { token })
      if (kind === 'rating') await call('POST', '/api/v1/quotes', { token, data: homeownersPayload(`load${worker}x${i}`) })
      if (kind === 'document') await call('GET', `${prefix}/documents/${documents[0].documentId}/content`, { token, raw: true })
      timings[kind].push(performance.now() - t)
    } catch (e) { failures.push({ kind, message: e.message }) }
    await new Promise(r => setTimeout(r, 3000))
  }
}))
const workload = Object.fromEntries(Object.entries(timings).map(([kind, values]) => [kind, { count: values.length, p95Ms: percentile(values, .95) }]))
const errorRate = failures.length / seq
evidence('acceptance', { profile, sha: manifest.sha, policyId: policy.policyId, checks,
  documentHashes: documents.map(d => ({ documentId: d.documentId, hash: d.measuredHash })),
  workload, requests: seq, errorRate, failures, durationSeconds: (performance.now() - start) / 1000 })
assert(errorRate <= profile.maxErrorRate, 'Workload error rate exceeds pilot target')
for (const kind of Object.keys(timings)) assert(workload[kind].p95Ms <= profile[`${kind}P95Ms`], `${kind} p95 exceeds pilot target`)
const compose = ['compose', '-p', `lattice-${profile.tenantId}`, '--env-file', path.join(pilotRoot, 'kit/carrier.env'), '-f', path.join(pilotRoot, 'kit/docker-compose.yml')]
const stats = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' })
evidence('services', { services: stats.trim().split('\n').filter(Boolean).map(JSON.parse) })
console.log('Pilot API acceptance and workload targets passed. Evidence: .pilot/evidence/acceptance.json')
