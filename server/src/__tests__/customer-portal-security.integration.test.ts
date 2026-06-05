import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { issuePolicy } from '../services/lifecycle.service.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'

const cacheSpies = vi.hoisted(() => ({
  cacheDeleteKey: vi.fn(() => Promise.resolve()),
  cacheDeletePrefix: vi.fn(() => Promise.resolve(0)),
  cacheGetJson: vi.fn(() => Promise.resolve(null)),
  cacheSetJson: vi.fn(() => Promise.resolve()),
}))

vi.mock('../cache.js', () => ({
  buildCacheKey: (parts: Array<string | number | null | undefined>) =>
    parts.map((part) => String(part ?? '').trim().replace(/[\s:]+/g, '_') || 'na').join(':'),
  cacheDeleteKey: cacheSpies.cacheDeleteKey,
  cacheDeletePrefix: cacheSpies.cacheDeletePrefix,
  cacheGetJson: cacheSpies.cacheGetJson,
  cacheSetJson: cacheSpies.cacheSetJson,
  getCache: () => null,
  initCache: vi.fn(() => Promise.resolve()),
  closeCache: vi.fn(() => Promise.resolve()),
  hashCacheInput: (value: unknown) => JSON.stringify(value),
}))

const app = createApp()
const tenantId = 'sample-carrier'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

function quotePayload(customerName: string, vin: string) {
  const [firstName, lastName] = customerName.split(' ')
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}@example.com`,
    },
    insureds: {
      primary: {
        firstName,
        lastName,
        displayName: customerName,
      },
    },
    risks: [
      {
        type: 'autoVehicle',
        year: 2024,
        make: 'Honda',
        model: 'Accord',
        vin,
        garagingZip: '94105',
        symbol: 'A',
        usage: 'commute',
      },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
      { code: 'UM', selected: false, limit: 50000 },
    ],
  }
}

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency, mfa_required)
     VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (tenant_id) DO UPDATE
       SET name = EXCLUDED.name, mfa_required = false`,
    [tenantId, 'Portal Security Carrier', 'en-US', 'USD'],
  )
}

async function createCustomer(customerKey: string, displayName: string) {
  const customerId = crypto.randomUUID()
  await getDb()!.query(
    `INSERT INTO customers (customer_id, tenant_id, customer_key, entity_type, status, display_name, metadata)
     VALUES ($1::uuid,$2,$3,'INDIVIDUAL','ACTIVE',$4,'{}'::jsonb)`,
    [customerId, tenantId, customerKey, displayName],
  )
  return { customerId, customerKey, displayName }
}

async function login(username: string) {
  const res = await request(app)
    .post('/auth/login')
    .send({ tenantId, username, password })
    .expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authGet(path: string, token: string) {
  return request(app)
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', tenantId)
}

function authPatch(path: string, token: string) {
  return request(app)
    .patch(path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', tenantId)
}

async function createIssuedPolicy(customer: { customerId: string; displayName: string }, vin: string) {
  const quote = await createOrRateQuote(
    {} as any,
    tenantId,
    quotePayload(customer.displayName, vin),
    null,
    'integration-test',
  )
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
  await withTenantTx(tenantId, (db) =>
    issuePolicy(db, tenantId, bound.policyId, {
      id: crypto.randomUUID(),
      username: 'integration-test',
      roles: ['admin'],
      permissions: ['uw.referrals.decide'],
    }),
  )
  await getDb()!.query(
    `INSERT INTO policy_customer_links (
       tenant_id, policy_id, customer_id, role_code, is_primary, source, metadata
     )
     VALUES ($1,$2::uuid,$3::uuid,'PRIMARY_NAMED_INSURED',true,'integration-test','{}'::jsonb)`,
    [tenantId, bound.policyId, customer.customerId],
  )
  return bound
}

describe('customer portal, RBAC, and cache integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('enforces customer policy scope and returns portal-safe projections only', async () => {
    await initDb()
    await ensureTenant()

    const run = suffix()
    const ada = await createCustomer(`CUST-ADA-${run}`, 'Ada Lovelace')
    const grace = await createCustomer(`CUST-GRACE-${run}`, 'Grace Hopper')
    const adaPolicy = await createIssuedPolicy(ada, `VINADA${run}`)
    const gracePolicy = await createIssuedPolicy(grace, `VINGRC${run}`)

    await createUser({
      username: `portal-ada-${run}`,
      password,
      tenantId,
      roles: ['customer'],
      customerRef: ada.customerKey,
    })
    const token = await login(`portal-ada-${run}`)

    const summary = await authGet('/api/v1/customer-portal/summary', token).expect(200)
    expect(summary.body.customer).toMatchObject({
      customerId: ada.customerId,
      customerKey: ada.customerKey,
      customerName: ada.displayName,
    })
    expect(summary.body.policies).toHaveLength(1)
    expect(summary.body.policies[0]).toMatchObject({
      policyId: adaPolicy.policyId,
      status: 'Issued',
      productCode: 'personal-auto',
    })
    expect(JSON.stringify(summary.body.policies[0])).not.toContain('metadata')
    expect(JSON.stringify(summary.body.policies[0])).not.toContain('lifecycle')

    const detail = await authGet(`/api/v1/customer-portal/policies/${adaPolicy.policyId}`, token).expect(200)
    expect(detail.body.policy).toMatchObject({
      policyId: adaPolicy.policyId,
      status: 'Issued',
      productCode: 'personal-auto',
    })
    expect(detail.body.declarations.namedInsured).toBe(ada.displayName)
    expect(detail.body.declarations.coverages.map((x: any) => x.code).sort()).toEqual(['BI', 'PD'])
    expect(detail.body.idCard.vehicles[0]).toMatchObject({ make: 'Honda', model: 'Accord' })
    expect(JSON.stringify(detail.body)).not.toContain('payload')
    expect(JSON.stringify(detail.body)).not.toContain('auditLog')
    expect(JSON.stringify(detail.body)).not.toContain('premiumSummary')
    expect(JSON.stringify(detail.body)).not.toContain('metadata')

    await authGet(`/api/v1/customer-portal/policies/${gracePolicy.policyId}`, token).expect(404)
  })

  it('hydrates persisted RBAC permissions for allowed and denied route access', async () => {
    await initDb()
    await ensureTenant()

    const run = suffix()
    await createUser({ username: `rbac-admin-${run}`, password, tenantId, roles: ['admin'] })
    await createUser({ username: `rbac-agent-${run}`, password, tenantId, roles: ['agent'] })

    const adminToken = await login(`rbac-admin-${run}`)
    const agentToken = await login(`rbac-agent-${run}`)

    const allowed = await authGet('/api/v1/admin/security/permissions', adminToken).expect(200)
    expect(allowed.body.some((permission: any) => permission.permissionCode === 'admin.security.read')).toBe(true)

    const denied = await authGet('/api/v1/admin/security/permissions', agentToken).expect(403)
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('invalidates tenant preference cache after admin tenant mutations', async () => {
    await initDb()
    await ensureTenant()

    const run = suffix()
    await createUser({ username: `cache-admin-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`cache-admin-${run}`)

    await authPatch('/api/v1/admin/tenant', token)
      .send({ name: `Portal Security Carrier ${run}` })
      .expect(200)

    expect(cacheSpies.cacheDeleteKey).toHaveBeenCalledWith(`tenant-preferences:${tenantId}`)
  })
})
