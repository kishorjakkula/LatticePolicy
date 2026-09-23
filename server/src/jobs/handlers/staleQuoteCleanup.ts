import { withTenantTx, toRawQuery } from '../../db.js'
import type { JobHandler } from '../registry.js'

export const DEFAULT_STALE_QUOTE_DAYS = 90

export interface StaleQuoteCleanupPayload {
  staleAfterDays?: number
  dryRun?: boolean
}

export function computeStaleQuoteCutoff(staleAfterDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - staleAfterDays * 24 * 60 * 60 * 1000)
}

export const staleQuoteCleanupHandler: JobHandler = async ({ run, requestPayload, checkpoint }) => {
  const payload = requestPayload as StaleQuoteCleanupPayload
  const staleAfterDays = payload?.staleAfterDays ?? DEFAULT_STALE_QUOTE_DAYS
  const dryRun = payload?.dryRun ?? false
  const cutoff = computeStaleQuoteCutoff(staleAfterDays)

  const quoteIds = await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    const params = [run.tenant_id, cutoff.toISOString()]
    const result = dryRun
      ? await q(
          `SELECT quote_id
             FROM quotes
            WHERE tenant_id = $1
              AND status IN ('Draft', 'Rated')
              AND COALESCE(updated_at, created_at) < $2::timestamptz
            ORDER BY quote_id`,
          params
        )
      : await q(
          `UPDATE quotes
              SET status = 'Expired',
                  updated_at = now(),
                  updated_by = 'stale_quote_cleanup',
                  status_history = COALESCE(status_history, '[]'::jsonb) || jsonb_build_array(
                    jsonb_build_object('value', 'Expired', 'updatedAt', now(), 'updatedBy', 'stale_quote_cleanup')
                  )
            WHERE tenant_id = $1
              AND status IN ('Draft', 'Rated')
              AND COALESCE(updated_at, created_at) < $2::timestamptz
          RETURNING quote_id`,
          params
        )
    return result.rows.map((row: { quote_id: string }) => row.quote_id)
  })

  await checkpoint({ staleAfterDays, dryRun, candidateCount: quoteIds.length, quoteIds })
  return { resultPayload: { staleAfterDays, dryRun, candidateCount: quoteIds.length, expiredCount: dryRun ? 0 : quoteIds.length } }
}
