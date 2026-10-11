import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { parseRange, rateFromRateTable, tablesUsedByRates, validateRateTable } from '../rating-table.js'
import { readPackTables } from '../carrier-tables.js'

const PACK_PRODUCT = path.resolve(__dirname, '../../../../examples/carrier-pack/products/condo-unit-owners')
const rates = YAML.parse(fs.readFileSync(path.join(PACK_PRODUCT, 'rates.yaml'), 'utf8'))
const productConfig = YAML.parse(fs.readFileSync(path.join(PACK_PRODUCT, 'coverage.yaml'), 'utf8'))
const tables = Object.fromEntries(
  readPackTables({ dir: path.resolve(PACK_PRODUCT, '../..'), manifest: { packFormat: 1, carrier: 'acme-mutual', version: '1.0.0' } }).map((entry) => [entry.name, entry.table!])
)
const packOptions = { tables, listColumns: { scheduledItems: ['description', 'category', 'value'] } }

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
    const fields = ['construction', 'protectionClass', 'roofAgeYears', 'roofType', 'floorLevel', 'occupancy']
    expect(validateRateTable(rates, productConfig, fields, packOptions)).toEqual([])
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
    const issues = validateRateTable(bad, productConfig, ['construction', 'protectionClass'], packOptions)
    expect(messages(issues, 'error')).toEqual(expect.arrayContaining([
      'rating.factors[1] (Both): set exactly one of field (a risk field) or path (anywhere on the quote)',
      'rating.factors[2] (Neither): set exactly one of table, ranges, or fromTable',
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

    const issues = validateRateTable(bad, productConfig, [], packOptions)
    expect(messages(issues, 'error')).toEqual(expect.arrayContaining([
      "rating.coverages: coverage 'C' has no pricing and there is no default",
      'rating.coverages.E: no premium for limit 500000, which the product offers',
      'rating.coverages.F: set exactly one pricing method (rate, byLimit, flat, shareOfBase, or perItem)',
      'rating.coverages.D: shareOfBase needs rating.basePremium',
      'taxes.rate must be a fraction between 0 and 1',
    ]))
    expect(messages(issues, 'warning')).toContain("rating.coverages.FLOOD: 'FLOOD' is not a coverage of this product")
  })
})

describe('rate-table rating with carrier tables and lists', () => {
  const scheduled = [
    { description: 'Ring', category: 'jewelry', value: 5000 },
    { description: 'Painting', category: 'art', value: '12000' },
    { description: 'Bike', category: 'other', value: 800 },
  ]

  it('reads a factor from a carrier lookup table', () => {
    const base = rateFromRateTable(quote(), rates, productConfig, tables)
    const metal = rateFromRateTable(quote({ risks: [{ ...quote().risks[0], roofType: 'metal' }] }), rates, productConfig, tables)
    // No roof type entered: the factor falls to its default of 1 and the premium is unchanged.
    expect(base.total.amount).toBe(337.35)
    expect(base.calcTrace.factors).toContainEqual({ name: 'Roof type', source: 'risks.0.roofType', value: null, factor: 1, matched: false })
    // Metal roof 0.94: 0.883476 x 0.94 = 0.830467.
    expect(metal.calcTrace.factorProduct).toBe(0.830467)
    expect(metal.calcTrace.factors).toContainEqual({ name: 'Roof type', source: 'risks.0.roofType', value: 'metal', factor: 0.94, matched: true })
    expect(premiums(metal).A).toBe(151.35) // 202.50 x 0.830467 x 0.90
  })

  it('prices a coverage per item of a list, with item-level factors', () => {
    const result = rateFromRateTable(
      quote({ risks: [{ ...quote().risks[0], scheduledItems: scheduled }], coverages: [{ code: 'SCHEDULED', selected: true }] }),
      rates,
      productConfig,
      tables
    )
    // 5,000 jewelry: 50 x 1.20 x 1.50 = 90.00; 12,000 art: 120 x 1.20 x 1.20 = 172.80; 800 other: 8 x 1.20 x 1 = 9.60.
    expect(premiums(result)).toEqual({ SCHEDULED: 272.4 })
    expect(result.calcTrace.coverages).toEqual([{
      code: 'SCHEDULED', method: 'perItem', limit: null, applyFactors: false, deductibleFactor: null, premium: 272.4,
      items: [
        { item: 1, amount: 5000, factor: 1.5, premium: 90 },
        { item: 2, amount: 12000, factor: 1.2, premium: 172.8 },
        { item: 3, amount: 800, factor: 1, premium: 9.6 },
      ],
    }])
  })

  it('prices an empty list at nothing and refuses an item with no amount', () => {
    const none = rateFromRateTable(quote({ coverages: [{ code: 'SCHEDULED', selected: true }] }), rates, productConfig, tables)
    expect(premiums(none)).toEqual({ SCHEDULED: 0, MIN_PREMIUM: 150 })
    expect(() => rateFromRateTable(
      quote({ risks: [{ ...quote().risks[0], scheduledItems: [{ description: 'Mystery', category: 'art' }] }], coverages: [{ code: 'SCHEDULED', selected: true }] }),
      rates,
      productConfig,
      tables
    )).toThrowError(expect.objectContaining({ code: 'RATING_ITEM_AMOUNT_REQUIRED' }))
  })

  it('names the tables a configuration reads', () => {
    expect(tablesUsedByRates(rates)).toEqual(['roof-types'])
    expect(tablesUsedByRates({ rating: { coverages: { X: { perItem: { factors: [{ fromTable: 'item-classes' }] } } } } })).toEqual(['item-classes'])
    expect(tablesUsedByRates({})).toEqual([])
  })

  it('reports table and list mistakes in the configuration', () => {
    const bad = clone(rates)
    bad.rating.factors[3] = { name: 'Roof type', field: 'roofType', fromTable: 'roof-kinds', value: 'factor' }
    bad.rating.factors.push({ name: 'Bad column', field: 'roofType', fromTable: 'roof-types', value: 'name' })
    bad.rating.coverages.SCHEDULED.perItem.list = 'valuables'
    expect(messages(validateRateTable(bad, productConfig, [], packOptions), 'error')).toEqual(expect.arrayContaining([
      "rating.factors[4] (Roof type): lookup table 'roof-kinds' is not in the pack",
      "rating.factors[8] (Bad column): 'roof-types' row asphalt has no usable name",
      "rating.coverages.SCHEDULED: perItem.list 'valuables' is not a list field of the product",
    ]))

    const badItem = clone(rates)
    badItem.rating.coverages.SCHEDULED.perItem.amount = 'worth'
    badItem.rating.coverages.SCHEDULED.perItem.factors[0].field = 'colour'
    expect(messages(validateRateTable(badItem, productConfig, [], packOptions), 'error')).toEqual(expect.arrayContaining([
      "rating.coverages.SCHEDULED: perItem.amount 'worth' is not a column of scheduledItems",
      "rating.coverages.SCHEDULED.perItem.factors[1] (Category): 'colour' is not a column of scheduledItems",
    ]))
  })
})
