type JsonRecord = Record<string, any>

export function isCancelTransactionType(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'cancel' || normalized === 'cancelled' || normalized === 'cancellation'
}

export function isReinstateTransactionType(value: unknown): boolean {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'reinstate' || normalized === 'reinstated' || normalized === 'reinstatement'
}

// Reads the *local* calendar date of a value (not a UTC-shifted one), so a
// version's term dates can be matched against the policy term as entered.
function toLocalDateOnlyKey(value: unknown): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  // Date columns arrive as UTC midnight ("2026-09-18T00:00:00.000Z"). Their
  // calendar date is the leading YYYY-MM-DD; converting to local time would
  // move it to the previous day west of UTC and no version would match the term.
  const isoDate = /^(\d{4}-\d{2}-\d{2})(?:$|T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?$)/.exec(trimmed)
  if (isoDate) return isoDate[1]
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  const year = String(parsed.getFullYear())
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function processedOrder(left: JsonRecord, right: JsonRecord): number {
  const time = (version: JsonRecord, key: 'processed' | 'effective') => {
    const raw = key === 'processed'
      ? version?.processedDate || version?.updatedDate || version?.createdDate
      : version?.effectiveDate
    const parsed = Date.parse(String(raw || ''))
    return Number.isFinite(parsed) ? parsed : 0
  }
  const byProcessed = time(left, 'processed') - time(right, 'processed')
  if (byProcessed !== 0) return byProcessed
  const byEffective = time(left, 'effective') - time(right, 'effective')
  if (byEffective !== 0) return byEffective
  return String(left?.transactionNumber || '').localeCompare(String(right?.transactionNumber || ''))
}

/**
 * Premium of the policy's current term ("Premium this term" in the header).
 *
 * Each version's `premium.total` is that transaction's premium: the full term
 * premium for new business, renewal and rewrite, and a delta for endorsements,
 * cancellations and reinstatements. The term premium is therefore the sum of
 * the versions whose term dates (`policyEffectiveDate` / `expirationDate`)
 * match the policy's current `term`. Versions from earlier terms are excluded;
 * if no version belongs to the current term the result is null (callers show
 * "Not rated") rather than a sum across all terms.
 *
 * A reinstatement that nets to ~0 after a cancellation adds back the cancelled
 * amount, so cancel + reinstate restores the term premium.
 */
export function computeCurrentTermPremium(
  versions: JsonRecord[],
  term: JsonRecord | null | undefined,
): { amount: number; currency: string } | null {
  if (!Array.isArray(versions) || versions.length === 0) return null

  const termEffective = toLocalDateOnlyKey(term?.effectiveDate)
  const termExpiration = toLocalDateOnlyKey(term?.expirationDate)

  const inCurrentTerm = versions.filter((version) => {
    const versionEffective = toLocalDateOnlyKey(version?.policyEffectiveDate)
    const versionExpiration = toLocalDateOnlyKey(version?.expirationDate)
    return !(
      (termEffective && versionEffective && versionEffective !== termEffective) ||
      (termExpiration && versionExpiration && versionExpiration !== termExpiration)
    )
  })
  if (inCurrentTerm.length === 0) return null

  let cumulative = 0
  let sawAnyAmount = false
  let currency = 'USD'
  let pendingCancelMagnitude = 0

  for (const version of [...inCurrentTerm].sort(processedOrder)) {
    const total = version?.premium?.total
    const amount = typeof total?.amount === 'number' ? total.amount : Number(total?.amount)
    if (total?.amount === null || total?.amount === undefined || !Number.isFinite(amount)) continue

    let delta = amount
    if (isCancelTransactionType(version?.transactionType) && amount < 0) {
      pendingCancelMagnitude = Math.abs(amount)
    } else if (isReinstateTransactionType(version?.transactionType)) {
      if (Math.abs(amount) < 0.01 && pendingCancelMagnitude > 0) delta = pendingCancelMagnitude
      pendingCancelMagnitude = 0
    }

    sawAnyAmount = true
    cumulative += delta
    if (typeof total?.currency === 'string' && total.currency.trim()) currency = total.currency.trim()
  }

  return sawAnyAmount ? { amount: cumulative, currency } : null
}
