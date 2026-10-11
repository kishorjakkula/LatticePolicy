import type { Request, Response, NextFunction } from 'express'
import { getRequestLogger } from './logger.js'
import { withTenantTx, type DrizzleDB } from './db.js'
import { getPinnedTenantId } from './config.js'

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

export function tenancyMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = (req.header('X-Tenant') || req.query.tenant || '').toString().trim()
  const pinnedTenantId = getPinnedTenantId()
  if (pinnedTenantId) {
    // Single-carrier stack: a request or token naming any other tenant is
    // rejected here, before it can reach a route or a login handler.
    const tokenTenantId = String(req.user?.tenantId || '').trim()
    if ((tenantId && tenantId !== pinnedTenantId) || (tokenTenantId && tokenTenantId !== pinnedTenantId)) {
      getRequestLogger(req, res).warn({ method: req.method, url: req.url }, 'TENANT_NOT_SERVED')
      return res.status(403).json({ code: 'TENANT_NOT_SERVED', message: 'This deployment does not serve the requested tenant' })
    }
    req.tenant = { tenantId: pinnedTenantId }
  } else if (tenantId) {
    req.tenant = { tenantId }
  } else if (req.user?.tenantId) {
    req.tenant = { tenantId: req.user.tenantId }
  }
  // withTenantTx rejects a missing tenant id, so an unresolved tenant fails
  // closed instead of opening a transaction with an empty tenant scope.
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
