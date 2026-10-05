import type { Pool } from 'pg'
import { withTenantTx, toRawQuery } from '../db.js'
import { logger } from '../logger.js'

export type JobRunStatus = 'Queued' | 'Running' | 'Succeeded' | 'Retry' | 'DeadLettered' | 'Cancelled'

export interface JobRunRow {
  run_id: string
  tenant_id: string
  job_code: string
  schedule_id: string | null
  idempotency_key: string
  status: JobRunStatus
  attempts: number
  max_attempts: number
  checkpoint: unknown
  request_payload: unknown
  result_payload: unknown
  last_error: string | null
  locked_by: string | null
  locked_until: string | null
  next_attempt_at: string
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export interface EnqueueJobParams {
  tenantId: string
  jobCode: string
  idempotencyKey: string
  requestPayload?: unknown
  scheduleId?: string | null
  maxAttempts?: number
}

/**
 * Enqueues a job run. Idempotent on (tenant_id, idempotency_key): a repeat
 * enqueue with the same key returns the existing run instead of creating a
 * duplicate, whether that run is still queued, already ran, or lost the
 * insert race to a concurrent caller.
 */
export async function enqueueJob(params: EnqueueJobParams): Promise<{ run: JobRunRow; created: boolean }> {
  return withTenantTx(params.tenantId, async (db) => {
    const q = toRawQuery(db)
    const inserted = await q(
      `INSERT INTO job_runs (tenant_id, job_code, schedule_id, idempotency_key, request_payload, max_attempts)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        params.tenantId,
        params.jobCode,
        params.scheduleId ?? null,
        params.idempotencyKey,
        JSON.stringify(params.requestPayload ?? {}),
        params.maxAttempts ?? 5,
      ]
    )
    if (inserted.rows[0]) {
      return { run: inserted.rows[0] as JobRunRow, created: true }
    }
    const existing = await q(
      `SELECT * FROM job_runs WHERE tenant_id = $1 AND idempotency_key = $2`,
      [params.tenantId, params.idempotencyKey]
    )
    return { run: existing.rows[0] as JobRunRow, created: false }
  })
}

/**
 * Claims up to `limit` due runs across all tenants using FOR UPDATE SKIP
 * LOCKED, matching the existing async outbox worker's claim pattern
 * (server/src/asyncMessageWorker.ts). This step is necessarily cross-tenant
 * raw SQL: the worker does not know which tenant has due work until it
 * claims a row. Every subsequent read/write for a claimed run goes back
 * through withTenantTx using that row's own tenant_id, so tenant RLS is
 * honored for all tenant-scoped state changes.
 */
export async function claimDueRuns(
  pool: Pool,
  limit: number,
  workerId: string,
  lockSeconds: number
): Promise<JobRunRow[]> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<JobRunRow>(
      `
        WITH candidate AS (
          SELECT run_id
          FROM job_runs
          WHERE status IN ('Queued', 'Retry')
            AND next_attempt_at <= now()
            AND attempts < max_attempts
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE job_runs runs
        SET status = 'Running',
            attempts = runs.attempts + 1,
            locked_by = $2,
            locked_until = now() + make_interval(secs => $3),
            started_at = COALESCE(runs.started_at, now()),
            updated_at = now()
        FROM candidate
        WHERE runs.run_id = candidate.run_id
        RETURNING runs.*
      `,
      [limit, workerId, lockSeconds]
    )
    await client.query('COMMIT')
    return result.rows
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback failure, original error is what matters
    }
    throw err
  } finally {
    client.release()
  }
}

export async function recordRunEvent(
  tenantId: string,
  runId: string,
  eventType: string,
  message?: string,
  payload?: unknown
): Promise<void> {
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await q(
      `INSERT INTO job_run_events (tenant_id, run_id, event_type, message, payload) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, runId, eventType, message ?? null, JSON.stringify(payload ?? {})]
    )
  })
}

export async function checkpointRun(run: JobRunRow, checkpoint: unknown): Promise<void> {
  await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    await q(`UPDATE job_runs SET checkpoint = $2::jsonb, updated_at = now() WHERE run_id = $1`, [
      run.run_id,
      JSON.stringify(checkpoint ?? {}),
    ])
  })
  await recordRunEvent(run.tenant_id, run.run_id, 'checkpointed', undefined, checkpoint)
}

