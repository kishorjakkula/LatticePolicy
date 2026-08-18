import crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'

type IdempotencyStatus = 'processing' | 'completed' | 'failed'

type IdempotencyRecord = {
  requestHash: string
  status: IdempotencyStatus
  statusCode: number | null
  responseBody: unknown
}

type Reservation =
  | { outcome: 'owned' }
  | { outcome: 'conflict' }
  | { outcome: 'processing' }
  | { outcome: 'replay'; record: IdempotencyRecord }

const memoryRecords = new Map<string, IdempotencyRecord>()

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function responseTraceId(req: Request, res: Response): string {
  return String(res.getHeader('x-request-id') || (req as any).id || '')
}

function requestHash(req: Request): string {
  const input = stableStringify({
    method: req.method,
    path: req.originalUrl || req.url,
    body: req.body ?? null,
  })
  return crypto.createHash('sha256').update(input).digest('hex')
}

function memoryKey(tenantId: string, key: string): string {
  return `${tenantId}:${key}`
}

// Reservation for the in-memory fallback store is intentionally synchronous
// (no `await` between the read and the write) so that Node's single-threaded
// event loop cannot interleave two concurrent requests between the check and
// the reservation. This gives the memory path the same "only one caller wins"
// guarantee that `INSERT ... ON CONFLICT DO NOTHING` gives the database path.
function reserveMemory(tenantId: string, key: string, hash: string): Reservation {
  const mapKey = memoryKey(tenantId, key)
  const existing = memoryRecords.get(mapKey)

  if (!existing) {
    memoryRecords.set(mapKey, {
      requestHash: hash,
      status: 'processing',
      statusCode: null,
      responseBody: null,
    })
    return { outcome: 'owned' }
  }

  if (existing.requestHash !== hash) return { outcome: 'conflict' }
  if (existing.status === 'completed') return { outcome: 'replay', record: existing }
  if (existing.status === 'processing') return { outcome: 'processing' }

  // status === 'failed': the prior attempt did not complete successfully, so
  // a matching retry reclaims the reservation and re-executes the handler.
  existing.status = 'processing'
  existing.statusCode = null
  existing.responseBody = null
  return { outcome: 'owned' }
}

function finalizeMemory(
  tenantId: string,
  key: string,
  status: IdempotencyStatus,
  statusCode: number | null,
  responseBody: unknown
): void {
  const rec = memoryRecords.get(memoryKey(tenantId, key))
  if (!rec) return
  rec.status = status
  rec.statusCode = statusCode
  rec.responseBody = responseBody
}

// Reservation for the database-backed store relies on two Postgres
// guarantees inside a single tenant-scoped transaction:
// 1. `INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING` is atomic across
//    concurrent transactions, so only one concurrent request can create the
//    row and become the owner.
// 2. `SELECT ... FOR UPDATE` on the losing path row-locks the existing
//    record so a "failed" reclaim (or a read racing a finalize write) cannot
//    itself be duplicated by two concurrent losers.
async function reserveDb(tenantId: string, key: string, hash: string, req: Request): Promise<Reservation> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)

    const inserted = await q(
      `INSERT INTO idempotency_keys
        (tenant_id, key, method, path, request_hash, status)
       VALUES ($1, $2, $3, $4, $5, 'processing')
       ON CONFLICT (tenant_id, key) DO NOTHING
       RETURNING idempotency_key_id`,
      [tenantId, key, req.method, req.originalUrl || req.url, hash]
    )
    if (inserted.rowCount) return { outcome: 'owned' as const }

    const locked = await q(
      `SELECT status, request_hash, status_code, response_body
         FROM idempotency_keys
        WHERE tenant_id = $1 AND key = $2
        FOR UPDATE`,
      [tenantId, key]
    )
    const row = locked.rows[0]
    if (!row) return { outcome: 'owned' as const }

    if (row.request_hash !== hash) return { outcome: 'conflict' as const }
    if (row.status === 'completed') {
      return {
        outcome: 'replay' as const,
        record: {
          requestHash: row.request_hash,
          status: 'completed',
          statusCode: Number(row.status_code),
          responseBody: row.response_body,
        },
      }
    }
    if (row.status === 'processing') return { outcome: 'processing' as const }

    // status === 'failed': reclaim under the row lock so only one concurrent
    // retry can take ownership.
    await q(
      `UPDATE idempotency_keys
          SET status = 'processing', status_code = NULL, response_body = NULL, updated_at = now()
        WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key]
    )
    return { outcome: 'owned' as const }
  })
}

async function finalizeDb(
  tenantId: string,
  key: string,
  status: IdempotencyStatus,
  statusCode: number | null,
  responseBody: unknown
): Promise<void> {
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await q(
      `UPDATE idempotency_keys
          SET status = $3, status_code = $4, response_body = $5::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key, status, statusCode, JSON.stringify(responseBody ?? null)]
    )
  })
}

async function reserve(tenantId: string, key: string, hash: string, req: Request): Promise<Reservation> {
  if (!getDb()) return reserveMemory(tenantId, key, hash)
  return reserveDb(tenantId, key, hash, req)
}

async function finalize(
  tenantId: string,
  key: string,
  status: IdempotencyStatus,
  statusCode: number | null,
  responseBody: unknown
): Promise<void> {
  if (!getDb()) return finalizeMemory(tenantId, key, status, statusCode, responseBody)
  return finalizeDb(tenantId, key, status, statusCode, responseBody)
}

export function resetIdempotencyStoreForTests(): void {
  memoryRecords.clear()
}

export async function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const method = req.method.toUpperCase()
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next()

  const key = String(req.header('Idempotency-Key') || '').trim()
  if (!key) return next()

  const tenantId = req.tenant?.tenantId
  if (!tenantId) return next()

  try {
    const hash = requestHash(req)
    const reservation = await reserve(tenantId, key, hash, req)

    if (reservation.outcome === 'conflict') {
      return res.status(409).json({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: 'Idempotency-Key was already used with a different request',
        traceId: responseTraceId(req, res),
      })
    }

    if (reservation.outcome === 'replay') {
      return res.status(reservation.record.statusCode ?? 200).json(reservation.record.responseBody)
    }

    if (reservation.outcome === 'processing') {
      res.setHeader('Retry-After', '1')
      return res.status(409).json({
        code: 'IDEMPOTENCY_KEY_PROCESSING',
        message:
          'A request with this Idempotency-Key is still processing. Retry after it completes instead of sending a new request.',
        traceId: responseTraceId(req, res),
      })
    }

    // reservation.outcome === 'owned': this caller executes the protected
    // operation and is responsible for finalizing the reservation exactly
    // once, either as completed (2xx) or failed (anything else, including
    // aborted connections).
    let finalized = false
    const originalJson = res.json.bind(res)
    res.json = ((body?: unknown) => {
      const statusCode = res.statusCode || 200
      const status: IdempotencyStatus = statusCode >= 200 && statusCode < 300 ? 'completed' : 'failed'
      finalized = true
      finalize(tenantId, key, status, statusCode, status === 'completed' ? body : null)
        .then(() => originalJson(body))
        .catch(next)
      return res
    }) as Response['json']

    const markFailedIfUnfinished = () => {
      if (finalized) return
      finalized = true
      finalize(tenantId, key, 'failed', res.statusCode || 500, null).catch(() => {})
    }
    res.on('finish', markFailedIfUnfinished)
    res.on('close', markFailedIfUnfinished)

    return next()
  } catch (err) {
    return next(err)
  }
}
