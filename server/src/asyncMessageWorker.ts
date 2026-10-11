import type { Pool } from 'pg'
import { and, eq, sql } from 'drizzle-orm'
import { createDrizzleDb, getDb } from './db.js'
import { getPinnedTenantId } from './config.js'
import { buildEventEnvelope } from './events/envelope.js'
import { createEventTransport, getEventTransportName, type EventTransport } from './events/transport.js'
import { createWebhookTransport } from './events/transports/webhook.js'
import { asyncMessageOutbox } from './schema.js'
import { logger } from './logger.js'

type AsyncOutboxStatus = 'Pending' | 'Processing' | 'Retry' | 'Sent' | 'Failed'

export interface AsyncOutboxRow {
  message_id: string
  tenant_id: string
  topic: string
  payload: unknown
  attempts: number
  max_attempts: number
  created_at: string
}

export interface AsyncPushConfig {
  enabled: boolean
  webhookUrl: string
  authHeader: string
  pollMs: number
  batchSize: number
  requestTimeoutMs: number
  baseBackoffSeconds: number
  maxBackoffSeconds: number
}

const PENDING_STATUSES: AsyncOutboxStatus[] = ['Pending', 'Retry']
const DEFAULT_POLL_MS = 1500
const DEFAULT_BATCH_SIZE = 25
const DEFAULT_TIMEOUT_MS = 5000
const DEFAULT_BASE_BACKOFF_SECONDS = 10
const DEFAULT_MAX_BACKOFF_SECONDS = 600

export type StopAsyncMessageWorker = () => void

/** `force` starts the loop regardless of ASYNC_PUSH_ENABLED; a dedicated dispatcher process uses it. */
export function startAsyncMessageWorker(options: { force?: boolean } = {}): StopAsyncMessageWorker {
  const db = getDb()
  if (!db) {
    logger.info('[async-push] Worker disabled: database not initialized')
    return () => {}
  }

  const config = loadConfig()
  if (!config.enabled && !options.force) {
    logger.info('[async-push] Worker disabled by ASYNC_PUSH_ENABLED')
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
      const batch = await claimOutboxRows(db, config.batchSize, getPinnedTenantId() ?? undefined)
      if (batch.length === 0) {
        schedule(config.pollMs)
        return
      }

      for (const row of batch) {
        await dispatchOutboxRow(db, row, config)
      }
      schedule(25)
    } catch (err) {
      logger.error({ err: asErrorMessage(err) }, '[async-push] Worker iteration failed')
      schedule(config.pollMs)
    } finally {
      running = false
    }
  }

  schedule(10)
  logger.info(
    { pollMs: config.pollMs, batchSize: config.batchSize, webhook: config.webhookUrl || 'stdout' },
    '[async-push] Worker started'
  )

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    void closeEventTransport()
    logger.info('[async-push] Worker stopped')
  }
}

