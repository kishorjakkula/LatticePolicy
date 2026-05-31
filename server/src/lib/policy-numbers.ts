import {
  defaultTenantPolicyNumberFormats,
  normalizePolicyNumberFormatsByProduct,
  type TenantPolicyNumberFormats
} from '../tenantPreferences.js'

const POLICY_NUMBER_MAX_LENGTH = 40
const TOKEN_PATTERN = /\{([A-Z0-9_]+)\}/g

export type PolicyNumberContext = {
  policyId: string
  productCode: string
  now?: Date
}

export type PolicyNumberGenerateOptions = PolicyNumberContext & {
  formatsByProduct?: TenantPolicyNumberFormats
  isUnique?: (candidate: string) => Promise<boolean>
  maxAttempts?: number
}

export function normalizePolicyProductCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

export function resolvePolicyNumberTemplate(
  formatsByProduct: TenantPolicyNumberFormats | undefined,
  productCode: string
): string {
  const normalizedProductCode = normalizePolicyProductCode(productCode)
  const normalizedFormats = normalizePolicyNumberFormatsByProduct(
    formatsByProduct || {},
    defaultTenantPolicyNumberFormats()
  )
  return (
    normalizedFormats[normalizedProductCode] ||
    normalizedFormats['*'] ||
    '{PRODUCT}-{ID8}'
  )
}

export function renderPolicyNumber(
  template: string,
  context: PolicyNumberContext,
  attempt = 0
): string {
  const now = context.now || new Date()
  const productToken = normalizePolicyProductCode(context.productCode)
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase() || 'POL'
  const policyIdRaw = String(context.policyId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
  const policyIdFallback = randomAlphaNumeric(12)
  const policyId = policyIdRaw || policyIdFallback
  const rand4 = randomAlphaNumeric(4)
  const rand6 = randomAlphaNumeric(6)
  const rand8 = randomAlphaNumeric(8)
  const values: Record<string, string> = {
    PRODUCT: productToken,
    ID: policyId,
    ID6: takeOrPad(policyId, 6),
    ID8: takeOrPad(policyId, 8),
    YYYY: String(now.getUTCFullYear()),
    YY: String(now.getUTCFullYear()).slice(-2),
    MM: String(now.getUTCMonth() + 1).padStart(2, '0'),
    DD: String(now.getUTCDate()).padStart(2, '0'),
    RAND4: rand4,
    RAND6: rand6,
    RAND8: rand8
  }

  const base = String(template || '{PRODUCT}-{ID8}').replace(TOKEN_PATTERN, (_, token: string) => {
    const key = String(token || '').toUpperCase()
    return values[key] ?? ''
  })
  const normalized = normalizePolicyNumberValue(base)
  if (!attempt) return normalized
  const suffix = `-${attempt + 1}`
  if (normalized.length + suffix.length <= POLICY_NUMBER_MAX_LENGTH) {
    return normalized + suffix
  }
  const keepLength = Math.max(1, POLICY_NUMBER_MAX_LENGTH - suffix.length)
  return normalizePolicyNumberValue(normalized.slice(0, keepLength) + suffix)
}

export async function generatePolicyNumber(options: PolicyNumberGenerateOptions): Promise<string> {
  const {
    policyId,
    productCode,
    now,
    formatsByProduct,
    isUnique,
    maxAttempts = 24
  } = options
  const template = resolvePolicyNumberTemplate(formatsByProduct, productCode)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = renderPolicyNumber(template, { policyId, productCode, now }, attempt)
    if (!isUnique || (await isUnique(candidate))) return candidate
  }
  throw new Error('POLICY_NUMBER_GENERATION_FAILED')
}

function normalizePolicyNumberValue(value: string): string {
  const collapsed = String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  const fallback = collapsed || `POL-${randomAlphaNumeric(8)}`
  return fallback.slice(0, POLICY_NUMBER_MAX_LENGTH)
}

function takeOrPad(value: string, length: number): string {
  if (value.length >= length) return value.slice(0, length)
  return (value + randomAlphaNumeric(length)).slice(0, length)
}

function randomAlphaNumeric(length: number): string {
  let out = ''
  while (out.length < length) {
    out += Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '')
  }
  return out.slice(0, length)
}
