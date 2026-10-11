import { round2 } from './date.utils.js'
import { BadRequestError } from '../errors/domain.errors.js'

/**
 * Table-driven rating for products that declare `ratingAdapter: rate-table`.
 * The whole algorithm lives in the product's rates.yaml, so a carrier can
 * price a new product from its carrier pack without any rating code:
 *
 *   rating:
 *     basePremium: 420                 # optional; needed by shareOfBase
 *     termFactors: { 6: 0.55, 12: 1 }  # optional, by termMonths
 *     factors:                         # multiplied together, in order
 *       - name: Construction
 *         field: construction          # a field on the first risk
 *         table: { frame: 1.05, masonry: 0.9 }
 *         default: 1
 *       - name: Protection class
 *         field: protectionClass
 *         ranges: { '1-4': 0.92, '5-8': 1, '9+': 1.2 }
 *       - name: State
 *         path: state                  # anywhere on the quote
 *         table: { TX: 1.1 }
 *     coverages:                       # one pricing method per coverage
 *       A: { rate: 1.35, ratePer: 1000 }              # per unit of limit
 *       E: { byLimit: { 100000: 40, 300000: 55 } }    # premium per limit option
 *       F: { flat: 12, applyFactors: false }          # fixed amount
 *       default: { shareOfBase: 0.05 }                # anything not listed
 *     minimumPremium: 150
 *   fees: { policy: 25 }
 *   taxes: { rate: 0.02 }
 *
 * A coverage premium is its method's amount, times the product of all
 * factors (unless applyFactors is false), times its deductible factor.
 */

export type RateTableIssue = { level: 'error' | 'warning'; message: string }

type RangeTable = Record<string, number>

type FactorStep = {
  name?: string
  field?: string
  path?: string
  table?: Record<string, number>
  ranges?: RangeTable
  default?: number
  required?: boolean
}

type CoverageRating = {
  rate?: number
  ratePer?: number
  byLimit?: Record<string, number>
  flat?: number
  shareOfBase?: number
  applyFactors?: boolean
  deductibleFactors?: Record<string, number>
}

const COVERAGE_METHODS = ['rate', 'byLimit', 'flat', 'shareOfBase'] as const

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getByPath(source: any, path: string): unknown {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current: any, key) => (current == null ? undefined : current[key]), source)
}

/** Parses a band label: '1-4', '9+', '<25', '<=10', '>5', '>=65'. Null when it is not a band. */
export function parseRange(label: string): ((value: number) => boolean) | null {
  const text = String(label ?? '').trim()
  let match = /^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/.exec(text)
  if (match) {
    const min = Number(match[1])
    const max = Number(match[2])
    return (value) => value >= min && value <= max
  }
  match = /^(-?\d+(?:\.\d+)?)\+$/.exec(text)
  if (match) {
    const min = Number(match[1])
    return (value) => value >= min
  }
  match = /^(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)$/.exec(text)
  if (match) {
    const bound = Number(match[2])
    if (match[1] === '<=') return (value) => value <= bound
    if (match[1] === '>=') return (value) => value >= bound
    if (match[1] === '<') return (value) => value < bound
    return (value) => value > bound
  }
  return null
}

function lookupFactor(step: FactorStep, rawValue: unknown): number | null {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null
  if (isPlainObject(step.table)) {
    const wanted = String(rawValue).trim().toLowerCase()
    for (const [key, factor] of Object.entries(step.table)) {
      if (String(key).trim().toLowerCase() === wanted && isFiniteNumber(factor)) return factor
    }
    return null
  }
  if (isPlainObject(step.ranges)) {
    const value = typeof rawValue === 'number' ? rawValue : Number(rawValue)
    if (!Number.isFinite(value)) return null
    for (const [label, factor] of Object.entries(step.ranges)) {
      const inRange = parseRange(label)
      if (inRange && inRange(value) && isFiniteNumber(factor)) return factor
    }
  }
  return null
}

