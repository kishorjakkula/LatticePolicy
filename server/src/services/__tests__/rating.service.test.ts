import { describe, expect, it } from 'vitest'
import { rate } from '../rating.service.js'

function expectPremiumShape(premium: any) {
  expect(premium).toHaveProperty('byCoverage')
  expect(Array.isArray(premium.byCoverage)).toBe(true)
  expect(premium.byCoverage.length).toBeGreaterThan(0)
  expect(premium.fees.amount).toBeGreaterThanOrEqual(0)
  expect(premium.taxes.amount).toBeGreaterThanOrEqual(0)
  expect(premium.total.amount).toBeGreaterThan(0)
  expect(premium.total.currency).toBe('USD')
  for (const coverage of premium.byCoverage) {
    expect(coverage.amount.amount).toBeGreaterThanOrEqual(0)
    expect(coverage.amount.currency).toBe('USD')
  }
}

describe('rating.service', () => {
  it('rates a personal auto submission with selected coverages', () => {
    const premium = rate('sample-carrier', {
      productCode: 'personal-auto',
      state: 'CA',
      termMonths: 12,
      risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute' }],
      uwAnswers: { driverAge: 34 },
      coverages: [
        { code: 'BI', selected: true, limit: 100000 },
        { code: 'PD', selected: true, limit: 50000 },
        { code: 'COMP', selected: true, deductible: 500 },
        { code: 'COLL', selected: true, deductible: 500 },
      ],
    })

    expectPremiumShape(premium)
    expect(premium.byCoverage.map((item: any) => item.code)).toEqual(['BI', 'PD', 'COMP', 'COLL'])
  })

  it('rates a homeowners submission with dwelling and liability coverages', () => {
    const premium = rate('sample-carrier', {
      productCode: 'homeowners',
      state: 'TX',
      termMonths: 12,
      risks: [{ construction: 'frame', protectionClass: 4, roofAgeYears: 8 }],
      coverages: [
        { code: 'A', selected: true, limit: 350000 },
        { code: 'B', selected: true, percent: 10 },
        { code: 'C', selected: true, percent: 50 },
        { code: 'E', selected: true, limit: 300000 },
      ],
    })

    expectPremiumShape(premium)
    expect(premium.byCoverage.map((item: any) => item.code)).toEqual(['A', 'B', 'C', 'E'])
  })

  it('rates cyber risk higher when controls and loss history are worse', () => {
    const baseline = rate('sample-carrier', {
      productCode: 'cyber',
      state: 'NY',
      risks: [{
        industry: 'technology',
        annualRevenue: 1_000_000,
        employeeCount: 25,
        recordsCount: 10_000,
        mfaEnabled: true,
        endpointProtection: true,
        backups: 'daily',
        priorIncidents: 0,
        publicFacingApps: 1,
      }],
      coverages: [{ code: 'CYB_LIAB', selected: true, limit: 1_000_000, deductible: 5000 }],
    })
    const worseRisk = rate('sample-carrier', {
      productCode: 'cyber',
      state: 'NY',
      risks: [{
        industry: 'technology',
        annualRevenue: 1_000_000,
        employeeCount: 25,
        recordsCount: 10_000,
        mfaEnabled: false,
        endpointProtection: false,
        backups: 'none',
        priorIncidents: 3,
        publicFacingApps: 10,
      }],
      coverages: [{ code: 'CYB_LIAB', selected: true, limit: 1_000_000, deductible: 5000 }],
    })

    expectPremiumShape(baseline)
    expectPremiumShape(worseRisk)
    expect(worseRisk.total.amount).toBeGreaterThan(baseline.total.amount)
  })

  it('rates commercial auto and records builtin calc trace inputs', () => {
    const premium = rate('sample-carrier', {
      productCode: 'commercial-auto',
      state: 'IL',
      risks: [{
        vehicleCount: 4,
        driverCount: 5,
        useClass: 'service',
        radiusClass: 'local',
        vehicleType: 'van',
        gvwClass: 'light',
        annualMileage: 22000,
        yearsInBusiness: 7,
        priorLossesCount: 1,
      }],
      coverages: [
        { code: 'AUTO_LIAB', selected: true, limit: 1_000_000 },
        { code: 'COMP', selected: true, deductible: 1000 },
        { code: 'COLL', selected: true, deductible: 1000 },
      ],
    })

    expectPremiumShape(premium)
    expect(premium.calcTrace.source).toBe('builtin-commercial-auto-rater')
    expect(premium.calcTrace.factors.vehicleCount).toBe(4)
  })

  it('rates professional liability and records builtin calc trace inputs', () => {
    const premium = rate('sample-carrier', {
      productCode: 'professional-liability',
      state: 'FL',
      risks: [{
        industry: 'consulting',
        annualRevenue: 2_000_000,
        employeeCount: 12,
        yearsInBusiness: 10,
        largestContractValue: 250000,
        subcontractorPct: 10,
        writtenContracts: true,
        qualityControl: 'formal',
        retroactiveYears: 5,
        priorClaimsCount: 0,
      }],
      coverages: [
        { code: 'PROF_LIAB', selected: true, limit: 1_000_000, deductible: 5000 },
        { code: 'DEF_REIMB', selected: true, limit: 50000, deductible: 1000 },
      ],
    })

    expectPremiumShape(premium)
    expect(premium.calcTrace.source).toBe('builtin-professional-liability-rater')
    expect(premium.calcTrace.factors.priorClaimsCount).toBe(0)
  })

  it('throws when productCode is missing', () => {
    expect(() => rate('sample-carrier', {})).toThrow('productCode is required')
  })
})