export async function completeRun(run: JobRunRow, resultPayload: unknown): Promise<void> {
  await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    await q(
      `UPDATE job_runs
       SET status = 'Succeeded',
           result_payload = $2::jsonb,
           finished_at = now(),
           locked_by = NULL,
           locked_until = NULL,
           updated_at = now()
       WHERE run_id = $1`,
      [run.run_id, JSON.stringify(resultPayload ?? {})]
    )
  })
  await recordRunEvent(run.tenant_id, run.run_id, 'completed', undefined, resultPayload)
}

export interface BackoffPolicy {
  baseSeconds: number
  maxSeconds: number
}

/**
 * Marks a failed run as Retry (with backoff) or DeadLettered once attempts
 * are exhausted. Mirrors the outbox worker's retry/dead-letter behavior.
 */
export async function retryOrDeadLetterRun(run: JobRunRow, error: unknown, backoff: BackoffPolicy): Promise<void> {
  const exhausted = run.attempts >= run.max_attempts
  const errorText = asErrorMessage(error).slice(0, 3000)
  const status: JobRunStatus = exhausted ? 'DeadLettered' : 'Retry'
  const delaySeconds = exhausted ? 0 : calculateBackoffSeconds(run.attempts, backoff.baseSeconds, backoff.maxSeconds)

  await withTenantTx(run.tenant_id, async (db) => {
    const q = toRawQuery(db)
    await q(
      `UPDATE job_runs
       SET status = $2,
           last_error = $3,
           locked_by = NULL,
           locked_until = NULL,
           next_attempt_at = now() + make_interval(secs => $4),
           finished_at = CASE WHEN $2 = 'DeadLettered' THEN now() ELSE finished_at END,
           updated_at = now()
       WHERE run_id = $1`,
      [run.run_id, status, errorText, delaySeconds]
    )
  })

  if (exhausted) {
    logger.error({ runId: run.run_id, jobCode: run.job_code, attempts: run.attempts, err: errorText }, '[jobs] Run dead-lettered')
  } else {
    logger.warn(
      { runId: run.run_id, jobCode: run.job_code, attempts: run.attempts, retryInSeconds: delaySeconds, err: errorText },
      '[jobs] Run retry scheduled'
    )
  }

  await recordRunEvent(run.tenant_id, run.run_id, exhausted ? 'dead_lettered' : 'retry_scheduled', errorText)
}

/**
 * Requeues a new run derived from a dead-lettered one. Does not mutate the
 * original run's history — per the job queue design, an old run must never
 * be rewritten to look successful.
 */
export async function retryDeadLetteredRun(run: JobRunRow, workerActorId: string | null): Promise<JobRunRow> {
  if (run.status !== 'DeadLettered') {
    throw new Error(`Run ${run.run_id} is not dead-lettered (status: ${run.status})`)
  }
  const retryKey = `${run.idempotency_key}:manual-retry:${Date.now()}`
  const { run: newRun } = await enqueueJob({
    tenantId: run.tenant_id,
    jobCode: run.job_code,
    idempotencyKey: retryKey,
    requestPayload: run.request_payload,
    scheduleId: run.schedule_id,
    maxAttempts: run.max_attempts,
  })
  await recordRunEvent(run.tenant_id, newRun.run_id, 'manual_retry_enqueued', workerActorId ?? undefined, {
    sourceRunId: run.run_id,
  })
  return newRun
}

export function calculateBackoffSeconds(attempt: number, baseSeconds: number, maxSeconds: number): number {
  const exponent = Math.max(attempt - 1, 0)
  const value = Math.round(baseSeconds * Math.pow(2, exponent))
  return Math.min(value, maxSeconds)
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
