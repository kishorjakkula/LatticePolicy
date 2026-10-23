import { buildRiskFields, loadProductConfig } from '../products.js'
import { listProductCapabilities } from '../product-registry.js'
import { qualificationQuestionsFor } from '@lattice-policy/rules'

/**
 * A value the intake extractor is asked to find in a submission.
 *
 * The list is built from the product's own quote screen (the same risk
 * fields the wizard renders, including carrier pack fields), plus the
 * policy, insured, and broker details every quote needs. Intake therefore
 * follows each carrier's configuration without code changes.
 */
export type IntakeTargetField = {
  key: string
  label: string
  section: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[]
  required: boolean
  help?: string
  /** Other labels documents use for this value (declarations tables, forms). */
  aliases?: string[]
}

export const PRODUCT_FIELD_KEY = 'productCode'
export const RISK_FIELD_PREFIX = 'risk.'
export const QUALIFICATION_FIELD_PREFIX = 'qual.'
export const COVERAGE_FIELD_PREFIX = 'cov.'

const COMMON_FIELDS: IntakeTargetField[] = [
  { key: 'effectiveDate', label: 'Effective date', section: 'Policy', type: 'date', options: [], required: true, help: 'YYYY-MM-DD' },
  { key: 'state', label: 'Rating state', section: 'Policy', type: 'text', options: [], required: true, help: 'Two-letter state code' },
  { key: 'priorCarrier', label: 'Prior carrier', section: 'Policy', type: 'text', options: [], required: false },
  { key: 'insuredName', label: 'Named insured', section: 'Insured', type: 'text', options: [], required: true },
  { key: 'insuredType', label: 'Insured type', section: 'Insured', type: 'select', options: ['company', 'person'], required: true },
  { key: 'fein', label: 'FEIN', section: 'Insured', type: 'text', options: [], required: false, help: 'Companies only, NN-NNNNNNN' },
  { key: 'insuredDob', label: 'Insured date of birth', section: 'Insured', type: 'date', options: [], required: false, help: 'People only', aliases: ['date of birth', 'dob', 'applicant date of birth'] },
  { key: 'email', label: 'Insured email', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'phone', label: 'Insured phone', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'addressLine1', label: 'Mailing address', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'addressLine2', label: 'Apartment, suite or unit', section: 'Insured', type: 'text', options: [], required: false, aliases: ['address line 2', 'apartment', 'suite', 'unit'] },
  { key: 'city', label: 'City', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'addressState', label: 'Address state', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'postalCode', label: 'ZIP code', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'priorPolicyNumber', label: 'Prior policy number', section: 'Prior insurance', type: 'text', options: [], required: false },
  { key: 'priorExpirationDate', label: 'Prior policy expiration', section: 'Prior insurance', type: 'date', options: [], required: false, help: 'YYYY-MM-DD' },
  { key: 'yearsWithPriorCarrier', label: 'Years with prior carrier', section: 'Prior insurance', type: 'number', options: [], required: false },
  { key: 'billingMethod', label: 'Billing method', section: 'Billing', type: 'select', options: ['direct', 'agency'], required: false },
  { key: 'paymentPlan', label: 'Payment plan', section: 'Billing', type: 'select', options: ['annual', 'semi-annual', 'quarterly', 'monthly'], required: false },
  { key: 'interestRole', label: 'Additional interest type', section: 'Additional interest', type: 'select', options: ['MORTGAGEE', 'LOSS_PAYEE', 'ADDITIONAL_INSURED', 'ADDITIONAL_INTEREST'], required: false, help: 'Mortgagee, lienholder (loss payee), additional insured' },
  { key: 'interestName', label: 'Mortgagee or lienholder', section: 'Additional interest', type: 'text', options: [], required: false },
  { key: 'interestLoanNumber', label: 'Loan number', section: 'Additional interest', type: 'text', options: [], required: false },
  { key: 'interestAddress', label: 'Mortgagee address', section: 'Additional interest', type: 'text', options: [], required: false },
  { key: 'brokerName', label: 'Broker or agency', section: 'Broker', type: 'text', options: [], required: false },
  { key: 'brokerEmail', label: 'Broker email', section: 'Broker', type: 'text', options: [], required: false },
]

export type IntakeProductOption = { code: string; label: string; riskLabel: string }

export function listIntakeProducts(): IntakeProductOption[] {
  return listProductCapabilities().map((product) => ({
    code: product.code,
    label: product.label || product.code,
    riskLabel: product.riskLabel || 'Risk',
  }))
}

function productField(products: IntakeProductOption[]): IntakeTargetField {
  return {
    key: PRODUCT_FIELD_KEY,
    label: 'Product',
    section: 'Policy',
    type: 'select',
    options: products.map((product) => product.code),
    required: true,
  }
}

/** The product's risk fields as intake targets, keyed `risk.<fieldKey>`. */
export function riskTargetFields(productCode: string, tenantId?: string): IntakeTargetField[] {
  const product = listIntakeProducts().find((item) => item.code === productCode)
  if (!product) return []
  let fields: ReturnType<typeof buildRiskFields>
  try {
    fields = buildRiskFields(productCode, loadProductConfig(productCode), tenantId)
  } catch {
    return []
  }
  return fields.map((field) => ({
    key: `${RISK_FIELD_PREFIX}${field.key}`,
    label: field.label,
    section: field.group || product.riskLabel || 'Risk',
    type: field.type,
    options: Array.isArray(field.options) ? field.options.map((option) => String(option)) : [],
    required: field.required === true,
    help: field.help,
  }))
}

/**
 * The product's qualification questions (the wizard's eligibility step) as
 * yes/no intake targets, keyed `qual.<questionKey>`. A follow-up question
 * asked only after a particular answer is not required here; the wizard asks
 * it again when it applies.
 */
