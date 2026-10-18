import { Router, type Request, type Response, type NextFunction } from 'express'
import { requirePermission } from '../auth.js'
import { getDb } from '../db.js'
import { routeParam } from '../lib/utils.js'
import {
  VALIDATION_VOCABULARY,
  applicableValidationRules,
  createValidationRule,
  deleteValidationRule,
  getValidationRuleHistory,
  listValidationAcknowledgements,
  listValidationRules,
  updateValidationRule,
  validationFieldCatalog,
} from '../services/validation-rules.service.js'

export const validationRuleRoutes = Router()
const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
const actorOf = (req: Request) => String(req.user?.username || req.user?.id || 'system')
function handle(operation: (req: Request) => Promise<unknown> | unknown, status = 200) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Validation rules require database mode' })
    Promise.resolve()
      .then(() => operation(req))
      .then((data) => res.status(status).json(data))
      .catch(next)
  }
}

validationRuleRoutes.get(
  '/admin/validation-rules',
  requirePermission('admin.validation_rules.read'),
  handle(async (req) => ({ items: await listValidationRules(req.tenant!.tenantId), vocabulary: VALIDATION_VOCABULARY })),
)
validationRuleRoutes.get(
  '/admin/validation-rules/catalog',
  requirePermission('admin.validation_rules.read'),
  handle((req) => ({ fields: validationFieldCatalog(req.tenant!.tenantId, text(req.query.productCode)) })),
)
validationRuleRoutes.get(
  '/admin/validation-rules/:id/history',
  requirePermission('admin.validation_rules.read'),
  handle(async (req) => ({ items: await getValidationRuleHistory(req.tenant!.tenantId, routeParam(req.params.id)) })),
)
validationRuleRoutes.post(
  '/admin/validation-rules',
  requirePermission('admin.validation_rules.manage'),
  handle((req) => createValidationRule(req.tenant!.tenantId, actorOf(req), req.body), 201),
)
validationRuleRoutes.put(
  '/admin/validation-rules/:id',
  requirePermission('admin.validation_rules.manage'),
  handle((req) => updateValidationRule(req.tenant!.tenantId, actorOf(req), routeParam(req.params.id), req.body)),
)
validationRuleRoutes.delete(
  '/admin/validation-rules/:id',
  requirePermission('admin.validation_rules.manage'),
  handle((req) => deleteValidationRule(req.tenant!.tenantId, actorOf(req), routeParam(req.params.id))),
)
// The wizard evaluates these as the user types; the API enforces the same rules.
validationRuleRoutes.get(
  '/validation-rules/applicable',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  handle(async (req) => ({
    items: await applicableValidationRules(req.tenant!.tenantId, {
      productCode: text(req.query.productCode),
      state: text(req.query.state),
    }),
  })),
)
validationRuleRoutes.get(
  '/validation-acknowledgements',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  handle(async (req) => ({
    items: await listValidationAcknowledgements(
      req.tenant!.tenantId,
      req.query.entityType === 'quote' ? 'quote' : 'policy',
      text(req.query.entityId) || '',
    ),
  })),
)
