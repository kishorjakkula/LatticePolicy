import crypto from 'node:crypto'
import request from 'supertest'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { initDb, closeDb, getDb, withTenantTx, toRawQuery, TENANT_RLS_ROLE } from '../db.js'
import { createUser } from '../users.js'
import { createApp } from '../app.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'

const tenant = 'sample-carrier'
const app = createApp()
let token = ''
let contactToken = ''
let actorId = ''
const addresses = [
  { addressType: 'mailing', line1: '20 Synthetic Street', line2: 'APT 4B', city: 'Boston', state: 'MA', postalCode: '02108-1234', country: 'US', primary: true },
  { addressType: 'business', line1: '30 Example Avenue', line2: 'STE 200', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US', primary: false },
]
beforeAll(async () => {
  if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true' || !new URL(process.env.DATABASE_URL!).pathname.includes('integration')) throw new Error('Fresh disposable integration database required')
  await initDb()
  await getDb()!.query('INSERT INTO tenants(tenant_id,name) VALUES($1,$1) ON CONFLICT DO NOTHING', [tenant])
  const username = `address-${crypto.randomUUID()}`
  await createUser({ username, tenantId: tenant, password: 'synthetic-test-password', roles: ['admin'] })
  const login = await request(app).post('/auth/login').send({ username, tenantId: tenant, password: 'synthetic-test-password' }).expect(200)
  token = login.body.token; actorId = login.body.user.id
  const contactUsername = `contact-${crypto.randomUUID()}`
  await createUser({ username: contactUsername, tenantId: tenant, password: 'synthetic-test-password', roles: ['customer_service'] })
  const contactLogin = await request(app).post('/auth/login').send({ username: contactUsername, tenantId: tenant, password: 'synthetic-test-password' }).expect(200)
  contactToken = contactLogin.body.token
  expect(contactLogin.body.user.permissions).toContain('admin.customers.contact.manage')
  expect(contactLogin.body.user.permissions).not.toContain('admin.customers.manage')
})
afterAll(closeDb)

it('persists multiple customer addresses independently from email and mobile under tenant RLS', async () => {
  const role = await withTenantTx(tenant, db => toRawQuery(db)('SELECT current_user AS role'))
  expect(role.rows[0].role).toBe(TENANT_RLS_ROLE)
  const created = await request(app).post('/api/v1/admin/customers').set('Authorization', `Bearer ${token}`).set('X-Tenant', tenant).send({
    entityType: 'INDIVIDUAL', createAnyway: true,
    identity: { person: { firstName: 'Synthetic', lastName: `Address-${crypto.randomUUID()}`, dob: '1980-01-01' } },
    contactPoints: [{ contactType: 'EMAIL', value: `synthetic-${crypto.randomUUID()}@example.com`, preferred: true }, { contactType: 'PHONE', subType: 'mobile', value: '2025550148', preferred: true }], addresses,
  }).expect(201)
  const id = created.body.customerId
  const loaded = await request(app).get(`/api/v1/admin/customers/${id}`).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenant).expect(200)
  expect(loaded.body.addresses).toHaveLength(2)
  for (const a of addresses) expect(loaded.body.addresses).toContainEqual(expect.objectContaining({ ...a, addressType: a.addressType.toUpperCase() }))
  expect(loaded.body.contactPoints).toContainEqual(expect.objectContaining({ contactType: 'PHONE', subType: 'mobile', value: '2025550148' }))
  for (const a of loaded.body.addresses) { expect(a).not.toHaveProperty('email'); expect(a).not.toHaveProperty('phone') }
  const sensitiveBefore = await getDb()!.query('SELECT dob_encrypted,dob_hash FROM customer_person_details WHERE tenant_id=$1 AND customer_id=$2', [tenant, id])
  const edited = { ...loaded.body, addresses: loaded.body.addresses.map((a: any, i: number) => i === 0 ? { ...a, line2: 'APT 99' } : a), expectedVersion: loaded.body.version }
  await request(app).patch(`/api/v1/admin/customers/${id}`).set('Authorization', `Bearer ${contactToken}`).set('X-Tenant', tenant).send(edited).expect(200)
  const sensitiveAfter = await getDb()!.query('SELECT dob_encrypted,dob_hash FROM customer_person_details WHERE tenant_id=$1 AND customer_id=$2', [tenant, id])
  expect(sensitiveAfter.rows).toEqual(sensitiveBefore.rows)
  expect(sensitiveAfter.rows[0].dob_encrypted).toBeTruthy()
})

