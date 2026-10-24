import type { CoveragePackageTerms } from '@lattice-policy/types'
import { ValidationError } from '../errors/domain.errors.js'

export type PackageViolation = { path: string; keyword: 'package'; message: string }

/** Fixed benefits are derived from the pinned definition, never from browser claims. */
export function coveragePackageTerms(definition: any, coverage: any): CoveragePackageTerms | undefined {
  if (!definition?.packageTerms) return undefined
  const terms = { ...definition.packageTerms }
  const limit = Number(coverage?.limit)
  if (Number.isFinite(limit) && definition.aggregateMultiplier != null) {
    terms.generalAggregate = limit * definition.aggregateMultiplier
    terms.productsCompletedOperationsAggregate = limit * definition.aggregateMultiplier
  }
  if (Number.isFinite(limit) && definition.personalAdvertisingInjuryMultiplier != null) {
    terms.personalAdvertisingInjuryLimit = limit * definition.personalAdvertisingInjuryMultiplier
  }
  return terms
}

const numeric = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) return null
  return Number.isFinite(Number(value)) ? Number(value) : null
}

export function productPackageViolations(payload: any, config: any): PackageViolation[] {
  const rules = config?.packageRules
  if (!rules) return []
  const errors: PackageViolation[] = []
  const fail = (path: string, message: string) => errors.push({ path, keyword: 'package', message })
  const risks = Array.isArray(payload?.risks) ? payload.risks : []
  const risk = risks[0] || {}
  for (const field of Array.isArray(config.fields) ? config.fields : []) {
    const key = String(field.path || '').replace(/^risks\.0\./, '')
    const value = risk[key]
    const path = `/risks/0/${key}`
    if (value === undefined || value === null || value === '') {
      if (field.required) fail(path, `${field.label || key} is required.`)
      continue
    }
    if (field.type === 'bool' && typeof value !== 'boolean') fail(path, 'Choose yes or no explicitly.')
    if (field.type === 'string' && (typeof value !== 'string' || !value.trim())) fail(path, 'Enter a nonempty text value.')
    if (field.type === 'enum' && !field.enum?.includes(value)) fail(path, 'Choose an offered value.')
    if (field.type === 'number' || field.type === 'int') {
      const number = numeric(value)
      if (number === null || (field.type === 'int' && !Number.isInteger(number))
        || (field.validation?.min != null && number! < field.validation.min)
        || (field.validation?.max != null && number! > field.validation.max)) fail(path, 'Enter a value within the configured range.')
    }
    if (field.type === 'object' && field.format === 'postal-address') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { fail(path, 'Enter a structured premises address.'); continue }
      for (const property of field.requiredProperties || []) {
        if (typeof value[property] !== 'string' || !value[property].trim()) fail(`${path}/${property}`, 'Address field is required.')
      }
      if (value.country !== 'US' || value.state !== payload.state) fail(path, 'Premises must be in the selected US rating state.')
      if (!/^\d{5}(?:-\d{4})?$/.test(value.postalCode || '')) fail(`${path}/postalCode`, 'Enter a US ZIP or ZIP+4.')
    }
  }
  if (numeric(risk.yearBuilt) !== null && Number(risk.yearBuilt) > new Date().getUTCFullYear()) fail('/risks/0/yearBuilt', 'Building year cannot be in the future.')
  if (risks.length !== rules.riskCount) fail('/risks', `Exactly ${rules.riskCount} premises is supported.`)
  if (risk.type !== rules.riskType) fail('/risks/0/type', 'Use the product-specific risk type.')
  if (!rules.termMonths?.includes(payload?.termMonths)) fail('/termMonths', 'This term length is not offered.')
  if (!rules.states?.includes(payload?.state)) fail('/state', 'This state is not offered by the product.')
  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : []
  const selected = coverages.filter((coverage: any) => coverage?.selected === true)
  const definitions = new Map<string, any>((config.coverages || []).map((item: any) => [item.code, item]))
  const seen = new Set<string>()
  for (const code of rules.requiredCoverages || []) {
    if (!selected.some((coverage: any) => coverage.code === code)) fail('/coverages', `Required package coverage ${code} must be selected.`)
  }
  const building = selected.some((coverage: any) => coverage.code === rules.buildingCoverage)
  const owner = risk[rules.occupancyField] === rules.ownerOccupancy
  const hasInterest = risk[rules.buildingInterestField] === true
  if (owner && !building) fail('/coverages', 'Owned building coverage is required for this package.')
  if (building && !hasInterest) fail(`/risks/0/${rules.buildingInterestField}`, 'Building coverage requires an insurable building interest.')
  coverages.forEach((coverage: any, index: number) => {
    const path = `/coverages/${index}`
    if (!coverage || typeof coverage !== 'object') { fail(path, 'Coverage must be an object.'); return }
    if (typeof coverage.selected !== 'boolean') fail(`${path}/selected`, 'Select or deselect explicitly.')
    if (seen.has(coverage.code)) fail(`${path}/code`, 'Duplicate coverage is not allowed.')
    seen.add(coverage.code)
    const definition = definitions.get(coverage.code)
    if (!definition) { fail(`${path}/code`, 'Coverage does not belong to this package.'); return }
    if (coverage.selected !== true) return
    const limit = numeric(coverage.limit)
    if (limit === null || limit <= 0) fail(`${path}/limit`, 'Enter a positive coverage limit.')
    else if (Array.isArray(definition.limits) && !definition.limits.some((value: any) => Number(value) === limit)) {
      fail(`${path}/limit`, 'Choose an offered coverage limit.')
    } else if (definition.limitType === 'value' && (limit < definition.minLimit || limit > definition.maxLimit)) {
      fail(`${path}/limit`, `Limit must be between ${definition.minLimit} and ${definition.maxLimit}.`)
    }
    if (Array.isArray(definition.deductibles) && definition.deductibles.length) {
      const deductible = numeric(coverage.deductible)
      if (deductible === null || !definition.deductibles.some((value: any) => Number(value) === deductible)) fail(`${path}/deductible`, 'Choose an offered deductible.')
    }
    const expected = coveragePackageTerms(definition, coverage)
    if (coverage.packageTerms !== undefined) {
      const actual = coverage.packageTerms
      if (!actual || typeof actual !== 'object' || Array.isArray(actual)
        || Object.keys(actual).length !== Object.keys(expected || {}).length
        || Object.entries(expected || {}).some(([key, value]) => actual[key] !== value)) {
        fail(`${path}/packageTerms`, 'Package terms must match the product definition and selected limit.')
      }
    }
  })
  return errors
}

/** Called before pricing, including direct/servicing rating paths. */
export function applyProductPackage(payload: any, config: any): void {
  if (!config?.packageRules) return
  const errors = productPackageViolations(payload, config)
  if (errors.length) throw new ValidationError('PRODUCT_RULES_NOT_MET', { errors })
  for (const coverage of payload.coverages) {
    const definition = config.coverages.find((item: any) => item.code === coverage.code)
    const terms = coveragePackageTerms(definition, coverage)
    if (coverage.selected && terms) coverage.packageTerms = terms
  }
}
