import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'
import { routeParam } from '../lib/utils.js'
import { NotFoundError } from '../errors/domain.errors.js'
import { generateBordereau, loadBordereauRows, toCsv } from '../services/bordereaux.service.js'

export const bordereauxRoutes = Router()

bordereauxRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Bordereaux generation requires database mode' })
  }
  next()
})

bordereauxRoutes.get('/batches', requirePermission('admin.bordereaux.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const bordereauType = typeof req.query.bordereauType === 'string' ? req.query.bordereauType : undefined
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id = $1']
      const params: any[] = [tenantId]
      if (bordereauType) {
        clauses.push(`bordereau_type = $${params.length + 1}`)
        params.push(bordereauType)
      }
      const result = await q(
        `SELECT * FROM bordereaux_batches WHERE ${clauses.join(' AND ')} ORDER BY generated_at DESC`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err) {
    next(err)
  }
})

bordereauxRoutes.get('/batches/:id', requirePermission('admin.bordereaux.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.id)
  try {
    const batch = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(`SELECT * FROM bordereaux_batches WHERE tenant_id = $1 AND batch_id = $2`, [tenantId, batchId])
      return result.rows[0]
    })
    if (!batch) throw new NotFoundError('BORDEREAUX_NOT_FOUND', 'Batch not found')
    res.json(batch)
  } catch (err) {
    next(err)
  }
})

bordereauxRoutes.post('/batches', requirePermission('admin.bordereaux.manage'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const body = req.body || {}
  try {
    const summary = await withTenantTx(tenantId, (db) =>
      generateBordereau(db, tenantId, {
        bordereauType: body.bordereauType,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        productCode: body.productCode ?? null,
        programName: body.programName ?? null,
        recipientName: body.recipientName ?? null,
        treatyId: body.treatyId ?? null,
        correctsBatchId: body.correctsBatchId ?? null,
        generatedBy: req.user?.id || null
      })
    )
    res.status(201).json(summary)
  } catch (err) {
    next(err)
  }
})

bordereauxRoutes.get('/batches/:id/rows', requirePermission('admin.bordereaux.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.id)
  try {
    const rows = await withTenantTx(tenantId, (db) => loadBordereauRows(db, tenantId, batchId))
    res.json({ items: rows })
  } catch (err) {
    next(err)
  }
})

bordereauxRoutes.get('/batches/:id/export', requirePermission('admin.bordereaux.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const batchId = routeParam(req.params.id)
  const format = typeof req.query.format === 'string' ? req.query.format : 'json'
  try {
    const batch = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(`SELECT * FROM bordereaux_batches WHERE tenant_id = $1 AND batch_id = $2`, [tenantId, batchId])
      return result.rows[0]
    })
    if (!batch) throw new NotFoundError('BORDEREAUX_NOT_FOUND', 'Batch not found')
    const rows = await withTenantTx(tenantId, (db) => loadBordereauRows(db, tenantId, batchId))

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="bordereau-${batchId}.csv"`)
      res.send(toCsv(rows))
      return
    }
    res.json({ batch, rows })
  } catch (err) {
    next(err)
  }
})
