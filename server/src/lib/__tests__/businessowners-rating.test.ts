import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { describe, expect, it } from 'vitest'
import { rateFromRateTable, validateRateTable } from '../rating-table.js'
import { parseProductDescriptor } from '../product-registry.js'

const productDir = new URL('../../../../products/businessowners/', import.meta.url)
const config = YAML.parse(readFileSync(new URL('coverage.yaml', productDir), 'utf8'))
const rates = YAML.parse(readFileSync(new URL('rates.yaml', productDir), 'utf8'))
const tenantFields = JSON.parse(readFileSync(new URL('../../../../tenants/sample-carrier/field_meta.businessowners.json', import.meta.url), 'utf8'))
const risk = {
  type: 'businessownersLocation', businessName: 'Synthetic Office', businessClass: 'office',
  annualRevenue: 750000, annualPayroll: 200000, employeeCount: 5, yearsInBusiness: 6,
  priorLossCount: 0, priorLossAmount: 0, occupancy: 'owner', buildingInterest: true,
  locationAddress: {line1: '100 Example Way', city: 'Columbus', state: 'OH', postalCode: '43215', country: 'US'},
  yearBuilt: 2015, squareFeet: 2500, construction: 'masonry', protectionClass: 3,
  roofAgeYears: 5, sprinklers: false, fireAlarm: true, burglarAlarm: false,
  vacancyDays: 0, hazardousOperations: false,
}
function quote(owner = true) {
  return {
    productCode: 'businessowners', state: 'OH', termMonths: 12,
    risks: [{...structuredClone(risk), occupancy: owner ? 'owner' : 'tenant', buildingInterest: owner}],
    coverages: [
      ...(owner ? [{code: 'BOP_BUILDING', selected: true, limit: 500000, deductible: 1000}] : []),
      {code: 'BOP_BPP', selected: true, limit: 100000, deductible: 1000},
      {code: 'BOP_BI_EE', selected: true, limit: 100000},
      {code: 'BOP_LIAB', selected: true, limit: 1000000},
      {code: 'BOP_MED', selected: true, limit: 5000},
    ],
  }
}
const price = (payload = quote()) => rateFromRateTable(payload, rates, config)
const amounts = (result: ReturnType<typeof price>) => Object.fromEntries(result.byCoverage.map(item => [item.code, item.amount.amount]))
const definition = (code: string) => config.coverages.find((item: any) => item.code === code)

describe('businessowners versioned pack configuration', () => {
  it('declares a distinct risk, explicit fields and no invented risk facts', () => {
    expect(parseProductDescriptor(config, 'businessowners')).toMatchObject({
      code: 'businessowners', version: '1.0.0', label: 'Businessowners Policy (BOP) - Demo',
      ratingAdapter: 'rate-table', formsMode: 'catalog',
      riskKinds: {businessownersLocation: 'BOP.Location'}, defaultRisk: {type: 'businessownersLocation'},
    })
    expect(config.capabilities.defaultRisk).toEqual({type: 'businessownersLocation'})
    expect(config.availability).toEqual({country: 'US', states: ['OH']})
    expect(config.fields).toEqual(tenantFields)
    expect(config.fields.every((field: any) => field.required === true && field.label && field.ui.group)).toBe(true)
    expect(config.fields.map((field: any) => field.path)).toEqual(config.ratingKeys.map((key: string) => 'risks.0.' + key))
    expect(config.fields.find((field: any) => field.path === 'risks.0.locationAddress')).toMatchObject({
      type: 'object', format: 'postal-address', requiredProperties: ['line1','city','state','postalCode','country'],
    })
    for (const key of ['buildingInterest','sprinklers','fireAlarm','burglarAlarm','hazardousOperations']) {
      expect(config.fields.find((field: any) => field.path === 'risks.0.' + key)).toMatchObject({type: 'bool', required: true})
    }
    expect(validateRateTable(rates, config, config.ratingKeys)).toEqual([])
  })

  it('provides the locked generic package enforcement contract', () => {
    expect(config.packageRules).toEqual({
      riskType: 'businessownersLocation', riskCount: 1, termMonths: [12], states: ['OH'],
      requiredCoverages: ['BOP_BPP','BOP_BI_EE','BOP_LIAB','BOP_MED'], buildingCoverage: 'BOP_BUILDING',
      buildingInterestField: 'buildingInterest', ownerOccupancy: 'owner', occupancyField: 'occupancy', requiredUnderwritingRules: true,
    })
    for (const code of config.packageRules.requiredCoverages) expect(definition(code).required).toBe(true)
    for (const code of ['BOP_BUILDING','BOP_EQUIP','BOP_WATER']) expect(definition(code).optional).toBe(true)
    expect(definition('BOP_BUILDING')).toMatchObject({minLimit: 100000, maxLimit: 5000000, defaultLimit: 500000})
    expect(definition('BOP_BPP')).toMatchObject({minLimit: 10000, maxLimit: 1000000, defaultLimit: 100000})
    expect(rates.rating.coverages.default).toBeUndefined()
  })

  it('represents shared income and included liability benefits without duplicate coverage codes', () => {
    expect(definition('BOP_BI_EE')).toMatchObject({limits: [100000], packageTerms: {
      basis: 'limited-dollar', restorationMonths: 12, waitingPeriodHours: 72, extraExpenseIncluded: true, sharedLimit: true,
    }})
    expect(definition('BOP_LIAB')).toMatchObject({aggregateMultiplier: 2, personalAdvertisingInjuryMultiplier: 1,
      packageTerms: {basis: 'occurrence', damageToRentedPremisesLimit: 100000, medicalExpensesPerPerson: 5000}})
    expect(definition('BOP_MED')).toMatchObject({limits: [5000], packageTerms: {basis: 'perPerson', included: true}})
    for (const code of ['BOP_BUILDING','BOP_BPP']) {
      expect(definition(code).packageTerms).toEqual({valuation: 'replacement-cost'})
      expect(definition(code).deductibles).toEqual([1000,2500,5000])
    }
    expect(config.coverages.map((item: any) => item.code)).toEqual([
      'BOP_BUILDING','BOP_BPP','BOP_BI_EE','BOP_LIAB','BOP_MED','BOP_EQUIP','BOP_WATER',
    ])
  })
})

