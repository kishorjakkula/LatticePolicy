import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, homeownersPayload, profile, waitForApi, isPilotCompanyEnabled, prepare } from './pilot-lib.mjs'
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
test('pilot activates only Homeowners underwriting configurations in approved jurisdictions', () => {
  assert.equal(isPilotCompanyEnabled({ productCode: 'homeowners', country: 'US', state: 'ALL' }), true)
  assert.equal(isPilotCompanyEnabled({ productCode: 'homeowners', country: 'US', state: 'TX' }), true)
  assert.equal(isPilotCompanyEnabled({ productCode: 'homeowners', country: 'US', state: 'CA' }), false)
  assert.equal(isPilotCompanyEnabled({ productCode: 'cyber', country: 'US', state: 'ALL' }), false)
  assert.equal(isPilotCompanyEnabled({ productCode: 'homeowners', country: 'CA', state: 'ALL' }), false)
})

test('pilot setup supplies branding once and preserves administrator changes', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  const calls = []
  let configured = false
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    const body = url.endsWith('/admin/branding') && options.method === 'GET' ? { configured } : []
    return { status: url.endsWith('/compliance/eligibility') ? 201 : 200, json: async () => body }
  }
  await prepare('synthetic-token')
  const saved = calls.find(c => c.url.endsWith('/admin/branding') && c.options.method === 'PATCH')
  const brand = JSON.parse(saved.options.body)
  assert.equal(brand.name, profile.name)
  assert.match(brand.logoDataUrl, /^data:image\/png;base64,/)
  calls.length = 0; configured = true
  await prepare('synthetic-token')
  assert.equal(calls.some(c => c.url.endsWith('/admin/branding') && c.options.method === 'PATCH'), false)
})
