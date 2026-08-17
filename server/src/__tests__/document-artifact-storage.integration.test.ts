import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../services/user.service.js'
import { issuePolicy } from '../services/lifecycle.service.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'

vi.mock('../cache.js', () => ({
  buildCacheKey: (parts: Array<string | number | null | undefined>) =>
    parts.map((part) => String(part ?? '').trim().replace(/[\s:]+/g, '_') || 'na').join(':'),
  cacheDeleteKey: vi.fn(() => Promise.resolve()),
  cacheDeletePrefix: vi.fn(() => Promise.resolve(0)),
  cacheGetJson: vi.fn(() => Promise.resolve(null)),
  cacheSetJson: vi.fn(() => Promise.resolve()),
  getCache: () => null,
  initCache: vi.fn(() => Promise.resolve()),
  closeCache: vi.fn(() => Promise.resolve()),
  hashCacheInput: (value: unknown) => JSON.stringify(value),
}))

const app = createApp()
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant(tenantId: string, name: string) {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency, mfa_required)
     VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name, mfa_required = false`,
    [tenantId, name, 'en-US', 'USD'],
  )
}

let seededFormIds: string[] = []

async function seedForm(
  tenantId: string,
  formNumber: string,
  visibility: string[],
): Promise<string> {
  const db = getDb()
  const formId = crypto.randomUUID()
  seededFormIds.push(formId)
  await db!.query(
    `INSERT INTO forms_admin_forms (
        form_id, tenant_id, carrier_code, authority, form_number, form_title,
        edition_date, form_type, line_of_business, workflow_status, active
      )
     VALUES ($1,$2,'SAMPLE','ISO',$3,'Personal Auto Test Form',
        '2026-01-01','Declarations','personal-auto','Approved',true
      )
     ON CONFLICT (tenant_id, carrier_code, authority, form_number, edition_date)
     DO UPDATE SET workflow_status = 'Approved', active = true`,
    [formId, tenantId, formNumber],
  )
  await db!.query(
    `INSERT INTO forms_admin_applicability (
        tenant_id, form_id, line_of_business, product_code, transaction_types, active
      )
     VALUES ($1,$2,'personal-auto','personal-auto',ARRAY['NB']::text[],true)
     ON CONFLICT DO NOTHING`,
    [tenantId, formId],
  )
  await db!.query(
    `INSERT INTO forms_admin_jurisdictions (
        tenant_id, form_id, state_code, regulatory_status, effective_date
      )
     VALUES ($1,$2,'CA','Approved','2026-01-01')
     ON CONFLICT DO NOTHING`,
    [tenantId, formId],
  )
  await db!.query(
    `INSERT INTO forms_admin_delivery (
        tenant_id, form_id, delivery_methods, visibility, active
      )
     VALUES ($1,$2,ARRAY['portal']::text[],$3::text[],true)
     ON CONFLICT (tenant_id, form_id)
     DO UPDATE SET visibility = $3::text[], active = true`,
    [tenantId, formId, visibility],
  )
  return formId
}

function quotePayload(customerName: string, vin: string) {
  const [firstName, lastName] = customerName.split(' ')
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName, lastName, email: `${firstName.toLowerCase()}@example.com` },
    insureds: { primary: { firstName, lastName, displayName: customerName } },
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
    ],
  }
}

async function createCustomer(tenantId: string, customerKey: string, displayName: string) {
  const customerId = crypto.randomUUID()
  await getDb()!.query(
    `INSERT INTO customers (customer_id, tenant_id, customer_key, entity_type, status, display_name, metadata)
     VALUES ($1::uuid,$2,$3,'INDIVIDUAL','ACTIVE',$4,'{}'::jsonb)`,
    [customerId, tenantId, customerKey, displayName],
  )
  return { customerId, customerKey, displayName }
}

async function createIssuedPolicy(
  tenantId: string,
  customer: { customerId: string; displayName: string },
  vin: string,
) {
  const quote = await createOrRateQuote({} as any, tenantId, quotePayload(customer.displayName, vin), null, 'integration-test')
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
  await withTenantTx(tenantId, (db) =>
    issuePolicy(db, tenantId, bound.policyId, {}, {
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

async function login(username: string, tenantId: string) {
  const res = await request(app).post('/auth/login').send({ tenantId, username, password }).expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authGet(path: string, token: string, tenantId: string) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}

async function fetchOnlyDocumentId(tenantId: string, policyId: string): Promise<{ documentId: string; hash: string }> {
  const rows = await getDb()!.query(
    `SELECT document_id, hash FROM documents WHERE tenant_id = $1 AND policy_id = $2::uuid AND type = 'POLICY_PACKET'`,
    [tenantId, policyId],
  )
  expect(rows.rowCount).toBe(1)
  return { documentId: String(rows.rows[0].document_id), hash: String(rows.rows[0].hash) }
}

describe('policy document artifact storage and retrieval', () => {
  afterEach(async () => {
    // Forms are matched by tenant/product/transaction type only, so leftover
    // forms from an earlier test would otherwise bleed into a later test's
    // form selection within this same suite run.
    const db = getDb()
    if (db && seededFormIds.length) {
      for (const formId of seededFormIds) {
        await db.query(`DELETE FROM forms_admin_forms WHERE form_id = $1::uuid`, [formId])
      }
    }
    seededFormIds = []
  })

  afterAll(async () => {
    await closeDb()
  })

  it('renders and stores a real artifact whose hash matches the retrieved content', async () => {
    await initDb()
    const tenantId = 'sample-carrier'
    await ensureTenant(tenantId, 'Sample Carrier')
    const run = suffix()
    await seedForm(tenantId, `PA-DEC-${run}`, ['internal', 'customer'])

    const customer = await createCustomer(tenantId, `CUST-SAFE-${run}`, 'Ada Lovelace')
    const policy = await createIssuedPolicy(tenantId, customer, `VINSAFE${run}`)
    const { documentId, hash } = await fetchOnlyDocumentId(tenantId, policy.policyId)

    await createUser({ username: `agent-${run}`, password, tenantId, roles: ['agent'] })
    const agentToken = await login(`agent-${run}`, tenantId)

    const listRes = await authGet(`/api/v1/policies/${policy.policyId}/documents`, agentToken, tenantId).expect(200)
    const packetEntry = listRes.body.data.documents.find((doc: any) => doc.documentId === documentId)
    expect(packetEntry).toMatchObject({ customerSafe: true, contentType: 'text/html; charset=utf-8' })
    expect(packetEntry.byteSize).toBeGreaterThan(0)

    const contentRes = await authGet(
      `/api/v1/policies/${policy.policyId}/documents/${documentId}/content`,
      agentToken,
      tenantId,
    ).expect(200)
    expect(contentRes.headers['content-type']).toContain('text/html')
    const actualHash = crypto.createHash('sha256').update(contentRes.text).digest('hex')
    expect(actualHash).toBe(hash)
    expect(contentRes.text).toContain(policy.policyNumber)
  })

  it('denies customer retrieval of an internal-only document but allows a customer-safe one', async () => {
    await initDb()
    const tenantId = 'sample-carrier'
    await ensureTenant(tenantId, 'Sample Carrier')
    const run = suffix()
    await seedForm(tenantId, `PA-SAFE-${run}`, ['internal', 'customer'])

    const customer = await createCustomer(tenantId, `CUST-MIX-${run}`, 'Grace Hopper')
    const safePolicy = await createIssuedPolicy(tenantId, customer, `VINGRC1${run}`)
    const { documentId: safeDocId } = await fetchOnlyDocumentId(tenantId, safePolicy.policyId)

    // A second policy whose only matching form is internal-only.
    const run2 = suffix()
    await seedForm(tenantId, `PA-INTERNAL-${run2}`, ['internal'])
    const internalPolicy = await createIssuedPolicy(tenantId, customer, `VINGRC2${run2}`)
    const { documentId: internalDocId } = await fetchOnlyDocumentId(tenantId, internalPolicy.policyId)

    await createUser({
      username: `portal-grace-${run}`,
      password,
      tenantId,
      roles: ['customer'],
      customerRef: customer.customerKey,
    })
    const customerToken = await login(`portal-grace-${run}`, tenantId)

    const safeContentRes = await authGet(
      `/api/v1/policies/${safePolicy.policyId}/documents/${safeDocId}/content`,
      customerToken,
      tenantId,
    ).expect(200)
    expect(safeContentRes.headers['content-type']).toContain('text/html')

    await authGet(
      `/api/v1/policies/${internalPolicy.policyId}/documents/${internalDocId}/content`,
      customerToken,
      tenantId,
    ).expect(403)

    const internalListRes = await authGet(
      `/api/v1/policies/${internalPolicy.policyId}/documents`,
      customerToken,
      tenantId,
    ).expect(200)
    expect(internalListRes.body.data.documents.find((doc: any) => doc.documentId === internalDocId)).toBeUndefined()
    expect(internalListRes.body.data.documents.every((doc: any) => doc.customerSafe === true)).toBe(true)
  })

  it('denies document access for a customer not linked to the policy', async () => {
    await initDb()
    const tenantId = 'sample-carrier'
    await ensureTenant(tenantId, 'Sample Carrier')
    const run = suffix()
    await seedForm(tenantId, `PA-OWNER-${run}`, ['internal', 'customer'])

    const owner = await createCustomer(tenantId, `CUST-OWNER-${run}`, 'Owner Customer')
    const stranger = await createCustomer(tenantId, `CUST-STRANGER-${run}`, 'Stranger Customer')
    const policy = await createIssuedPolicy(tenantId, owner, `VINOWN${run}`)
    const { documentId } = await fetchOnlyDocumentId(tenantId, policy.policyId)

    await createUser({
      username: `portal-stranger-${run}`,
      password,
      tenantId,
      roles: ['customer'],
      customerRef: stranger.customerKey,
    })
    const strangerToken = await login(`portal-stranger-${run}`, tenantId)

    await authGet(`/api/v1/policies/${policy.policyId}/documents`, strangerToken, tenantId).expect(404)
    await authGet(
      `/api/v1/policies/${policy.policyId}/documents/${documentId}/content`,
      strangerToken,
      tenantId,
    ).expect(404)
  })
})
