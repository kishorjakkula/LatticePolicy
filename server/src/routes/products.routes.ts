import { Router } from 'express'
import { loadProductConfig, buildRiskFields, loadFieldMeta } from '../products.js'
import { listProductCapabilities, requireProductCapabilities } from '../lib/product-registry.js'

export const productsRoutes = Router()

productsRoutes.get('/products', (_req, res) => {
  return res.json({ items: listProductCapabilities() })
})

// GET /products/:code/config
// Returns the full product configuration object for the given product code.
productsRoutes.get('/products/:code/config', (req, res, next) => {
  try {
    const code = (req.params.code || '').toLowerCase()
    requireProductCapabilities(code)
    const cfg = loadProductConfig(code)
    return res.json(cfg)
  } catch (err) {
    next(err)
  }
})

// GET /products/:code/form
// Returns the risk field definitions used to render the quote/policy form.
productsRoutes.get('/products/:code/form', (req, res, next) => {
  try {
    const code = (req.params.code || '').toLowerCase()
    requireProductCapabilities(code)
    const cfg = loadProductConfig(code)
    const fields = buildRiskFields(code, cfg)
    return res.json({ fields })
  } catch (err) {
    next(err)
  }
})

// GET /products/:code/field-meta
// Returns field metadata (labels, validations, display hints) for a product.
productsRoutes.get('/products/:code/field-meta', (req, res, next) => {
  try {
    const code = (req.params.code || '').toLowerCase()
    requireProductCapabilities(code)
    const tenantId = req.tenant!.tenantId
    const meta = loadFieldMeta(code, tenantId)
    return res.json({ fields: meta })
  } catch (err) {
    next(err)
  }
})
