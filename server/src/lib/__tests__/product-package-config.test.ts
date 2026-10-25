import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors/domain.errors.js'
import { assertValidProductPackageConfig } from '../product-package-config.js'

const bop = YAML.parse(readFileSync(new URL('../../../../products/businessowners/coverage.yaml', import.meta.url), 'utf8'))
const clone = () => structuredClone(bop)
function invalid(config: any, path?: string) {
  let thrown: unknown
  try { assertValidProductPackageConfig(config) } catch (error) { thrown = error }
  expect(thrown).toBeInstanceOf(ValidationError)
  const error = thrown as ValidationError
  expect(error.code).toBe('PRODUCT_PACKAGE_CONFIG_INVALID')
  expect(error.statusCode).toBe(422)
  const details = error.details as {errors: {path: string; message: string}[]}
  expect(details.errors.length).toBeGreaterThan(0)
  if (path) expect(details.errors.some(entry => entry.path.startsWith(path))).toBe(true)
  return details
}

describe('fail-closed product package configuration', () => {
  it.each([undefined, null, {}, {coverages: []}, {fields: []}])('leaves products without package rules unchanged: %j', config => {
    expect(() => assertValidProductPackageConfig(config)).not.toThrow()
  })
  it('accepts the full current BOP edition without changing its definition', () => {
    const config = clone(), before = structuredClone(config)
    assertValidProductPackageConfig(config)
    expect(config).toEqual(before)
  })
  it.each([undefined, null, {}, {fields: []}])('requires package rules when the caller binds a package product: %j', config => {
    expect(() => assertValidProductPackageConfig(config, {required: true})).toThrowError(
      expect.objectContaining({code: 'PRODUCT_PACKAGE_CONFIG_INVALID', statusCode: 422}),
    )
  })
  it('accepts current BOP with required-package mode', () => {
    expect(() => assertValidProductPackageConfig(clone(), {required: true})).not.toThrow()
  })
  it.each([false, undefined])('forced mode rejects disabled or omitted underwriting-rule requirements: %j', value => {
    const config = clone()
    if (value === undefined) delete config.packageRules.requiredUnderwritingRules
    else config.packageRules.requiredUnderwritingRules = value
    expect(() => assertValidProductPackageConfig(config, {required: true})).toThrowError(
      expect.objectContaining({code: 'PRODUCT_PACKAGE_CONFIG_INVALID', details: {errors: [
        {path: '/packageRules/requiredUnderwritingRules', message: 'This product must require configured underwriting rules.'},
      ]}}),
    )
    expect(() => assertValidProductPackageConfig(config)).not.toThrow()
  })
  it('accepts a generic package with different codes and required fact metadata', () => {
    const config = {
      packageRules: {riskType: 'differentRisk', riskCount: 1, states: ['NY'], termMonths: [6, 12],
        requiredCoverages: ['PROPERTY', 'LIABILITY'], buildingCoverage: 'BUILDING',
        buildingInterestField: 'interest', occupancyField: 'occupancy', ownerOccupancy: 'owned'},
      fields: [
        {path: 'risks.0.occupancy', label: 'Occupancy', type: 'enum', required: true, enum: ['owned', 'rented']},
        {path: 'risks.0.interest', label: 'Interest', type: 'bool', required: true},
      ],
      coverages: [
        {code: 'PROPERTY', required: true, limitType: 'value', minLimit: 10000, maxLimit: 1000000,
          deductibles: [0, 1000], packageTerms: {valuation: 'replacement-cost'}},
        {code: 'LIABILITY', required: true, limits: [500000, 1000000], aggregateMultiplier: 3,
          personalAdvertisingInjuryMultiplier: 1, packageTerms: {basis: 'occurrence', damageToRentedPremisesLimit: 100000}},
        {code: 'BUILDING', limitType: 'value', minLimit: 100000, maxLimit: 5000000, deductibles: [1000]},
      ],
    }
    expect(() => assertValidProductPackageConfig(config)).not.toThrow()
  })
  it.each([null, undefined, false, [], '', 'rules'])('refuses a malformed declared package: %j', rules => {
    invalid({...clone(), packageRules: rules}, '/packageRules')
  })
  it.each(['riskType', 'riskCount', 'states', 'termMonths', 'requiredCoverages', 'buildingCoverage',
    'buildingInterestField', 'ownerOccupancy', 'occupancyField'])('requires declared rule %s', key => {
    const config = clone(); delete config.packageRules[key]
    invalid(config, '/packageRules')
  })
  it.each([
    {riskType: ''}, {riskType: 'constructor'}, {riskCount: 0}, {riskCount: 2}, {riskCount: 1.5}, {riskCount: Infinity},
    {states: []}, {states: ['OH', 'OH']}, {states: ['']}, {states: 'OH'},
    {termMonths: []}, {termMonths: [0]}, {termMonths: [NaN]}, {termMonths: [12, 12]}, {termMonths: ['12']},
    {requiredCoverages: []}, {requiredCoverages: ['BOP_BPP', 'BOP_BPP']}, {requiredCoverages: ['UNKNOWN']},
    {requiredUnderwritingRules: 'true'}, {ignoredRules: {}}, {riskRules: []}, {riskRules: [{field: 'annualRevenue', max: 5000000}]},
  ])('rejects invalid scope/options/references: %j', patch => {
    const config = clone(); Object.assign(config.packageRules, patch)
    invalid(config, '/packageRules')
  })
  it('rejects both independently reproduced fail-open configurations', () => {
    const invalidTerms = clone()
    invalidTerms.coverages.find((definition: any) => definition.code === 'BOP_LIAB').aggregateMultiplier = 'invalid'
    invalid(invalidTerms, '/coverages')
    const unrestricted = clone(); unrestricted.fields = []; delete unrestricted.packageRules.requiredCoverages
    const details = invalid(unrestricted)
    expect(details.errors.some(error => error.path === '/fields')).toBe(true)
    expect(details.errors.some(error => error.path === '/packageRules/requiredCoverages')).toBe(true)
  })
  it.each([null, [], {}, [null], [{path: 'risks.0.a', type: 'string', label: 'A'}]])('rejects missing or malformed field metadata: %j', fields => {
    invalid({...clone(), fields}, '/fields')
  })
  it.each([
    {path: 'risks.0.__proto__'}, {path: 'risks.1.businessName'}, {path: 'risks.0.a.b'},
    {type: 'unknown'}, {required: 'true'}, {label: ''}, {enum: ['unused']},
    {validation: {min: NaN}}, {validation: {min: 2, max: 1}}, {validation: {maximum: 10}},
    {validation: {min: '0'}},
  ])('rejects invalid field descriptors: %j', patch => {
    const config = clone(); Object.assign(config.fields[0], patch)
    invalid(config, '/fields')
  })
  it('rejects duplicate fields and malformed numeric ranges/enum options', () => {
    const duplicate = clone(); duplicate.fields.push(duplicate.fields[0]); invalid(duplicate, '/fields')
    for (const validation of [{min: 1.5}, {max: Infinity}, {min: 10, max: 1}]) {
      const config = clone(); config.fields.find((field: any) => field.type === 'int').validation = validation
      invalid(config, '/fields')
    }
    const config = clone(); config.fields.find((field: any) => field.type === 'enum').enum = []
    invalid(config, '/fields')
  })
  it.each(['buildingInterestField', 'occupancyField'])('requires a valid, required typed field reference for %s', key => {
    const config = clone(); config.packageRules[key] = 'unknown'; invalid(config, '/packageRules/' + key)
    const optional = clone(); optional.fields.find((field: any) => field.path.endsWith('.' + optional.packageRules[key])).required = false
    invalid(optional, '/packageRules/' + key)
  })
  it.each([
    {format: 'free-text'}, {properties: []}, {requiredProperties: []},
    {requiredProperties: ['line1']}, {requiredProperties: ['line1', 'city', 'state', 'postalCode', 'country', 'missing']},
  ])('rejects incomplete postal-address metadata: %j', patch => {
    const config = clone(); Object.assign(config.fields.find((field: any) => field.type === 'object'), patch)
    invalid(config, '/fields')
  })
  it('rejects malformed address property types and enum options', () => {
    for (const property of [null, {type: 'object'}, {type: 'enum', enum: []}, {type: 'enum', enum: ['OH', 'OH']}]) {
      const config = clone(); config.fields.find((field: any) => field.type === 'object').properties.state = property
      invalid(config, '/fields')
    }
  })
  it.each([null, [], {}, [null]])('requires usable coverage definitions: %j', coverages => {
    invalid({...clone(), coverages}, '/coverages')
  })
  it('rejects duplicate coverage codes and required/reference disagreements', () => {
    const duplicate = clone(); duplicate.coverages.push(duplicate.coverages[0]); invalid(duplicate, '/coverages')
    const missing = clone(); missing.coverages = missing.coverages.filter((definition: any) => definition.code !== 'BOP_BPP')
    invalid(missing, '/packageRules/requiredCoverages')
    const unmarked = clone(); delete unmarked.coverages[1].required; invalid(unmarked, '/packageRules/requiredCoverages')
    const unlisted = clone(); unlisted.packageRules.requiredCoverages = ['BOP_BPP']; invalid(unlisted, '/packageRules/requiredCoverages')
  })
  it.each([
    {code: ''}, {minLimit: undefined}, {maxLimit: undefined}, {minLimit: 0}, {maxLimit: Infinity},
    {minLimit: 6000000}, {maxLimit: '5000000'}, {limitType: 'unknown'}, {limits: [100000]},
    {defaultLimit: 1}, {deductibles: []}, {deductibles: [-1]}, {deductibles: [Infinity]},
    {deductibles: ['1000']}, {defaultDeductible: 7}, {optional: 'true'}, {selectable: 'true'},
  ])('rejects invalid property ranges/options: %j', patch => {
    const config = clone(); Object.assign(config.coverages[0], patch)
    invalid(config, '/coverages')
  })
  it.each([[], [0], [-1], [1.5], [NaN], [Infinity], ['5000'], [5000, 5000]].map(limits => ({limits})))('rejects invalid fixed limit options: %j', ({limits}) => {
    const config = clone(); config.coverages[4].limits = limits; invalid(config, '/coverages')
  })
  it.each(['invalid', NaN, Infinity, -Infinity, 0, -1, null, undefined, true, {}, []])('rejects invalid multipliers: %j', multiplier => {
    for (const key of ['aggregateMultiplier', 'personalAdvertisingInjuryMultiplier']) {
      const config = clone(); config.coverages[3][key] = multiplier; invalid(config, '/coverages/3')
    }
  })
  it('rejects derived overflow or loss of safe monetary precision', () => {
    for (const multiplier of [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]) {
      const config = clone(); config.coverages[3].aggregateMultiplier = multiplier; invalid(config, '/coverages/3')
    }
    const config = clone(); config.coverages[3].limits = [Number.MAX_VALUE]; invalid(config, '/coverages/3')
  })
  it.each([null, [], {}, 'terms', {generalAggregate: NaN}, {basis: 'unknown'}, {basis: 'occurrence', extra: true}])('rejects malformed/unsupported fixed terms: %j', packageTerms => {
    const config = clone(); config.coverages[3].packageTerms = packageTerms; invalid(config, '/coverages/3')
  })
  it.each([
    {restorationMonths: 0}, {restorationMonths: 1.5}, {restorationMonths: Infinity},
    {waitingPeriodHours: -1}, {waitingPeriodHours: 1.5}, {waitingPeriodHours: NaN},
    {extraExpenseIncluded: 'true'}, {sharedLimit: null},
  ])('rejects invalid fixed income semantics: %j', patch => {
    const config = clone(); Object.assign(config.coverages[2].packageTerms, patch); invalid(config, '/coverages/2')
  })
  it('requires complete declared income, occurrence and per-person terms without BOP code checks', () => {
    for (const key of ['restorationMonths', 'waitingPeriodHours', 'extraExpenseIncluded', 'sharedLimit']) {
      const config = clone(); delete config.coverages[2].packageTerms[key]; invalid(config, '/coverages/2')
    }
    for (const key of ['aggregateMultiplier', 'personalAdvertisingInjuryMultiplier']) {
      const config = clone(); delete config.coverages[3][key]; invalid(config, '/coverages/3')
    }
    const config = clone(); delete config.coverages[4].packageTerms.included; invalid(config, '/coverages/4')
  })
  it('rejects nonfinite included amounts and cross-type terms', () => {
    for (const value of [NaN, Infinity, '100000', -1, 0, {}]) {
      const config = clone(); config.coverages[3].packageTerms.damageToRentedPremisesLimit = value
      invalid(config, '/coverages/3')
    }
    const config = clone(); config.coverages[1].packageTerms.waitingPeriodHours = 72; invalid(config, '/coverages/1')
    const missing = clone(); delete missing.coverages[1].packageTerms; invalid(missing, '/packageRules/requiredCoverages')
  })
  it('refuses prototype-shaped objects, accessors and sparse lists without raw-value error leakage', () => {
    const inherited = clone(); inherited.packageRules = Object.create(inherited.packageRules); invalid(inherited)
    const dangerous = clone(); dangerous.coverages[3].packageTerms = JSON.parse('{"__proto__":{"polluted":true}}'); invalid(dangerous)
    const accessor = clone(); Object.defineProperty(accessor.packageRules, 'states', {enumerable: true, get() {throw new Error('must not run')}})
    invalid(accessor)
    const sparse = clone(); sparse.packageRules.termMonths = new Array(1); invalid(sparse)
    const secret = clone(); secret.coverages[3].aggregateMultiplier = 'not-a-number-secret'
    expect(JSON.stringify(invalid(secret))).not.toContain('not-a-number-secret')
    expect(({} as any).polluted).toBeUndefined()
  })
})
