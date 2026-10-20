import { describe, expect, it } from 'vitest'
import { computeCurrentTermPremium } from '../policyPremium'

const money = (amount: number) => ({ total: { amount, currency: 'USD' } })
const term1 = { policyEffectiveDate: '2025-09-18', expirationDate: '2026-09-18' }
const term2 = { policyEffectiveDate: '2026-09-18', expirationDate: '2027-09-18' }

describe('computeCurrentTermPremium', () => {
  it('returns the current term premium, not the sum of all terms', () => {
    const versions = [
      { ...term1, transactionType: 'NB', processedDate: '2025-09-01T00:00:00Z', premium: money(500) },
      { ...term1, transactionType: 'Endorse', processedDate: '2026-01-10T00:00:00Z', premium: money(40) },
      { ...term2, transactionType: 'Renew', processedDate: '2026-08-15T00:00:00Z', premium: money(542.82) },
    ]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2026-09-18', expirationDate: '2027-09-18' })).toEqual({
      amount: 542.82,
      currency: 'USD',
    })
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2025-09-18', expirationDate: '2026-09-18' })).toEqual({
      amount: 540,
      currency: 'USD',
    })
  })

  it('adds endorsement and cancellation deltas within the term', () => {
    const versions = [
      { ...term2, transactionType: 'Renew', processedDate: '2026-08-15T00:00:00Z', premium: money(600) },
      { ...term2, transactionType: 'Endorse', processedDate: '2026-10-01T00:00:00Z', premium: money(-25) },
      { ...term2, transactionType: 'Cancel', processedDate: '2026-11-01T00:00:00Z', premium: money(-300) },
    ]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2026-09-18', expirationDate: '2027-09-18' })?.amount).toBe(275)
  })

  it('restores the cancelled amount for a zero-premium reinstatement', () => {
    const versions = [
      { ...term1, transactionType: 'NB', processedDate: '2025-09-01T00:00:00Z', premium: money(500) },
      { ...term1, transactionType: 'Cancel', processedDate: '2025-12-01T00:00:00Z', premium: money(-200) },
      { ...term1, transactionType: 'Reinstate', processedDate: '2025-12-05T00:00:00Z', premium: money(0) },
    ]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2025-09-18', expirationDate: '2026-09-18' })?.amount).toBe(500)
  })

  it('returns null instead of summing other terms when no version is in the current term', () => {
    const versions = [{ ...term1, transactionType: 'NB', processedDate: '2025-09-01T00:00:00Z', premium: money(500) }]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2026-09-18', expirationDate: '2027-09-18' })).toBeNull()
  })

  it('returns null without versions or amounts', () => {
    expect(computeCurrentTermPremium([], { effectiveDate: '2026-09-18' })).toBeNull()
    expect(computeCurrentTermPremium([{ ...term2, transactionType: 'NB', premium: {} }], { effectiveDate: '2026-09-18' })).toBeNull()
  })

  it('matches term dates given as timestamps by calendar date', () => {
    const versions = [{ policyEffectiveDate: '2026-09-18', expirationDate: '2027-09-18', transactionType: 'NB', premium: money(100) }]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2026-09-18T12:00:00', expirationDate: '2027-09-18T12:00:00' })?.amount).toBe(100)
  })

  it('matches UTC-midnight version dates from the API in a US time zone', () => {
    const original = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      // The shape GET /policies/:id/versions returns.
      const versions = [{ policyEffectiveDate: '2026-09-18T00:00:00.000Z', expirationDate: '2027-09-18T00:00:00.000Z', transactionType: 'NB', premium: money(542.82) }]
      expect(computeCurrentTermPremium(versions, { effectiveDate: '2026-09-18', expirationDate: '2027-09-18' })?.amount).toBe(542.82)
    } finally {
      process.env.TZ = original
    }
  })

  it('restarts at a rewrite on the original term instead of adding to the cancelled premium', () => {
    const versions = [
      { ...term1, transactionType: 'NB', processedDate: '2025-09-01T00:00:00Z', premium: money(500) },
      { ...term1, transactionType: 'Cancel', processedDate: '2025-12-01T00:00:00Z', premium: money(-300) },
      { ...term1, transactionType: 'Rewrite', processedDate: '2025-12-10T00:00:00Z', premium: money(520) },
      { ...term1, transactionType: 'Endorse', processedDate: '2026-01-10T00:00:00Z', premium: money(15) },
    ]
    expect(computeCurrentTermPremium(versions, { effectiveDate: '2025-09-18', expirationDate: '2026-09-18' })?.amount).toBe(535)
  })
})
