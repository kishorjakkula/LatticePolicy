import { createHash } from 'node:crypto'
import { canonicalProposal } from './referral-proposal.js'
import { normalizeQuotePayload } from './quote.utils.js'

/**
 * Rating fingerprint (WP-0008): what a quote's rating and underwriting result
 * were computed from. A draft save that changes it resets the rating; bind
 * refuses a quote whose payload no longer matches it.
 */

/** May change after rating without a new rating: the rater and UW rules do not read them. */
export const NON_RATING_FIELDS = ['billingMethod', 'paymentPlan'] as const

/**
 * The product version a quote is rated and bound on. Set by rating only: draft
 * saves keep the stored values and ignore the client's, so they never weaken
 * the fingerprint even though they are left out of it.
 */
export const PRODUCT_PIN_FIELDS = ['productVersion', 'governanceLineage', 'productSnapshot'] as const

/** Wizard bookkeeping plus the product pin; never risk data chosen by the user. */
const SERVER_OWNED_FIELDS = ['quoteId', ...PRODUCT_PIN_FIELDS] as const

export function ratingFingerprint(payload: unknown): string {
  const risk = normalizeQuotePayload(payload)
  for (const key of [...NON_RATING_FIELDS, ...SERVER_OWNED_FIELDS]) delete risk[key]
  return createHash('sha256').update(canonicalProposal(risk)).digest('hex')
}

/** The client's payload without product pin fields, for a new draft. */
export function withoutServerOwnedFields(payload: Record<string, any>): Record<string, any> {
  const next = { ...payload }
  for (const key of PRODUCT_PIN_FIELDS) delete next[key]
  return next
}

/** The client's payload with the product pin fields taken from the stored quote. */
export function withServerOwnedFieldsFrom(next: Record<string, any>, stored: unknown): Record<string, any> {
  const result = withoutServerOwnedFields(next)
  const source = stored && typeof stored === 'object' ? stored as Record<string, unknown> : {}
  for (const key of PRODUCT_PIN_FIELDS) if (source[key] !== undefined) result[key] = source[key]
  return result
}

/** The fingerprint stored with a rating, if any (ratings before WP-0008 have none). */
export function storedRatingFingerprint(underwriting: unknown): string | null {
  const value = underwriting && typeof underwriting === 'object'
    ? (underwriting as Record<string, unknown>).ratedFingerprint
    : null
  return typeof value === 'string' && value ? value : null
}