export function qualificationTargetFields(productCode: string): IntakeTargetField[] {
  const questions = qualificationQuestionsFor(productCode)
  return questions.map((question) => {
    const parent = question.showWhen ? questions.find((item) => item.key === question.showWhen!.key) : null
    return {
      key: `${QUALIFICATION_FIELD_PREFIX}${question.key}`,
      label: question.label,
      section: 'Qualification questions',
      type: 'select' as const,
      options: ['yes', 'no'],
      required: question.required === true && !question.showWhen,
      help: parent ? `Answer only if "${parent.label}" is ${question.showWhen!.answer}.` : 'yes or no',
    }
  })
}

const asOptions = (values: unknown[]): string[] => values.map((value) => String(value))
const meaningful = (values: unknown): values is unknown[] => Array.isArray(values) && values.length > 0 && values.some((value) => Number(value) !== 0 || typeof value === 'string')

/**
 * The coverages a submission asks for, from the product's coverage
 * definition: limits, deductibles, amounts, percentages of Coverage A, and
 * optional endorsements. Keys are `cov.<CODE>.<limit|deductible|percent|
 * selected|windHailPercent>`. None is required: the quote wizard applies the
 * product's defaults to anything not asked for.
 */
export function coverageTargetFields(productCode: string): IntakeTargetField[] {
  let cfg: any
  try {
    cfg = loadProductConfig(productCode)
  } catch {
    return []
  }
  const section = 'Coverages requested'
  const out: IntakeTargetField[] = []
  for (const cov of Array.isArray(cfg?.coverages) ? cfg.coverages : []) {
    if (!cov?.code || cov.selectable === false) continue
    const code = String(cov.code)
    const name = String(cov.name || code)
    // Declarations often shorten names ("Medical Payments" for "Medical Payments to Others").
    const shortName = name.split(/\s+(?:to|on|for|and)\s+/i)[0]
    const named = Array.from(new Set([name, shortName].flatMap((label) => [label.toLowerCase(), `coverage ${code.toLowerCase()} - ${label.toLowerCase()}`]).concat(`coverage ${code.toLowerCase()}`)))
    if (cov.limitType === 'value') {
      out.push({ key: `${COVERAGE_FIELD_PREFIX}${code}.limit`, label: `${name} limit`, section, type: 'number', options: [], required: false, aliases: named })
    } else if (cov.limitAsPercentOf) {
      out.push({ key: `${COVERAGE_FIELD_PREFIX}${code}.percent`, label: `${name} (% of Coverage ${cov.limitAsPercentOf})`, section, type: 'select', options: asOptions(cov.percentOptions || []), required: false, help: 'Percentage of the dwelling limit' })
    } else if (meaningful(cov.limits) && cov.limits.length > 1) {
      out.push({ key: `${COVERAGE_FIELD_PREFIX}${code}.limit`, label: `${name} limit`, section, type: 'select', options: asOptions(cov.limits), required: false, aliases: named })
    }
    if (meaningful(cov.deductibles) && cov.deductibles.length > 1) {
      out.push({ key: `${COVERAGE_FIELD_PREFIX}${code}.deductible`, label: `${name} deductible`, section, type: 'select', options: asOptions(cov.deductibles), required: false })
    }
    const hasValue = cov.limitType === 'value' || cov.limitAsPercentOf || (meaningful(cov.limits) && cov.limits.length > 1)
    if (cov.optional === true && !hasValue) {
      out.push({ key: `${COVERAGE_FIELD_PREFIX}${code}.selected`, label: `${name} requested?`, section, type: 'select', options: ['yes', 'no'], required: false })
    }
  }
  // Homeowners-style policy deductibles, kept on Coverage A.
  if (meaningful(cfg?.deductibles?.allPeril)) {
    out.push({ key: `${COVERAGE_FIELD_PREFIX}A.deductible`, label: 'All peril deductible', section, type: 'select', options: asOptions(cfg.deductibles.allPeril), required: false, aliases: ['all other perils deductible', 'aop deductible', 'deductible'] })
  }
  if (meaningful(cfg?.deductibles?.windHailPercent)) {
    out.push({ key: `${COVERAGE_FIELD_PREFIX}A.windHailPercent`, label: 'Wind/hail deductible', section, type: 'select', options: asOptions(cfg.deductibles.windHailPercent), required: false, help: 'Percent of Coverage A', aliases: ['windstorm or hail deductible', 'wind and hail deductible', 'wind deductible'] })
  }
  return out
}

/** Every field to draft for a submission on `productCode` (or only common fields when unknown). */
export function buildTargetFields(productCode: string | null | undefined, tenantId?: string): IntakeTargetField[] {
  const products = listIntakeProducts()
  const [effectiveDate, state, priorCarrier, ...rest] = COMMON_FIELDS
  const out = [productField(products), effectiveDate, state, priorCarrier, ...rest]
  if (productCode) out.push(...riskTargetFields(productCode, tenantId), ...coverageTargetFields(productCode), ...qualificationTargetFields(productCode))
  return out
}

/**
 * The catalog an extractor reads from: the common fields, and per installed
 * product its risk fields. The extractor picks the product and fills that
 * product's fields in one pass over the documents.
 */
export function buildExtractionCatalog(tenantId?: string): {
  products: Array<IntakeProductOption & { fields: IntakeTargetField[] }>
  common: IntakeTargetField[]
} {
  const products = listIntakeProducts()
  return {
    products: products.map((product) => ({ ...product, fields: [...riskTargetFields(product.code, tenantId), ...coverageTargetFields(product.code), ...qualificationTargetFields(product.code)] })),
    common: buildTargetFields(null, tenantId),
  }
}
