import { describe, expect, it, vi, beforeEach } from 'vitest'

// The published-rating-workbook lookup is backed by an in-memory cache that's
// normally populated from the database. Mock it so tests can control exactly
// when a tenant does/doesn't have a published model for a product, without a
// DB. Default (no override) mirrors real behavior for a tenant with nothing
// published: null.
vi.mock('../../ratingModelRegistry.js', () => ({
  getPublishedRatingModelForProduct: vi.fn(() => null),
}))

import { rate } from '../rating.service.js'
import { getPublishedRatingModelForProduct } from '../../ratingModelRegistry.js'

beforeEach(() => {
  vi.mocked(getPublishedRatingModelForProduct).mockReset()
  vi.mocked(getPublishedRatingModelForProduct).mockReturnValue(null)
})

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

// Fixed sample inputs reused below for every product line. Values captured
// from `rate()` against the original (pre-generalization) rating.service.ts
// with the same inputs and no published workbook -- used to prove that
// generalizing the "published workbook, else hardcoded rater" gate to all
// five product lines does not change a single hardcoded premium number.
const noWorkbookSamples: Array<{
  product: string
  payload: any
  expected: { byCoverage: Array<{ code: string; amount: number }>; fees: number; taxes: number; total: number }
  calcTraceSource: string
}> = [
  {
    product: 'personal-auto',
    payload: {
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
    },
    expected: {
      byCoverage: [
        { code: 'BI', amount: 300.71 },
        { code: 'PD', amount: 176.89 },
        { code: 'COMP', amount: 93.1 },
        { code: 'COLL', amount: 121.03 },
      ],
      fees: 25,
      taxes: 20.75,
      total: 737.48,
    },
    calcTraceSource: 'builtin-personal-auto-rater',
  },
  {
    product: 'homeowners',
    payload: {
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
    },
    expected: {
      byCoverage: [
        { code: 'A', amount: 373.51 },
        { code: 'B', amount: 53.2 },
        { code: 'C', amount: 99.75 },
        { code: 'E', amount: 79.8 },
      ],
      fees: 35,
      taxes: 12.13,
      total: 653.39,
    },
    calcTraceSource: 'builtin-homeowners-rater',
  },
  {
    product: 'cyber',
    payload: {
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
    },
    expected: {
      byCoverage: [{ code: 'CYB_LIAB', amount: 413.8 }],
      fees: 65,
      taxes: 10.35,
      total: 489.15,
    },
    calcTraceSource: 'builtin-cyber-rater',
  },
  {
    product: 'commercial-auto',
    payload: {
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
    },
    expected: {
      byCoverage: [
        { code: 'AUTO_LIAB', amount: 2412.41 },
        { code: 'COMP', amount: 502.58 },
        { code: 'COLL', amount: 502.58 },
      ],
      fees: 95,
      taxes: 102.53,
      total: 3615.1,
    },
    calcTraceSource: 'builtin-commercial-auto-rater',
  },
  {
    product: 'professional-liability',
    payload: {
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
    },
    expected: {
      byCoverage: [
        { code: 'PROF_LIAB', amount: 1439.2 },
        { code: 'DEF_REIMB', amount: 208.92 },
      ],
      fees: 85,
      taxes: 41.2,
      total: 1774.32,
    },
    calcTraceSource: 'builtin-professional-liability-rater',
  },
]

describe('rating.service — published-workbook gating, generalized to every product line', () => {
  it.each(noWorkbookSamples)(
    'produces an identical $product premium to the pre-generalization hardcoded rater when no workbook is published',
    ({ payload, expected, calcTraceSource }) => {
      // No tenant has anything published (default mock) -- every product
      // must fall back to its existing hardcoded rater, byte-for-byte.
      const premium = rate('sample-carrier', payload)

      expect(premium.byCoverage.map((c: any) => ({ code: c.code, amount: c.amount.amount }))).toEqual(
        expected.byCoverage
      )
      expect(premium.fees.amount).toBe(expected.fees)
      expect(premium.taxes.amount).toBe(expected.taxes)
      expect(premium.total.amount).toBe(expected.total)
      // The governance audit trail must always say which source priced the
      // quote, even when nothing has been published yet.
      expect(premium.calcTrace?.source).toBe(calcTraceSource)
    }
  )

  it.each([
    ['personal-auto', 'CA', 'BI'],
    ['commercial-auto', 'IL', 'AUTO_LIAB'],
    ['homeowners', 'TX', 'A'],
    ['cyber', 'NY', 'CYB_LIAB'],
    ['professional-liability', 'FL', 'PROF_LIAB'],
  ])(
    'prefers an active published rating workbook over the hardcoded rater for %s',
    (product, stateCode, coverageCode) => {
      const syntheticModel = {
        modelCode: `${product}-${stateCode.toLowerCase()}-synthetic`,
        versionId: 'version-synthetic-1',
        versionLabel: 'v1.0',
        stateCode,
        // Minimal synthetic workbookJson shape -- structurally identical to
        // what the generic Excel parser in rating-workbench.routes.ts
        // produces (tables keyed by sheet alias, rows as plain records). No
        // real actuarial rate content: just enough to prove the dispatch
        // prefers the published model.
        workbookJson: {
          tables: {
            baseLossCosts: [
              { State: stateCode, Coverage: coverageCode, Limit: '', 'Base Loss Cost': 1000 },
            ],
            assumptions: [
              { Parameter: 'Policy Fee', Value: 10 },
              { Parameter: 'Premium Tax Rate', Value: 0.05 },
            ],
          },
        },
      }

      vi.mocked(getPublishedRatingModelForProduct).mockImplementation((_tenantId: string, productCode: string) =>
        productCode === product ? (syntheticModel as any) : null
      )

      const premium = rate('sample-carrier', {
        productCode: product,
        state: stateCode,
        termMonths: 12,
        // Intentionally no `coverages` -- proves the generic workbook
        // interpreter derives the coverage set from the workbook's own base
        // loss cost table rather than assuming an auto-specific default list.
        risks: [{}],
      })

      expect(premium.calcTrace?.source).toBe('published-rating-model')
      expect(premium.calcTrace?.modelCode).toBe(syntheticModel.modelCode)
      expect(premium.calcTrace?.versionId).toBe(syntheticModel.versionId)
      expect(premium.byCoverage).toHaveLength(1)
      expect(premium.byCoverage[0].code).toBe(coverageCode)
      // base loss cost (1000) x all-neutral relativities (1x) + fee (10) + 5% tax (50)
      expect(premium.total.amount).toBe(1060)
    }
  )

  it('still falls back to the hardcoded rater when a published model exists but has no usable workbook tables', () => {
    vi.mocked(getPublishedRatingModelForProduct).mockReturnValue({
      modelCode: 'cyber-empty',
      versionId: 'v-empty',
      versionLabel: 'v1.0',
      stateCode: 'NY',
      workbookJson: { tables: {} },
    } as any)

    const premium = rate('sample-carrier', {
      productCode: 'cyber',
      state: 'NY',
      risks: [{ industry: 'technology', annualRevenue: 1_000_000, employeeCount: 25 }],
      coverages: [{ code: 'CYB_LIAB', selected: true, limit: 1_000_000, deductible: 5000 }],
    })

    expect(premium.calcTrace?.source).toBe('builtin-cyber-rater')
  })
})