function coverageCode(coverage: any): string {
  return String(coverage?.code || coverage?.coverage_code || coverage?.definitionCode || '').trim()
}

function findCoverageRating(coverages: Record<string, CoverageRating>, code: string): CoverageRating | null {
  const wanted = code.toLowerCase()
  for (const [key, value] of Object.entries(coverages)) {
    if (key !== 'default' && key.toLowerCase() === wanted && isPlainObject(value)) return value
  }
  return isPlainObject(coverages.default) ? coverages.default : null
}

/** A coverage's limit, including one expressed as a percent of another coverage's limit. */
function effectiveLimit(coverage: any, selected: any[], productConfig: any): number | null {
  if (isFiniteNumber(coverage?.limit)) return coverage.limit
  const numericLimit = Number(coverage?.limit)
  if (coverage?.limit != null && coverage.limit !== '' && Number.isFinite(numericLimit)) return numericLimit
  const percent = Number(coverage?.percent)
  if (!Number.isFinite(percent)) return null
  const code = coverageCode(coverage).toLowerCase()
  const definition = (Array.isArray(productConfig?.coverages) ? productConfig.coverages : [])
    .find((item: any) => String(item?.code || '').toLowerCase() === code)
  const parentCode = String(definition?.limitAsPercentOf || '').toLowerCase()
  if (!parentCode) return null
  const parent = selected.find((item) => coverageCode(item).toLowerCase() === parentCode)
  const parentLimit = Number(parent?.limit)
  return Number.isFinite(parentLimit) ? (parentLimit * percent) / 100 : null
}

function ratingError(code: string, message: string, details?: Record<string, unknown>): BadRequestError {
  return new BadRequestError(code, message, details)
}

