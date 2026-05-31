export type DateFormatValue =
  | 'MM-DD-YYYY'
  | 'DD-MM-YYYY'
  | 'YYYY-MM-DD'
  | 'MM/DD/YYYY'
  | 'DD/MM/YYYY'
  | 'YYYY/MM/DD'

export type TenantDatePreferences = {
  defaultCountry: string
  dateFormatsByCountry: Record<string, DateFormatValue>
}

export type TenantPolicyNumberFormats = Record<string, string>

export const DATE_FORMAT_VALUES: DateFormatValue[] = [
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY/MM/DD'
]

const DEFAULT_DATE_FORMAT: DateFormatValue = 'MM-DD-YYYY'
const DEFAULT_COUNTRY = 'US'
const DEFAULT_FORMATS: Record<string, DateFormatValue> = {
  US: 'MM-DD-YYYY',
  CA: 'MM-DD-YYYY'
}
const DEFAULT_POLICY_NUMBER_FORMATS: TenantPolicyNumberFormats = {
  'personal-auto': 'PC-{ID8}',
  'commercial-auto': 'CA-{ID8}',
  homeowners: 'HO-{ID8}',
  cyber: 'CY-{ID8}',
  'professional-liability': 'PL-{ID8}'
}

const memoryByTenant = new Map<string, TenantDatePreferences>()
const memoryPolicyFormatsByTenant = new Map<string, TenantPolicyNumberFormats>()

export function defaultTenantDatePreferences(): TenantDatePreferences {
  return {
    defaultCountry: DEFAULT_COUNTRY,
    dateFormatsByCountry: { ...DEFAULT_FORMATS }
  }
}

export function defaultTenantPolicyNumberFormats(): TenantPolicyNumberFormats {
  return { ...DEFAULT_POLICY_NUMBER_FORMATS }
}

export function normalizeCountryCode(value: any, fallback = DEFAULT_COUNTRY): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (/^[A-Z]{2,3}$/.test(normalized)) return normalized
  return fallback
}

export function normalizeDateFormatValue(value: any, fallback: DateFormatValue = DEFAULT_DATE_FORMAT): DateFormatValue {
  const normalized = String(value || '').trim().toUpperCase() as DateFormatValue
  return DATE_FORMAT_VALUES.includes(normalized) ? normalized : fallback
}

export function normalizeDateFormatsByCountry(
  input: any,
  fallback: Record<string, DateFormatValue> = DEFAULT_FORMATS
): Record<string, DateFormatValue> {
  const out: Record<string, DateFormatValue> = {}
  const source = input && typeof input === 'object' ? input : {}
  for (const [rawCountry, rawFormat] of Object.entries(source)) {
    const country = normalizeCountryCode(rawCountry, '')
    if (!country) continue
    out[country] = normalizeDateFormatValue(rawFormat, fallback[country] || DEFAULT_DATE_FORMAT)
  }
  if (!Object.keys(out).length) {
    return { ...fallback }
  }
  return out
}

export function normalizeTenantDatePreferences(
  input: any,
  fallback: TenantDatePreferences = defaultTenantDatePreferences()
): TenantDatePreferences {
  const defaultCountry = normalizeCountryCode(input?.defaultCountry, fallback.defaultCountry || DEFAULT_COUNTRY)
  const dateFormatsByCountry = normalizeDateFormatsByCountry(
    input?.dateFormatsByCountry,
    fallback.dateFormatsByCountry || DEFAULT_FORMATS
  )
  if (!dateFormatsByCountry[defaultCountry]) {
    dateFormatsByCountry[defaultCountry] =
      fallback.dateFormatsByCountry?.[defaultCountry] ||
      fallback.dateFormatsByCountry?.[fallback.defaultCountry] ||
      DEFAULT_DATE_FORMAT
  }
  return { defaultCountry, dateFormatsByCountry }
}

