import { describe, expect, it } from 'vitest'
import { applyProductPackage, coveragePackageTerms, productPackageViolations, refreshCopiedPackageTerms } from '../product-package.js'

const config = {
  fields: [
    { path: 'risks.0.occupancy', label: 'Occupancy', type: 'enum', enum: ['owner', 'tenant'], required: true },
    { path: 'risks.0.buildingInterest', label: 'Building interest', type: 'bool', required: true },
  ],
  packageRules: { riskCount: 1, riskType: 'businessownersLocation', termMonths: [12], states: ['OH'], requiredCoverages: ['BPP', 'LIAB'], buildingCoverage: 'BUILDING', occupancyField: 'occupancy', ownerOccupancy: 'owner', buildingInterestField: 'buildingInterest', requiredUnderwritingRules: true },
  coverages: [
    { code: 'BPP', required: true, limitType: 'value', minLimit: 10000, maxLimit: 1000000, deductibles: [1000, 2500], packageTerms: { valuation: 'replacement-cost' } },
    { code: 'LIAB', required: true, limits: [500000, 1000000], packageTerms: { basis: 'occurrence', damageToRentedPremisesLimit: 100000 }, aggregateMultiplier: 2, personalAdvertisingInjuryMultiplier: 1 },
    { code: 'BUILDING', limitType: 'value', minLimit: 100000, maxLimit: 5000000, deductibles: [1000] },
  ],
}
const quote = (): any => ({ productCode: 'businessowners', state: 'OH', termMonths: 12, risks: [{ type: 'businessownersLocation', occupancy: 'tenant', buildingInterest: false }], coverages: [{ code: 'BPP', selected: true, limit: 100000, deductible: 1000 }, { code: 'LIAB', selected: true, limit: 1000000 }] })

describe('versioned product package validation and authoritative benefits', () => {
  it('leaves established products unchanged', () => {
    const body = quote()
    body.productCode = 'personal-auto'
    expect(productPackageViolations(body, {})).toEqual([])
    applyProductPackage(body, {})
    expect(body.coverages[0].packageTerms).toBeUndefined()
  })
  it('derives distinct aggregates and included sublimits without additional selections', () => {
    const body = quote()
    applyProductPackage(body, config)
    expect(body.coverages).toHaveLength(2)
    expect(body.coverages[1].packageTerms).toEqual({ basis: 'occurrence', damageToRentedPremisesLimit: 100000, generalAggregate: 2000000, productsCompletedOperationsAggregate: 2000000, personalAdvertisingInjuryLimit: 1000000 })
    expect(productPackageViolations(body, config)).toEqual([])
  })
  it('does not depend on property insertion order when validating echoed benefits', () => {
    const body = quote()
    const terms = coveragePackageTerms(config.coverages[1], body.coverages[1])!
    body.coverages[1].packageTerms = Object.fromEntries(Object.entries(terms).reverse())
    expect(productPackageViolations(body, config)).toEqual([])
  })
  it.each([null, [], { generalAggregate: 999 }, { ...coveragePackageTerms(config.coverages[1], quote().coverages[1]), inventedBenefit: true }])('rejects forged terms %j', terms => {
    const body = quote()
    body.coverages[1].packageTerms = terms
    expect(productPackageViolations(body, config).some(error => error.path.endsWith('/packageTerms'))).toBe(true)
  })
  it.each([0, -1, true, '', '1e6', Infinity, NaN, 9999, 1000001])('rejects invalid property values %s', value => {
    const body = quote(); body.coverages[0].limit = value
    expect(productPackageViolations(body, config).some(error => error.path === '/coverages/0/limit')).toBe(true)
  })
  it.each([10000, 1000000])('accepts the configured property boundary %s', value => {
    const body = quote(); body.coverages[0].limit = value
    expect(productPackageViolations(body, config)).toEqual([])
  })
  it('rejects duplicate, foreign, nonboolean selection and invalid deductible', () => {
    const body = quote()
    body.coverages.push({ ...body.coverages[0] }, { code: 'FOREIGN', selected: true, limit: 1 })
    body.coverages[0].selected = 'true'; body.coverages[2].deductible = 1
    const errors = productPackageViolations(body, config)
    expect(errors.map(error => error.path)).toEqual(expect.arrayContaining(['/coverages/0/selected', '/coverages/2/code', '/coverages/2/deductible', '/coverages/3/code']))
  })
  it('rejects an omitted or deselected required part', () => {
    const body = quote(); body.coverages[1].selected = false
    expect(productPackageViolations(body, config).some(error => error.message.includes('LIAB'))).toBe(true)
  })
  it('requires owned building and insurable interest without forcing tenant building', () => {
    const body = quote(); expect(productPackageViolations(body, config)).toEqual([])
    body.risks[0].occupancy = 'owner'
    expect(productPackageViolations(body, config)).not.toEqual([])
    body.coverages.push({ code: 'BUILDING', selected: true, limit: 500000, deductible: 1000 })
    expect(productPackageViolations(body, config).some(error => error.path.endsWith('/buildingInterest'))).toBe(true)
    body.risks[0].buildingInterest = true
    expect(productPackageViolations(body, config)).toEqual([])
  })
  it.each(['risks', 'termMonths', 'state', 'type'])('refuses unsupported scope %s', scope => {
    const body = quote()
    if (scope === 'risks') body.risks.push({ ...body.risks[0] })
    if (scope === 'termMonths') body.termMonths = 6
    if (scope === 'state') body.state = 'NY'
    if (scope === 'type') body.risks[0].type = 'dwelling'
    expect(() => applyProductPackage(body, config)).toThrow(expect.objectContaining({ code: 'PRODUCT_RULES_NOT_MET' }))
  })
  it('uses the supplied pinned definition rather than an unrelated current configuration', () => {
    const body = quote()
    const pinned = structuredClone(config); pinned.coverages[1].aggregateMultiplier = 3
    applyProductPackage(body, pinned)
    expect(body.coverages[1].packageTerms.generalAggregate).toBe(3000000)
    expect(productPackageViolations(body, config)).not.toEqual([])
  })
  it.each([0, -1000, 50000, true, '1000'])('rejects unoffered liability deductible %s', deductible => {
    const body = quote(); body.coverages[1].deductible = deductible
    expect(productPackageViolations(body, config)).toEqual(expect.arrayContaining([expect.objectContaining({ path: '/coverages/1/deductible' })]))
    expect(() => applyProductPackage(body, config)).toThrow(expect.objectContaining({ code: 'PRODUCT_RULES_NOT_MET' }))
  })
  it('re-derives only trusted copied terms for a new edition without changing history', () => {
    const previous = quote(); applyProductPackage(previous, config)
    const original = structuredClone(previous)
    const next = structuredClone(previous)
    const edition = structuredClone(config); edition.coverages[1].aggregateMultiplier = 3
    refreshCopiedPackageTerms(next, edition)
    expect(next.coverages[1].packageTerms.generalAggregate).toBe(3000000)
    expect(previous).toEqual(original)
    expect(productPackageViolations(previous, config)).toEqual([])
    const client = structuredClone(previous); client.coverages[1].packageTerms.generalAggregate = 9000000
    expect(() => applyProductPackage(client, edition)).toThrow(expect.objectContaining({ code: 'PRODUCT_RULES_NOT_MET' }))
  })
})
