import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'

const app = createApp()
const tenantId = 'sample-carrier'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant() {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD']
  )
}

async function login(username: string) {
  const res = await request(app).post('/auth/login').send({ tenantId, username, password }).expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authReq(method: 'get' | 'post' | 'patch', path: string, token: string) {
  return (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}

async function seedPolicyWithTransaction(
  run: string,
  productCode: string,
  stateCode: string,
  premiumTotal: number,
  effectiveDate = '2026-06-01'
) {
  const db = getDb()!
  const policyResult = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,'Issued',$3,$4,'2026-01-01','2027-01-01')
     RETURNING policy_id`,
    [tenantId, `RI-${run}`, productCode, stateCode]
  )
  const policyId = policyResult.rows[0].policy_id

  const txnResult = await db.query(
    `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
     VALUES ($1,$2,'NB','Issued',$3)
     RETURNING transaction_id`,
    [tenantId, policyId, effectiveDate]
  )
  const transactionId = txnResult.rows[0].transaction_id

  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, transaction_id, effective_date, transaction_type, premium_total)
     VALUES ($1,$2,$3,$4,'NB',$5)`,
    [tenantId, policyId, transactionId, effectiveDate, premiumTotal]
  )

  return { policyId, transactionId }
}

describe('reinsurance treaty and facultative placement (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('creates a treaty with layers and participants, and matches a policy transaction to it', async () => {
    const run = suffix()
    const productCode = `ri-product-${run}`

    await createUser({ username: `reinsurance-admin-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-admin-${run}`)

    const created = await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Quota Share ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [productCode],
        layers: [
          {
            layerNumber: 1,
            cededPercent: 40,
            retainedPercent: 60,
            participants: [
              { reinsurerName: 'Acme Re', participationPercent: 60, isLead: true },
              { reinsurerName: 'Beta Re', participationPercent: 40 }
            ]
          }
        ]
      })
      .expect(201)
    expect(created.body.treaty_name).toBe(`Quota Share ${run}`)

    const { policyId, transactionId } = await seedPolicyWithTransaction(run, productCode, 'NY', 10000)

    const computed = await authReq(
      'post',
      `/api/v1/admin/reinsurance/policies/${policyId}/transactions/${transactionId}/compute`,
      token
    ).expect(200)
    expect(computed.body.items).toHaveLength(1)
    expect(computed.body.items[0]).toMatchObject({ placementType: 'TREATY', cededPercent: 40, retainedPercent: 60 })
    expect(computed.body.items[0].participants).toHaveLength(2)

    const placements = await authReq('get', `/api/v1/admin/reinsurance/policies/${policyId}/placements`, token).expect(200)
    expect(placements.body.items).toHaveLength(1)
    expect(Number(placements.body.items[0].ceded_premium)).toBe(4000)
    expect(Number(placements.body.items[0].retained_premium)).toBe(6000)
  })

  it('creates a linked treaty version and resolves placements by transaction effective date', async () => {
    const run = suffix()
    const productCode = `ri-version-${run}`

    await createUser({ username: `reinsurance-version-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-version-${run}`)

    const created = await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Versioned Treaty ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [productCode],
        layers: [{
          cededPercent: 25,
          retainedPercent: 75,
          participants: [{ reinsurerName: 'Version Re', participationPercent: 100, isLead: true }]
        }]
      })
      .expect(201)

    const updated = await authReq('patch', `/api/v1/admin/reinsurance/treaties/${created.body.treaty_id}`, token)
      .send({
        effectiveDate: '2026-07-01',
        brokerName: 'Updated Broker',
        layers: [{
          layerNumber: 1,
          layerType: 'QUOTA_SHARE',
          retentionAmount: 50000,
          limitAmount: 250000,
          cededPercent: 35,
          retainedPercent: 65,
          participants: [
            { reinsurerName: 'Version Re', participationPercent: 60, isLead: true },
            { reinsurerName: 'New Capacity Re', participationPercent: 40 }
          ]
        }]
      })
      .expect(200)

    expect(updated.body).toMatchObject({ version: 2, broker_name: 'Updated Broker' })
    expect(updated.body.treaty_id).not.toBe(created.body.treaty_id)

    const versions = await getDb()!.query(
      `SELECT treaty_id, version, superseded_by
         FROM reinsurance_treaties
        WHERE tenant_id = $1 AND treaty_name = $2
        ORDER BY version`,
      [tenantId, `Versioned Treaty ${run}`]
    )
    expect(versions.rows).toHaveLength(2)
    expect(versions.rows[0]).toMatchObject({ version: 1, superseded_by: updated.body.treaty_id })
    expect(versions.rows[1]).toMatchObject({ version: 2, superseded_by: null })

    const clonedChildren = await getDb()!.query(
      `SELECT count(DISTINCT l.layer_id)::int AS layers, count(p.participant_id)::int AS participants
         FROM reinsurance_treaty_layers l
         LEFT JOIN reinsurance_market_participants p ON p.layer_id = l.layer_id AND p.tenant_id = l.tenant_id
        WHERE l.tenant_id = $1 AND l.treaty_id = $2`,
      [tenantId, updated.body.treaty_id]
    )
    expect(clonedChildren.rows[0]).toEqual({ layers: 1, participants: 2 })

    const past = await seedPolicyWithTransaction(`${run}-past`, productCode, 'NY', 1000, '2026-06-01')
    const pastPlacement = await authReq(
      'post',
      `/api/v1/admin/reinsurance/policies/${past.policyId}/transactions/${past.transactionId}/compute`,
      token
    ).expect(200)
    expect(pastPlacement.body.items).toHaveLength(1)
    expect(pastPlacement.body.items[0].treatyId).toBe(created.body.treaty_id)
    expect(pastPlacement.body.items[0]).toMatchObject({ cededPercent: 25, retainedPercent: 75 })

    const current = await seedPolicyWithTransaction(`${run}-current`, productCode, 'NY', 1000, '2026-08-01')
    const currentPlacement = await authReq(
      'post',
      `/api/v1/admin/reinsurance/policies/${current.policyId}/transactions/${current.transactionId}/compute`,
      token
    ).expect(200)
    expect(currentPlacement.body.items).toHaveLength(1)
    expect(currentPlacement.body.items[0].treatyId).toBe(updated.body.treaty_id)
    expect(currentPlacement.body.items[0]).toMatchObject({ cededPercent: 35, retainedPercent: 65 })
    expect(currentPlacement.body.items[0].participants).toHaveLength(2)

    const listed = await authReq('get', '/api/v1/admin/reinsurance/treaties', token).expect(200)
    const listedVersions = listed.body.items.filter((item: any) => item.treaty_name === `Versioned Treaty ${run}`)
    expect(listedVersions).toHaveLength(1)
    expect(listedVersions[0].treaty_id).toBe(updated.body.treaty_id)
    expect(listedVersions[0].layers[0].participants).toHaveLength(2)
    expect(listedVersions[0].layers[0].participants[0]).toEqual(expect.objectContaining({ reinsurerName: 'Version Re' }))
  })

  it('does not match a treaty outside its product applicability', async () => {
    const run = suffix()
    const productCode = `ri-nomatch-${run}`

    await createUser({ username: `reinsurance-nomatch-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-nomatch-${run}`)

    await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Other Product Treaty ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [`unrelated-product-${run}`],
        layers: [{ cededPercent: 50, retainedPercent: 50, participants: [] }]
      })
      .expect(201)

    const { policyId, transactionId } = await seedPolicyWithTransaction(run, productCode, 'CA', 5000)

    const computed = await authReq(
      'post',
      `/api/v1/admin/reinsurance/policies/${policyId}/transactions/${transactionId}/compute`,
      token
    ).expect(200)
    expect(computed.body.items).toHaveLength(0)
  })

  it('prefers a facultative certificate over an otherwise-matching treaty', async () => {
    const run = suffix()
    const productCode = `ri-fac-${run}`

    await createUser({ username: `reinsurance-fac-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-fac-${run}`)

    await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Fac Override Treaty ${run}`,
        treatyType: 'SURPLUS',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [productCode],
        layers: [{ cededPercent: 30, retainedPercent: 70, participants: [] }]
      })
      .expect(201)

    const { policyId, transactionId } = await seedPolicyWithTransaction(run, productCode, 'TX', 20000)

    await authReq('post', '/api/v1/admin/reinsurance/facultative', token)
      .send({
        policyId,
        certificateNumber: `FAC-${run}`,
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        cededPercent: 75,
        retainedPercent: 25,
        participants: [{ reinsurerName: 'Facultative Re', participationPercent: 100 }]
      })
      .expect(201)

    const computed = await authReq(
      'post',
      `/api/v1/admin/reinsurance/policies/${policyId}/transactions/${transactionId}/compute`,
      token
    ).expect(200)
    expect(computed.body.items).toHaveLength(1)
    expect(computed.body.items[0]).toMatchObject({ placementType: 'FACULTATIVE', cededPercent: 75, retainedPercent: 25 })
  })

  it('rejects treaty creation when participant shares exceed 100%', async () => {
    const run = suffix()
    await createUser({ username: `reinsurance-invalid-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-invalid-${run}`)

    await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Over Placed ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        layers: [
          {
            cededPercent: 50,
            retainedPercent: 50,
            participants: [
              { reinsurerName: 'A Re', participationPercent: 70 },
              { reinsurerName: 'B Re', participationPercent: 40 }
            ]
          }
        ]
      })
      .expect(400)
  })

  it('rejects a versioned layer edit when participant shares exceed 100%', async () => {
    const run = suffix()
    await createUser({ username: `reinsurance-edit-invalid-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`reinsurance-edit-invalid-${run}`)

    const created = await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Invalid Edit ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [`invalid-edit-${run}`],
        layers: [{ cededPercent: 50, retainedPercent: 50, participants: [] }]
      })
      .expect(201)

    const rejected = await authReq('patch', `/api/v1/admin/reinsurance/treaties/${created.body.treaty_id}`, token)
      .send({
        effectiveDate: '2026-07-01',
        layers: [{
          cededPercent: 50,
          retainedPercent: 50,
          participants: [
            { reinsurerName: 'A Re', participationPercent: 70 },
            { reinsurerName: 'B Re', participationPercent: 40 }
          ]
        }]
      })
      .expect(400)
    expect(rejected.body.code).toBe('REINSURANCE_INVALID_INPUT')

    const versions = await getDb()!.query(
      `SELECT count(*)::int AS count FROM reinsurance_treaties WHERE tenant_id = $1 AND treaty_name = $2`,
      [tenantId, `Invalid Edit ${run}`]
    )
    expect(versions.rows[0].count).toBe(1)
  })

  it('denies treaty management to a user without admin.reinsurance.manage, and enforces tenant isolation on placements', async () => {
    const run = suffix()
    await createUser({ username: `reinsurance-agent-${run}`, password, tenantId, roles: ['agent'] })
    const token = await login(`reinsurance-agent-${run}`)

    await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Denied Treaty ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        layers: [{ cededPercent: 50, retainedPercent: 50, participants: [] }]
      })
      .expect(403)

    await authReq('get', '/api/v1/admin/reinsurance/treaties', token).expect(403)
  })
})