export function tenantDatePreferencesFromRow(row: any): TenantDatePreferences {
  if (!row || typeof row !== 'object') return defaultTenantDatePreferences()
  let rawFormats = row.date_formats_by_country ?? row.dateFormatsByCountry
  if (typeof rawFormats === 'string') {
    try {
      rawFormats = JSON.parse(rawFormats)
    } catch {
      rawFormats = {}
    }
  }
  return normalizeTenantDatePreferences({
    defaultCountry: row.default_country_code ?? row.defaultCountry,
    dateFormatsByCountry: rawFormats
  })
}

export function getMemoryTenantDatePreferences(tenantId: string): TenantDatePreferences {
  const existing = memoryByTenant.get(tenantId)
  if (existing) return { defaultCountry: existing.defaultCountry, dateFormatsByCountry: { ...existing.dateFormatsByCountry } }
  const defaults = defaultTenantDatePreferences()
  memoryByTenant.set(tenantId, defaults)
  return { defaultCountry: defaults.defaultCountry, dateFormatsByCountry: { ...defaults.dateFormatsByCountry } }
}

export function setMemoryTenantDatePreferences(tenantId: string, input: any): TenantDatePreferences {
  const current = getMemoryTenantDatePreferences(tenantId)
  const next = normalizeTenantDatePreferences(input, current)
  memoryByTenant.set(tenantId, next)
  return { defaultCountry: next.defaultCountry, dateFormatsByCountry: { ...next.dateFormatsByCountry } }
}

function normalizePolicyProductCode(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
}

function normalizePolicyFormatTemplate(value: any, fallback: string): string {
  const normalized = String(value || '').trim()
  if (!normalized) return fallback
  return normalized.slice(0, 80)
}

export function normalizePolicyNumberFormatsByProduct(
  input: any,
  fallback: TenantPolicyNumberFormats = defaultTenantPolicyNumberFormats()
): TenantPolicyNumberFormats {
  const out: TenantPolicyNumberFormats = {}
  const source = input && typeof input === 'object' ? input : {}
  for (const [rawProductCode, rawFormat] of Object.entries(source)) {
    const productCode = normalizePolicyProductCode(rawProductCode)
    if (!productCode) continue
    out[productCode] = normalizePolicyFormatTemplate(rawFormat, fallback[productCode] || '{PRODUCT}-{ID8}')
  }
  if (!Object.keys(out).length) {
    return { ...fallback }
  }
  for (const [productCode, fallbackFormat] of Object.entries(fallback)) {
    if (!out[productCode]) out[productCode] = fallbackFormat
  }
  return out
}

export function tenantPolicyNumberFormatsFromRow(row: any): TenantPolicyNumberFormats {
  if (!row || typeof row !== 'object') return defaultTenantPolicyNumberFormats()
  let rawFormats = row.policy_number_formats_by_product ?? row.policyNumberFormatsByProduct
  if (typeof rawFormats === 'string') {
    try {
      rawFormats = JSON.parse(rawFormats)
    } catch {
      rawFormats = {}
    }
  }
  return normalizePolicyNumberFormatsByProduct(rawFormats, defaultTenantPolicyNumberFormats())
}

export function getMemoryTenantPolicyNumberFormats(tenantId: string): TenantPolicyNumberFormats {
  const existing = memoryPolicyFormatsByTenant.get(tenantId)
  if (existing) return { ...existing }
  const defaults = defaultTenantPolicyNumberFormats()
  memoryPolicyFormatsByTenant.set(tenantId, defaults)
  return { ...defaults }
}

export function setMemoryTenantPolicyNumberFormats(tenantId: string, input: any): TenantPolicyNumberFormats {
  const current = getMemoryTenantPolicyNumberFormats(tenantId)
  const next = normalizePolicyNumberFormatsByProduct(input, current)
  memoryPolicyFormatsByTenant.set(tenantId, next)
  return { ...next }
}