export function rateFromRateTable(payload: any, rates: any, productConfig: any = {}) {
  const productCode = String(payload?.productCode || '').trim().toLowerCase()
  const rating = rates?.rating
  if (!isPlainObject(rating)) {
    throw ratingError('RATING_NOT_CONFIGURED', `Product '${productCode}' has no rating section in its rates file.`, { productCode })
  }

  const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
  const basePremium = isFiniteNumber(rating.basePremium) ? rating.basePremium : null

  // --- factors ----------------------------------------------------------------
  const factorTrace: Array<Record<string, unknown>> = []
  let factorProduct = 1
  if (isPlainObject(rating.termFactors)) {
    const termMonths = Number(payload?.termMonths || 12)
    const termFactor = rating.termFactors[String(termMonths)]
    if (isFiniteNumber(termFactor)) {
      factorProduct *= termFactor
      factorTrace.push({ name: 'Term', value: termMonths, factor: termFactor })
    }
  }
  for (const step of Array.isArray(rating.factors) ? (rating.factors as FactorStep[]) : []) {
    const source = step.path ? step.path : `risks.0.${step.field}`
    const value = step.path ? getByPath(payload, step.path) : risk?.[String(step.field)]
    let factor = lookupFactor(step, value)
    let matched = true
    if (factor === null) {
      matched = false
      if (step.required) {
        throw ratingError(
          'RATING_FACTOR_NOT_FOUND',
          `No ${step.name || step.field || step.path} rating factor for value '${value ?? ''}'.`,
          { productCode, factor: step.name || step.field || step.path, value: value ?? null }
        )
      }
      factor = isFiniteNumber(step.default) ? step.default : 1
    }
    factorProduct *= factor
    factorTrace.push({ name: step.name || step.field || step.path, source, value: value ?? null, factor, matched })
  }

  // --- coverages --------------------------------------------------------------
  const coverageRatings: Record<string, CoverageRating> = isPlainObject(rating.coverages) ? rating.coverages : {}
  const selected = (Array.isArray(payload?.coverages) ? payload.coverages : []).filter((item: any) => item && item.selected !== false)
  const coverageTrace: Array<Record<string, unknown>> = []
  const byCoverage: any[] = []
  let subtotal = 0

  for (const coverage of selected) {
    const code = coverageCode(coverage)
    const config = findCoverageRating(coverageRatings, code)
    if (!config) {
      throw ratingError('RATING_COVERAGE_NOT_CONFIGURED', `Coverage '${code}' has no rating for product '${productCode}'.`, { productCode, coverage: code })
    }
    const limit = effectiveLimit(coverage, selected, productConfig)
    let amount: number
    let method: string
    if (isFiniteNumber(config.rate)) {
      method = 'rate'
      if (limit === null) throw ratingError('RATING_LIMIT_REQUIRED', `Coverage '${code}' needs a limit to be rated.`, { productCode, coverage: code })
      amount = (limit / (isFiniteNumber(config.ratePer) && config.ratePer > 0 ? config.ratePer : 1)) * config.rate
    } else if (isPlainObject(config.byLimit)) {
      method = 'byLimit'
      const entry = limit === null ? undefined : config.byLimit[String(limit)]
      if (!isFiniteNumber(entry)) {
        throw ratingError('RATING_LIMIT_NOT_RATED', `Coverage '${code}' has no rate for limit ${limit ?? '(none)'}.`, { productCode, coverage: code, limit })
      }
      amount = entry
    } else if (isFiniteNumber(config.flat)) {
      method = 'flat'
      amount = config.flat
    } else if (isFiniteNumber(config.shareOfBase)) {
      method = 'shareOfBase'
      if (basePremium === null) throw ratingError('RATING_NOT_CONFIGURED', `Coverage '${code}' is a share of the base premium, but no basePremium is set.`, { productCode, coverage: code })
      amount = basePremium * config.shareOfBase
    } else {
      throw ratingError('RATING_COVERAGE_NOT_CONFIGURED', `Coverage '${code}' has no usable rating method for product '${productCode}'.`, { productCode, coverage: code })
    }

    const applyFactors = config.applyFactors !== false
    if (applyFactors) amount *= factorProduct
    let deductibleFactor: number | null = null
    if (isPlainObject(config.deductibleFactors) && coverage?.deductible != null) {
      const candidate = config.deductibleFactors[String(coverage.deductible)]
      if (isFiniteNumber(candidate)) {
        deductibleFactor = candidate
        amount *= candidate
      }
    }

    const premium = round2(amount)
    subtotal += premium
    byCoverage.push({
      code: code.toUpperCase(),
      selected: coverage.selected !== false,
      limit: coverage?.limit ?? null,
      deductible: coverage?.deductible ?? null,
      percent: coverage?.percent ?? null,
      amount: { amount: premium, currency: 'USD' },
    })
    coverageTrace.push({ code: code.toUpperCase(), method, limit, applyFactors, deductibleFactor, premium })
  }

  subtotal = round2(subtotal)
  let minimumPremiumAdjustment = 0
  if (isFiniteNumber(rating.minimumPremium) && subtotal < rating.minimumPremium) {
    minimumPremiumAdjustment = round2(rating.minimumPremium - subtotal)
    byCoverage.push({
      code: 'MIN_PREMIUM',
      selected: true,
      limit: null,
      deductible: null,
      percent: null,
      amount: { amount: minimumPremiumAdjustment, currency: 'USD' },
    })
    subtotal = round2(rating.minimumPremium)
  }

  const fees = isFiniteNumber(rates?.fees?.policy) ? rates.fees.policy : 0
  const taxRate = isFiniteNumber(rates?.taxes?.rate) ? rates.taxes.rate : 0
  const taxes = round2(subtotal * taxRate)
  const total = round2(subtotal + fees + taxes)

  return {
    byCoverage,
    fees: { amount: round2(fees), currency: 'USD' },
    taxes: { amount: taxes, currency: 'USD' },
    total: { amount: total, currency: 'USD' },
    calcTrace: {
      source: 'rate-table',
      productCode,
      ratesVersion: rates?.version ?? null,
      basePremium,
      factorProduct: Math.round(factorProduct * 1e6) / 1e6,
      factors: factorTrace,
      coverages: coverageTrace,
      coverageSubtotal: subtotal,
      minimumPremiumAdjustment,
      taxRate,
    },
  }
}