/** Exported so server/src/jobs/handlers/asyncOutboxDeliveryRetry.ts can reuse the same delivery config. */
export function loadConfig(): AsyncPushConfig {
  return {
    enabled: parseBoolean(process.env.ASYNC_PUSH_ENABLED, true),
    webhookUrl: (process.env.ASYNC_PUSH_WEBHOOK_URL || '').trim(),
    authHeader: (process.env.ASYNC_PUSH_AUTH_HEADER || '').trim(),
    pollMs: parsePositiveInt(process.env.ASYNC_PUSH_POLL_MS, DEFAULT_POLL_MS),
    batchSize: parsePositiveInt(process.env.ASYNC_PUSH_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    requestTimeoutMs: parsePositiveInt(process.env.ASYNC_PUSH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    baseBackoffSeconds: parsePositiveInt(process.env.ASYNC_PUSH_BASE_BACKOFF_SECONDS, DEFAULT_BASE_BACKOFF_SECONDS),
    maxBackoffSeconds: parsePositiveInt(process.env.ASYNC_PUSH_MAX_BACKOFF_SECONDS, DEFAULT_MAX_BACKOFF_SECONDS)
  }
}

/** Exported so server/src/jobs/handlers/asyncOutboxDeliveryRetry.ts can reuse the same claim query. */
/**
 * How long a claimed message may stay in Processing before another claim
 * takes it over. A dispatcher that dies mid-batch leaves its messages in
 * Processing; without this they would never be delivered. It must be longer
 * than a batch can take, or a slow batch is delivered twice.
 */
export function claimLeaseSeconds(): number {
  return parsePositiveInt(process.env.ASYNC_PUSH_CLAIM_LEASE_SECONDS, 300)
}

export async function claimOutboxRows(pool: Pool, limit: number, tenantId?: string, leaseSeconds = claimLeaseSeconds()): Promise<AsyncOutboxRow[]> {
  // This query uses FOR UPDATE SKIP LOCKED with a CTE, which requires raw SQL.
  // We keep it as a raw query via a dedicated client transaction.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const params: any[] = [PENDING_STATUSES, limit, leaseSeconds]
    const tenantFilter = tenantId ? 'AND tenant_id = $4' : ''
    if (tenantId) params.push(tenantId)
    const result = await client.query<AsyncOutboxRow>(
      `
        WITH candidate AS (
          SELECT message_id
          FROM async_message_outbox
          WHERE (
              (status = ANY($1::text[]) AND next_attempt_at <= now())
              -- Abandoned by a dispatcher that stopped before finishing it.
              OR (status = 'Processing' AND last_attempt_at < now() - make_interval(secs => $3))
            )
            AND attempts < max_attempts
            ${tenantFilter}
          ORDER BY next_attempt_at ASC, created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE async_message_outbox outbox
        SET status = 'Processing',
            last_attempt_at = now(),
            updated_at = now()
        FROM candidate
        WHERE outbox.message_id = candidate.message_id
        RETURNING outbox.message_id, outbox.tenant_id, outbox.topic, outbox.payload, outbox.attempts, outbox.max_attempts, outbox.created_at
      `,
      params
    )
    await client.query('COMMIT')
    return result.rows
  } catch (err) {
    try { await client.query('ROLLBACK') } catch {}
    throw err
  } finally {
    client.release()
  }
}

/**
 * Exported so server/src/jobs/handlers/asyncOutboxDeliveryRetry.ts can reuse
 * the same dispatch behavior. Returns true when the row was sent
 * successfully, false when it was scheduled for retry or marked Failed.
 * Never throws for delivery failures; only a DB error propagates.
 */
export async function dispatchOutboxRow(pool: Pool, row: AsyncOutboxRow, config: AsyncPushConfig): Promise<boolean> {
  const db = createDrizzleDb(pool)
  const nextAttempts = row.attempts + 1
  try {
    await pushMessage(row, config, nextAttempts)
    await db
      .update(asyncMessageOutbox)
      .set({
        status: 'Sent',
        attempts: nextAttempts,
        sentAt: new Date(),
        lastError: null,
        nextAttemptAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(
        eq(asyncMessageOutbox.messageId, row.message_id as any),
        eq(asyncMessageOutbox.tenantId, row.tenant_id)
      ))
    return true
  } catch (err) {
    const exhausted = nextAttempts >= row.max_attempts
    const delaySeconds = exhausted
      ? 0
      : calculateBackoffSeconds(nextAttempts, config.baseBackoffSeconds, config.maxBackoffSeconds)
    const errorText = asErrorMessage(err).slice(0, 3000)
    const nextStatus = exhausted ? 'Failed' : 'Retry'
    await db
      .update(asyncMessageOutbox)
      .set({
        status: nextStatus,
        attempts: nextAttempts,
        lastError: errorText,
        nextAttemptAt: exhausted
          ? new Date()
          : sql`now() + make_interval(secs => ${delaySeconds})`,
        updatedAt: new Date()
      })
      .where(and(
        eq(asyncMessageOutbox.messageId, row.message_id as any),
        eq(asyncMessageOutbox.tenantId, row.tenant_id)
      ))

    if (exhausted) {
      logger.error({ messageId: row.message_id, attempts: nextAttempts, err: errorText }, '[async-push] Message failed permanently')
    } else {
      logger.warn({ messageId: row.message_id, attempts: nextAttempts, retryInSeconds: delaySeconds, err: errorText }, '[async-push] Message retry scheduled')
    }
    return false
  }
}

let brokerTransport: EventTransport | null = null

/**
 * The transport messages go out on. The webhook transport is built from the
 * dispatcher's own settings; a broker transport holds a connection, so there
 * is one per process.
 */
function transportFor(config: AsyncPushConfig): EventTransport {
  if (getEventTransportName() === 'webhook') {
    return createWebhookTransport({ webhookUrl: config.webhookUrl, authHeader: config.authHeader, requestTimeoutMs: config.requestTimeoutMs })
  }
  if (!brokerTransport) brokerTransport = createEventTransport()
  return brokerTransport
}

/** Releases the broker connection, if one was opened. */
export async function closeEventTransport(): Promise<void> {
  const transport = brokerTransport
  brokerTransport = null
  if (transport) await transport.close()
}

async function pushMessage(row: AsyncOutboxRow, config: AsyncPushConfig, attemptNumber: number): Promise<void> {
  await transportFor(config).publish(buildEventEnvelope(row, attemptNumber))
}

function calculateBackoffSeconds(attempt: number, baseSeconds: number, maxSeconds: number): number {
  const exponent = Math.max(attempt - 1, 0)
  const value = Math.round(baseSeconds * Math.pow(2, exponent))
  return Math.min(value, maxSeconds)
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
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
