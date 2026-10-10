import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'

// Route-layer test: the database is stubbed so the assertions are about which
// roles may reach the quote-intake customer endpoints and that the admin-only
// customer operations are not exposed through them. Persistence is covered by
// the Playwright quote-wizard spec against a real stack.
vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { tenancyMiddleware, requireTenant } from '../tenancy.js'
import { getDefaultPermissionCodesForRoles } from '../lib/rbac.js'
import { customerIntakeRoutes } from '../routes/customers.routes.js'

type TestUser = { id: string; username: string; tenantId: string; roles: string[]; permissions?: string[] }

// Role identities resolve through the real RBAC role map when no database is
// configured; the token-scoped identity carries explicit permissions the way
// issueToken() embeds them, so it also works once the database stub is on.
const AGENT: TestUser = { id: '11111111-1111-4111-a111-111111111111', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'] }
const WIZARD_USER: TestUser = { id: '77777777-7777-4777-a777-777777777777', username: 'producer', tenantId: 'sample-carrier', roles: [], permissions: ['page.wizard.view'] }
const CUSTOMER: TestUser = { id: '55555555-5555-4555-a555-555555555555', username: 'portal1', tenantId: 'sample-carrier', roles: ['customer'] }
const ACTUARY: TestUser = { id: '66666666-6666-4666-a666-666666666666', username: 'actuary1', tenantId: 'sample-carrier', roles: ['actuary'] }

function buildApp(user: TestUser | null) {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) req.user = { ...user } as any
    next()
  })
  app.use(tenancyMiddleware)
  app.use('/api/v1/customers', requireTenant, customerIntakeRoutes)
  return app
}

describe('quote-intake customer routes', () => {
  const queries: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    queries.length = 0
    vi.mocked(getDb).mockReturnValue(null)
    vi.mocked(toRawQuery).mockReturnValue((async (sql: string) => {
      queries.push(sql)
      return { rows: [], rowCount: 0 }
    }) as any)
  })

  function withDatabase() {
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(withTenantTx).mockImplementation(async (_tenantId: string, fn: any) => fn({} as any))
  }

  it('the seeded agent role passes the permission gate without holding any admin permission', async () => {
    const agentPermissions = getDefaultPermissionCodesForRoles(['agent'])
    expect(agentPermissions).toContain('page.wizard.view')
    expect(agentPermissions).not.toContain('menu.admin.view')
    expect(agentPermissions).not.toContain('admin.customers.read')

    // No database configured: getting past the gate surfaces as 503, not 403.
    const res = await request(buildApp(AGENT)).get('/api/v1/customers/search?q=Smith').set('X-Tenant', 'sample-carrier')
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('DB_REQUIRED')
  })

  it('searches customers for a wizard user', async () => {
    withDatabase()
    const res = await request(buildApp(WIZARD_USER)).get('/api/v1/customers/search?q=Smith&limit=20').set('X-Tenant', 'sample-carrier')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
    expect(queries.length).toBeGreaterThan(0)
  })

  it('returns 404 for a customer that does not exist in the tenant', async () => {
    withDatabase()
    const res = await request(buildApp(WIZARD_USER)).get('/api/v1/customers/CUST-2026-999999').set('X-Tenant', 'sample-carrier')
    expect(res.status).toBe(404)
  })

  it.each([
    ['get', '/api/v1/customers/search?q=Smith'],
    ['get', '/api/v1/customers/CUST-2026-000001'],
    ['post', '/api/v1/customers'],
  ] as const)('rejects unauthenticated %s %s', async (method, url) => {
    const res = await (request(buildApp(null)) as any)[method](url).set('X-Tenant', 'sample-carrier').send({})
    expect(res.status).toBe(401)
    expect(queries).toEqual([])
  })

  it.each([
    ['customer', CUSTOMER],
    ['actuary', ACTUARY],
  ] as const)('rejects the %s role, which cannot use the quote wizard', async (_name, user) => {
    for (const [method, url] of [
      ['get', '/api/v1/customers/search?q=Smith'],
      ['get', '/api/v1/customers/CUST-2026-000001'],
      ['post', '/api/v1/customers'],
    ] as const) {
      const res = await (request(buildApp(user)) as any)[method](url).set('X-Tenant', 'sample-carrier').send({})
      expect(res.status, `${method} ${url}`).toBe(403)
      expect(res.body.message).toContain('page.wizard.view')
    }
    expect(queries).toEqual([])
  })

  it('does not expose update, delete, PII reveal, merge, or export through the intake router', async () => {
    withDatabase()
    const app = buildApp(WIZARD_USER)
    const attempts: Array<['patch' | 'delete' | 'post' | 'get', string]> = [
      ['patch', '/api/v1/customers/CUST-2026-000001'],
      ['delete', '/api/v1/customers/CUST-2026-000001'],
      ['post', '/api/v1/customers/CUST-2026-000001/reveal'],
      ['post', '/api/v1/customers/merge'],
      ['get', '/api/v1/customers/CUST-2026-000001/export'],
      ['get', '/api/v1/customers/CUST-2026-000001/audit'],
    ]
    for (const [method, url] of attempts) {
      const res = await (request(app) as any)[method](url).set('X-Tenant', 'sample-carrier').send({})
      expect(res.status, `${method} ${url}`).toBe(404)
    }
  })
})
