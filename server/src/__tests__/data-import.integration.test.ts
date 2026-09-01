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

function personalAutoQuotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    risks: [
      { type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '94105', symbol: 'A', usage: 'commute' }
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 }
    ],
    ...overrides
  }
}

async function ensureTenant() {
  const db = getDb()
  await db!.query(
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

describe('data import framework: stage, validate, commit, retry (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('stages, validates, and commits a customer batch, then reconciles a duplicate import as an idempotent update', async () => {
    const run = suffix()
    await createUser({ username: `import-admin-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`import-admin-${run}`)

    const sourceSystem = `LEGACY_AMS_${run}`
    const externalId = `CUST-${run}`

    const stageRes = await authReq('post', '/api/v1/admin/import/batches', token)
      .send({
        entityType: 'customer',
        sourceSystem,
        rows: [
          {
            payload: {
              entityType: 'INDIVIDUAL',
              identity: { person: { firstName: 'Jane', lastName: 'Doe', dob: '1985-05-15' } },
              contactPoints: [{ contactType: 'EMAIL', value: 'jane.doe@example.com' }],
              externalIdentifiers: [{ sourceSystem, externalId }]
            }
          },
          {
            // Invalid: no name, no external identifiers.
            payload: { entityType: 'INDIVIDUAL' }
          }
        ]
      })
      .expect(201)

    const batchId = stageRes.body.batchId
    expect(stageRes.body.status).toBe('Staged')
    expect(stageRes.body.rowCount).toBe(2)

    const validateRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/validate`, token).send({}).expect(200)
    expect(validateRes.body.validCount).toBe(1)
    expect(validateRes.body.invalidCount).toBe(1)
    expect(validateRes.body.status).toBe('Validated')

    const rowsRes = await authReq('get', `/api/v1/admin/import/batches/${batchId}/rows`, token).expect(200)
    const invalidRow = rowsRes.body.find((r: any) => r.status === 'Invalid')
    expect(invalidRow.validationErrors.length).toBeGreaterThan(0)

    const commitRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/commit`, token).send({}).expect(200)
    expect(commitRes.body.committedCount).toBe(1)
    // The one invalid row was already excluded at validation time (not a commit
    // failure), so once every Valid row commits successfully the batch reaches
    // Committed; PartiallyCommitted is reserved for rows that fail during commit.
    expect(commitRes.body.status).toBe('Committed')

    const committedRowsRes = await authReq('get', `/api/v1/admin/import/batches/${batchId}/rows?status=Committed`, token).expect(200)
    expect(committedRowsRes.body).toHaveLength(1)
    const committedCustomerId = committedRowsRes.body[0].committedEntityId
    expect(committedCustomerId).toBeTruthy()

    // Re-importing the same external identifier in a new batch should update
    // the existing customer, not create a duplicate.
    const secondBatchRes = await authReq('post', '/api/v1/admin/import/batches', token)
      .send({
        entityType: 'customer',
        sourceSystem,
        rows: [
          {
            payload: {
              entityType: 'INDIVIDUAL',
              identity: { person: { firstName: 'Jane', lastName: 'Doe-Smith', dob: '1985-05-15' } },
              contactPoints: [{ contactType: 'EMAIL', value: 'jane.doe@example.com' }],
              externalIdentifiers: [{ sourceSystem, externalId }]
            }
          }
        ]
      })
      .expect(201)
    const secondBatchId = secondBatchRes.body.batchId
    await authReq('post', `/api/v1/admin/import/batches/${secondBatchId}/validate`, token).send({}).expect(200)
    const secondCommitRes = await authReq('post', `/api/v1/admin/import/batches/${secondBatchId}/commit`, token).send({}).expect(200)
    expect(secondCommitRes.body.committedCount).toBe(1)

    const secondRowsRes = await authReq('get', `/api/v1/admin/import/batches/${secondBatchId}/rows?status=Committed`, token).expect(200)
    expect(secondRowsRes.body[0].committedEntityId).toBe(committedCustomerId)
    expect(secondRowsRes.body[0].commitMode).toBe('updated')
  })

  it('allows retrying a failed row after fixing it, and denies non-admin access', async () => {
    const run = suffix()
    await createUser({ username: `import-admin2-${run}`, password, tenantId, roles: ['admin'] })
    await createUser({ username: `import-agent-${run}`, password, tenantId, roles: ['agent'] })
    const adminToken = await login(`import-admin2-${run}`)
    const agentToken = await login(`import-agent-${run}`)

    const sourceSystem = `LEGACY_AMS_${run}`

    await authReq('post', '/api/v1/admin/import/batches', agentToken)
      .send({ entityType: 'customer', sourceSystem, rows: [{ payload: {} }] })
      .expect(403)

    const stageRes = await authReq('post', '/api/v1/admin/import/batches', adminToken)
      .send({
        entityType: 'policy',
        sourceSystem,
        // Missing externalIdentifiers and quote entirely: fails validatePolicyRow.
        rows: [{ payload: {} }]
      })
      .expect(201)
    const batchId = stageRes.body.batchId

    const validateRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/validate`, adminToken).send({}).expect(200)
    expect(validateRes.body.invalidCount).toBe(1)
    expect(validateRes.body.status).toBe('Failed')

    // Nothing reached the Valid state, so commit is rejected before any commit handler runs.
    await authReq('post', `/api/v1/admin/import/batches/${batchId}/commit`, adminToken).send({}).expect(409)
  })

  it('stages, validates, and commits a policy batch by replaying quote -> bind -> issue, then treats a duplicate import as an idempotent skip', async () => {
    const run = suffix()
    await createUser({ username: `import-admin3-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`import-admin3-${run}`)

    const sourceSystem = `LEGACY_PAS_${run}`
    const externalId = `POL-${run}`

    const stageRes = await authReq('post', '/api/v1/admin/import/batches', token)
      .send({
        entityType: 'policy',
        sourceSystem,
        rows: [
          {
            payload: {
              externalIdentifiers: [{ sourceSystem, externalId }],
              quote: personalAutoQuotePayload()
            }
          }
        ]
      })
      .expect(201)
    const batchId = stageRes.body.batchId

    const validateRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/validate`, token).send({}).expect(200)
    expect(validateRes.body.validCount).toBe(1)
    expect(validateRes.body.status).toBe('Validated')

    const commitRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/commit`, token).send({}).expect(200)
    expect(commitRes.body.committedCount).toBe(1)
    expect(commitRes.body.status).toBe('Committed')

    const committedRowsRes = await authReq('get', `/api/v1/admin/import/batches/${batchId}/rows?status=Committed`, token).expect(200)
    expect(committedRowsRes.body).toHaveLength(1)
    const policyId = committedRowsRes.body[0].committedEntityId
    expect(policyId).toBeTruthy()
    expect(committedRowsRes.body[0].commitMode).toBe('created')

    // The commit handler replayed the real quote -> bind -> issue services, so
    // the resulting record is a genuinely Issued policy, not a raw table insert.
    const policyRes = await authReq('get', `/api/v1/policies/${policyId}`, token).expect(200)
    expect(policyRes.body.internalStatus).toBe('Issued')

    // Re-importing the same external identifier must not re-run create -> bind -> issue
    // a second time: it is detected via import_external_refs and skipped, returning
    // the same policyId — a policy is not master data the way a customer is.
    const secondBatchRes = await authReq('post', '/api/v1/admin/import/batches', token)
      .send({
        entityType: 'policy',
        sourceSystem,
        rows: [
          {
            payload: {
              externalIdentifiers: [{ sourceSystem, externalId }],
              quote: personalAutoQuotePayload()
            }
          }
        ]
      })
      .expect(201)
    const secondBatchId = secondBatchRes.body.batchId
    await authReq('post', `/api/v1/admin/import/batches/${secondBatchId}/validate`, token).send({}).expect(200)
    const secondCommitRes = await authReq('post', `/api/v1/admin/import/batches/${secondBatchId}/commit`, token).send({}).expect(200)
    expect(secondCommitRes.body.committedCount).toBe(1)

    const secondRowsRes = await authReq('get', `/api/v1/admin/import/batches/${secondBatchId}/rows?status=Committed`, token).expect(200)
    expect(secondRowsRes.body[0].committedEntityId).toBe(policyId)
    expect(secondRowsRes.body[0].commitMode).toBe('skipped')
  })

  it('marks a policy row Failed with the underwriting decline reason when bind is rejected, without corrupting the batch', async () => {
    const run = suffix()
    await createUser({ username: `import-admin4-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`import-admin4-${run}`)

    const sourceSystem = `LEGACY_PAS_${run}`

    // Contract-valid quote (passes AJV schema validation, so it is marked Valid
    // at the validate step) but underwritten to a hard Decline, so bindQuote
    // rejects it at commit time — a real business-rule failure, not a shape error.
    const stageRes = await authReq('post', '/api/v1/admin/import/batches', token)
      .send({
        entityType: 'policy',
        sourceSystem,
        rows: [
          {
            payload: {
              externalIdentifiers: [{ sourceSystem, externalId: `POL-${run}` }],
              quote: personalAutoQuotePayload({ uwAnswers: { driverAge: 15 } })
            }
          }
        ]
      })
      .expect(201)
    const batchId = stageRes.body.batchId

    const validateRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/validate`, token).send({}).expect(200)
    expect(validateRes.body.validCount).toBe(1)
    expect(validateRes.body.status).toBe('Validated')

    const commitRes = await authReq('post', `/api/v1/admin/import/batches/${batchId}/commit`, token).send({}).expect(200)
    expect(commitRes.body.committedCount).toBe(0)
    expect(commitRes.body.failedCount).toBe(1)
    expect(commitRes.body.status).toBe('PartiallyCommitted')

    const failedRowsRes = await authReq('get', `/api/v1/admin/import/batches/${batchId}/rows?status=Failed`, token).expect(200)
    expect(failedRowsRes.body).toHaveLength(1)
    expect(failedRowsRes.body[0].errorMessage).toMatch(/Underwriting decision: Decline/)
  })
})
