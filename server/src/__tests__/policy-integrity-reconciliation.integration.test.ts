import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { policyIntegrityReconciliationHandler, type PolicyIntegrityPayload } from '../jobs/handlers/policyIntegrityReconciliation.js'
import type { JobRunRow } from '../jobs/jobQueue.js'

const tenantId = 'policy-integrity-test'

async function seedPolicy(status = 'Quote') {
  const suffix = crypto.randomUUID().slice(0, 8)
  const result = await getDb()!.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,$3,'personal-auto','2026-01-01','2027-01-01') RETURNING policy_id`,
    [tenantId, `INT-${suffix}`, status]
  )
  return result.rows[0].policy_id as string
}

async function seedTransaction(policyId: string, type = 'ENDORSE', ratingId: string | null = null) {
  const result = await getDb()!.query(
    `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, processed_at, rating_id)
     VALUES ($1,$2,$3,'Issued',now(),$4) RETURNING transaction_id`,
    [tenantId, policyId, type, ratingId]
  )
  return result.rows[0].transaction_id as string
}

async function addVersion(policyId: string, transactionId: string) {
  await getDb()!.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, transaction_id, effective_date, transaction_type)
     VALUES ($1,$2,$3,'2026-01-01','ENDORSE')`, [tenantId, policyId, transactionId]
  )
}

async function addEvent(policyId: string, transactionId: string) {
  await getDb()!.query(
    `INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, payload)
     VALUES ($1,'Policy',$2,'TEST',$3::jsonb)`, [tenantId, policyId, JSON.stringify({ transactionId })]
  )
}

async function addForm(policyId: string, transactionId: string) {
  await getDb()!.query(
    `INSERT INTO policy_forms (tenant_id, policy_id, transaction_id, code, edition, snapshot_hash)
     VALUES ($1,$2,$3,'TEST','01-26','snapshot')`, [tenantId, policyId, transactionId]
  )
}

async function addDocument(policyId: string, transactionId: string, integrityStatus = 'VERIFIED') {
  await getDb()!.query(
    `INSERT INTO documents (tenant_id, policy_id, transaction_id, type, uri, hash, integrity_status)
     VALUES ($1,$2,$3,'PolicyPacket','memory://test','hash',$4)`, [tenantId, policyId, transactionId, integrityStatus]
  )
}

async function runFor(policyId: string, payload: PolicyIntegrityPayload = { policyId }) {
  const now = new Date().toISOString()
  const run = {
    run_id: crypto.randomUUID(), tenant_id: tenantId, job_code: 'policy_integrity_reconciliation', schedule_id: null,
    idempotency_key: crypto.randomUUID(), status: 'Running', attempts: 1, max_attempts: 3, checkpoint: {},
    request_payload: payload, result_payload: {}, last_error: null, locked_by: 'test', locked_until: null,
    next_attempt_at: now, started_at: now, finished_at: null, created_at: now, updated_at: now,
  } as JobRunRow
  await policyIntegrityReconciliationHandler({ run, requestPayload: payload, checkpoint: async () => undefined })
}

beforeAll(async () => {
  await initDb()
  await getDb()!.query(`INSERT INTO tenants (tenant_id, name) VALUES ($1,'Integrity Test') ON CONFLICT (tenant_id) DO NOTHING`, [tenantId])
})

afterAll(async () => { await closeDb() })

describe('policy integrity reconciliation', () => {
  const cases: Array<[string, () => Promise<string>]> = [
    ['MISSING_VERSION', async () => { const p = await seedPolicy(); await seedTransaction(p); return p }],
    ['MISSING_RATING', async () => { const p = await seedPolicy(); const t = await seedTransaction(p, 'ENDORSE', crypto.randomUUID()); await addVersion(p, t); await addEvent(p, t); return p }],
    ['MISSING_FORMS', async () => { const p = await seedPolicy(); const t = await seedTransaction(p, 'NB'); await addVersion(p, t); await addDocument(p, t); await addEvent(p, t); return p }],
    ['MISSING_DOCUMENT', async () => { const p = await seedPolicy(); const t = await seedTransaction(p, 'NB'); await addVersion(p, t); await addForm(p, t); await addEvent(p, t); return p }],
    ['MISSING_LEDGER_EVENT', async () => { const p = await seedPolicy(); const t = await seedTransaction(p); await addVersion(p, t); return p }],
    ['MISSING_CUSTOMER_LINK', async () => seedPolicy('Issued')],
    ['INCOMPLETE_SIDE_EFFECT', async () => { const p = await seedPolicy(); const t = await seedTransaction(p); await addVersion(p, t); await addEvent(p, t); await addDocument(p, t, 'FAILED'); return p }],
  ]

  it.each(cases)('detects %s', async (exceptionClass, setup) => {
    const policyId = await setup()
    await runFor(policyId)
    const findings = await getDb()!.query(
      `SELECT exception_class, correlation_id FROM policy_integrity_exceptions WHERE tenant_id = $1 AND policy_id = $2 AND status <> 'Resolved'`,
      [tenantId, policyId]
    )
    expect(findings.rows.map((row) => row.exception_class)).toContain(exceptionClass)
    expect(findings.rows.every((row) => String(row.correlation_id).startsWith('policy-integrity:'))).toBe(true)
  })
})
