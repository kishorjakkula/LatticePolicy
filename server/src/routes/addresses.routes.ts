import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { requirePermission } from '../auth.js'
import { ForbiddenError, BadRequestError } from '../errors/domain.errors.js'
import { addressCapabilities, addressCheckInput, checkAddress } from '../services/address-check.service.js'

export const addressRoutes = Router()
const permission = requirePermission(['page.wizard.view', 'admin.customers.manage', 'admin.customers.contact.manage'])
const limiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: req => JSON.stringify([req.tenant?.tenantId, req.user?.id]) })
addressRoutes.use('/addresses', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() }, permission, (req, res, next) => {
  if (req.user?.roles?.includes('customer')) throw new ForbiddenError('FORBIDDEN')
  res.setHeader('Cache-Control', 'no-store')
  next()
})
addressRoutes.get('/addresses/capabilities', (_req, res) => res.json(addressCapabilities(_req.tenant!.tenantId)))
addressRoutes.post('/addresses/check', limiter, async (req, res) => {
  const result = addressCheckInput.safeParse(req.body)
  if (!result.success) throw new BadRequestError('INVALID_ADDRESS_INPUT', 'Supply a bounded structured postal address')
  res.json(await checkAddress(req.tenant!.tenantId, result.data.address))
})