it('rejects customer entity-type changes through the contact-only permission path before any writes', async () => {
  const suffix = crypto.randomUUID()
  const created = await request(app).post('/api/v1/admin/customers').set('Authorization', `Bearer ${token}`).set('X-Tenant', tenant).send({
    entityType: 'BOTH', createAnyway: true,
    identity: { person: { firstName: 'Entity', lastName: suffix, dob: '1980-01-01' }, company: { legalName: `Synthetic ${suffix}`, incorporationState: 'MA' } },
    contactPoints: [{ contactType: 'EMAIL', value: `entity-${suffix}@example.com`, preferred: true }],
  }).expect(201)
  const path = `/api/v1/admin/customers/${created.body.customerId}`
  const loaded = await request(app).get(path).set('Authorization', `Bearer ${contactToken}`).set('X-Tenant', tenant).expect(200)
  for (const entityType of ['INDIVIDUAL', 'COMPANY']) {
    const response = await request(app).patch(path).set('Authorization', `Bearer ${contactToken}`).set('X-Tenant', tenant)
      .send({ ...loaded.body, entityType, expectedVersion: loaded.body.version }).expect(403)
    expect(response.body.code).toBe('IDENTITY_EDIT_FORBIDDEN')
  }
  const unchanged = await request(app).get(path).set('Authorization', `Bearer ${contactToken}`).set('X-Tenant', tenant).expect(200)
  expect(unchanged.body.entityType).toBe('BOTH')
  expect(unchanged.body.version).toBe(loaded.body.version)
  expect(unchanged.body.identity).toEqual(loaded.body.identity)
})

it('retains all contact addresses plus single garaging address in quote-to-policy snapshots', async () => {
  const primary = { firstName: 'Synthetic', lastName: 'Address', email: 'synthetic@example.com', phone: '2025550148', addresses,
    address: { street: addresses[0].line1, line2: addresses[0].line2, city: 'Boston', state: 'MA', zip: '02108-1234', country: 'US' } }
  const payload = { productCode: 'personal-auto', effectiveDate: '2026-07-01', termMonths: 12, state: 'CA',
    applicant: { firstName: 'Synthetic', lastName: 'Address', email: primary.email }, insureds: { primary }, mailingAddress: primary.address,
    risks: [{ type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '94105', garagingAddress: { ...addresses[1], state: 'CA', postalCode: '94105' }, symbol: 'A', usage: 'commute' }],
    coverages: [{ code: 'BI', selected: true, limit: 100000 }, { code: 'PD', selected: true, limit: 50000 }],
  }
  const quote = await createOrRateQuote({} as any, tenant, payload, null, 'synthetic-address-test')
  const bound = await bindQuote({} as any, tenant, quote.quoteId, {}, 'synthetic-address-test', actorId, { roles: ['admin'], permissions: [] })
  const stored = await withTenantTx(tenant, db => toRawQuery(db)('SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1', [tenant, bound.policyId]))
  expect(stored.rows[0].payload.insureds.primary.addresses).toEqual(addresses)
  expect(stored.rows[0].payload.insureds.primary.email).toBe(primary.email)
  expect(stored.rows[0].payload.mailingAddress.line2).toBe('APT 4B')
  expect(stored.rows[0].payload.risks[0].garagingAddress.postalCode).toBe('94105')
  expect(stored.rows[0].payload.risks[0].garagingAddress).not.toBeInstanceOf(Array)
})
