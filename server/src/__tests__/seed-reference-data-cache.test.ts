import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'

// Route-layer regression test: seeding reference data must drop the cached
// reference lists the Quote Wizard reads, otherwise a tenant that looked at the
// wizard before seeding keeps seeing "No underwriting company configured".
vi.mock('../db.js', () => ({
  getDb: vi.fn(() => ({})),
  withTenantTx: vi.fn(async (_tenantId: string, fn: any) => fn({})),
  // Lookups find nothing (so everything is "created"); inserts hand back a row
  // carrying the generated ids the handler reads from RETURNING clauses.
  toRawQuery: vi.fn(() => async (sql: string) => (
    /^\s*INSERT/i.test(sql)
      ? { rows: [{ form_id: 'form-1', company_id: 'company-1', agency_id: 'agency-1', template_id: 'template-1', id: 'row-1' }], rowCount: 1 }
      : { rows: [], rowCount: 0 }
  ))
}))

const cacheSpies = vi.hoisted(() => ({
  cacheDeletePrefix: vi.fn(() => Promise.resolve(0)),
  cacheDeleteKey: vi.fn(() => Promise.resolve(0))
}))

vi.mock('../cache.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../cache.js')>()),
  cacheDeletePrefix: cacheSpies.cacheDeletePrefix,
  cacheDeleteKey: cacheSpies.cacheDeleteKey
}))

import { withTenantTx } from '../db.js'
import { buildCacheKey } from '../cache.js'
import { tenancyMiddleware, requireTenant } from '../tenancy.js'
import { adminRoutes } from '../routes/admin.routes.js'

const TENANT = 'sample-carrier'

function buildApp(permissions: string[]) {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 'u-1', username: 'admin', tenantId: TENANT, roles: [], permissions } as any
    next()
  })
  app.use(tenancyMiddleware)
  app.use('/api/v1/admin', requireTenant, adminRoutes)
  return app
}

describe('POST /admin/seed-reference-data cache invalidation', () => {
  beforeEach(() => {
    cacheSpies.cacheDeletePrefix.mockClear()
  })

  it('clears the cached underwriting-company and form-preview lists after seeding', async () => {
    const res = await request(buildApp(['menu.admin.view', 'admin.security.manage']))
      .post('/api/v1/admin/seed-reference-data')
      .set('X-Tenant', TENANT)
      .send({})

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.summary.underwritingCompanies.created.length).toBeGreaterThan(0)
    const cleared = cacheSpies.cacheDeletePrefix.mock.calls.map((call) => (call as unknown[])[0])
    expect(cleared).toContain(buildCacheKey(['uw-companies', TENANT]))
    expect(cleared).toContain(buildCacheKey(['forms-preview', TENANT]))
  })

  it('does not touch the cache when the seed transaction fails', async () => {
    const original = vi.mocked(withTenantTx).getMockImplementation()!
    vi.mocked(withTenantTx).mockRejectedValue(new Error('boom'))
    const res = await request(buildApp(['menu.admin.view', 'admin.security.manage']))
      .post('/api/v1/admin/seed-reference-data')
      .set('X-Tenant', TENANT)
      .send({})
    vi.mocked(withTenantTx).mockImplementation(original)

    expect(res.status).toBe(500)
    expect(cacheSpies.cacheDeletePrefix).not.toHaveBeenCalled()
  })

  it('is refused without the security-manage permission', async () => {
    const res = await request(buildApp(['menu.admin.view']))
      .post('/api/v1/admin/seed-reference-data')
      .set('X-Tenant', TENANT)
      .send({})

    expect(res.status).toBe(403)
    expect(cacheSpies.cacheDeletePrefix).not.toHaveBeenCalled()
  })
})
