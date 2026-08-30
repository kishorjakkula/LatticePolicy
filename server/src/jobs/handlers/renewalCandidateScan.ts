import { withTenantTx, toRawQuery } from '../../db.js'
import { loadPolicyContext } from '../../persistence.js'
import { createPolicyNotificationIntent } from '../../services/notification.service.js'
import type { JobHandler } from '../registry.js'

export const DEFAULT_RENEWAL_WINDOW_DAYS = 45

export interface RenewalScanPayload {
  windowDays?: number
}

interface RenewalCandidateRow {
  policy_id: string
  policy_number: string | null
  product_code: string
  term_expiration_date: string
}

/**
 * Pure date-window computation, kept separate from the SQL query so it can
 * be unit tested without a database. `to` is inclusive: a policy expiring
 * exactly `windowDays` from `now` is still a candidate.
 */
export function computeRenewalWindowBounds(windowDays: number, now: Date = new Date()): { from: string; to: string } {
  const from = now.toISOString().slice(0, 10)
  const toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  toDate.setUTCDate(toDate.getUTCDate() + windowDays)
  const to = toDate.toISOString().slice(0, 10)
  return { from, to }
}

/**
 * Renewal candidate scan: finds a tenant's in-force policies whose term
 * expires within the configured window and creates a renewal-reminder
 * notification intent for each one. Does not bind or execute a renewal —
 * this job only identifies candidates and notifies; an underwriter/agent
 * still drives the actual renewal transaction.
 *
 * Exclusions are enforced in SQL, not just the date window:
 * - `status = 'Issued'` excludes cancelled/reinstated-then-cancelled policies.
 * - `non_renewed_at IS NULL` excludes policies already marked non-renewal.
 * - `NOT EXISTS (... type = 'RENEW' ...)` excludes already-renewed policies.
 *   This check is used instead of trusting `term_expiration_date` alone,
 *   because renewPolicy() does not update the policies.term_expiration_date
 *   column when it renews a policy (see docs/tasks for this issue) — relying
 *   solely on the stored expiration date would keep flagging an already
 *   renewed policy indefinitely.
 */
export const renewalCandidateScanHandler: JobHandler = async ({ run, requestPayload, checkpoint }) => {
  const windowDays = Number((requestPayload as RenewalScanPayload)?.windowDays) || DEFAULT_RENEWAL_WINDOW_DAYS
  const { from, to } = computeRenewalWindowBounds(windowDays)

  const candidates = await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    const res = await q(
      `SELECT policy_id, policy_number, product_code, term_expiration_date
         FROM policies
        WHERE tenant_id = $1
          AND status = 'Issued'
          AND non_renewed_at IS NULL
          AND term_expiration_date >= $2::date
          AND term_expiration_date <= $3::date
          AND NOT EXISTS (
            SELECT 1 FROM policy_transactions pt
             WHERE pt.tenant_id = $1 AND pt.policy_id = policies.policy_id AND pt.type = 'RENEW'
          )
        ORDER BY term_expiration_date ASC`,
      [run.tenant_id, from, to]
    )
    return res.rows as RenewalCandidateRow[]
  })

  let notified = 0
  let suppressed = 0
  const candidateIds: string[] = []

  for (const candidate of candidates) {
    candidateIds.push(candidate.policy_id)
    await withTenantTx(run.tenant_id, async (db) => {
      const ctx = await loadPolicyContext(db, run.tenant_id, candidate.policy_id)
      if (!ctx) return
      const intent = await createPolicyNotificationIntent(db, {
        tenantId: run.tenant_id,
        policyId: candidate.policy_id,
        policyNumber: candidate.policy_number,
        productCode: candidate.product_code,
        transactionId: null,
        transactionType: 'RenewalReminder',
        eventType: 'POLICY_RENEWAL_REMINDER',
        effectiveDate: candidate.term_expiration_date,
        expirationDate: candidate.term_expiration_date,
        payload: ctx.latestPayload || null,
        correlationId: `renewal-reminder:${candidate.policy_id}`,
      })
      if (intent.status === 'Queued') notified += 1
      else suppressed += 1
    })
  }

  await checkpoint({ candidateCount: candidates.length, candidateIds })

  return {
    resultPayload: {
      windowDays,
      candidateCount: candidates.length,
      notified,
      suppressed,
    },
  }
}