describe('businessowners synthetic component rating', () => {
  it('prices the all-factor-one owner package at exactly 1800 and tenant at 800', () => {
    const owner = price(), tenant = price(quote(false))
    expect(amounts(owner)).toEqual({BOP_BUILDING: 1000, BOP_BPP: 300, BOP_BI_EE: 100, BOP_LIAB: 400, BOP_MED: 0})
    expect(owner.total).toEqual({amount: 1800, currency: 'USD'})
    expect(amounts(tenant)).toEqual({BOP_BPP: 300, BOP_BI_EE: 100, BOP_LIAB: 400, BOP_MED: 0})
    expect(tenant.total.amount).toBe(800)
    expect(owner.fees.amount).toBe(0)
    expect(owner.taxes.amount).toBe(0)
    expect(owner.calcTrace).toMatchObject({source: 'rate-table', ratesVersion: '1.0.0', factorProduct: 1, minimumPremiumAdjustment: 0})
    expect(owner.calcTrace.factors.every(item => item.factor === 1)).toBe(true)
    expect(price()).toEqual(owner)
  })

  it.each([
    ['businessClass','office',1,1800], ['businessClass','retail',1.15,2010], ['businessClass','service',1.1,1940],
    ['construction','masonry',1,1800], ['construction','frame',1.1,1940], ['construction','noncombustible',0.9,1660],
    ['protectionClass',1,1,1800], ['protectionClass',4,1,1800], ['protectionClass',5,1.1,1940],
    ['protectionClass',8,1.1,1940], ['protectionClass',9,1.25,2150], ['protectionClass',10,1.25,2150],
    ['priorLossCount',0,1,1800], ['priorLossCount',1,1.1,1940], ['priorLossCount',2,1.25,2150], ['priorLossCount',5,1.25,2150],
  ])('prices %s=%s with its documented factor, never changing liability', (field, value, factor, total) => {
    const payload = quote()
    Object.assign(payload.risks[0], {[field]: value})
    const result = price(payload)
    expect(result.calcTrace.factorProduct).toBe(factor)
    expect(amounts(result).BOP_LIAB).toBe(400)
    expect(amounts(result).BOP_MED).toBe(0)
    expect(result.total.amount).toBe(total)
  })

  it.each([[1000,1,1800], [2500,0.9,1670], [5000,0.8,1540]])('prices both property deductibles at %s', (deductible, factor, total) => {
    const payload = quote()
    for (const coverage of payload.coverages.filter(item => ['BOP_BUILDING','BOP_BPP'].includes(item.code))) coverage.deductible = deductible
    const result = price(payload)
    expect(result.total.amount).toBe(total)
    expect(result.calcTrace.coverages.find(item => item.code === 'BOP_BPP')).toMatchObject({deductibleFactor: factor})
    expect(amounts(result).BOP_BI_EE).toBe(100)
    expect(amounts(result).BOP_LIAB).toBe(400)
  })

  it.each([
    ['BOP_EQUIP',25000,50], ['BOP_EQUIP',50000,90], ['BOP_EQUIP',100000,160],
    ['BOP_WATER',5000,25], ['BOP_WATER',10000,45], ['BOP_WATER',25000,90],
  ])('prices optional %s limit %s only while selected', (code, limit, premium) => {
    const payload = quote(false)
    payload.coverages.push({code: String(code), selected: true, limit: Number(limit), deductible: 1000})
    expect(amounts(price(payload))[code]).toBe(premium)
    expect(price(payload).total.amount).toBe(800 + Number(premium))
    payload.coverages[payload.coverages.length - 1].selected = false
    expect(amounts(price(payload))[code]).toBeUndefined()
    expect(price(payload).total.amount).toBe(800)
  })

  it.each([[500000,300,1700], [1000000,400,1800], [2000000,600,2000]])('prices liability %s without charging aggregate/subterms again', (limit, premium, total) => {
    const payload = quote()
    payload.coverages.find(item => item.code === 'BOP_LIAB')!.limit = limit
    expect(amounts(price(payload)).BOP_LIAB).toBe(premium)
    expect(price(payload).total.amount).toBe(total)
  })

  it.each([['BOP_BUILDING',100000,200], ['BOP_BUILDING',5000000,10000], ['BOP_BPP',10000,30], ['BOP_BPP',1000000,3000]])(
    'prices %s at its advertised value boundary %s', (code, limit, expected) => {
      const payload = quote()
      payload.coverages.find(item => item.code === code)!.limit = Number(limit)
      expect(amounts(price(payload))[code]).toBe(expected)
    },
  )

  it('applies the minimum to a valid small tenant package and shows the adjustment', () => {
    const payload = quote(false)
    payload.risks[0].construction = 'noncombustible'
    payload.coverages.find(item => item.code === 'BOP_BPP')!.limit = 10000
    payload.coverages.find(item => item.code === 'BOP_BPP')!.deductible = 5000
    payload.coverages.find(item => item.code === 'BOP_LIAB')!.limit = 500000
    const result = price(payload)
    // 30 x .90 x .80 = 21.60, plus 90 income + 300 liability = 411.60.
    expect(amounts(result)).toEqual({BOP_BPP: 21.6, BOP_BI_EE: 90, BOP_LIAB: 300, BOP_MED: 0, MIN_PREMIUM: 88.4})
    expect(result.total.amount).toBe(500)
  })

  it('keeps optional prices and liability independent of all property factors', () => {
    const payload = quote()
    Object.assign(payload.risks[0], {businessClass: 'retail', construction: 'frame', protectionClass: 10, priorLossCount: 2})
    payload.coverages.push({code: 'BOP_EQUIP', selected: true, limit: 100000, deductible: 1000},
      {code: 'BOP_WATER', selected: true, limit: 25000, deductible: 1000})
    const result = price(payload)
    expect(amounts(result)).toMatchObject({BOP_LIAB: 400, BOP_MED: 0, BOP_EQUIP: 160, BOP_WATER: 90})
    expect(result.calcTrace.coverages.filter(item => ['BOP_LIAB','BOP_MED','BOP_EQUIP','BOP_WATER'].includes(String(item.code)))
      .every(item => item.applyFactors === false)).toBe(true)
  })

  it('rounds each coverage once before summing, without mutating payload or rates', () => {
    const payload = quote(), originalRates = structuredClone(rates)
    payload.coverages.find(item => item.code === 'BOP_BUILDING')!.limit = 500123
    payload.coverages.find(item => item.code === 'BOP_BPP')!.limit = 100123
    const original = structuredClone(payload)
    expect(amounts(price(payload))).toEqual({BOP_BUILDING: 1000.25, BOP_BPP: 300.37, BOP_BI_EE: 100, BOP_LIAB: 400, BOP_MED: 0})
    expect(price(payload).total.amount).toBe(1800.62)
    expect(payload).toEqual(original)
    expect(rates).toEqual(originalRates)
  })

  it.each(['businessClass','construction','protectionClass','priorLossCount'])('refuses missing %s instead of inventing a safe factor', field => {
    const payload = quote()
    delete (payload.risks[0] as Record<string, unknown>)[field]
    expect(() => price(payload)).toThrowError(expect.objectContaining({code: 'RATING_FACTOR_NOT_FOUND'}))
  })

  it.each([
    ['businessClass','manufacturing'], ['construction','unknown'], ['protectionClass',0], ['protectionClass',11],
    ['priorLossCount',-1], ['priorLossCount',NaN],
  ])('refuses an unrated risk factor %s=%s', (field, value) => {
    const payload = quote()
    Object.assign(payload.risks[0], {[field]: value})
    expect(() => price(payload)).toThrowError(expect.objectContaining({code: 'RATING_FACTOR_NOT_FOUND'}))
  })

  it.each([{state: 'NY'}, {state: ''}, {termMonths: 6}, {termMonths: 0}])('refuses an unsupported or missing jurisdiction/term: %j', patch => {
    expect(() => price({...quote(), ...patch})).toThrowError(expect.objectContaining({code: 'RATING_FACTOR_NOT_FOUND'}))
  })

  it.each(['BOP_BI_EE','BOP_LIAB','BOP_MED','BOP_EQUIP','BOP_WATER'])('refuses an unlisted limit for %s', code => {
    const payload = quote()
    payload.coverages = [{code, selected: true, limit: 123, deductible: 1000}]
    expect(() => price(payload)).toThrowError(expect.objectContaining({code: 'RATING_LIMIT_NOT_RATED'}))
  })

  it('refuses foreign coverage or missing value limits rather than fallback pricing', () => {
    const payload = quote()
    payload.coverages.push({code: 'FOREIGN', selected: true, limit: 1000})
    expect(() => price(payload)).toThrowError(expect.objectContaining({code: 'RATING_COVERAGE_NOT_CONFIGURED'}))
    payload.coverages = [{code: 'BOP_BUILDING', selected: true, limit: undefined as any}]
    expect(() => price(payload)).toThrowError(expect.objectContaining({code: 'RATING_LIMIT_REQUIRED'}))
  })
})
