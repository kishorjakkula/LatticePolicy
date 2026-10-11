import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { parseRange, rateFromRateTable, validateRateTable } from '../rating-table.js'

const PACK_PRODUCT = path.resolve(__dirname, '../../../../examples/carrier-pack/products/condo-unit-owners')
const rates = YAML.parse(fs.readFileSync(path.join(PACK_PRODUCT, 'rates.yaml'), 'utf8'))
const productConfig = YAML.parse(fs.readFileSync(path.join(PACK_PRODUCT, 'coverage.yaml'), 'utf8'))

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function quote(overrides: Record<string, unknown> = {}) {
  return {
    productCode: 'condo-unit-owners',
    state: 'TX',
    termMonths: 12,
    risks: [{ type: 'dwelling', construction: 'masonry', protectionClass: 3, roofAgeYears: 5, floorLevel: 4, occupancy: 'OwnerOccupied' }],
    coverages: [
      { code: 'A', selected: true, limit: 150000, deductible: 2500 },
      { code: 'C', selected: true, percent: 50 },
      { code: 'E', selected: true, limit: 300000 },
      { code: 'F', selected: true, limit: 5000 },
      { code: 'LOSS_ASSESS', selected: true, limit: 10000 },
      { code: 'D', selected: false, percent: 20 },
    ],
    ...overrides,
  }
}

function premiums(result: any): Record<string, number> {
  return Object.fromEntries(result.byCoverage.map((item: any) => [item.code, item.amount.amount]))
}

function messages(issues: Array<{ level: string; message: string }>, level: 'error' | 'warning') {
  return issues.filter((issue) => issue.level === level).map((issue) => issue.message)
}

describe('rate-table rating', () => {
  it('prices each coverage by its method, the factors, and the deductible', () => {
    const result = rateFromRateTable(quote(), rates, productConfig)

    // Factors: masonry 0.90 x class 3 0.92 x roof 1.00 x floor 4 0.97 x owner 1.00 x TX 1.10 = 0.883476
    expect(result.calcTrace.factorProduct).toBe(0.883476)
    expect(premiums(result)).toEqual({
      A: 161.01, // 150 x 1.35 = 202.50, x 0.883476, x 0.90 for the 2,500 deductible
      C: 59.63, // 50% of A's limit = 75,000 -> 75 x 0.90, x 0.883476
      E: 48.59, // 55 for a 300,000 limit, x 0.883476
      F: 15, // 15 for a 5,000 limit, factors not applied
      LOSS_ASSESS: 22, // 22 for a 10,000 limit, factors not applied
    })
    expect(result.fees.amount).toBe(25)
    expect(result.taxes.amount).toBe(6.12) // 306.23 x 2%
    expect(result.total.amount).toBe(337.35)
  })

  it('records how the premium was reached', () => {
    const { calcTrace } = rateFromRateTable(quote(), rates, productConfig)
    expect(calcTrace).toMatchObject({ source: 'rate-table', productCode: 'condo-unit-owners', ratesVersion: '1.0.0', coverageSubtotal: 306.23, minimumPremiumAdjustment: 0 })
    expect(calcTrace.factors).toEqual(expect.arrayContaining([
      { name: 'Term', value: 12, factor: 1 },
      { name: 'Floor level', source: 'risks.0.floorLevel', value: 4, factor: 0.97, matched: true },
      { name: 'State', source: 'state', value: 'TX', factor: 1.1, matched: true },
    ]))
    expect(calcTrace.coverages).toContainEqual({ code: 'A', method: 'rate', limit: 150000, applyFactors: true, deductibleFactor: 0.9, premium: 161.01 })
    expect(calcTrace.coverages).toContainEqual({ code: 'C', method: 'rate', limit: 75000, applyFactors: true, deductibleFactor: null, premium: 59.63 })
  })

  it('applies the term factor and falls back to a factor default when nothing matches', () => {
    const sixMonths = rateFromRateTable(
      quote({ termMonths: 6, state: 'NV', risks: [{ type: 'dwelling', construction: 'log-cabin' }], coverages: [{ code: 'A', selected: true, limit: 200000 }] }),
      rates,
      productConfig
    )
    // 200 x 1.35 = 270, x 0.55 term; every other factor falls to its default of 1.
    expect(premiums(sixMonths)).toEqual({ A: 148.5, MIN_PREMIUM: 1.5 })
    expect(sixMonths.calcTrace.factors).toContainEqual({ name: 'Construction', source: 'risks.0.construction', value: 'log-cabin', factor: 1, matched: false })
  })

  it('raises the premium to the minimum and taxes the minimum', () => {
    const result = rateFromRateTable(quote({ coverages: [{ code: 'LOSS_ASSESS', selected: true, limit: 1000 }] }), rates, productConfig)
    expect(premiums(result)).toEqual({ LOSS_ASSESS: 6, MIN_PREMIUM: 144 })
    expect(result.calcTrace.minimumPremiumAdjustment).toBe(144)
    expect(result.taxes.amount).toBe(3)
    expect(result.total.amount).toBe(178)
  })

  it('supports flat, share-of-base, and default coverage pricing', () => {
    const custom = {
      version: '2.0.0',
      rating: {
        basePremium: 400,
        factors: [{ name: 'Tier', field: 'tier', table: { gold: 0.5 } }],
        coverages: { X: { flat: 30 }, Y: { shareOfBase: 0.25, applyFactors: false }, default: { shareOfBase: 0.1 } },
      },
    }
    const result = rateFromRateTable(
      { productCode: 'p', risks: [{ tier: 'GOLD' }], coverages: [{ code: 'X' }, { code: 'Y' }, { code: 'Other' }] },
      custom,
      {}
    )
    expect(premiums(result)).toEqual({ X: 15, Y: 100, OTHER: 20 })
    expect(result.fees.amount).toBe(0)
    expect(result.taxes.amount).toBe(0)
    expect(result.total.amount).toBe(135)
  })

  it('rejects a quote it cannot price instead of guessing', () => {
    expect(() => rateFromRateTable(quote({ coverages: [{ code: 'E', selected: true, limit: 250000 }] }), rates, productConfig))
      .toThrowError(expect.objectContaining({ code: 'RATING_LIMIT_NOT_RATED', statusCode: 400 }))
    expect(() => rateFromRateTable(quote({ coverages: [{ code: 'FLOOD', selected: true, limit: 1000 }] }), rates, productConfig))
      .toThrowError(expect.objectContaining({ code: 'RATING_COVERAGE_NOT_CONFIGURED' }))
    expect(() => rateFromRateTable(quote({ coverages: [{ code: 'A', selected: true }] }), rates, productConfig))
      .toThrowError(expect.objectContaining({ code: 'RATING_LIMIT_REQUIRED' }))
    expect(() => rateFromRateTable(quote(), { fees: { policy: 25 } }, productConfig))
      .toThrowError(expect.objectContaining({ code: 'RATING_NOT_CONFIGURED' }))

    const strict = clone(rates)
    strict.rating.factors[0].required = true
    delete strict.rating.factors[0].default
    expect(() => rateFromRateTable(quote({ risks: [{ construction: 'log-cabin' }] }), strict, productConfig))
      .toThrowError(expect.objectContaining({ code: 'RATING_FACTOR_NOT_FOUND' }))
  })

  it('reads the band forms carriers write', () => {
    const check = (label: string, inside: number[], outside: number[]) => {
      const inRange = parseRange(label)!
      expect(inside.every(inRange), `${label} should include ${inside}`).toBe(true)
      expect(outside.some(inRange), `${label} should exclude ${outside}`).toBe(false)
    }
    check('1-4', [1, 2.5, 4], [0, 5])
    check('9+', [9, 40], [8.9])
    check('<25', [24], [25])
    check('<=10', [10], [11])
    check('>5', [6], [5])
    check('>=65', [65], [64])
    expect(parseRange('young')).toBeNull()
  })
})

