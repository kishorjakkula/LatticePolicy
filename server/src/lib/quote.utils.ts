/**
 * Quote utility functions extracted from routes.ts.
 */

import { isUuidLike, sanitizeCustomerRef } from './utils.js'
import { coerceDateOnly, today } from './date.utils.js'

export type QuoteCustomerLink = {
  customerId: string
  customerKey: string
  relationshipType: string
  isPrimary: boolean
  displayName: string
}

function buildDisplayNameFromInsured(value: any): string {
  if (!value || typeof value !== 'object') return ''
  const explicit = sanitizeCustomerRef(value.displayName)
  if (explicit) return explicit
  const firstName = sanitizeCustomerRef(value.firstName)
  const lastName = sanitizeCustomerRef(value.lastName)
  return [firstName, lastName].filter(Boolean).join(' ').trim()
}

export function extractQuoteCustomerLinks(payload: any): QuoteCustomerLink[] {
  const insureds = payload?.insureds && typeof payload.insureds === 'object' ? payload.insureds : {}
  const candidates: Array<{ source: any; relationshipType: string; isPrimary: boolean }> = []
  candidates.push({ source: insureds.primary || null, relationshipType: 'PRIMARY_NAMED_INSURED', isPrimary: true })
  candidates.push({ source: insureds.secondary || null, relationshipType: 'SECONDARY_NAMED_INSURED', isPrimary: false })
  const additional = Array.isArray(insureds.additional) ? insureds.additional : []
  for (const source of additional) {
    candidates.push({ source, relationshipType: 'ADDITIONAL_NAMED_INSURED', isPrimary: false })
  }

  const links: QuoteCustomerLink[] = []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    const customerId = sanitizeCustomerRef(candidate.source?.customerId)
    if (!isUuidLike(customerId)) continue
    const customerKey = sanitizeCustomerRef(candidate.source?.customerKey)
    const displayName = buildDisplayNameFromInsured(candidate.source)
    const dedupeKey = `${customerId}:${candidate.relationshipType}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    links.push({
      customerId,
      customerKey,
      relationshipType: candidate.relationshipType,
      isPrimary: candidate.isPrimary,
      displayName
    })
  }
  return links
}

export function generateQuoteNumber(): string {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `Q${stamp}-${rand}`
}

export function resolveQuoteActor(req: any): string {
  return req.user?.username || req.user?.id || 'system'
}

export function normalizeQuotePayload(rawPayload: any, fallbackEffectiveDate?: string): any {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {}
  const effectiveDate = coerceDateOnly(
    payload.effectiveDate || payload.transactionEffectiveDate || fallbackEffectiveDate,
    today()
  )
  payload.effectiveDate = effectiveDate
  payload.transactionEffectiveDate = effectiveDate
  return payload
}
