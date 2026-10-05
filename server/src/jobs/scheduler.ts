import type { Pool } from 'pg'
import { logger } from '../logger.js'

interface DueScheduleRow {
  schedule_id: string
  tenant_id: string
  job_code: string
  request_payload: unknown
  next_run_at: Date | string
  schedule_expression: string | null
  default_schedule: string | null
  default_max_attempts: number
}

export interface SchedulerTickResult {
  schedulesClaimed: number
  runsCreated: number
  invalidSchedules: number
}

const INTERVAL_PATTERN = /^interval:(\d+)(s|m|h|d)$/i
const UNIT_MILLISECONDS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
}

export function calculateNextRunAt(expression: string, scheduledAt: Date, now = new Date()): Date {
  const match = INTERVAL_PATTERN.exec(expression.trim())
  if (!match) {
    throw new Error(`Unsupported schedule expression: ${expression}`)
  }

  const amount = Number.parseInt(match[1], 10)
  const intervalMs = amount * UNIT_MILLISECONDS[match[2].toLowerCase()]
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid schedule interval: ${expression}`)
  }

  const scheduledMs = scheduledAt.getTime()
  const nowMs = now.getTime()
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(nowMs)) {
    throw new Error('Schedule timestamps must be valid dates')
  }

  const elapsedIntervals = Math.max(1, Math.floor((nowMs - scheduledMs) / intervalMs) + 1)
  return new Date(scheduledMs + elapsedIntervals * intervalMs)
}

/**
 * Turns due tenant schedules into queued runs. Schedule row locks, run
 * creation, and cadence advancement share one transaction so concurrent
 * worker processes cannot fire the same occurrence twice.
 */
export async function runSchedulerTick(
  pool: Pool,
  limit: number,
  now = new Date()
): Promise<SchedulerTickResult> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const due = await client.query<DueScheduleRow>(
      `SELECT schedules.schedule_id,
              schedules.tenant_id,
              schedules.job_code,
              schedules.request_payload,
              schedules.next_run_at,
              schedules.schedule_expression,
              definitions.default_schedule,
              definitions.default_max_attempts
       FROM job_schedules schedules
       JOIN job_definitions definitions ON definitions.job_code = schedules.job_code
       WHERE schedules.enabled = true
         AND definitions.enabled = true
         AND schedules.next_run_at IS NOT NULL
         AND schedules.next_run_at <= $1
       ORDER BY schedules.next_run_at ASC, schedules.created_at ASC
       LIMIT $2
       FOR UPDATE OF schedules SKIP LOCKED`,
      [now, limit]
    )

    let runsCreated = 0
    let invalidSchedules = 0
    for (const schedule of due.rows) {
      const expression = schedule.schedule_expression || schedule.default_schedule || ''
      const scheduledAt = new Date(schedule.next_run_at)
      let nextRunAt: Date
      try {
        nextRunAt = calculateNextRunAt(expression, scheduledAt, now)
      } catch (err) {
        invalidSchedules += 1
        await client.query(
          `UPDATE job_schedules
           SET enabled = false,
               updated_at = now()
           WHERE schedule_id = $1`,
          [schedule.schedule_id]
        )
        logger.warn(
          { scheduleId: schedule.schedule_id, jobCode: schedule.job_code, expression, err: asErrorMessage(err) },
          '[jobs] Invalid schedule expression; schedule disabled'
        )
        continue
      }

      const idempotencyKey = `schedule:${schedule.schedule_id}:${scheduledAt.toISOString()}`
      const inserted = await client.query(
        `INSERT INTO job_runs
           (tenant_id, job_code, schedule_id, idempotency_key, request_payload, max_attempts)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING run_id`,
        [
          schedule.tenant_id,
          schedule.job_code,
          schedule.schedule_id,
          idempotencyKey,
          JSON.stringify(schedule.request_payload ?? {}),
          schedule.default_max_attempts,
        ]
      )

      runsCreated += inserted.rowCount ?? 0
      await client.query(
        `UPDATE job_schedules
         SET last_run_at = $2,
             next_run_at = $3,
             updated_at = now()
         WHERE schedule_id = $1`,
        [schedule.schedule_id, scheduledAt, nextRunAt]
      )
    }

    await client.query('COMMIT')
    return { schedulesClaimed: due.rows.length, runsCreated, invalidSchedules }
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

function asErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
