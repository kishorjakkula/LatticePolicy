/**
 * General-purpose string/value utilities extracted from routes.ts.
 * Pure functions with no external dependencies.
 */

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

export function sanitizeCustomerRef(value: any): string {
  return String(value || '').trim()
}

export function asTrimmedText(value: any): string {
  return String(value ?? '').trim()
}

export function csvEscape(v: any): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function sanitizeInlineFileName(value: string): string {
  return String(value || '')
    .replace(/[\r\n"]/g, '')
    .replace(/[^\w.\- ]+/g, '_')
    .slice(0, 180) || 'document.pdf'
}

export function sanitizeText(value: any): string {
  return String(value ?? '').trim()
}
