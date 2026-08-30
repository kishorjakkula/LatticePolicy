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

function authReq(method: 'get' | 'post', path: string, token: string) {
  return (request(app) as any)[method](path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}

async function seedPolicyWithTransactionAndRisk(
  run: string,
  productCode: string,
  stateCode: string,
  premiumTotal: number,
  effectiveDate: string
) {
  const db = getDb()!
  const policyResult = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,'Issued',$3,$4,'2026-01-01','2027-01-01')
     RETURNING policy_id`,
    [tenantId, `BX-${run}`, productCode, stateCode]
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

  await db.query(
    `INSERT INTO risk_units (tenant_id, policy_id, transaction_id, kind, attributes, effective_date)
     VALUES ($1,$2,$3,'Vehicle','{"vin":"1HGCM82633A004352"}'::jsonb,$4)`,
    [tenantId, policyId, transactionId, effectiveDate]
  )

  return { policyId, transactionId }
}

async function seedCancelledTransactionWithClaimReference(
  run: string,
  productCode: string,
  claimReference: string | null,
  effectiveDate: string
) {
  const db = getDb()!
  const policyResult = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,'Cancelled',$3,'NY','2026-01-01','2027-01-01')
     RETURNING policy_id`,
    [tenantId, `BX-CLM-${run}`, productCode]
  )
  const policyId = policyResult.rows[0].policy_id

  const txnResult = await db.query(
    `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
     VALUES ($1,$2,'Cancel','Issued',$3)
     RETURNING transaction_id`,
    [tenantId, policyId, effectiveDate]
  )
  const transactionId = txnResult.rows[0].transaction_id

  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, transaction_id, effective_date, transaction_type, premium_total, claim_reference)
     VALUES ($1,$2,$3,$4,'Cancel',0,$5)`,
    [tenantId, policyId, transactionId, effectiveDate, claimReference]
  )

  return { policyId, transactionId }
}

describe('bordereaux generation and validation (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('generates a risk bordereau from persisted risk units', async () => {
    const run = suffix()
    const productCode = `bx-risk-product-${run}`

    await createUser({ username: `bordereaux-risk-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`bordereaux-risk-${run}`)

    await seedPolicyWithTransactionAndRisk(run, productCode, 'NY', 8000, '2026-03-01')

    const generated = await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({ bordereauType: 'RISK', periodStart: '2026-01-01', periodEnd: '2026-12-31', productCode })
      .expect(201)

    expect(generated.body.bordereauType).toBe('RISK')
    expect(generated.body.rowCount).toBe(1)
    expect(generated.body.validRowCount).toBe(1)
    expect(generated.body.invalidRowCount).toBe(0)

    const rows = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/rows`, token).expect(200)
    expect(rows.body.items).toHaveLength(1)
    expect(rows.body.items[0]).toMatchObject({ isValid: true })
    expect(rows.body.items[0].data.riskKind).toBe('Vehicle')

    const csv = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/export?format=csv`, token).expect(200)
    expect(csv.text).toContain('riskKind')
    expect(csv.text).toContain('Vehicle')
  })

  it('generates a transaction/premium-impact bordereau with reinsurance placement fields when available', async () => {
    const run = suffix()
    const productCode = `bx-txn-product-${run}`

    await createUser({ username: `bordereaux-txn-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`bordereaux-txn-${run}`)

    await authReq('post', '/api/v1/admin/reinsurance/treaties', token)
      .send({
        treatyName: `Bordereaux Treaty ${run}`,
        treatyType: 'QUOTA_SHARE',
        effectiveDate: '2026-01-01',
        expirationDate: '2027-01-01',
        productCodes: [productCode],
        layers: [{ cededPercent: 25, retainedPercent: 75, participants: [{ reinsurerName: 'BX Re', participationPercent: 100 }] }]
      })
      .expect(201)

    const { policyId, transactionId } = await seedPolicyWithTransactionAndRisk(run, productCode, 'CA', 10000, '2026-04-01')

    await authReq('post', `/api/v1/admin/reinsurance/policies/${policyId}/transactions/${transactionId}/compute`, token).expect(200)

    const generated = await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({ bordereauType: 'PREMIUM', periodStart: '2026-01-01', periodEnd: '2026-12-31', productCode })
      .expect(201)

    expect(generated.body.rowCount).toBe(1)
    expect(generated.body.validRowCount).toBe(1)

    const rows = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/rows`, token).expect(200)
    expect(rows.body.items[0].data.premiumTotal).toBe(10000)
    expect(rows.body.items[0].data.cededPercent).toBe(25)
    expect(rows.body.items[0].data.cededPremium).toBe(2500)
  })

  it('generates a claims-reference-handoff bordereau distinct from the generic transaction bordereau', async () => {
    const run = suffix()
    const productCode = `bx-claim-product-${run}`

    await createUser({ username: `bordereaux-claim-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`bordereaux-claim-${run}`)

    await seedCancelledTransactionWithClaimReference(run, productCode, 'CLM-2026-000123', '2026-05-01')
    // A second transaction with no claim reference must be excluded from the
    // claims-handoff bordereau entirely, not reported with a null reference.
    await seedCancelledTransactionWithClaimReference(`${run}-none`, productCode, null, '2026-05-02')

    const generated = await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({ bordereauType: 'CLAIMS_REFERENCE_HANDOFF', periodStart: '2026-01-01', periodEnd: '2026-12-31', productCode })
      .expect(201)

    expect(generated.body.rowCount).toBe(1)
    expect(generated.body.validRowCount).toBe(1)
    expect(generated.body.invalidRowCount).toBe(0)

    const rows = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/rows`, token).expect(200)
    expect(rows.body.items).toHaveLength(1)
    expect(rows.body.items[0].data.claimReference).toBe('CLM-2026-000123')
    // Distinct from the generic TRANSACTION/PREMIUM row shape: no premium fields.
    expect(rows.body.items[0].data.premiumTotal).toBeUndefined()
    expect(rows.body.items[0].data.cancellationReasonCode).toBeUndefined()

    const csv = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/export?format=csv`, token).expect(200)
    expect(csv.text).toContain('claimReference')
    expect(csv.text).toContain('CLM-2026-000123')
    expect(csv.text).not.toContain('premiumTotal')
  })

  it('flags invalid rows instead of dropping them, and tracks corrections', async () => {
    const run = suffix()
    const productCode = `bx-invalid-product-${run}`

    await createUser({ username: `bordereaux-invalid-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`bordereaux-invalid-${run}`)

    const db = getDb()!
    const policyResult = await db.query(
      `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
       VALUES ($1,$2,'Issued',$3,'NY','2026-01-01','2027-01-01')
       RETURNING policy_id`,
      [tenantId, `BX-INV-${run}`, productCode]
    )
    const policyId = policyResult.rows[0].policy_id
    const txnResult = await db.query(
      `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
       VALUES ($1,$2,'NB','Issued','2026-05-01') RETURNING transaction_id`,
      [tenantId, policyId]
    )
    const transactionId = txnResult.rows[0].transaction_id
    // policy_versions row intentionally omits premium_total to produce an invalid row.
    await db.query(
      `INSERT INTO policy_versions (tenant_id, policy_id, transaction_id, effective_date, transaction_type)
       VALUES ($1,$2,$3,'2026-05-01','NB')`,
      [tenantId, policyId, transactionId]
    )

    const generated = await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({ bordereauType: 'TRANSACTION', periodStart: '2026-01-01', periodEnd: '2026-12-31', productCode })
      .expect(201)
    expect(generated.body.rowCount).toBe(1)
    expect(generated.body.validRowCount).toBe(0)
    expect(generated.body.invalidRowCount).toBe(1)

    const rows = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}/rows`, token).expect(200)
    expect(rows.body.items[0].isValid).toBe(false)
    expect(rows.body.items[0].validationErrors).toContain('premiumTotal is required')

    const corrected = await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({
        bordereauType: 'CORRECTION',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        productCode,
        correctsBatchId: generated.body.batchId
      })
      .expect(201)
    expect(corrected.body.correctsBatchId).toBe(generated.body.batchId)

    const priorBatch = await authReq('get', `/api/v1/admin/bordereaux/batches/${generated.body.batchId}`, token).expect(200)
    expect(priorBatch.body.status).toBe('Corrected')
  })

  it('denies bordereaux generation to a user without admin.bordereaux.manage', async () => {
    const run = suffix()
    await createUser({ username: `bordereaux-agent-${run}`, password, tenantId, roles: ['agent'] })
    const token = await login(`bordereaux-agent-${run}`)

    await authReq('post', '/api/v1/admin/bordereaux/batches', token)
      .send({ bordereauType: 'RISK', periodStart: '2026-01-01', periodEnd: '2026-12-31' })
      .expect(403)

    await authReq('get', '/api/v1/admin/bordereaux/batches', token).expect(403)
  })
})
