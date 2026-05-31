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

export const DATE_FORMAT_OPTIONS: DateFormatValue[] = [
  'MM-DD-YYYY',
  'DD-MM-YYYY',
  'YYYY-MM-DD',
  'MM/DD/YYYY',
  'DD/MM/YYYY',
  'YYYY/MM/DD'
]

const STORAGE_KEY = 'tenantDatePreferences'
const DEFAULT_DATE_FORMAT: DateFormatValue = 'MM-DD-YYYY'
const DEFAULT_PREFERENCES: TenantDatePreferences = {
  defaultCountry: 'US',
  dateFormatsByCountry: {
    US: 'MM-DD-YYYY',
    CA: 'MM-DD-YYYY'
  }
}

let preferencesCache: TenantDatePreferences = loadPreferencesFromStorage()

export function getTenantDatePreferences(): TenantDatePreferences {
  return {
    defaultCountry: preferencesCache.defaultCountry,
    dateFormatsByCountry: { ...preferencesCache.dateFormatsByCountry }
  }
}

export function applyTenantDatePreferences(input: any): TenantDatePreferences {
  const normalized = normalizeTenantDatePreferences(input, preferencesCache)
  preferencesCache = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  }
  return getTenantDatePreferences()
}

export function resetTenantDatePreferences(): TenantDatePreferences {
  preferencesCache = { ...DEFAULT_PREFERENCES, dateFormatsByCountry: { ...DEFAULT_PREFERENCES.dateFormatsByCountry } }
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
  return getTenantDatePreferences()
}

export function resolveDateFormat(country?: string | null): DateFormatValue {
  const normalizedCountry = normalizeCountryCode(country, preferencesCache.defaultCountry)
  return (
    preferencesCache.dateFormatsByCountry[normalizedCountry] ||
    preferencesCache.dateFormatsByCountry[preferencesCache.defaultCountry] ||
    DEFAULT_DATE_FORMAT
  )
}

export function formatDisplayDate(
  value: any,
  options: { country?: string | null; fallback?: string } = {}
): string {
  const fallback = options.fallback ?? ''
  const parsed = parseDateValue(value)
  if (!parsed) {
    const raw = String(value || '').trim()
    return raw || fallback
  }
  const format = resolveDateFormat(options.country)
  return renderDate(parsed.date, parsed.dateOnly, format)
}

export function formatDisplayDateTime(
  value: any,
  options: { country?: string | null; fallback?: string; includeTime?: boolean } = {}
): string {
  const fallback = options.fallback ?? ''
  const parsed = parseDateValue(value)
  if (!parsed) {
    const raw = String(value || '').trim()
    return raw || fallback
  }
  const dateText = renderDate(parsed.date, parsed.dateOnly, resolveDateFormat(options.country))
  if (!options.includeTime || parsed.dateOnly) return dateText
  const timeText = parsed.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return `${dateText} ${timeText}`
}

export function normalizeTenantDatePreferences(
  input: any,
  fallback: TenantDatePreferences = DEFAULT_PREFERENCES
): TenantDatePreferences {
  const defaultCountry = normalizeCountryCode(input?.defaultCountry, fallback.defaultCountry || 'US')
  const dateFormatsByCountry = normalizeDateFormatsByCountry(
    input?.dateFormatsByCountry,
    fallback.dateFormatsByCountry || DEFAULT_PREFERENCES.dateFormatsByCountry
  )
  if (!dateFormatsByCountry[defaultCountry]) {
    dateFormatsByCountry[defaultCountry] = fallback.dateFormatsByCountry?.[defaultCountry] || DEFAULT_DATE_FORMAT
  }
  return { defaultCountry, dateFormatsByCountry }
}

function loadPreferencesFromStorage(): TenantDatePreferences {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_PREFERENCES, dateFormatsByCountry: { ...DEFAULT_PREFERENCES.dateFormatsByCountry } }
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PREFERENCES, dateFormatsByCountry: { ...DEFAULT_PREFERENCES.dateFormatsByCountry } }
    return normalizeTenantDatePreferences(JSON.parse(raw), DEFAULT_PREFERENCES)
  } catch {
    return { ...DEFAULT_PREFERENCES, dateFormatsByCountry: { ...DEFAULT_PREFERENCES.dateFormatsByCountry } }
  }
}

function normalizeCountryCode(value: any, fallback: string): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (/^[A-Z]{2,3}$/.test(normalized)) return normalized
  return String(fallback || 'US').trim().toUpperCase() || 'US'
}

function normalizeDateFormat(value: any, fallback: DateFormatValue): DateFormatValue {
  const normalized = String(value || '').trim().toUpperCase() as DateFormatValue
  return DATE_FORMAT_OPTIONS.includes(normalized) ? normalized : fallback
}

function normalizeDateFormatsByCountry(
  input: any,
  fallback: Record<string, DateFormatValue>
): Record<string, DateFormatValue> {
  const out: Record<string, DateFormatValue> = {}
  const source = input && typeof input === 'object' ? input : {}
  for (const [countryRaw, formatRaw] of Object.entries(source)) {
    const country = normalizeCountryCode(countryRaw, '')
    if (!country) continue
    out[country] = normalizeDateFormat(formatRaw, fallback[country] || DEFAULT_DATE_FORMAT)
  }
  if (!Object.keys(out).length) return { ...fallback }
  return out
}

function parseDateValue(value: any): { date: Date; dateOnly: boolean } | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(date.getTime())) return null
    return { date, dateOnly: true }
  }
  const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})T/.exec(raw)
  if (isoPrefix) {
    const parsedIso = new Date(raw)
    if (!Number.isNaN(parsedIso.getTime())) return { date: parsedIso, dateOnly: false }
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return { date: parsed, dateOnly: false }
}

function renderDate(date: Date, dateOnly: boolean, format: DateFormatValue): string {
  const year = String(dateOnly ? date.getUTCFullYear() : date.getFullYear())
  const month = String((dateOnly ? date.getUTCMonth() : date.getMonth()) + 1).padStart(2, '0')
  const day = String(dateOnly ? date.getUTCDate() : date.getDate()).padStart(2, '0')

  if (format === 'MM-DD-YYYY') return `${month}-${day}-${year}`
  if (format === 'DD-MM-YYYY') return `${day}-${month}-${year}`
  if (format === 'YYYY-MM-DD') return `${year}-${month}-${day}`
  if (format === 'MM/DD/YYYY') return `${month}/${day}/${year}`
  if (format === 'DD/MM/YYYY') return `${day}/${month}/${year}`
  return `${year}/${month}/${day}`
}

