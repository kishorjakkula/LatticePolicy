import { buildRiskFields, loadProductConfig } from '../products.js'
import { listProductCapabilities } from '../product-registry.js'

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
}

export const PRODUCT_FIELD_KEY = 'productCode'
export const RISK_FIELD_PREFIX = 'risk.'

const COMMON_FIELDS: IntakeTargetField[] = [
  { key: 'effectiveDate', label: 'Effective date', section: 'Policy', type: 'date', options: [], required: true, help: 'YYYY-MM-DD' },
  { key: 'state', label: 'Rating state', section: 'Policy', type: 'text', options: [], required: true, help: 'Two-letter state code' },
  { key: 'priorCarrier', label: 'Prior carrier', section: 'Policy', type: 'text', options: [], required: false },
  { key: 'insuredName', label: 'Named insured', section: 'Insured', type: 'text', options: [], required: true },
  { key: 'insuredType', label: 'Insured type', section: 'Insured', type: 'select', options: ['company', 'person'], required: true },
  { key: 'fein', label: 'FEIN', section: 'Insured', type: 'text', options: [], required: false, help: 'Companies only, NN-NNNNNNN' },
  { key: 'email', label: 'Insured email', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'phone', label: 'Insured phone', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'addressLine1', label: 'Mailing address', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'city', label: 'City', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'addressState', label: 'Address state', section: 'Insured', type: 'text', options: [], required: false },
  { key: 'postalCode', label: 'ZIP code', section: 'Insured', type: 'text', options: [], required: false },
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

/** Every field to draft for a submission on `productCode` (or only common fields when unknown). */
export function buildTargetFields(productCode: string | null | undefined, tenantId?: string): IntakeTargetField[] {
  const products = listIntakeProducts()
  const [effectiveDate, state, priorCarrier, ...rest] = COMMON_FIELDS
  const out = [productField(products), effectiveDate, state, priorCarrier, ...rest]
  if (productCode) out.push(...riskTargetFields(productCode, tenantId))
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
    products: products.map((product) => ({ ...product, fields: riskTargetFields(product.code, tenantId) })),
    common: buildTargetFields(null, tenantId),
  }
}
