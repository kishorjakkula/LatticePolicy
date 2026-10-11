import { Router } from 'express'
import { loadProductConfig, buildRiskFields, loadFieldMeta, loadRiskScreen } from '../products.js'
import { listProductCapabilities, requireProductCapabilities } from '../lib/product-registry.js'
import { requirePermission } from '../auth.js'
import { isUuidLike, routeParam } from '../lib/utils.js'
import { getDb } from '../db.js'
import { loadPolicyContext } from '../persistence.js'
import { getLoadedSnapshot, snapshotIdOf } from '../lib/product-snapshot.js'

export const productsRoutes = Router()
const requireProductAccess = requirePermission(['page.wizard.view', 'page.policy.view'])

productsRoutes.get('/products', requireProductAccess, (_req, res) => {
  return res.json({ items: listProductCapabilities() })
})

// GET /products/:code/config
// Returns the full product configuration object for the given product code.
productsRoutes.get('/products/:code/config', requireProductAccess, (req, res, next) => {
  try {
    const code = routeParam(req.params.code).toLowerCase()
    requireProductCapabilities(code)
    const cfg = loadProductConfig(code)
    return res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// GET /products/:code/form
// Returns the risk field definitions used to render the quote/policy form.
productsRoutes.get('/products/:code/form', requireProductAccess, async (req, res, next) => {
  try {
    const code = routeParam(req.params.code).toLowerCase()
    requireProductCapabilities(code)
    const cfg = loadProductConfig(code)
    // A mid-term transaction (endorse, cancel, reinstate) names its policy so
    // the screen served is the one from the product version that term was
    // written on, not a screen changed since.
    const policyId = typeof req.query.policyId === 'string' ? req.query.policyId.trim() : ''
    if (policyId && getDb() && isUuidLike(policyId)) {
      const ctx = await req.tx((db) => loadPolicyContext(db, req.tenant!.tenantId, policyId))
      const snapshot = getLoadedSnapshot(snapshotIdOf(ctx?.latestPayload))
      if (snapshot && snapshot.productCode === code && snapshot.definition.screen) {
        const pinnedScreen = snapshot.definition.screen
        const pinnedFields = pinnedScreen.sections.flatMap((section) =>
          section.fields.map((field) => ({
            key: field.key,
            label: field.label,
            type: field.widget === 'select' || field.widget === 'radio' || field.widget === 'checkbox' ? 'select' : field.dataType === 'int' || field.dataType === 'number' ? 'number' : 'text',
            path: field.path,
            required: field.required === true,
            ...(field.options ? { options: field.options } : {}),
            ...(field.help ? { help: field.help } : {}),
            ...(section.title ? { group: section.title } : {}),
          }))
        )
        return res.json({ fields: pinnedFields, screen: pinnedScreen, productSnapshotId: snapshot.id })
      }
    }
    const fields = buildRiskFields(code, cfg, req.tenant?.tenantId)
    // Present only when the carrier pack defines a screen for this product.
    const screen = loadRiskScreen(code, cfg, req.tenant?.tenantId)
    return res.json(screen ? { fields, screen } : { fields })
  } catch (err) {
    next(err)
  }
})

// GET /products/:code/field-meta
// Returns field metadata (labels, validations, display hints) for a product.
productsRoutes.get('/products/:code/field-meta', requireProductAccess, (req, res, next) => {
  try {
    const code = routeParam(req.params.code).toLowerCase()
    requireProductCapabilities(code)
    const tenantId = req.tenant!.tenantId
    const meta = loadFieldMeta(code, tenantId)
    return res.json({ fields: meta })
  } catch (err) {
    next(err)
  }
})