/**
 * Checks a rate-table configuration before a stack runs with it: structure,
 * numbers, band labels, and that every coverage and every listed limit of the
 * product can actually be priced. `knownFields` are the risk field names the
 * product defines; a factor reading any other field is reported as a warning.
 */
export function validateRateTable(rates: any, productConfig: any, knownFields: string[] = []): RateTableIssue[] {
  const issues: RateTableIssue[] = []
  const error = (message: string) => issues.push({ level: 'error', message })
  const warning = (message: string) => issues.push({ level: 'warning', message })

  const rating = rates?.rating
  if (!isPlainObject(rating)) {
    error("ratingAdapter is 'rate-table' but there is no rating section")
    return issues
  }
  if (rating.basePremium != null && !(isFiniteNumber(rating.basePremium) && rating.basePremium >= 0)) error('rating.basePremium must be a number of 0 or more')
  if (rating.minimumPremium != null && !(isFiniteNumber(rating.minimumPremium) && rating.minimumPremium >= 0)) error('rating.minimumPremium must be a number of 0 or more')
  if (rating.termFactors != null) {
    if (!isPlainObject(rating.termFactors)) error('rating.termFactors must map term months to a factor')
    else for (const [term, factor] of Object.entries(rating.termFactors)) {
      if (!/^\d+$/.test(term) || !isFiniteNumber(factor) || factor <= 0) error(`rating.termFactors: '${term}' must be a number of months with a factor above 0`)
    }
  }

  // --- factors ----------------------------------------------------------------
  const known = new Set(knownFields)
  if (rating.factors != null && !Array.isArray(rating.factors)) error('rating.factors must be a list')
  ;(Array.isArray(rating.factors) ? rating.factors : []).forEach((step: any, index: number) => {
    const label = `rating.factors[${index + 1}]${step?.name ? ` (${step.name})` : ''}`
    if (!isPlainObject(step)) return error(`${label}: must be a mapping`)
    const hasField = typeof step.field === 'string' && step.field.trim()
    const hasPath = typeof step.path === 'string' && step.path.trim()
    if (Boolean(hasField) === Boolean(hasPath)) error(`${label}: set exactly one of field (a risk field) or path (anywhere on the quote)`)
    const hasTable = step.table != null
    const hasRanges = step.ranges != null
    if (hasTable === hasRanges) {
      error(`${label}: set exactly one of table or ranges`)
    } else {
      const entries = hasTable ? step.table : step.ranges
      if (!isPlainObject(entries) || Object.keys(entries).length === 0) {
        error(`${label}: ${hasTable ? 'table' : 'ranges'} must be a non-empty mapping`)
      } else {
        for (const [key, factor] of Object.entries(entries)) {
          if (!isFiniteNumber(factor) || factor < 0) error(`${label}: factor for '${key}' must be a number of 0 or more`)
          if (hasRanges && !parseRange(key)) error(`${label}: '${key}' is not a band; use forms like 1-4, 9+, <25, <=10, >5, >=65`)
        }
      }
    }
    if (step.default != null && !(isFiniteNumber(step.default) && step.default >= 0)) error(`${label}: default must be a number of 0 or more`)
    if (hasField && known.size && !known.has(String(step.field).trim())) {
      warning(`${label}: reads field '${step.field}', which the product does not define`)
    }
  })

  // --- coverages --------------------------------------------------------------
  if (!isPlainObject(rating.coverages) || Object.keys(rating.coverages).length === 0) {
    error('rating.coverages must list how each coverage is priced')
    return issues
  }
  const productCoverages: any[] = Array.isArray(productConfig?.coverages) ? productConfig.coverages : []
  const productCodes = new Map(productCoverages.map((item) => [String(item?.code || '').toLowerCase(), item]))
  const hasDefault = isPlainObject(rating.coverages.default)

  for (const [code, config] of Object.entries(rating.coverages as Record<string, any>)) {
    const label = `rating.coverages.${code}`
    if (!isPlainObject(config)) {
      error(`${label}: must be a mapping`)
      continue
    }
    const methods = COVERAGE_METHODS.filter((method) => config[method] != null)
    if (methods.length !== 1) {
      error(`${label}: set exactly one pricing method (rate, byLimit, flat, or shareOfBase)`)
      continue
    }
    const method = methods[0]
    if (method === 'rate') {
      if (!(isFiniteNumber(config.rate) && config.rate >= 0)) error(`${label}: rate must be a number of 0 or more`)
      if (config.ratePer != null && !(isFiniteNumber(config.ratePer) && config.ratePer > 0)) error(`${label}: ratePer must be a number above 0`)
    } else if (method === 'flat') {
      if (!(isFiniteNumber(config.flat) && config.flat >= 0)) error(`${label}: flat must be a number of 0 or more`)
    } else if (method === 'shareOfBase') {
      if (!(isFiniteNumber(config.shareOfBase) && config.shareOfBase >= 0)) error(`${label}: shareOfBase must be a number of 0 or more`)
      if (!isFiniteNumber(rating.basePremium)) error(`${label}: shareOfBase needs rating.basePremium`)
    } else if (!isPlainObject(config.byLimit) || Object.keys(config.byLimit).length === 0) {
      error(`${label}: byLimit must map each limit to a premium`)
    } else {
      for (const [limit, premium] of Object.entries(config.byLimit)) {
        if (!isFiniteNumber(premium) || premium < 0) error(`${label}: premium for limit ${limit} must be a number of 0 or more`)
      }
    }
    if (config.deductibleFactors != null) {
      if (!isPlainObject(config.deductibleFactors)) error(`${label}: deductibleFactors must map each deductible to a factor`)
      else for (const [deductible, factor] of Object.entries(config.deductibleFactors)) {
        if (!isFiniteNumber(factor) || factor < 0) error(`${label}: deductible factor for ${deductible} must be a number of 0 or more`)
      }
    }
    if (code !== 'default' && !productCodes.has(code.toLowerCase())) {
      warning(`${label}: '${code}' is not a coverage of this product`)
    }

    // A coverage sold with fixed limit options must have a premium for each one.
    const definition = productCodes.get(code.toLowerCase())
    if (method === 'byLimit' && isPlainObject(config.byLimit) && Array.isArray(definition?.limits)) {
      for (const limit of definition.limits) {
        if (!isFiniteNumber(config.byLimit[String(limit)])) error(`${label}: no premium for limit ${limit}, which the product offers`)
      }
    }
    if (method === 'rate' && definition && !Array.isArray(definition.limits) && definition.limitType !== 'value' && !definition.limitAsPercentOf) {
      warning(`${label}: priced per unit of limit, but the coverage defines no limit`)
    }
  }

  for (const item of productCoverages) {
    const code = String(item?.code || '')
    const priced = Object.keys(rating.coverages).some((key) => key !== 'default' && key.toLowerCase() === code.toLowerCase())
    if (code && !priced && !hasDefault) error(`rating.coverages: coverage '${code}' has no pricing and there is no default`)
  }

  if (rates?.fees?.policy != null && !(isFiniteNumber(rates.fees.policy) && rates.fees.policy >= 0)) error('fees.policy must be a number of 0 or more')
  if (rates?.taxes?.rate != null && !(isFiniteNumber(rates.taxes.rate) && rates.taxes.rate >= 0 && rates.taxes.rate < 1)) error('taxes.rate must be a fraction between 0 and 1')

  return issues
}
