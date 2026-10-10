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

  it('creates fresh contacts and addresses without overwriting supplied existing IDs', async () => {
    withDatabase()
    const contactId = '22222222-2222-4222-a222-222222222222'
    const addressId = '33333333-3333-4333-a333-333333333333'
    const contacts = new Map([[contactId, 'original@example.com']])
    const addresses = new Map([[addressId, 'Original address']])
    const writes: Array<{ sql: string; values: any[] }> = []
    vi.mocked(toRawQuery).mockReturnValue((async (sql: string, values: any[] = []) => {
      if (/^\s*INSERT INTO customer_contact_points\s/.test(sql)) {
        contacts.set(values[0], values[5])
        writes.push({ sql, values })
      }
      if (/^\s*INSERT INTO customer_addresses\s/.test(sql)) {
        addresses.set(values[0], values[4])
        writes.push({ sql, values })
      }
      return { rows: [], rowCount: 0 }
    }) as any)
    const res = await request(buildApp(WIZARD_USER)).post('/api/v1/customers')
      .set('X-Tenant', 'sample-carrier').send({
        entityType: 'INDIVIDUAL',
        identity: { person: { firstName: 'New', lastName: 'Insured', ssnLast4: '1234' } },
        contactPoints: [{ contactPointId: contactId, contactType: 'EMAIL', value: 'new@example.com' }],
        addresses: [{ addressId, addressType: 'residence', line1: 'New address' }],
      })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(contacts.get(contactId)).toBe('original@example.com')
    expect(addresses.get(addressId)).toBe('Original address')
    expect([...contacts.values()]).toContain('new@example.com')
    expect([...addresses.values()]).toContain('New address')
    expect(writes).toHaveLength(2)
    for (const { values } of writes) {
      expect(values[0]).not.toBe(contactId)
      expect(values[0]).not.toBe(addressId)
      expect(values[1]).toBe('sample-carrier')
      expect(values[2]).toBe(writes[0].values[2])
    }
  })

  it('ignores admin-only collections and compliance during intake creation', async () => {
    withDatabase()
    const writes: Array<{ sql: string; values: any[] }> = []
    vi.mocked(toRawQuery).mockReturnValue((async (sql: string, values: any[] = []) => {
      if (/^\s*INSERT/.test(sql)) writes.push({ sql, values })
      return { rows: [], rowCount: 0 }
    }) as any)
    const res = await request(buildApp(WIZARD_USER)).post('/api/v1/customers')
      .set('X-Tenant', 'sample-carrier').send({
        entityType: 'INDIVIDUAL',
        identity: { person: { firstName: 'New', lastName: 'Insured', ssnLast4: '1234' } },
        contactPoints: [{ contactType: 'EMAIL', value: 'new@example.com' }],
        externalIdentifiers: [{ sourceSystem: 'CRM', externalId: 'existing-customer' }],
        relationships: [{ relationshipId: CUSTOMER.id, relatedCustomerId: AGENT.id, relationshipType: 'SPOUSE' }],
        notes: [{ noteId: CUSTOMER.id, noteText: 'Admin note' }],
        attachments: [{ attachmentId: CUSTOMER.id, documentId: 'existing-document' }],
        compliance: { kycStatus: 'VERIFIED', sanctionsStatus: 'CLEAR' },
        metadata: { privileged: true },
      })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    for (const table of ['customer_external_identifiers', 'customer_relationships', 'customer_notes', 'customer_attachments']) {
      expect(writes.some(({ sql }) => sql.includes(`INSERT INTO ${table}`)), table).toBe(false)
    }
    const compliance = writes.find(({ sql }) => sql.includes('INSERT INTO customer_compliance'))!
    expect(compliance.values[2]).toBeNull() // kyc_status
    expect(compliance.values[5]).toBeNull() // sanctions_status
    const customer = writes.find(({ sql }) => /INSERT INTO customers\s/.test(sql))!
    expect(JSON.parse(customer.values[7])).toEqual({})
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
