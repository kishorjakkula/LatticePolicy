import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, homeownersPayload, profile, waitForApi } from './pilot-lib.mjs'
test('nearest-rank percentile keeps the slow tail and rejects absent evidence', () => {
  assert.equal(percentile([3, 1, 100, 2], .95), 100)
  assert.throws(() => percentile([], .95))
})
test('host readiness retries a reset health connection without repeating transaction writes', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    if (requests.length === 1) throw new Error('ECONNRESET')
    return { ok: true, json: async () => ({ db: true, cache: true }) }
  }
  await waitForApi(3000)
  assert.equal(requests.length, 2)
  assert(requests.every(r => r.url.endsWith('/health') && !r.options.method && r.options.headers.Connection === 'close'))
})
test('pilot uses synthetic data and complete Homeowners qualifications', () => {
  assert.equal(profile.synthetic, true)
  const payload = homeownersPayload('test')
  assert.equal(payload.productCode, profile.product)
  assert(profile.jurisdictions.includes(payload.state))
  assert.equal(Object.keys(payload.qualificationAnswers).length, 5)
  assert(payload.applicant.email.endsWith('@example.com'))
})
