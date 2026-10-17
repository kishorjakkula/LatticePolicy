import { Router, type Request } from 'express'
import { requirePermission } from '../auth.js'
import { getDb } from '../db.js'
import { routeParam } from '../lib/utils.js'
import {
  listLlmReleases,
  registerLlmRelease,
  saveLlmContact,
  transitionLlmRelease,
} from '../services/llm-release.service.js'

export const llmReleaseRoutes = Router()
function handle(operation: (req: Request) => Promise<unknown>, status = 200) {
  return (req: Request, res: any, next: any) => {
    if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED' })
    operation(req)
      .then((data) => res.status(status).json(data))
      .catch(next)
  }
}
llmReleaseRoutes.get(
  '/admin/llm/releases',
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
  requirePermission('llm.releases.review'),
  handle((req) =>
    saveLlmContact(req.tenant!.tenantId, req.user!.id, req.body?.email),
  ),
)
llmReleaseRoutes.post(
  '/admin/llm/releases',
  requirePermission('llm.releases.register'),
  handle(
    (req) => registerLlmRelease(req.tenant!.tenantId, req.user!.id, req.body),
    201,
  ),
)
llmReleaseRoutes.post(
  '/admin/llm/releases/:id/:action',
  requirePermission('llm.releases.review'),
  handle((req) =>
    transitionLlmRelease(
      req.tenant!.tenantId,
      routeParam(req.params.id),
      req.user!.id,
      routeParam(req.params.action),
      req.body,
    ),
  ),
)
