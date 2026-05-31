import type { Request, Response, NextFunction } from 'express'
import { getRequestLogger } from './logger.js'
import { withTenantTx, type DrizzleDB } from './db.js'

export type TenantContext = {
  tenantId: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: TenantContext
      tx: <T>(fn: (db: DrizzleDB) => Promise<T>) => Promise<T>
    }
  }
}

export function tenancyMiddleware(req: Request, _res: Response, next: NextFunction) {
  const tenantId = (req.header('X-Tenant') || req.query.tenant || '').toString().trim()
  if (tenantId) {
    req.tenant = { tenantId }
  } else if (req.user?.tenantId) {
    req.tenant = { tenantId: req.user.tenantId }
  }
  req.tx = <T>(fn: (db: DrizzleDB) => Promise<T>): Promise<T> =>
    withTenantTx(req.tenant?.tenantId ?? (req as any).user?.tenantId ?? '', fn)
  next()
}

export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant?.tenantId) {
    getRequestLogger(req, res).warn({ method: req.method, url: req.url }, 'TENANT_REQUIRED')
    return res.status(400).json({ code: 'TENANT_REQUIRED', message: 'X-Tenant header is required' })
  }
  if (req.user?.tenantId && req.tenant?.tenantId && req.user.tenantId !== req.tenant.tenantId) {
    return res.status(403).json({ code: 'TENANT_MISMATCH', message: 'User tenant does not match request tenant' })
  }
  next()
}
