import { test } from 'node:test'
import assert from 'node:assert/strict'
import { percentile, homeownersPayload, profile } from './pilot-lib.mjs'
test('nearest-rank percentile keeps the slow tail and rejects absent evidence', () => {
  assert.equal(percentile([3, 1, 100, 2], .95), 100)
  assert.throws(() => percentile([], .95))
})
test('pilot uses synthetic data and complete Homeowners qualifications', () => {
  assert.equal(profile.synthetic, true)
  const payload = homeownersPayload('test')
  assert.equal(payload.productCode, profile.product)
  assert(profile.jurisdictions.includes(payload.state))
  assert.equal(Object.keys(payload.qualificationAnswers).length, 5)
  assert(payload.applicant.email.endsWith('@example.com'))
})
