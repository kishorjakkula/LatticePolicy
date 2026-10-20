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
// US convention (WP-0004 REQ-7): dates read MM/DD/YYYY and date-times
// MM/DD/YYYY h:mm AM/PM. Other countries keep their tenant-configured order.
const DEFAULT_DATE_FORMAT: DateFormatValue = 'MM/DD/YYYY'
const DEFAULT_PREFERENCES: TenantDatePreferences = {
  defaultCountry: 'US',
  dateFormatsByCountry: {
    US: 'MM/DD/YYYY',
    CA: 'MM-DD-YYYY'
  }
}
// The dash form was the platform default stored for every tenant before
// REQ-7 (migration 012). For the US it is read as the slash form so existing
// tenants show the US convention without a data migration.
const LEGACY_US_DATE_FORMAT: DateFormatValue = 'MM-DD-YYYY'
// Countries whose everyday convention is a 12-hour clock with AM/PM.
const TWELVE_HOUR_COUNTRIES = new Set(['US', 'CA', 'AU', 'NZ', 'IN', 'PH'])

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
  return `${dateText} ${renderTime(parsed.date, usesTwelveHourClock(options.country))}`
}

/** True when the country (or the tenant default country) uses a 12-hour clock. */
export function usesTwelveHourClock(country?: string | null): boolean {
  return TWELVE_HOUR_COUNTRIES.has(normalizeCountryCode(country, preferencesCache.defaultCountry))
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
  if (dateFormatsByCountry.US === LEGACY_US_DATE_FORMAT) {
    dateFormatsByCountry.US = 'MM/DD/YYYY'
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
  // DATE columns reach the client serialized as UTC-midnight timestamps
  // ("2026-10-10T00:00:00.000Z"). They carry a calendar date, not an instant, so
  // render the UTC date; converting to local time shows the previous day in
  // every timezone west of UTC.
  const utcMidnight = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:?00)$/.exec(raw)
  if (utcMidnight) {
    const date = new Date(Date.UTC(Number(utcMidnight[1]), Number(utcMidnight[2]) - 1, Number(utcMidnight[3])))
    if (!Number.isNaN(date.getTime())) return { date, dateOnly: true }
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

function renderTime(date: Date, twelveHour: boolean): string {
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  if (!twelveHour) return `${String(hours).padStart(2, '0')}:${minutes}`
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

