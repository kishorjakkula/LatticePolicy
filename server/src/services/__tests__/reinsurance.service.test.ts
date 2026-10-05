import { describe, expect, it } from 'vitest'
import { treatyApplies, validateParticipantShares, computePlacementForTransactionSafely } from '../reinsurance.service.js'

describe('validateParticipantShares', () => {
  it('allows an empty participant list', () => {
    expect(validateParticipantShares([])).toEqual({ valid: true, totalPercent: 0 })
  })

  it('allows under-subscribed shares (total below 100%)', () => {
    const result = validateParticipantShares([{ participationPercent: 40 }, { participationPercent: 35 }])
    expect(result.valid).toBe(true)
    expect(result.totalPercent).toBe(75)
  })

  it('allows exactly 100% total', () => {
    const result = validateParticipantShares([{ participationPercent: 60 }, { participationPercent: 40 }])
    expect(result.valid).toBe(true)
    expect(result.totalPercent).toBe(100)
  })

  it('rejects shares that sum to more than 100%', () => {
    const result = validateParticipantShares([{ participationPercent: 70 }, { participationPercent: 40 }])
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/exceeds 100%/)
  })

  it('rejects a non-positive participation percent', () => {
    const result = validateParticipantShares([{ participationPercent: 0 }])
    expect(result.valid).toBe(false)
  })

  it('rejects a participation percent above 100', () => {
    const result = validateParticipantShares([{ participationPercent: 101 }])
    expect(result.valid).toBe(false)
  })
})

describe('treatyApplies', () => {
  const baseTreaty = {
    status: 'Active',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    productCodes: null,
    stateCodes: null
  }

  it('applies to any product/state when applicability lists are null', () => {
    expect(treatyApplies(baseTreaty, { productCode: 'auto', stateCode: 'NY', asOfDate: '2026-06-01' })).toBe(true)
  })

  it('does not apply outside the effective/expiration window', () => {
    expect(treatyApplies(baseTreaty, { productCode: 'auto', stateCode: 'NY', asOfDate: '2025-12-31' })).toBe(false)
    expect(treatyApplies(baseTreaty, { productCode: 'auto', stateCode: 'NY', asOfDate: '2027-01-01' })).toBe(false)
  })

  it('does not apply when the treaty is not Active', () => {
    expect(treatyApplies({ ...baseTreaty, status: 'Draft' }, { productCode: 'auto', stateCode: 'NY', asOfDate: '2026-06-01' })).toBe(
      false
    )
  })

  it('restricts by product codes when set', () => {
    const treaty = { ...baseTreaty, productCodes: ['auto', 'homeowners'] }
    expect(treatyApplies(treaty, { productCode: 'auto', stateCode: 'NY', asOfDate: '2026-06-01' })).toBe(true)
    expect(treatyApplies(treaty, { productCode: 'businessowners', stateCode: 'NY', asOfDate: '2026-06-01' })).toBe(false)
  })

  it('restricts by state codes when set', () => {
    const treaty = { ...baseTreaty, stateCodes: ['NY', 'NJ'] }
    expect(treatyApplies(treaty, { productCode: 'auto', stateCode: 'NY', asOfDate: '2026-06-01' })).toBe(true)
    expect(treatyApplies(treaty, { productCode: 'auto', stateCode: 'CA', asOfDate: '2026-06-01' })).toBe(false)
  })

  it('applies when stateCode is null and the treaty has no state restriction', () => {
    expect(treatyApplies(baseTreaty, { productCode: 'auto', stateCode: null, asOfDate: '2026-06-01' })).toBe(true)
  })
})

describe('computePlacementForTransactionSafely', () => {
  it('swallows a DB/lookup failure and resolves to an empty array instead of throwing', async () => {
    // A db handle that toRawQuery cannot resolve a real client from — this
    // forces computePlacementForTransaction to fail internally, simulating
    // any unexpected reinsurance-subsystem error. The wrapper must not let
    // this propagate to the caller (bind/endorsement/renewal/rewrite).
    const brokenDb = {} as any
    await expect(
      computePlacementForTransactionSafely(brokenDb, 'sample-carrier', 'policy-1', 'transaction-1')
    ).resolves.toEqual([])
  })
})
