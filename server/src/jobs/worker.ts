import os from 'node:os'
import type { Pool } from 'pg'
import { getDb } from '../db.js'
import { logger } from '../logger.js'
import { getJobDefinition } from './registry.js'
import { claimDueRuns, checkpointRun, completeRun, retryOrDeadLetterRun, type JobRunRow } from './jobQueue.js'

interface JobWorkerConfig {
  enabled: boolean
  pollMs: number
  batchSize: number
  lockSeconds: number
  workerId: string
}

export type StopJobWorker = () => void

export function startJobWorker(): StopJobWorker {
  const db = getDb()
  if (!db) {
    logger.info('[jobs] Worker disabled: database not initialized')
    return () => {}
  }

  const config = loadConfig()
  if (!config.enabled) {
    logger.info('[jobs] Worker disabled by JOB_WORKER_ENABLED')
    return () => {}
  }

  let stopped = false
  let running = false
  let timer: NodeJS.Timeout | null = null

  const schedule = (delayMs: number) => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(runLoop, delayMs)
  }

  const runLoop = async () => {
    if (stopped || running) return
    running = true
    try {
      const batch = await claimDueRuns(db, config.batchSize, config.workerId, config.lockSeconds)
      if (batch.length === 0) {
        schedule(config.pollMs)
        return
      }
      for (const run of batch) {
        await executeRun(db, run)
      }
      schedule(25)
    } catch (err) {
      logger.error({ err: asErrorMessage(err) }, '[jobs] Worker iteration failed')
      schedule(config.pollMs)
    } finally {
      running = false
    }
  }

  schedule(10)
  logger.info({ pollMs: config.pollMs, batchSize: config.batchSize, workerId: config.workerId }, '[jobs] Worker started')

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    logger.info('[jobs] Worker stopped')
  }
}

async function executeRun(pool: Pool, run: JobRunRow): Promise<void> {
  const def = getJobDefinition(run.job_code)
  if (!def) {
    // Unknown job code: nothing can ever succeed here, so dead-letter
    // immediately instead of burning retry attempts.
    await retryOrDeadLetterRun({ ...run, attempts: run.max_attempts }, new Error(`No handler registered for job code ${run.job_code}`), {
      baseSeconds: 1,
      maxSeconds: 1,
    })
    return
  }

  try {
    const result = await def.handler({
      run,
      requestPayload: run.request_payload,
      checkpoint: (data) => checkpointRun(run, data),
    })
    await completeRun(run, result.resultPayload ?? {})
  } catch (err) {
    await retryOrDeadLetterRun(run, err, def.backoff)
  }
}

function loadConfig(): JobWorkerConfig {
  return {
    enabled: parseBoolean(process.env.JOB_WORKER_ENABLED, false),
    pollMs: parsePositiveInt(process.env.JOB_WORKER_POLL_MS, 1500),
    batchSize: parsePositiveInt(process.env.JOB_WORKER_BATCH_SIZE, 10),
    lockSeconds: parsePositiveInt(process.env.JOB_WORKER_LOCK_SECONDS, 60),
    workerId: (process.env.JOB_WORKER_ID || '').trim() || `${os.hostname()}:${process.pid}`,
  }
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
