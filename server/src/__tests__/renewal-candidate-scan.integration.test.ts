import crypto from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx, toRawQuery } from '../db.js'
import { enqueueJob, checkpointRun, claimDueRuns, type JobRunRow } from '../jobs/jobQueue.js'
import { registerBuiltinJobs } from '../jobs/registerBuiltinJobs.js'
import { getJobDefinition } from '../jobs/registry.js'

const tenantA = 'sample-carrier'
const tenantB = 'renewal-scan-test-tenant-b'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

function isoDateOffset(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function ensureTenant(tenantId: string) {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, `Test Tenant ${tenantId}`, 'en-US', 'USD']
  )
}

async function seedPolicy(opts: {
  tenantId: string
  policyNumber: string
  status: string
  termExpirationDate: string
  nonRenewedAt?: string | null
  alreadyRenewed?: boolean
  withEmail?: boolean
}) {
  const db = getDb()!
  const policyRes = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date, non_renewed_at)
     VALUES ($1,$2,$3,'personal-auto','CA','2026-01-01',$4,$5)
     RETURNING policy_id`,
    [opts.tenantId, opts.policyNumber, opts.status, opts.termExpirationDate, opts.nonRenewedAt ?? null]
  )
  const policyId = policyRes.rows[0].policy_id

  const payload = opts.withEmail
    ? { productCode: 'personal-auto', applicant: { email: `${opts.policyNumber.toLowerCase()}@example.com`, firstName: 'Test', lastName: 'Insured' } }
    : { productCode: 'personal-auto' }

  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, effective_date, transaction_type, payload)
     VALUES ($1,$2,'2026-01-01','NB',$3::jsonb)`,
    [opts.tenantId, policyId, JSON.stringify(payload)]
  )

  await db.query(
    `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
     VALUES ($1,$2,'NB','Issued','2026-01-01')`,
    [opts.tenantId, policyId]
  )

  if (opts.alreadyRenewed) {
    await db.query(
      `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
       VALUES ($1,$2,'RENEW','Issued',$3)`,
      [opts.tenantId, policyId, opts.termExpirationDate]
    )
  }

  return policyId as string
}

async function claimSpecificRun(pool: Pool, runId: string, workerId: string, maxIterations = 200): Promise<JobRunRow> {
  for (let i = 0; i < maxIterations; i++) {
    const batch = await claimDueRuns(pool, 25, workerId, 60)
    const found = batch.find((r) => r.run_id === runId)
    if (found) return found
    if (batch.length === 0) break
  }
  throw new Error(`Run ${runId} was not claimed after ${maxIterations} claim iterations`)
}

beforeAll(async () => {
  await initDb()
  registerBuiltinJobs()
  await ensureTenant(tenantA)
  await ensureTenant(tenantB)
})

afterAll(async () => {
  await closeDb()
})

describe('renewal candidate scan job', () => {
  it('registers the renewal_candidate_scan job with a positive max attempts', () => {
    const def = getJobDefinition('renewal_candidate_scan')
    expect(def).toBeTruthy()
    expect(def?.defaultMaxAttempts).toBeGreaterThan(0)
  })

  it('identifies in-window candidates and excludes out-of-window, cancelled, non-renewed, and already-renewed policies', async () => {
    const run = suffix()
    const pool = getDb()!

    const inWindowId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-IN-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(20),
      withEmail: true,
    })
    const outOfWindowId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-OUT-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(200),
    })
    const cancelledId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-CANCELLED-${run}`,
      status: 'Cancelled',
      termExpirationDate: isoDateOffset(20),
    })
    const nonRenewedId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-NONRENEWED-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(20),
      nonRenewedAt: isoDateOffset(20),
    })
    const alreadyRenewedId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-ALREADY-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(20),
      alreadyRenewed: true,
    })

    const key = `test:renewal-scan:${run}`
    const { run: enqueued } = await enqueueJob({
      tenantId: tenantA,
      jobCode: 'renewal_candidate_scan',
      idempotencyKey: key,
      requestPayload: { windowDays: 45 },
    })
    const claimed = await claimSpecificRun(pool, enqueued.run_id, `worker-${run}`)

    const def = getJobDefinition('renewal_candidate_scan')!
    const result = await def.handler({
      run: claimed,
      requestPayload: claimed.request_payload,
      checkpoint: (data) => checkpointRun(claimed, data),
    })

    const payload = result.resultPayload as { candidateCount: number; notified: number; suppressed: number }
    expect(payload.candidateCount).toBe(1)
    expect(payload.notified).toBe(1)
    expect(payload.suppressed).toBe(0)

    const intents = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(
        `SELECT policy_id, event_type, status FROM notification_intents WHERE policy_id = $1`,
        [inWindowId]
      )
      return res.rows
    })
    expect(intents).toHaveLength(1)
    expect(intents[0].event_type).toBe('POLICY_RENEWAL_REMINDER')
    expect(intents[0].status).toBe('Queued')

    for (const excludedId of [outOfWindowId, cancelledId, nonRenewedId, alreadyRenewedId]) {
      const excludedIntents = await withTenantTx(tenantA, async (db) => {
        const q = toRawQuery(db)
        const res = await q(`SELECT policy_id FROM notification_intents WHERE policy_id = $1`, [excludedId])
        return res.rows
      })
      expect(excludedIntents).toHaveLength(0)
    }
  })

  it('does not scan across tenants', async () => {
    const run = suffix()
    const pool = getDb()!

    const tenantAPolicyId = await seedPolicy({
      tenantId: tenantA,
      policyNumber: `RENEW-TENANT-A-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(10),
    })
    const tenantBPolicyId = await seedPolicy({
      tenantId: tenantB,
      policyNumber: `RENEW-TENANT-B-${run}`,
      status: 'Issued',
      termExpirationDate: isoDateOffset(10),
    })

    const key = `test:renewal-scan-tenant:${run}`
    const { run: enqueued } = await enqueueJob({
      tenantId: tenantA,
      jobCode: 'renewal_candidate_scan',
      idempotencyKey: key,
    })
    const claimed = await claimSpecificRun(pool, enqueued.run_id, `worker-tenant-${run}`)

    const def = getJobDefinition('renewal_candidate_scan')!
    const result = await def.handler({
      run: claimed,
      requestPayload: claimed.request_payload,
      checkpoint: (data) => checkpointRun(claimed, data),
    })

    const payload = result.resultPayload as { candidateCount: number }
    expect(payload.candidateCount).toBe(1)

    const tenantAIntents = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT policy_id FROM notification_intents WHERE policy_id = $1`, [tenantAPolicyId])
      return res.rows
    })
    expect(tenantAIntents).toHaveLength(1)

    const tenantBIntents = await withTenantTx(tenantB, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT policy_id FROM notification_intents WHERE policy_id = $1`, [tenantBPolicyId])
      return res.rows
    })
    expect(tenantBIntents).toHaveLength(0)
  })
})
