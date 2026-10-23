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
 * Added or carried by the server (or the wizard's bookkeeping), never chosen by
 * the user as risk data. A key missing here makes every wizard autosave reset
 * the rating, which the E2E suites catch; it never weakens the check.
 */
const SERVER_OWNED_FIELDS = ['quoteId', 'productVersion', 'governanceLineage', 'productSnapshot'] as const

export function ratingFingerprint(payload: unknown): string {
  const risk = normalizeQuotePayload(payload)
  for (const key of [...NON_RATING_FIELDS, ...SERVER_OWNED_FIELDS]) delete risk[key]
  return createHash('sha256').update(canonicalProposal(risk)).digest('hex')
}

/** The fingerprint stored with a rating, if any (ratings before WP-0008 have none). */
export function storedRatingFingerprint(underwriting: unknown): string | null {
  const value = underwriting && typeof underwriting === 'object'
    ? (underwriting as Record<string, unknown>).ratedFingerprint
    : null
  return typeof value === 'string' && value ? value : null
}
