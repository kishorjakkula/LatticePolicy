import { describe, expect, it } from 'vitest'
import { resolvePolicyDetailTokens } from '../document-template-variables.js'

describe('businessowners saved document terms', () => {
  it('does not synthesize missing historical terms from a newer product definition', () => {
    const payload = { productCode: 'businessowners', coverages: [{ code: 'BOP_LIAB', selected: true, limit: 500000 }] }
    const newerConfig = { coverages: [{ code: 'BOP_LIAB', packageTerms: { generalAggregate: 9000000 } }] }
    const first = resolvePolicyDetailTokens(payload, newerConfig)
    expect(first.businessownersCoverageSummary).toContain('$500,000')
    expect(first.businessownersCoverageSummary).not.toContain('aggregate')
    expect(first.businessownersCoverageSummary).not.toContain('9,000,000')
    expect(resolvePolicyDetailTokens(payload, { coverages: [] }).businessownersCoverageSummary)
      .toBe(first.businessownersCoverageSummary)
  })

  it('keeps recorded false/zero values, excludes deselections, and never fabricates missing limits', () => {
    const summary = resolvePolicyDetailTokens({ productCode: 'businessowners', coverages: [
      { code: 'BOP_BI_EE', limit: 0, deductible: 0, packageTerms: { waitingPeriodHours: 0, extraExpenseIncluded: false, sharedLimit: false } },
      { code: 'BOP_WATER', selected: false, limit: 25000 },
      { code: 'BOP_EQUIP' },
    ] }).businessownersCoverageSummary
    expect(summary).toContain('Limit: $0')
    expect(summary).toContain('Deductible: $0')
    expect(summary).toContain('Income waiting period: 0 hours')
    expect(summary).toContain('Extra expense included: No')
    expect(summary).toContain('Shared income and extra expense limit: No')
    expect(summary).toContain('Limit: Not recorded')
    expect(summary).not.toContain('BOP_WATER')
  })

  it('preserves complete premises addresses and explicit occupancy without inferring ownership', () => {
    const summary = resolvePolicyDetailTokens({ productCode: 'businessowners', risks: [{
      businessName: 'Synthetic Tenant LLC', occupancy: 'tenant', buildingInterest: false, employeeCount: 0,
      locationAddress: { line1: '20 Example Street', line2: 'STE 2', line3: 'East Wing', city: 'Columbus', state: 'OH', postalCode: '01234-5678', country: 'US' },
    }] }).businessownersRiskSummary
    expect(summary).toContain('20 Example Street, STE 2, East Wing, Columbus, OH 01234-5678')
    expect(summary).toContain('Occupancy: tenant')
    expect(summary).toContain('Building interest: No')
    expect(summary).toContain('Employees: 0')
  })

  it('leaves BOP tokens blank for existing products', () => {
    for (const productCode of ['homeowners', 'personal-auto', 'commercial-auto', 'cyber', 'professional-liability']) {
      expect(resolvePolicyDetailTokens({ productCode })).toMatchObject({ businessownersRiskSummary: '', businessownersCoverageSummary: '' })
    }
  })
})
