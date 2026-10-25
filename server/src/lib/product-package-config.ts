import { ValidationError } from '../errors/domain.errors.js'

type ConfigError = { path: string; message: string }
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const positive = (value: unknown): value is number => finite(value) && value > 0
const integer = (value: unknown): value is number => positive(value) && Number.isSafeInteger(value)
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value === value.trim()
const safeKey = (value: unknown): value is string => text(value) && /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
  && !['constructor', 'prototype', '__proto__'].includes(value)
function record(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && !Object.getOwnPropertySymbols(value).length
    && Object.entries(Object.getOwnPropertyDescriptors(value)).every(([key, descriptor]) =>
      !['__proto__', 'constructor', 'prototype'].includes(key) && own(descriptor, 'value'))
}
const types = ['string', 'enum', 'number', 'int', 'bool', 'object']
const termKeys = ['basis', 'included', 'valuation', 'damageToRentedPremisesLimit', 'medicalExpensesPerPerson',
  'restorationMonths', 'waitingPeriodHours', 'extraExpenseIncluded', 'sharedLimit']

/** Reject an unusable package edition before it can weaken validation or enter a snapshot. */
export function assertValidProductPackageConfig(config: any, options: { required?: boolean } = {}): void {
  // An absent declaration is the existing non-package contract, not an empty package.
  if (config == null || !own(config, 'packageRules')) {
    if (options.required) throw new ValidationError('PRODUCT_PACKAGE_CONFIG_INVALID', {
      errors: [{path: '/packageRules', message: 'This product requires package rules.'}],
    })
    return
  }
  const errors: ConfigError[] = []
  const fail = (path: string, message: string) => { errors.push({ path, message }) }
  const refuse = () => { if (errors.length) throw new ValidationError('PRODUCT_PACKAGE_CONFIG_INVALID', { errors }) }
  if (!record(config) || !record(config.packageRules)) {
    fail('/packageRules', 'Package rules must be a plain object.')
    refuse(); return
  }
  const rules = config.packageRules
  const allowedRules = ['riskType', 'riskCount', 'states', 'termMonths', 'requiredCoverages', 'buildingCoverage',
    'buildingInterestField', 'ownerOccupancy', 'occupancyField', 'requiredUnderwritingRules']
  for (const key of Object.keys(rules)) if (!allowedRules.includes(key)) fail('/packageRules/' + key, 'Unsupported package rule.')
  if (!safeKey(rules.riskType)) fail('/packageRules/riskType', 'A valid risk type is required.')
  if (rules.riskCount !== 1) fail('/packageRules/riskCount', 'The package rater currently supports exactly one risk.')
  function list(value: unknown, path: string, valid: (entry: any) => boolean): value is any[] {
    if (!Array.isArray(value) || !value.length || !Array.from(value).every(valid) || new Set(value).size !== value.length) {
      fail(path, 'A nonempty list of unique valid options is required.'); return false
    }
    return true
  }
  list(rules.states, '/packageRules/states', value => typeof value === 'string' && /^[A-Z]{2}$/.test(value))
  list(rules.termMonths, '/packageRules/termMonths', integer)
  list(rules.requiredCoverages, '/packageRules/requiredCoverages', text)
  for (const key of ['buildingCoverage', 'ownerOccupancy']) {
    if (!text(rules[key])) fail('/packageRules/' + key, 'A nonempty reference is required.')
  }
  for (const key of ['buildingInterestField', 'occupancyField']) {
    if (!safeKey(rules[key])) fail('/packageRules/' + key, 'A simple risk field reference is required.')
  }
  if (rules.requiredUnderwritingRules !== undefined && typeof rules.requiredUnderwritingRules !== 'boolean') {
    fail('/packageRules/requiredUnderwritingRules', 'Underwriting-rule requirement must be boolean.')
  }
  if (options.required && rules.requiredUnderwritingRules !== true) {
    fail('/packageRules/requiredUnderwritingRules', 'This product must require configured underwriting rules.')
  }

  const fields = new Map<string, Record<string, any>>()
  if (!Array.isArray(config.fields) || !config.fields.length) fail('/fields', 'A nonempty explicit field catalog is required.')
  for (const [index, field] of (Array.isArray(config.fields) ? config.fields : []).entries()) {
    const path = '/fields/' + index
    if (!record(field)) { fail(path, 'Field metadata must be a plain object.'); continue }
    const match = typeof field.path === 'string' ? /^risks\.0\.([A-Za-z][A-Za-z0-9_]*)$/.exec(field.path) : null
    if (!match || !safeKey(match[1])) fail(path + '/path', 'Field path must name one direct risk property.')
    else if (fields.has(match[1])) fail(path + '/path', 'Duplicate risk field.')
    else fields.set(match[1], field)
    if (!text(field.label)) fail(path + '/label', 'A nonempty field label is required.')
    if (!types.includes(field.type)) fail(path + '/type', 'Unsupported field type.')
    if (typeof field.required !== 'boolean') fail(path + '/required', 'Required must be explicitly boolean.')
    if (field.type === 'enum') list(field.enum, path + '/enum', text)
    else if (field.enum !== undefined) fail(path + '/enum', 'Only enum fields can declare options.')
    if (field.validation !== undefined) {
      if (!record(field.validation)) fail(path + '/validation', 'Validation must be a plain object.')
      else {
        for (const bound of ['min', 'max']) {
          if (field.validation[bound] !== undefined && (!finite(field.validation[bound])
            || (field.type === 'int' && !Number.isSafeInteger(field.validation[bound])))) {
            fail(path + '/validation/' + bound, 'Range bounds must be finite and match the field type.')
          }
        }
        if (finite(field.validation.min) && finite(field.validation.max) && field.validation.min > field.validation.max) {
          fail(path + '/validation', 'Minimum must not exceed maximum.')
        }
        if (Object.keys(field.validation).some(key => !['min', 'max', 'message'].includes(key))) fail(path + '/validation', 'Unsupported field validation.')
        if ((field.validation.min !== undefined || field.validation.max !== undefined) && !['number', 'int'].includes(field.type)) {
          fail(path + '/validation', 'Numeric bounds require a numeric field.')
        }
      }
    }
    if (field.type === 'object') {
      if (field.format !== 'postal-address' || !record(field.properties)) {
        fail(path, 'Object fields require supported postal-address metadata.'); continue
      }
      const required = list(field.requiredProperties, path + '/requiredProperties', safeKey)
      if (required && ['line1', 'city', 'state', 'postalCode', 'country'].some(key => !field.requiredProperties.includes(key))) {
        fail(path + '/requiredProperties', 'Postal addresses must require street, city, state, ZIP and country.')
      }
      for (const [key, property] of Object.entries(field.properties)) {
        if (!['line1', 'line2', 'line3', 'city', 'state', 'postalCode', 'country', 'county'].includes(key)
          || !record(property) || !['string', 'enum'].includes(property.type)) {
          fail(path + '/properties/' + key, 'Address properties require string or enum metadata.'); continue
        }
        if (property.type === 'enum') list(property.enum, path + '/properties/' + key + '/enum', text)
      }
      if (required && field.requiredProperties.some((key: string) => !own(field.properties, key))) {
        fail(path + '/requiredProperties', 'Every required property must have a descriptor.')
      }
    } else if (field.format !== undefined || field.properties !== undefined || field.requiredProperties !== undefined) {
      fail(path, 'Postal-address metadata requires an object field.')
    }
  }
  if (![...fields.values()].some(field => field.required === true)) fail('/fields', 'The catalog must declare required risk facts.')
  const interest = fields.get(rules.buildingInterestField)
  if (!interest || interest.type !== 'bool' || interest.required !== true) fail('/packageRules/buildingInterestField', 'Building interest must reference a required boolean field.')
  const occupancy = fields.get(rules.occupancyField)
  if (!occupancy || occupancy.type !== 'enum' || occupancy.required !== true || !Array.isArray(occupancy.enum)
    || !occupancy.enum.includes(rules.ownerOccupancy)) fail('/packageRules/occupancyField', 'Occupancy must reference a required enum offering the owner value.')

  const definitions = new Map<string, Record<string, any>>()
  if (!Array.isArray(config.coverages) || !config.coverages.length) fail('/coverages', 'Nonempty coverage definitions are required.')
  for (const [index, definition] of (Array.isArray(config.coverages) ? config.coverages : []).entries()) {
    const path = '/coverages/' + index
    if (!record(definition)) { fail(path, 'Coverage definition must be a plain object.'); continue }
    if (!text(definition.code) || definitions.has(definition.code)) fail(path + '/code', 'Coverage codes must be nonempty and unique.')
    else definitions.set(definition.code, definition)
    for (const key of ['required', 'optional', 'selectable']) {
      if (definition[key] !== undefined && typeof definition[key] !== 'boolean') fail(path + '/' + key, 'Coverage flags must be boolean.')
    }
    if (definition.required === true && (definition.optional === true || definition.selectable === false)) fail(path, 'Required coverage flags conflict.')
    const valueLimit = definition.limitType === 'value'
    if (definition.limitType !== undefined && !valueLimit) fail(path + '/limitType', 'Unsupported package limit type.')
    if (valueLimit || definition.minLimit !== undefined || definition.maxLimit !== undefined) {
      if (!valueLimit || !positive(definition.minLimit) || !positive(definition.maxLimit) || definition.minLimit > definition.maxLimit) {
        fail(path, 'Value limits require complete positive finite ordered bounds.')
      }
      if (definition.limits !== undefined) fail(path + '/limits', 'Do not combine value bounds and fixed limit options.')
    } else list(definition.limits, path + '/limits', integer)
    if (definition.defaultLimit !== undefined && (!positive(definition.defaultLimit)
      || (valueLimit ? definition.defaultLimit < definition.minLimit || definition.defaultLimit > definition.maxLimit
        : !Array.isArray(definition.limits) || !definition.limits.includes(definition.defaultLimit)))) fail(path + '/defaultLimit', 'Default limit must be offered.')
    if (definition.deductibles !== undefined) list(definition.deductibles, path + '/deductibles', value => finite(value) && value >= 0)
    if (definition.defaultDeductible !== undefined && (!finite(definition.defaultDeductible)
      || !Array.isArray(definition.deductibles) || !definition.deductibles.includes(definition.defaultDeductible))) fail(path + '/defaultDeductible', 'Default deductible must be offered.')
    const maximum = valueLimit ? definition.maxLimit : Array.isArray(definition.limits) ? Math.max(...definition.limits.filter(finite)) : NaN
    for (const key of ['aggregateMultiplier', 'personalAdvertisingInjuryMultiplier']) {
      if (own(definition, key) && (!positive(definition[key]) || !positive(maximum)
        || !positive(maximum * definition[key]) || maximum * definition[key] > Number.MAX_SAFE_INTEGER)) fail(path + '/' + key, 'Multiplier and maximum derived amount must be positive finite safe values.')
    }
    const terms = definition.packageTerms
    if (terms !== undefined) {
      if (!record(terms) || !Object.keys(terms).length) { fail(path + '/packageTerms', 'Fixed package terms must be a nonempty plain object.'); continue }
      for (const key of Object.keys(terms)) {
        const termPath = path + '/packageTerms/' + key
        if (!termKeys.includes(key)) fail(termPath, 'Unsupported fixed term; derived limits must use multipliers.')
        else if (key === 'basis' && !['occurrence', 'limited-dollar', 'perPerson'].includes(terms[key])) fail(termPath, 'Unsupported coverage basis.')
        else if (key === 'valuation' && terms[key] !== 'replacement-cost') fail(termPath, 'Unsupported valuation.')
        else if (['included', 'extraExpenseIncluded', 'sharedLimit'].includes(key) && typeof terms[key] !== 'boolean') fail(termPath, 'Fixed inclusion terms must be boolean.')
        else if (['damageToRentedPremisesLimit', 'medicalExpensesPerPerson'].includes(key) && !positive(terms[key])) fail(termPath, 'Fixed amounts must be positive finite numbers.')
        else if (key === 'restorationMonths' && !integer(terms[key])) fail(termPath, 'Restoration months must be a positive safe integer.')
        else if (key === 'waitingPeriodHours' && (!finite(terms[key]) || !Number.isSafeInteger(terms[key]) || terms[key] < 0)) fail(termPath, 'Waiting hours must be a nonnegative safe integer.')
      }
      if (!own(terms, 'basis') && !own(terms, 'valuation')) fail(path + '/packageTerms', 'Fixed terms must declare their coverage basis or valuation.')
      if (own(terms, 'basis') && own(terms, 'valuation')) fail(path + '/packageTerms', 'Do not combine property valuation and another coverage basis.')
      if (terms.basis === 'perPerson' && !own(terms, 'included')) fail(path + '/packageTerms', 'Per-person benefits must declare their inclusion flag.')
      if (terms.basis !== 'occurrence' && ['damageToRentedPremisesLimit', 'medicalExpensesPerPerson'].some(key => own(terms, key))) fail(path + '/packageTerms', 'Liability sublimits require occurrence basis.')
      if (terms.basis === 'limited-dollar' && ['restorationMonths', 'waitingPeriodHours', 'extraExpenseIncluded', 'sharedLimit'].some(key => !own(terms, key))) fail(path + '/packageTerms', 'Limited-dollar income terms must declare restoration, waiting and shared extra-expense terms.')
      if (terms.basis === 'occurrence' && (!positive(definition.aggregateMultiplier) || !positive(definition.personalAdvertisingInjuryMultiplier))) fail(path, 'Occurrence terms require aggregate and personal-injury multipliers.')
      if (terms.basis !== 'limited-dollar' && ['restorationMonths', 'waitingPeriodHours', 'extraExpenseIncluded', 'sharedLimit'].some(key => own(terms, key))) fail(path + '/packageTerms', 'Income terms require limited-dollar basis.')
    }
    if ((definition.aggregateMultiplier !== undefined || definition.personalAdvertisingInjuryMultiplier !== undefined) && (!record(terms) || terms.basis !== 'occurrence')) fail(path, 'Liability multipliers require occurrence fixed terms.')
  }
  for (const code of Array.isArray(rules.requiredCoverages) ? rules.requiredCoverages : []) {
    const definition = definitions.get(code)
    if (!definition || definition.required !== true) fail('/packageRules/requiredCoverages', 'Each required reference must resolve to a required coverage definition.')
    else if (!record(definition.packageTerms) || !Object.keys(definition.packageTerms).length) fail('/packageRules/requiredCoverages', 'Required package coverages must declare fixed terms.')
  }
  for (const definition of definitions.values()) {
    if (definition.required === true && (!Array.isArray(rules.requiredCoverages) || !rules.requiredCoverages.includes(definition.code))) fail('/packageRules/requiredCoverages', 'Every required definition must be listed in the package.')
  }
  if (!definitions.has(rules.buildingCoverage)) fail('/packageRules/buildingCoverage', 'Building coverage must resolve to a definition.')
  refuse()
}
