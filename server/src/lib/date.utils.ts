/**
 * Date utility functions extracted from routes.ts.
 * All functions operate on YYYY-MM-DD string dates.
 */

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Coerce any value to a YYYY-MM-DD string.
 * Returns `fallback` (or today) if the value cannot be parsed.
 */
export function coerceDateOnly(value: any, fallback?: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  return fallback || today()
}

/**
 * Convert any value to a YYYY-MM-DD string, returning undefined when not parseable.
 */
export function asDateOnly(s?: unknown): string | undefined {
  if (s instanceof Date && !Number.isNaN(s.getTime())) {
    return s.toISOString().slice(0, 10)
  }
  if (typeof s !== 'string') return undefined
  const raw = s.trim()
  if (!raw) return undefined
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(raw)
  if (isoPrefix) return isoPrefix[1]
  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }
  return undefined
}

/**
 * Add (or subtract) a whole number of calendar months to a YYYY-MM-DD date.
 */
export function addMonths(yyyyMmDd: any, months: number): string {
  const normalized = coerceDateOnly(yyyyMmDd)
  const [y, m, d] = normalized.split('-').map(n => Number(n))
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() + months)
  return dt.toISOString().slice(0, 10)
}

/**
 * Count full calendar months between two YYYY-MM-DD dates (end minus start).
 */
export function diffMonths(start: any, end: any): number {
  const s = new Date(coerceDateOnly(start) + 'T00:00:00Z')
  const e = new Date(coerceDateOnly(end) + 'T00:00:00Z')
  return (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth())
}

/** Internal helper — number of whole days between two YYYY-MM-DD dates. */
function daysBetween(a: any, b: any): number {
  const da = new Date(coerceDateOnly(a) + 'T00:00:00Z').getTime()
  const db = new Date(coerceDateOnly(b) + 'T00:00:00Z').getTime()
  return Math.max(0, Math.round((db - da) / 86400000))
}

/**
 * Fraction of a policy term remaining from `eff` to `termExp` relative to
 * the full term length `termEff` → `termExp`.
 */
export function proRataFactor(eff: string, termEff: string, termExp: string): number {
  const total = Math.max(1, daysBetween(termEff, termExp))
  const remaining = Math.max(0, daysBetween(eff, termExp))
  return remaining / total
}

/**
 * Add (or subtract) a whole number of calendar days to a YYYY-MM-DD date.
 */
export function addDays(yyyyMmDd: any, days: number): string {
  const normalized = coerceDateOnly(yyyyMmDd)
  const d = new Date(normalized + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Round to 2 decimal places. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}
