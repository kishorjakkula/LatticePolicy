import { describe, expect, it } from 'vitest'
import {
  checkQuoteExpiry,
  checkStateEligibility,
  computeReturnPremium,
  computeShortRateEarnedPct,
  normalizeOfacName,
  screenOfac,
} from '../policy-compliance.js'

function createQuery(
  handlers: Array<{ match: string; rows: any[] }>,
  calls: Array<{ text: string; params?: any[] }> = []
) {
  return async (text: string, params?: any[]) => {
    calls.push({ text, params })
    for (const handler of handlers) {
      if (text.includes(handler.match)) {
        return { rows: handler.rows, rowCount: handler.rows.length }
      }
    }
    return { rows: [], rowCount: 0 }
  }
}

describe('normalizeOfacName', () => {
  it('uppercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeOfacName("John O'Malley-Smith")).toBe('JOHN O MALLEY SMITH')
    expect(normalizeOfacName('  Acme   Corp.  ')).toBe('ACME CORP')
  })

  it('handles empty input', () => {
    expect(normalizeOfacName('')).toBe('')
  })
})

describe('checkQuoteExpiry', () => {
  it('reports not expired when no expiry date is present', () => {
    expect(checkQuoteExpiry({})).toEqual({ expired: false, expiryDate: null })
  })

  it('reports expired for a past date', () => {
    const result = checkQuoteExpiry({ expiry_date: '2000-01-01' })
    expect(result.expired).toBe(true)
    expect(result.expiryDate).toBe('2000-01-01')
  })

  it('reports not expired for a far future date', () => {
    const result = checkQuoteExpiry({ expiryDate: '2999-01-01' })
    expect(result.expired).toBe(false)
  })
})

describe('computeShortRateEarnedPct', () => {
  const table = [
    { days_from: 0, days_to: 30, earned_pct: 0.2 },
    { days_from: 31, days_to: 60, earned_pct: 0.4 },
  ]

  it('returns the matching bracket percentage', () => {
    expect(computeShortRateEarnedPct(15, table)).toBe(0.2)
    expect(computeShortRateEarnedPct(45, table)).toBe(0.4)
  })

  it('falls back to fully earned when beyond the table', () => {
    expect(computeShortRateEarnedPct(1000, table)).toBe(1.0)
  })

  it('falls back to fully earned for an empty table', () => {
    expect(computeShortRateEarnedPct(10, [])).toBe(1.0)
  })
})

describe('computeReturnPremium', () => {
  const base = {
    fullPremium: 1200,
    cancelDate: '2026-01-16',
    termEffectiveDate: '2026-01-01',
    termExpirationDate: '2026-07-01', // 181-day term
  }

  it('FLAT returns the full premium and earns nothing', () => {
    const result = computeReturnPremium({ ...base, returnPremiumMethod: 'FLAT' })
    expect(result).toEqual({ returnPremium: 1200, earnedPremium: 0, method: 'FLAT' })
  })

  it('NONE returns nothing and earns the full premium', () => {
    const result = computeReturnPremium({ ...base, returnPremiumMethod: 'NONE' })
    expect(result).toEqual({ returnPremium: 0, earnedPremium: 1200, method: 'NONE' })
  })

  it('PRO_RATA splits premium by remaining term days', () => {
    // 181-day term, cancelled after 15 days in force -> 166 remaining days
    const result = computeReturnPremium({ ...base, returnPremiumMethod: 'PRO_RATA' })
    expect(result.method).toBe('PRO_RATA')
    expect(result.returnPremium).toBeCloseTo(1200 * (166 / 181), 2)
    expect(result.returnPremium + result.earnedPremium).toBeCloseTo(1200, 2)
  })

  it('SHORT_RATE applies the earned percentage from the table', () => {
    const shortRateTable = [{ days_from: 0, days_to: 30, earned_pct: 0.25 }]
    const result = computeReturnPremium({ ...base, returnPremiumMethod: 'SHORT_RATE', shortRateTable })
    expect(result.method).toBe('SHORT_RATE')
    expect(result.earnedPremium).toBeCloseTo(300, 2)
    expect(result.returnPremium).toBeCloseTo(900, 2)
  })

  it('SHORT_RATE with no table falls back to fully earned (no return)', () => {
    const result = computeReturnPremium({ ...base, returnPremiumMethod: 'SHORT_RATE' })
    expect(result.returnPremium).toBe(0)
    expect(result.earnedPremium).toBe(1200)
  })
})