describe('rate-table validation', () => {
  it('accepts the example product with no errors or warnings', () => {
    const fields = ['construction', 'protectionClass', 'roofAgeYears', 'floorLevel', 'occupancy']
    expect(validateRateTable(rates, productConfig, fields)).toEqual([])
  })

  it('requires a rating section', () => {
    expect(messages(validateRateTable({ fees: {} }, productConfig), 'error')).toEqual(["ratingAdapter is 'rate-table' but there is no rating section"])
  })

  it('reports malformed factors', () => {
    const bad = clone(rates)
    bad.rating.factors = [
      { name: 'Both', field: 'a', path: 'b', table: { x: 1 } },
      { name: 'Neither', field: 'construction' },
      { name: 'Bands', field: 'protectionClass', ranges: { low: 0.9, '5-8': 'one' } },
      { name: 'Unknown field', field: 'hairColour', table: { red: 1 } },
    ]
    const issues = validateRateTable(bad, productConfig, ['construction', 'protectionClass'])
    expect(messages(issues, 'error')).toEqual(expect.arrayContaining([
      'rating.factors[1] (Both): set exactly one of field (a risk field) or path (anywhere on the quote)',
      'rating.factors[2] (Neither): set exactly one of table or ranges',
      "rating.factors[3] (Bands): 'low' is not a band; use forms like 1-4, 9+, <25, <=10, >5, >=65",
      "rating.factors[3] (Bands): factor for '5-8' must be a number of 0 or more",
    ]))
    expect(messages(issues, 'warning')).toContain("rating.factors[4] (Unknown field): reads field 'hairColour', which the product does not define")
  })

  it('reports coverages that cannot be priced', () => {
    const bad = clone(rates)
    delete bad.rating.coverages.C
    delete bad.rating.coverages.E.byLimit['500000']
    bad.rating.coverages.F = { flat: 5, rate: 2 }
    bad.rating.coverages.D = { shareOfBase: 0.1 }
    delete bad.rating.basePremium
    bad.rating.coverages.FLOOD = { flat: 10 }
    bad.taxes.rate = 2

    const issues = validateRateTable(bad, productConfig)
    expect(messages(issues, 'error')).toEqual(expect.arrayContaining([
      "rating.coverages: coverage 'C' has no pricing and there is no default",
      'rating.coverages.E: no premium for limit 500000, which the product offers',
      'rating.coverages.F: set exactly one pricing method (rate, byLimit, flat, or shareOfBase)',
      'rating.coverages.D: shareOfBase needs rating.basePremium',
      'taxes.rate must be a fraction between 0 and 1',
    ]))
    expect(messages(issues, 'warning')).toContain("rating.coverages.FLOOD: 'FLOOD' is not a coverage of this product")
  })
})
