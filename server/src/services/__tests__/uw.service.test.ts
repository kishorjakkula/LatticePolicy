import { describe, expect, it, vi, beforeEach } from 'vitest'

// `evaluateUwRules` looks up active `underwriting_rules` rows itself (via
// getDb()/withTenantTx/toRawQuery), the same way rating.service.ts's
// published-workbook lookup is backed by its own DB access. Mock the DB
// module so tests can control exactly what rows (if any) are "configured"
// for a tenant/product, without a real database.
let mockRows: any[] = []
const getDbMock = vi.fn((): any => ({}))

vi.mock('../../db.js', () => ({
  getDb: () => getDbMock(),
  withTenantTx: async (_tenantId: string, fn: (db: any) => Promise<any>) => fn({}),
  toRawQuery: () => async () => ({ rows: mockRows }),
}))

import { evaluateUW, evaluateUwRules } from '../uw.service.js'
import { resolveFieldValue } from '../underwriting-rule-fields.js'

beforeEach(() => {
  mockRows = []
  getDbMock.mockReset()
  getDbMock.mockReturnValue(null) // default: no DB -- "nothing configured"
})

function rule(overrides: Partial<{
  field_path: string
  operator: string
  comparison_value: unknown
  outcome: 'Refer' | 'Decline'
  reason_code: string
  reason_description: string
}>) {
  return {
    field_path: 'x',
    operator: 'equals',
    comparison_value: null,
    outcome: 'Refer' as const,
    reason_code: 'R',
    reason_description: 'reason',
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Hard constraint: zero behavior change for any tenant/product with zero
// configured underwriting_rules rows. With no DB mocked (getDb() === null),
// evaluateUwRules always short-circuits to null, so evaluateUW must fall
// through to exactly the pre-existing hardcoded per-product logic. Expected
// values below were derived by hand-tracing uw.service.ts's hardcoded
// checks (now `evaluateUwFallback`) for each payload.
// ──────────────────────────────────────────────────────────────────────────
describe('evaluateUW — zero configured rules (regression: identical to the pre-existing hardcoded logic)', () => {
  it('personal-auto: eligible with no issues', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'personal-auto',
      uwAnswers: { driverAge: 34 },
      risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute', annualMiles: 12000 }],
    })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('personal-auto: declines a driver under 16', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'personal-auto',
      uwAnswers: { driverAge: 15 },
      risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute', annualMiles: 12000 }],
    })
    expect(result).toEqual({ decision: 'Decline', reasons: ['Driver age under 16 (decline)'] })
  })

  it('personal-auto: refers on every refer-worthy condition at once, in check order', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'personal-auto',
      uwAnswers: { driverAge: 17 },
      risks: [{ garagingZip: '941', symbol: 'EXOTIC1', usage: 'rideshare', annualMiles: 40000 }],
    })
    expect(result).toEqual({
      decision: 'Refer',
      reasons: [
        'Driver age under 18 (refer)',
        'Invalid garaging ZIP (refer)',
        'Annual miles > 35k (refer)',
        'Commercial/rideshare use (refer)',
        'High-performance symbol (refer)',
      ],
    })
  })

  it('commercial-auto: eligible fleet', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'commercial-auto',
      risks: [{
        vehicleCount: 10, driverCount: 15, annualMileage: 20000, yearsInBusiness: 5,
        priorLossesCount: 0, radiusClass: 'local', vehicleType: 'van', gvwClass: 'light',
        garagingZip: '60601',
      }],
    })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('commercial-auto: declines/refers across every check at once, in check order', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'commercial-auto',
      risks: [{
        vehicleCount: 200, driverCount: 900, annualMileage: 150000, yearsInBusiness: 0.5,
        priorLossesCount: 7, radiusClass: 'long-haul', vehicleType: 'tractor-trailer', gvwClass: 'heavy',
        garagingZip: '123',
      }],
    })
    expect(result).toEqual({
      decision: 'Decline',
      reasons: [
        'Invalid primary garaging ZIP (refer)',
        'Fleet size > 150 vehicles (decline)',
        'High driver-to-vehicle ratio (refer)',
        'Long-haul operations (refer)',
        'Tractor-trailer exposure requires underwriting review (refer)',
        'Heavy commercial vehicle exposure (refer)',
        'Average annual mileage > 100,000 (refer)',
        '6+ prior commercial auto losses (decline)',
        'New venture < 1 year in business (refer)',
      ],
    })
  })

  it('commercial-auto: mid-range refer only (fleet size + prior losses)', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'commercial-auto',
      risks: [{
        vehicleCount: 60, driverCount: 70, annualMileage: 50000, yearsInBusiness: 3,
        priorLossesCount: 4, radiusClass: 'intermediate', vehicleType: 'van', gvwClass: 'medium',
        garagingZip: '60601',
      }],
    })
    expect(result).toEqual({
      decision: 'Refer',
      reasons: ['Fleet size > 50 vehicles (refer)', 'Multiple prior commercial auto losses (refer)'],
    })
  })

  it('homeowners: eligible dwelling', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'homeowners',
      risks: [{ roofAgeYears: 8, protectionClass: 4 }],
    })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('homeowners: declines on roof age and protection class', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'homeowners',
      risks: [{ roofAgeYears: 35, protectionClass: 9 }],
    })
    expect(result).toEqual({
      decision: 'Decline',
      reasons: ['Roof age > 30 (decline)', 'Protection class 9-10 (decline)'],
    })
  })

  it('homeowners: refers in the 20-30 roof-age / 7-8 protection-class bands', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'homeowners',
      risks: [{ roofAgeYears: 25, protectionClass: 7 }],
    })
    expect(result).toEqual({
      decision: 'Refer',
      reasons: ['Roof age 20-30 (refer)', 'Protection class 7-8 (refer)'],
    })
  })

  it('cyber: eligible risk', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'cyber',
      risks: [{
        annualRevenue: 1_000_000, employeeCount: 25, recordsCount: 10_000,
        priorIncidents: 0, mfaEnabled: true, backups: 'daily',
      }],
    })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('cyber: declines on prior incidents and missing backups', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'cyber',
      risks: [{
        annualRevenue: 1_000_000, employeeCount: 25, recordsCount: 10_000,
        priorIncidents: 5, mfaEnabled: false, backups: 'none',
      }],
    })
    expect(result).toEqual({
      decision: 'Decline',
      reasons: [
        '3+ prior cyber incidents (decline)',
        'MFA not fully enabled (refer)',
        'No backup controls declared (decline)',
      ],
    })
  })

  it('cyber: refers across every refer-only condition at once', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'cyber',
      risks: [{
        annualRevenue: 200_000_000, employeeCount: 6_000, recordsCount: 6_000_000,
        priorIncidents: 1, mfaEnabled: true, backups: 'monthly',
      }],
    })
    expect(result).toEqual({
      decision: 'Refer',
      reasons: [
        'Prior cyber incident history (refer)',
        'Infrequent backup controls (refer)',
        'Large revenue profile > $100M (refer)',
        'Large workforce > 5,000 (refer)',
        'Very high sensitive records count (refer)',
      ],
    })
  })

  it('professional-liability: eligible risk', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'professional-liability',
      risks: [{
        priorClaimsCount: 0, yearsInBusiness: 10, annualRevenue: 2_000_000, subcontractorPct: 10,
        writtenContracts: true, qualityControl: 'formal', retroactiveYears: 5, largestContractValue: 250_000,
      }],
    })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('professional-liability: declines across every check at once, in check order', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'professional-liability',
      risks: [{
        priorClaimsCount: 5, yearsInBusiness: 0.5, annualRevenue: 60_000_000, subcontractorPct: 80,
        writtenContracts: false, qualityControl: 'limited', retroactiveYears: 0, largestContractValue: 30_000_000,
      }],
    })
    expect(result).toEqual({
      decision: 'Decline',
      reasons: [
        '4+ prior professional liability claims (decline)',
        'Startup or new venture with less than 1 year operations (refer)',
        'Revenue profile > $50M (refer)',
        'Subcontracted work exceeds 75% of revenue (refer)',
        'Written engagement contracts not consistently used (refer)',
        'Limited QA / peer review controls (refer)',
        'No prior acts / retroactive coverage history (refer)',
        'High single-client / contract concentration (refer)',
      ],
    })
  })

  it('professional-liability: refers on multiple prior claims plus contract concentration', async () => {
    const result = await evaluateUW('tenant-a', {
      productCode: 'professional-liability',
      risks: [{
        priorClaimsCount: 2, yearsInBusiness: 5, annualRevenue: 10_000_000, subcontractorPct: 20,
        writtenContracts: true, qualityControl: 'formal', retroactiveYears: 3, largestContractValue: 5_000_000,
      }],
    })
    expect(result).toEqual({
      decision: 'Refer',
      reasons: [
        'Multiple prior professional liability claims (refer)',
        'High single-client / contract concentration (refer)',
      ],
    })
  })
})

