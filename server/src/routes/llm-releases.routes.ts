import { Router, type Request, type Response, type NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { requirePermission } from '../auth.js'
import { getDb } from '../db.js'
import { routeParam } from '../lib/utils.js'
import { requestIdOf } from '../lib/request-id.js'
import {
  issueRevocationList,
  listLlmReleases,
  registerLlmRelease,
  saveLlmContact,
  saveLlmPolicy,
  transitionLlmRelease,
  type LlmActorContext,
} from '../services/llm-release.service.js'
import {
  authenticateAutomationCredential,
  isAutomationToken,
  issueAutomationCredential,
  listAutomationCredentials,
  revokeAutomationCredential,
} from '../services/llm-automation-credentials.service.js'

export const llmReleaseRoutes = Router()
const releaseReadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false })
const releaseActionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })
function handle(operation: (req: Request, ctx: LlmActorContext) => Promise<unknown>, status = 200) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED' })
    const ctx: LlmActorContext = {
      via: (req as any).llmCredentialId ? 'credential' : 'session',
      requestId: requestIdOf(req, res),
    }
    operation(req, ctx)
      .then((data) => res.status(status).json(data))
      .catch(next)
  }
}

/** IPv4 clients can arrive as IPv4-mapped IPv6 addresses. */
function clientIp(req: Request) {
  const ip = String(req.ip || '')
  return ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip
}

/**
 * Release automation authenticates with a scoped service credential
 * (lpa_...). It resolves to the automation identity only for this route; it
 * is never accepted anywhere else.
 */
function automationCredential(req: Request, res: Response, next: NextFunction) {
  const header = req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!isAutomationToken(token)) return next()
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED' })
  const tenantId = req.tenant!.tenantId
  authenticateAutomationCredential(tenantId, token, clientIp(req))
    .then((identity) => {
      if (!identity) return res.status(401).json({ code: 'INVALID_AUTOMATION_CREDENTIAL', message: 'Credential is invalid, expired, revoked, or not allowed from this address' })
      req.user = {
        id: identity.userId,
        username: identity.username,
        tenantId,
        roles: ['llm_release_automation'],
        permissions: ['llm.releases.read', 'llm.releases.register'],
        customerId: null,
        customerKey: null,
        customerName: null,
      } as any
      ;(req as any).llmCredentialId = identity.credentialId
      next()
    })
    .catch(next)
}

llmReleaseRoutes.get(
  '/admin/llm/releases',
  releaseReadLimiter,
  requirePermission('llm.releases.read'),
  handle((req) =>
    listLlmReleases(
      req.tenant!.tenantId,
      req.user!.id,
      typeof req.query.release === 'string' ? req.query.release : undefined,
    ),
  ),
)
llmReleaseRoutes.put(
  '/admin/llm/contact',
  releaseActionLimiter,
  requirePermission('llm.releases.review'),
  handle((req) =>
    saveLlmContact(req.tenant!.tenantId, req.user!.id, req.body?.email),
  ),
)
llmReleaseRoutes.put(
  '/admin/llm/policy',
  releaseActionLimiter,
  requirePermission('llm.releases.review'),
  handle((req, ctx) => saveLlmPolicy(req.tenant!.tenantId, req.user!.id, req.body, ctx)),
)
llmReleaseRoutes.get(
  '/admin/llm/revocations',
  releaseActionLimiter,
  requirePermission('llm.releases.review'),
  handle((req, ctx) => issueRevocationList(req.tenant!.tenantId, req.user!.id, ctx)),
)
llmReleaseRoutes.get(
  '/admin/llm/credentials',
  releaseReadLimiter,
  requirePermission('admin.users.manage'),
  handle((req) => listAutomationCredentials(req.tenant!.tenantId, req.user!.id)),
)
llmReleaseRoutes.post(
  '/admin/llm/credentials',
  releaseActionLimiter,
  requirePermission('admin.users.manage'),
  handle((req, ctx) => issueAutomationCredential(req.tenant!.tenantId, req.user!.id, req.body, ctx), 201),
)
llmReleaseRoutes.post(
  '/admin/llm/credentials/:id/revoke',
  releaseActionLimiter,
  requirePermission('admin.users.manage'),
  handle((req, ctx) => revokeAutomationCredential(req.tenant!.tenantId, req.user!.id, routeParam(req.params.id), ctx)),
)
llmReleaseRoutes.post(
  '/admin/llm/releases',
  releaseActionLimiter,
  automationCredential,
  requirePermission('llm.releases.register'),
  handle(
    (req, ctx) => registerLlmRelease(req.tenant!.tenantId, req.user!.id, req.body, ctx),
    201,
  ),
)
llmReleaseRoutes.post(
  '/admin/llm/releases/:id/:action',
  releaseActionLimiter,
  requirePermission('llm.releases.review'),
  handle((req, ctx) =>
    transitionLlmRelease(
      req.tenant!.tenantId,
      routeParam(req.params.id),
      req.user!.id,
      routeParam(req.params.action),
      req.body,
      ctx,
    ),
  ),
)
