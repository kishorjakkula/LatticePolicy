import { describe, expect, it, vi } from 'vitest'

vi.mock('../../ratingModelRegistry.js', () => ({ getPublishedRatingModelForProduct: vi.fn(() => null) }))

import { hoVersion2Factor, rate } from '../rating.service.js'
import { loadProductRates } from '../../lib/products.js'

const VERSION_1_RATES = {
  base: { state: '*', per100LimitRate: { A: 0.25, E: 0.15 } },
  constructionFactors: { frame: 1, masonry: 0.95, other: 1.05 },
  protectionClassFactors: { '1-4': 0.95, '5-8': 1, '9-10': 1.15 },
  roofAgeFactors: { '0-10': 1, '11-20': 1.05, '21+': 1.15 },
  fees: { policy: 35 },
  taxes: { rate: 0.02 },
}

const fullRisk = {
  construction: 'frame', protectionClass: 4, roofAgeYears: 8, yearBuilt: 1960, roofType: 'metal',
  dwellingUnits: '2', distanceToFireStationMiles: 12, fireAlarm: 'true', burglarAlarm: 'true',
}
const dwelling = { code: 'A', selected: true, limit: 350000, deductible: 2500, windHailPercent: 2 }

describe('homeowners version 2 rating', () => {
  it('leaves a quote pinned to version 1 rates exactly as before, whatever the risk says', () => {
    expect(hoVersion2Factor({ effectiveDate: '2026-12-01', risks: [fullRisk] }, VERSION_1_RATES as any, [dwelling])).toBe(1)
  })

  it('keeps the existing premium for a risk without version 2 attributes', () => {
    const premium = rate('sample-carrier', {
      productCode: 'homeowners', state: 'TX', termMonths: 12,
      risks: [{ construction: 'frame', protectionClass: 4, roofAgeYears: 8 }],
      coverages: [
        { code: 'A', selected: true, limit: 350000 },
        { code: 'B', selected: true, percent: 10 },
        { code: 'C', selected: true, percent: 50 },
        { code: 'E', selected: true, limit: 300000 },
      ],
    })
    expect(premium.total.amount).toBe(653.39)
  })

  it('applies each version 2 factor from the product rates', () => {
    const rates = loadProductRates('homeowners').rates as any
    const factor = hoVersion2Factor({ effectiveDate: '2026-12-01', risks: [fullRisk] }, rates, [dwelling])
    // deductible 2500, wind/hail 2%, 66-year-old dwelling, metal roof, two units, 12 miles to station, both alarms
    const expected = 0.88 * 0.96 * 1.15 * 0.92 * 1.12 * 1.25 * 0.97 * 0.98
    expect(factor).toBeCloseTo(expected, 10)
  })

  it('prices the optional endorsements when selected', () => {
    const premium = rate('sample-carrier', {
      productCode: 'homeowners', state: 'TX', termMonths: 12, effectiveDate: '2026-12-01',
      risks: [{ construction: 'masonry', protectionClass: 3, roofAgeYears: 5, yearBuilt: 2005 }],
      coverages: [
        { code: 'A', selected: true, limit: 400000, deductible: 1000, windHailPercent: 1 },
        { code: 'E', selected: true, limit: 300000 },
        { code: 'END_WB', selected: true, limit: 10000 },
        { code: 'END_PPRC', selected: true },
        { code: 'END_ORD', selected: true, percent: 50 },
        { code: 'END_ERC', selected: true, percent: 25 },
      ],
    })
    const byCode = Object.fromEntries(premium.byCoverage.map((item: any) => [item.code, item.amount.amount]))
    for (const code of ['END_WB', 'END_PPRC', 'END_ORD', 'END_ERC']) expect(byCode[code]).toBeGreaterThan(0)
    expect(byCode.END_ORD).toBeGreaterThan(byCode.END_ERC)
  })
})
