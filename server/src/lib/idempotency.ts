import crypto from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'

type IdempotencyRecord = {
  requestHash: string
  statusCode: number
  responseBody: unknown
}

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

async function findRecord(
  tenantId: string,
  key: string
): Promise<IdempotencyRecord | null> {
  if (!getDb()) return memoryRecords.get(memoryKey(tenantId, key)) || null

  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const res = await q(
      `SELECT request_hash, status_code, response_body
         FROM idempotency_keys
        WHERE tenant_id = $1 AND key = $2`,
      [tenantId, key]
    )
    if (!res.rowCount) return null
    const row = res.rows[0]
    return {
      requestHash: row.request_hash,
      statusCode: Number(row.status_code),
      responseBody: row.response_body,
    }
  })
}

async function saveRecord(
  tenantId: string,
  key: string,
  hash: string,
  req: Request,
  statusCode: number,
  responseBody: unknown
): Promise<void> {
  if (!getDb()) {
    memoryRecords.set(memoryKey(tenantId, key), { requestHash: hash, statusCode, responseBody })
    return
  }

  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    await q(
      `INSERT INTO idempotency_keys
        (tenant_id, key, method, path, request_hash, status_code, response_body)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      [
        tenantId,
        key,
        req.method,
        req.originalUrl || req.url,
        hash,
        statusCode,
        JSON.stringify(responseBody ?? null),
      ]
    )
  })
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
    const existing = await findRecord(tenantId, key)
    if (existing) {
      if (existing.requestHash !== hash) {
        return res.status(409).json({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: 'Idempotency-Key was already used with a different request',
          traceId: responseTraceId(req, res),
        })
      }
      return res.status(existing.statusCode).json(existing.responseBody)
    }

    const originalJson = res.json.bind(res)
    res.json = ((body?: unknown) => {
      const statusCode = res.statusCode || 200
      if (statusCode >= 200 && statusCode < 300) {
        saveRecord(tenantId, key, hash, req, statusCode, body)
          .then(() => originalJson(body))
          .catch(next)
        return res
      }
      return originalJson(body)
    }) as Response['json']

    return next()
  } catch (err) {
    return next(err)
  }
}