// ──────────────────────────────────────────────────────────────────────────
// evaluateUwRules: the generic engine itself, once a tenant has configured
// underwriting_rules rows (simulated here via the mocked DB module).
// ──────────────────────────────────────────────────────────────────────────
describe('evaluateUwRules', () => {
  beforeEach(() => {
    getDbMock.mockReturnValue({}) // DB "available"
  })

  it('returns null (fall back to hardcoded logic) when no rows are configured', async () => {
    mockRows = []
    const result = await evaluateUwRules('tenant-a', 'homeowners', { risks: [{ roofAgeYears: 40 }] })
    expect(result).toBeNull()
  })

  it('returns null immediately when there is no DB at all', async () => {
    getDbMock.mockReturnValue(null)
    mockRows = [rule({ field_path: 'risks[0].roofAgeYears', operator: 'greater_than', comparison_value: 25, outcome: 'Refer' })]
    const result = await evaluateUwRules('tenant-a', 'homeowners', { risks: [{ roofAgeYears: 40 }] })
    expect(result).toBeNull()
  })

  it('fires a single matching rule and reports its outcome/reason', async () => {
    mockRows = [
      rule({
        field_path: 'risks[0].roofAgeYears', operator: 'greater_than', comparison_value: 25,
        outcome: 'Refer', reason_description: 'Roof age > 25 (refer)',
      }),
    ]
    const result = await evaluateUwRules('tenant-a', 'homeowners', { risks: [{ roofAgeYears: 40 }] })
    expect(result).toEqual({ decision: 'Refer', reasons: ['Roof age > 25 (refer)'] })
  })

  it('produces Eligible with no reasons when configured rules exist but none fire', async () => {
    mockRows = [
      rule({ field_path: 'risks[0].roofAgeYears', operator: 'greater_than', comparison_value: 25, outcome: 'Refer' }),
    ]
    const result = await evaluateUwRules('tenant-a', 'homeowners', { risks: [{ roofAgeYears: 5 }] })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('escalates to the max severity across multiple firing rules without short-circuiting', async () => {
    mockRows = [
      rule({ field_path: 'risks[0].roofAgeYears', operator: 'greater_than_or_equal', comparison_value: 20, outcome: 'Refer', reason_description: 'refer-roof' }),
      rule({ field_path: 'risks[0].protectionClass', operator: 'greater_than_or_equal', comparison_value: 9, outcome: 'Decline', reason_description: 'decline-pc' }),
    ]
    const result = await evaluateUwRules('tenant-a', 'homeowners', { risks: [{ roofAgeYears: 25, protectionClass: 9 }] })
    expect(result).toEqual({ decision: 'Decline', reasons: ['refer-roof', 'decline-pc'] })
  })

  it('evaluates boolean is_false as "not affirmatively true", matching the hardcoded MFA/written-contracts checks', async () => {
    mockRows = [
      rule({ field_path: 'risks[0].mfaEnabled', operator: 'is_false', comparison_value: true, outcome: 'Refer', reason_description: 'mfa-refer' }),
    ]
    const withMfa = await evaluateUwRules('tenant-a', 'cyber', { risks: [{ mfaEnabled: true }] })
    expect(withMfa).toEqual({ decision: 'Eligible', reasons: [] })

    const withoutMfa = await evaluateUwRules('tenant-a', 'cyber', { risks: [{ mfaEnabled: false }] })
    expect(withoutMfa).toEqual({ decision: 'Refer', reasons: ['mfa-refer'] })

    const missingMfa = await evaluateUwRules('tenant-a', 'cyber', { risks: [{}] })
    expect(missingMfa).toEqual({ decision: 'Refer', reasons: ['mfa-refer'] })
  })

  it('evaluates the "in" operator case-insensitively against a list', async () => {
    mockRows = [
      rule({ field_path: 'risks[0].usage', operator: 'in', comparison_value: ['rideshare', 'commercial'], outcome: 'Refer', reason_description: 'usage-refer' }),
    ]
    const matching = await evaluateUwRules('tenant-a', 'personal-auto', { risks: [{ usage: 'RideShare' }] })
    expect(matching).toEqual({ decision: 'Refer', reasons: ['usage-refer'] })

    const nonMatching = await evaluateUwRules('tenant-a', 'personal-auto', { risks: [{ usage: 'commute' }] })
    expect(nonMatching).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('never fires equals/greater_than/etc. on a missing field', async () => {
    mockRows = [
      rule({ field_path: 'risks[0].annualMiles', operator: 'greater_than', comparison_value: 35000, outcome: 'Refer' }),
    ]
    const result = await evaluateUwRules('tenant-a', 'personal-auto', { risks: [{}] })
    expect(result).toEqual({ decision: 'Eligible', reasons: [] })
  })

  it('returns null when productCode or tenantId is missing', async () => {
    expect(await evaluateUwRules('', 'homeowners', {})).toBeNull()
    expect(await evaluateUwRules('tenant-a', '', {})).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────
// resolveFieldValue: the safe path resolver backing both the engine and the
// field catalog's contract with the admin UI.
// ──────────────────────────────────────────────────────────────────────────
describe('resolveFieldValue', () => {
  it('resolves a dotted path', () => {
    expect(resolveFieldValue({ uwAnswers: { driverAge: 42 } }, 'uwAnswers.driverAge')).toBe(42)
  })

  it('resolves a bracketed array index mid-path', () => {
    expect(resolveFieldValue({ risks: [{ roofAgeYears: 12 }] }, 'risks[0].roofAgeYears')).toBe(12)
  })

  it('returns undefined for a missing intermediate segment, never throws', () => {
    expect(resolveFieldValue({ risks: [] }, 'risks[0].roofAgeYears')).toBeUndefined()
    expect(resolveFieldValue({}, 'uwAnswers.driverAge')).toBeUndefined()
    expect(resolveFieldValue(null, 'risks[0].roofAgeYears')).toBeUndefined()
    expect(resolveFieldValue({ risks: 'not-an-array' }, 'risks[0].roofAgeYears')).toBeUndefined()
    expect(resolveFieldValue({ risks: [{ roofAgeYears: 5 }] }, 'risks[0].roofAgeYears.nested')).toBeUndefined()
  })
})
