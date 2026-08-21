import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { computeExposureSummary, loadExposureRows } from '../services/exposure.service.js'

const app = createApp()
const tenantId = 'sample-carrier'
const otherTenantId = 'exposure-other-tenant'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant(id: string) {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [id, id, 'en-US', 'USD'],
  )
}

async function login(username: string, forTenantId: string) {
  const res = await request(app)
    .post('/auth/login')
    .send({ tenantId: forTenantId, username, password })
    .expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authReq(method: 'get', path: string, token: string, forTenantId = tenantId) {
  return (request(app) as any)[method](path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', forTenantId)
}

async function seedPolicy(opts: {
  forTenantId: string
  policyNumber: string
  status: string
  productCode: string
  state: string
  risks: any[]
  coverages: any[]
}) {
  const db = getDb()!
  const policyRes = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,$3,$4,$5,'2026-01-01','2027-01-01')
     RETURNING policy_id`,
    [opts.forTenantId, opts.policyNumber, opts.status, opts.productCode, opts.state],
  )
  const policyId = policyRes.rows[0].policy_id
  const payload = { productCode: opts.productCode, state: opts.state, risks: opts.risks, coverages: opts.coverages }
  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, effective_date, transaction_type, payload)
     VALUES ($1,$2,'2026-01-01','NB',$3::jsonb)`,
    [opts.forTenantId, policyId, JSON.stringify(payload)],
  )
  return policyId
}

async function cleanup() {
  const db = getDb()
  if (!db) return
  await db.query(`DELETE FROM policy_versions WHERE tenant_id IN ($1,$2) AND policy_id IN (SELECT policy_id FROM policies WHERE policy_number LIKE 'EXP-%')`, [tenantId, otherTenantId])
  await db.query(`DELETE FROM policies WHERE tenant_id IN ($1,$2) AND policy_number LIKE 'EXP-%'`, [tenantId, otherTenantId])
}

describe('exposure management (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant(tenantId)
    await ensureTenant(otherTenantId)
    await cleanup()
  })

  afterAll(async () => {
    await cleanup()
    await closeDb()
  })

  it('aggregates in-force exposure by product/state and excludes non-issued and cross-tenant policies', async () => {
    const run = suffix()

    await seedPolicy({
      forTenantId: tenantId,
      policyNumber: `EXP-PA-${run}`,
      status: 'Issued',
      productCode: 'personal-auto',
      state: 'TX',
      risks: [
        { type: 'autoVehicle', garagingZip: '75201', year: 2021, make: 'Honda', model: 'Civic' },
        { type: 'autoVehicle', garagingZip: '75201', year: 2019, make: 'Ford', model: 'F150' },
      ],
      coverages: [{ code: 'BI', selected: true, limit: 100000 }],
    })

    await seedPolicy({
      forTenantId: tenantId,
      policyNumber: `EXP-HO-${run}`,
      status: 'Issued',
      productCode: 'homeowners',
      state: 'FL',
      risks: [{ type: 'dwelling', address: '1 Ocean Dr, Miami, FL 33139', construction: 'frame', yearBuilt: 2005 }],
      coverages: [{ code: 'DwellingA', selected: true, limit: 400000 }],
    })

    // A quote (not yet issued) must not appear in exposure.
    await seedPolicy({
      forTenantId: tenantId,
      policyNumber: `EXP-QUOTE-${run}`,
      status: 'Quote',
      productCode: 'personal-auto',
      state: 'TX',
      risks: [{ type: 'autoVehicle', garagingZip: '75201', year: 2022, make: 'Kia', model: 'Rio' }],
      coverages: [],
    })

    // A different tenant's issued policy must not leak into this tenant's summary.
    await seedPolicy({
      forTenantId: otherTenantId,
      policyNumber: `EXP-OTHER-${run}`,
      status: 'Issued',
      productCode: 'personal-auto',
      state: 'CA',
      risks: [{ type: 'autoVehicle', garagingZip: '90001', year: 2020, make: 'Nissan', model: 'Altima' }],
      coverages: [{ code: 'BI', selected: true, limit: 250000 }],
    })

    const summary = await computeExposureSummary(getDb() as any, tenantId, {})
    const testRows = summary.byProduct.filter((g) => g.key === 'personal-auto' || g.key === 'homeowners')
    expect(testRows.length).toBeGreaterThan(0)

    const paGroup = summary.byProduct.find((g) => g.key === 'personal-auto')
    expect(paGroup).toBeTruthy()
    expect(paGroup!.policyCount).toBeGreaterThanOrEqual(1)

    // Only the Issued personal-auto policy counts — the TX Quote is excluded.
    const txGroup = summary.byState.find((g) => g.key === 'TX')
    expect(txGroup).toBeTruthy()
    expect(txGroup!.policyCount).toBeGreaterThanOrEqual(1)

    // Tenant isolation: the other tenant's issued policy must never appear in
    // this tenant's rows, even though it shares the shared-tenant integration
    // suite's DB. Do not assert "no CA group at all" here — other integration
    // test files also seed CA policies for this same shared tenant.
    const rows = await loadExposureRows(getDb() as any, tenantId, {})
    expect(rows.some((r) => r.policyNumber === `EXP-OTHER-${run}`)).toBe(false)
  })

  it('scopes the summary API to a productCode filter and enforces admin.exposure.read', async () => {
    const run = suffix()
    await seedPolicy({
      forTenantId: tenantId,
      policyNumber: `EXP-CY-${run}`,
      status: 'Issued',
      productCode: 'cyber',
      state: 'NY',
      risks: [{ type: 'cyberProfile', annualRevenue: 1000000, recordsCount: 20000 }],
      coverages: [],
    })

    await createUser({ username: `exposure-admin-${run}`, password, tenantId, roles: ['admin'] })
    const adminToken = await login(`exposure-admin-${run}`, tenantId)

    const res = await authReq('get', `/api/v1/admin/exposure/summary?productCode=cyber`, adminToken).expect(200)
    expect(res.body.byProduct.every((g: any) => g.key === 'cyber')).toBe(true)
    expect(res.body.byProduct.find((g: any) => g.key === 'cyber').policyCount).toBeGreaterThanOrEqual(1)

    await createUser({ username: `exposure-agent-${run}`, password, tenantId, roles: ['agent'] })
    const agentToken = await login(`exposure-agent-${run}`, tenantId)
    await authReq('get', '/api/v1/admin/exposure/summary', agentToken).expect(403)
  })
})
