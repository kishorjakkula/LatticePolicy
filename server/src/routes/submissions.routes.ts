import { Router, type NextFunction, type Request, type Response } from 'express'
import { getDb } from '../db.js'
import { requirePermission } from '../auth.js'
import { routeParam } from '../lib/utils.js'
import {
  acceptHighConfidence,
  approveSubmission,
  createSubmission,
  declineSubmission,
  getIntakeSettings,
  getSubmission,
  getSubmissionChecks,
  getSubmissionDocument,
  listSubmissions,
  setCustomerChoice,
  startReading,
  updateSubmissionField,
} from '../services/submission-intake.service.js'
import { scheduleExtraction } from '../services/submission-intake-scheduler.js'

/**
 * Submission intake API. See docs/SUBMISSION_INTAKE.md.
 *
 * submissions.read     list, detail, documents, checks
 * submissions.manage   upload, read with AI, confirm or correct values
 * submissions.approve  approve (creates customer link and draft quote), decline
 */
export const submissionRoutes = Router()

function actorOf(req: Request): string {
  return String((req as any).user?.username || (req as any).user?.id || 'system')
}

function requireDb(_req: Request, res: Response, next: NextFunction) {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Submission intake requires database mode' })
  next()
}

type Handler = (req: Request, tenantId: string, actor: string) => Promise<unknown>

function handle(handler: Handler, status = 200) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, req.tenant!.tenantId, actorOf(req))
      .then((result) => res.status(status).json(result))
      .catch(next)
  }
}

submissionRoutes.get('/submissions/settings', requirePermission('submissions.read'), (_req, res) => {
  res.json(getIntakeSettings())
})

submissionRoutes.get('/submissions', requirePermission('submissions.read'), requireDb, handle((req, tenantId) =>
  listSubmissions(tenantId, {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    page: Number(req.query.page || 1),
    pageSize: Number(req.query.pageSize || 25),
  })
))

// Upload, then start reading straight away unless the uploader asks not to.
submissionRoutes.post('/submissions', requirePermission('submissions.manage'), requireDb, handle(async (req, tenantId, actor) => {
  const body = req.body || {}
  const submission = await createSubmission(tenantId, actor, body)
  if (body.startReading !== false) {
    await startReading(tenantId, submission.submissionId, actor, { productHint: body.productCode || null, schedule: scheduleExtraction })
  }
  return getSubmission(tenantId, submission.submissionId)
}, 201))

submissionRoutes.get('/submissions/:id', requirePermission('submissions.read'), requireDb, handle((req, tenantId) =>
  getSubmission(tenantId, routeParam(req.params.id))
))

submissionRoutes.get('/submissions/:id/checks', requirePermission('submissions.read'), requireDb, handle((req, tenantId) =>
  getSubmissionChecks(tenantId, routeParam(req.params.id))
))

submissionRoutes.get('/submissions/:id/documents/:documentId', requirePermission('submissions.read'), requireDb, (req, res, next) => {
  getSubmissionDocument(req.tenant!.tenantId, routeParam(req.params.id), routeParam(req.params.documentId))
    .then((document) => {
      const safeName = document.fileName.replace(/[^\w.\- ]+/g, '_')
      res.setHeader('Content-Type', document.contentType)
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${safeName}"`)
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
      res.send(document.content)
    })
    .catch(next)
})

submissionRoutes.post('/submissions/:id/read', requirePermission('submissions.manage'), requireDb, handle((req, tenantId, actor) =>
  startReading(tenantId, routeParam(req.params.id), actor, { productHint: req.body?.productCode || null, schedule: scheduleExtraction })
, 202))

submissionRoutes.patch('/submissions/:id/fields/:key', requirePermission('submissions.manage'), requireDb, handle((req, tenantId, actor) =>
  updateSubmissionField(tenantId, routeParam(req.params.id), routeParam(req.params.key), actor, req.body || {})
))

submissionRoutes.post('/submissions/:id/accept-high-confidence', requirePermission('submissions.manage'), requireDb, handle((req, tenantId, actor) =>
  acceptHighConfidence(tenantId, routeParam(req.params.id), actor)
))

submissionRoutes.put('/submissions/:id/customer', requirePermission('submissions.manage'), requireDb, handle((req, tenantId, actor) =>
  setCustomerChoice(tenantId, routeParam(req.params.id), actor, req.body || {})
))

submissionRoutes.post('/submissions/:id/approve', requirePermission('submissions.approve'), requireDb, handle((req, tenantId, actor) =>
  approveSubmission(tenantId, routeParam(req.params.id), actor, req.body || {})
))

submissionRoutes.post('/submissions/:id/decline', requirePermission('submissions.approve'), requireDb, handle((req, tenantId, actor) =>
  declineSubmission(tenantId, routeParam(req.params.id), actor, req.body || {})
))
