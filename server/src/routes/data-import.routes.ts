import type { Request } from 'express'
import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { hasPermission } from '../auth.js'
import { routeParam, sanitizeText } from '../lib/utils.js'
import {
  SUPPORTED_ENTITY_TYPES,
  IMPORTABLE_ENTITY_TYPES_FRAMEWORK_ONLY,
  stageImportBatch,
  listImportBatches,
  getImportBatch,
  listImportRows,
  validateImportBatch,
  commitImportBatch,
  retryImportRow
} from '../services/data-import.service.js'

export const dataImportRoutes = Router()

function currentActorId(req: Request): string {
  return req.user?.id || 'system'
}

function canManage(req: Request): boolean {
  return hasPermission(req, 'admin.import.manage')
}

dataImportRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Data import requires database mode' })
  }
  next()
})

dataImportRoutes.get('/entity-types', (_req, res) => {
  res.json({
    supported: SUPPORTED_ENTITY_TYPES,
    frameworkOnly: IMPORTABLE_ENTITY_TYPES_FRAMEWORK_ONLY
  })
})

dataImportRoutes.get('/batches', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const rows = await withTenantTx(tenantId, async (db) => listImportBatches(toRawQuery(db), tenantId))
    res.json(rows)
  } catch (e: any) {
    res.status(500).json({ code: 'LIST_FAILED', message: String(e?.message || e) })
  }
})

dataImportRoutes.post('/batches', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ code: 'FORBIDDEN' })
  const tenantId = req.tenant!.tenantId
  const entityType = sanitizeText(req.body?.entityType)
  const sourceSystem = sanitizeText(req.body?.sourceSystem)
  const rows = req.body?.rows
  if (!entityType) return res.status(400).json({ code: 'ENTITY_TYPE_REQUIRED' })
  if (!(SUPPORTED_ENTITY_TYPES as readonly string[]).includes(entityType) &&
      !(IMPORTABLE_ENTITY_TYPES_FRAMEWORK_ONLY as readonly string[]).includes(entityType)) {
    return res.status(400).json({ code: 'UNSUPPORTED_ENTITY_TYPE' })
  }
  try {
    const batch = await withTenantTx(tenantId, async (db) =>
      stageImportBatch(toRawQuery(db), {
        tenantId,
        entityType,
        sourceSystem,
        rows,
        actor: currentActorId(req),
        notes: sanitizeText(req.body?.notes) || undefined
      })
    )
    res.status(201).json(batch)
  } catch (e: any) {
    const msg = String(e?.message || e)
    const known = ['SOURCE_SYSTEM_REQUIRED', 'ROWS_REQUIRED', 'BATCH_TOO_LARGE']
    res.status(known.includes(msg) ? 400 : 500).json({ code: known.includes(msg) ? msg : 'STAGE_FAILED', message: msg })
  }
})

dataImportRoutes.get('/batches/:batchId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.batchId)
  try {
    const batch = await withTenantTx(tenantId, async (db) => getImportBatch(toRawQuery(db), tenantId, batchId))
    if (!batch) return res.status(404).json({ code: 'NOT_FOUND' })
    res.json(batch)
  } catch (e: any) {
    res.status(500).json({ code: 'GET_FAILED', message: String(e?.message || e) })
  }
})

dataImportRoutes.get('/batches/:batchId/rows', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.batchId)
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  try {
    const rows = await withTenantTx(tenantId, async (db) => listImportRows(toRawQuery(db), tenantId, batchId, status))
    res.json(rows)
  } catch (e: any) {
    res.status(500).json({ code: 'LIST_ROWS_FAILED', message: String(e?.message || e) })
  }
})

dataImportRoutes.post('/batches/:batchId/validate', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ code: 'FORBIDDEN' })
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.batchId)
  try {
    const batch = await withTenantTx(tenantId, async (db) => validateImportBatch(toRawQuery(db), tenantId, batchId))
    res.json(batch)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    res.status(500).json({ code: 'VALIDATE_FAILED', message: msg })
  }
})

dataImportRoutes.post('/batches/:batchId/commit', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ code: 'FORBIDDEN' })
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.batchId)
  try {
    const batch = await withTenantTx(tenantId, async (db) =>
      commitImportBatch(db, toRawQuery(db), tenantId, batchId, currentActorId(req))
    )
    res.json(batch)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'BATCH_NOT_VALIDATED') return res.status(409).json({ code: 'BATCH_NOT_VALIDATED' })
    res.status(500).json({ code: 'COMMIT_FAILED', message: msg })
  }
})

dataImportRoutes.post('/batches/:batchId/rows/:rowId/retry', async (req, res) => {
  if (!canManage(req)) return res.status(403).json({ code: 'FORBIDDEN' })
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.batchId)
  const rowId = routeParam(req.params.rowId)
  try {
    const row = await withTenantTx(tenantId, async (db) =>
      retryImportRow(db, toRawQuery(db), tenantId, batchId, rowId, currentActorId(req))
    )
    res.json(row)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'ROW_NOT_FAILED') return res.status(409).json({ code: 'ROW_NOT_FAILED' })
    res.status(500).json({ code: 'RETRY_FAILED', message: msg })
  }
})
