import { Router, type Request, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { requirePermission } from '../auth.js'
import { getDb } from '../db.js'
import { requestIdOf } from '../lib/request-id.js'
import { exportAiAuditCsv, listAiAudit, verifyAiAuditIntegrity } from '../services/ai-audit.service.js'

export const aiAuditRoutes = Router()
const auditReadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false })
const auditActionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false })
function requireDb(_req: Request, res: Response, next: NextFunction) {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED' })
  next()
}

aiAuditRoutes.get('/admin/ai-audit', auditReadLimiter, requirePermission('ai.audit.read'), requireDb, (req, res, next) => {
  listAiAudit(req.tenant!.tenantId, req.query).then((data) => res.json(data)).catch(next)
})
aiAuditRoutes.get('/admin/ai-audit/integrity', auditActionLimiter, requirePermission('ai.audit.read'), requireDb, (req, res, next) => {
  verifyAiAuditIntegrity(req.tenant!.tenantId).then((data) => res.json(data)).catch(next)
})
aiAuditRoutes.get('/admin/ai-audit/export', auditActionLimiter, requirePermission('ai.audit.read'), requireDb, (req, res, next) => {
  exportAiAuditCsv(req.tenant!.tenantId, req.user!.id, req.query, requestIdOf(req, res))
    .then((csv) => {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="ai-audit-${new Date().toISOString().slice(0, 10)}.csv"`)
      res.setHeader('Cache-Control', 'no-store')
      res.send(csv)
    })
    .catch(next)
})
