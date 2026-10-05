import { sanitizeText } from '../../lib/utils.js'

export function normalizeAgencyStatus(value: any): string {
  const allowed = ['PROSPECT', 'PENDING_COMPLIANCE', 'PENDING_CONTRACT', 'PENDING_APPOINTMENT', 'ACTIVE', 'SUSPENDED', 'TERMINATED']
  const raw = sanitizeText(value).toUpperCase()
  return allowed.includes(raw) ? raw : 'PROSPECT'
}

export function normalizeProducerStatus(value: any): string {
  const allowed = ['INVITED', 'PENDING_LICENSE', 'PENDING_APPOINTMENT', 'ACTIVE', 'RESTRICTED', 'SUSPENDED']
  const raw = sanitizeText(value).toUpperCase()
  return allowed.includes(raw) ? raw : 'INVITED'
}

export function normalizeAgencyType(value: any): string {
  const raw = sanitizeText(value).toUpperCase()
  return ['INDEPENDENT', 'CAPTIVE', 'MGA', 'WHOLESALER'].includes(raw) ? raw : 'INDEPENDENT'
}

export function normalizeAgencyCodePrefix(value: any): string {
  const raw = sanitizeText(value).toUpperCase().replace(/[^A-Z]/g, '')
  if (!raw) return 'AG'
  return raw.length === 1 ? `${raw}A` : raw.slice(0, 6)
}

export const normalizeStringArray = (value: any): string[] => Array.isArray(value) ? value.map(sanitizeText).filter(Boolean) : []
export const normalizeObject = (value: any): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
export const toNullable = (value: any): string | null => sanitizeText(value) || null
export const normalizeTextForMatch = (value: any): string => sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
export const normalizeLast4 = (value: any): string => {
  const digits = sanitizeText(value).replace(/\D+/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}
export const isUuid = (value: any): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sanitizeText(value))
export const isFiniteNumber = (value: any): boolean => Number.isFinite(Number(value))
export const toNumber = (value: any, fallback = 0): number => Number.isFinite(Number(value)) ? Number(value) : fallback

export function toOptionalNumber(value: any): number | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  return Number.isFinite(Number(raw)) ? Number(raw) : null
}

export function clampInt(value: any, fallback: number, min: number, max: number): number {
  const number = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

export function toBoolean(value: any, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  const raw = sanitizeText(value).toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false
  return fallback
}

export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

export function normalizeDate(value: any): string | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const normalized = /^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw)
    ? `${raw.slice(6, 10)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}T00:00:00Z`
    : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

export function normalizeTimestamp(value: any): string | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export const toTimestampOrDefault = (value: any, fallbackIso: string): string => normalizeTimestamp(value) || fallbackIso