describe('checkStateEligibility', () => {
  it('blocks by default when no eligibility record exists', async () => {
    const q = createQuery([])
    const result = await checkStateEligibility(q as any, 'tenant-1', 'personal-auto', 'CA')
    expect(result.eligible).toBe(false)
    expect(result.reason).toMatch(/not configured/i)
  })

  it('allows an ACTIVE eligibility record', async () => {
    const q = createQuery([
      { match: 'FROM product_state_eligibility', rows: [{ status: 'ACTIVE', admitted: true, surplus_lines: false, notes: null }] },
    ])
    const result = await checkStateEligibility(q as any, 'tenant-1', 'personal-auto', 'ca')
    expect(result).toEqual({ eligible: true, status: 'ACTIVE' })
  })

  it.each([
    ['SUSPENDED', /suspended/i],
    ['CLOSED', /closed to new business/i],
    ['FILING_PENDING', /filing.*pending/i],
  ])('blocks %s eligibility status with a descriptive reason', async (status, reasonPattern) => {
    const q = createQuery([
      { match: 'FROM product_state_eligibility', rows: [{ status, admitted: true, surplus_lines: false, notes: null }] },
    ])
    const result = await checkStateEligibility(q as any, 'tenant-1', 'homeowners', 'TX')
    expect(result.eligible).toBe(false)
    expect(result.status).toBe(status)
    expect(result.reason).toMatch(reasonPattern)
  })

  it('treats a missing product or state as eligible (no-op guard)', async () => {
    const q = createQuery([])
    expect(await checkStateEligibility(q as any, 'tenant-1', '', 'CA')).toEqual({ eligible: true })
    expect(await checkStateEligibility(q as any, 'tenant-1', 'personal-auto', '')).toEqual({ eligible: true })
  })
})

describe('screenOfac', () => {
  it('clears a party with no SDN match and no prior disposition', async () => {
    const q = createQuery([
      { match: 'FROM ofac_screens', rows: [] },
      { match: 'FROM ofac_sdn_list', rows: [] },
      { match: 'INSERT INTO ofac_screens', rows: [{ screen_id: 'screen-1' }] },
    ])
    const result = await screenOfac(q as any, 'tenant-1', 'Jane Doe', { policyId: 'policy-1' })
    expect(result.result).toBe('CLEAR')
    expect(result.matchDetails).toBeNull()
  })

  it('flags a fuzzy SDN name match as a potential hit', async () => {
    const q = createQuery([
      { match: 'FROM ofac_screens', rows: [] },
      {
        match: 'FROM ofac_sdn_list',
        rows: [{ entry_id: 'sdn-1', name: 'John Q Suspect', normalized_name: 'JOHN Q SUSPECT', aliases: [], country: 'XX', list_type: 'SDN' }],
      },
      { match: 'INSERT INTO ofac_screens', rows: [{ screen_id: 'screen-2' }] },
    ])
    const result = await screenOfac(q as any, 'tenant-1', 'John Q Suspect')
    expect(result.result).toBe('POTENTIAL_HIT')
    expect(result.matchDetails?.length).toBeGreaterThan(0)
  })

  it('carries forward a prior BLOCKED disposition as a confirmed hit even without a fresh SDN match', async () => {
    const q = createQuery([
      { match: 'FROM ofac_screens', rows: [{ disposition: 'BLOCKED' }] },
      { match: 'INSERT INTO ofac_screens', rows: [{ screen_id: 'screen-3' }] },
    ])
    const result = await screenOfac(q as any, 'tenant-1', 'Previously Blocked Party')
    expect(result.result).toBe('CONFIRMED_HIT')
    expect(result.matchDetails?.[0]?.note).toMatch(/previously blocked/i)
  })

  it('auto-clears a fresh fuzzy match when the party was previously cleared by a reviewer', async () => {
    const calls: Array<{ text: string; params?: any[] }> = []
    const q = createQuery([
      { match: 'FROM ofac_screens', rows: [{ disposition: 'CLEARED' }] },
      {
        match: 'FROM ofac_sdn_list',
        rows: [{ entry_id: 'sdn-1', name: 'Jane Cleared', normalized_name: 'JANE CLEARED', aliases: [], country: 'XX', list_type: 'SDN' }],
      },
      { match: 'INSERT INTO ofac_screens', rows: [{ screen_id: 'screen-4' }] },
    ], calls)
    const result = await screenOfac(q as any, 'tenant-1', 'Jane Cleared')
    expect(result.result).toBe('CLEAR')
    expect(calls[0].text).toMatch(/reviewed_by IS NOT NULL/)
  })
})
