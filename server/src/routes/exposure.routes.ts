import { Router } from 'express'
import { getDb } from '../db.js'
import { computeExposureSummary, exposureRowsToCsv, loadExposureRows } from '../services/exposure.service.js'

export const exposureRoutes = Router()

exposureRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Exposure management requires database mode' })
  }
  next()
})

function parseFilters(req: any) {
  const productCode = typeof req.query.productCode === 'string' ? req.query.productCode : undefined
  const state = typeof req.query.state === 'string' ? req.query.state : undefined
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined
  return { productCode, state, asOf }
}

exposureRoutes.get('/summary', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const summary = await computeExposureSummary(getDb() as any, tenantId, parseFilters(req))
    res.json(summary)
  } catch (err: any) {
    res.status(500).json({ code: 'EXPOSURE_SUMMARY_FAILED', message: err?.message || 'Failed to compute exposure summary' })
  }
})

exposureRoutes.get('/export.csv', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const rows = await loadExposureRows(getDb() as any, tenantId, parseFilters(req))
    const csv = exposureRowsToCsv(rows)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="exposure-export.csv"')
    res.send(csv)
  } catch (err: any) {
    res.status(500).json({ code: 'EXPOSURE_EXPORT_FAILED', message: err?.message || 'Failed to export exposure data' })
  }
})
