import crypto from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx, toRawQuery } from '../db.js'
import {
  enqueueJob,
  claimDueRuns,
  retryOrDeadLetterRun,
  completeRun,
  checkpointRun,
  type JobRunRow,
} from '../jobs/jobQueue.js'
import { registerBuiltinJobs } from '../jobs/registerBuiltinJobs.js'
import { getJobDefinition } from '../jobs/registry.js'
import { claimOutboxRows, dispatchOutboxRow, loadConfig as loadAsyncPushConfig } from '../asyncMessageWorker.js'

const tenantA = 'sample-carrier'
const tenantB = 'job-queue-test-tenant-b'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant(tenantId: string) {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, `Test Tenant ${tenantId}`, 'en-US', 'USD']
  )
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

describe('job queue framework', () => {
  it('creates job tables with tenant RLS policies', async () => {
    const db = getDb()
    const result = await db!.query(
      `SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation' AND tablename = ANY($1::text[])`,
      [['job_schedules', 'job_runs', 'job_run_events']]
    )
    const tables = result.rows.map((r: any) => r.tablename).sort()
    expect(tables).toEqual(['job_run_events', 'job_runs', 'job_schedules'])
  })

  it('registers the built-in async_outbox_delivery_retry job', () => {
    const def = getJobDefinition('async_outbox_delivery_retry')
    expect(def).toBeTruthy()
    expect(def?.defaultMaxAttempts).toBeGreaterThan(0)
  })

  it('duplicate enqueue with the same tenant/idempotency key returns the existing run', async () => {
    const key = `test:dup:${suffix()}`
    const first = await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })
    const second = await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.run.run_id).toBe(first.run.run_id)
  })

  it('a run for tenant A is not visible under a tenant-B-scoped query', async () => {
    const key = `test:isolation:${suffix()}`
    const { run } = await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })

    const rowsUnderTenantB = await withTenantTx(tenantB, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT * FROM job_runs WHERE tenant_id = $1 AND run_id = $2`, [tenantB, run.run_id])
      return res.rows
    })
    expect(rowsUnderTenantB).toHaveLength(0)

    const rowsUnderTenantA = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT * FROM job_runs WHERE tenant_id = $1 AND run_id = $2`, [tenantA, run.run_id])
      return res.rows
    })
    expect(rowsUnderTenantA).toHaveLength(1)
  })

  it('two claim calls cannot claim the same queued run', async () => {
    const pool = getDb()!
    const keyOne = `test:claim:${suffix()}`
    const keyTwo = `test:claim:${suffix()}`
    await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: keyOne })
    await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: keyTwo })

    const [batchA, batchB] = await Promise.all([
      claimDueRuns(pool, 1, 'worker-a', 60),
      claimDueRuns(pool, 1, 'worker-b', 60),
    ])

    const claimedIds = [...batchA, ...batchB].map((r) => r.run_id)
    expect(new Set(claimedIds).size).toBe(claimedIds.length)
    expect(claimedIds.length).toBeGreaterThanOrEqual(1)
    for (const run of [...batchA, ...batchB]) {
      expect(run.status).toBe('Running')
      expect(run.attempts).toBe(1)
    }
  })

  it('checkpoints a run and records a checkpoint event', async () => {
    const pool = getDb()!
    const key = `test:checkpoint:${suffix()}`
    await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })
    const [claimed] = await claimDueRuns(pool, 1, 'worker-checkpoint', 60)
    expect(claimed).toBeTruthy()

    await checkpointRun(claimed, { progress: 'halfway' })

    const events = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT event_type FROM job_run_events WHERE run_id = $1 ORDER BY created_at`, [claimed.run_id])
      return res.rows
    })
    expect(events.some((e: any) => e.event_type === 'checkpointed')).toBe(true)
  })

  it('completes a run and marks it Succeeded', async () => {
    const pool = getDb()!
    const key = `test:complete:${suffix()}`
    await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })
    const [claimed] = await claimDueRuns(pool, 1, 'worker-complete', 60)

    await completeRun(claimed, { done: true })

    const after = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT status, result_payload FROM job_runs WHERE run_id = $1`, [claimed.run_id])
      return res.rows[0]
    })
    expect(after.status).toBe('Succeeded')
    expect(after.result_payload).toEqual({ done: true })
  })

  it('retries a failed run until attempts are exhausted, then dead-letters it', async () => {
    const pool = getDb()!
    const key = `test:retry:${suffix()}`
    const { run } = await enqueueJob({
      tenantId: tenantA,
      jobCode: 'async_outbox_delivery_retry',
      idempotencyKey: key,
      maxAttempts: 2,
    })
    expect(run.max_attempts).toBe(2)

    const claimedOnce = await claimSpecificRun(pool, run.run_id, 'worker-retry')
    expect(claimedOnce.attempts).toBe(1)
    await retryOrDeadLetterRun(claimedOnce, new Error('transient failure'), { baseSeconds: 0, maxSeconds: 0 })

    const afterFirstFailure = await fetchRun(claimedOnce.run_id)
    expect(afterFirstFailure.status).toBe('Retry')

    const claimedTwice = await claimSpecificRun(pool, run.run_id, 'worker-retry-2')
    expect(claimedTwice.attempts).toBe(2)
    await retryOrDeadLetterRun(claimedTwice, new Error('still failing'), { baseSeconds: 0, maxSeconds: 0 })

    const afterSecondFailure = await fetchRun(claimedOnce.run_id)
    expect(afterSecondFailure.status).toBe('DeadLettered')
    expect(afterSecondFailure.last_error).toContain('still failing')
  })

  it('the async_outbox_delivery_retry handler dispatches a due outbox row end to end', async () => {
    const pool = getDb()!
    const sourceId = crypto.randomUUID()
    await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      await q(
        `INSERT INTO async_message_outbox (tenant_id, source_table, source_id, topic, payload)
         VALUES ($1, 'test_source', $2, 'test.topic', $3::jsonb)`,
        [tenantA, sourceId, JSON.stringify({ hello: 'world' })]
      )
    })

    const key = `test:handler:${suffix()}`
    const { run } = await enqueueJob({ tenantId: tenantA, jobCode: 'async_outbox_delivery_retry', idempotencyKey: key })
    const claimed = await claimSpecificRun(pool, run.run_id, 'worker-handler')

    const def = getJobDefinition('async_outbox_delivery_retry')!
    const result = await def.handler({
      run: claimed,
      requestPayload: claimed.request_payload,
      checkpoint: (data) => checkpointRun(claimed, data),
    })
    await completeRun(claimed, result.resultPayload ?? {})

    const payload = result.resultPayload as { claimed: number; sent: number }
    expect(payload.claimed).toBeGreaterThanOrEqual(1)
    expect(payload.sent).toBeGreaterThanOrEqual(1)

    // The handler claims globally oldest-due async_message_outbox rows
    // first, so with other integration test files' fixtures sharing this
    // Postgres instance, our row may not land in the very first batch.
    // Drain directly (mirrors a worker polling repeatedly in production)
    // until either it is dispatched or there is nothing left to claim, then
    // re-read the row's actual status rather than trusting loop state.
    const asyncPushConfig = loadAsyncPushConfig()
    for (let i = 0; i < 200; i++) {
      const current = await withTenantTx(tenantA, async (db) => {
        const q = toRawQuery(db)
        const res = await q(`SELECT status FROM async_message_outbox WHERE source_id = $1`, [sourceId])
        return res.rows[0]?.status
      })
      if (current === 'Sent') break
      const batch = await claimOutboxRows(pool, 25)
      if (batch.length === 0) break
      for (const row of batch) {
        await dispatchOutboxRow(pool, row, asyncPushConfig)
      }
    }

    const outboxRow = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const res = await q(`SELECT status FROM async_message_outbox WHERE source_id = $1`, [sourceId])
      return res.rows[0]
    })
    expect(outboxRow.status).toBe('Sent')
  })
})

async function fetchRun(runId: string): Promise<JobRunRow> {
  const rows = await withTenantTx(tenantA, async (db) => {
    const q = toRawQuery(db)
    const res = await q(`SELECT * FROM job_runs WHERE run_id = $1`, [runId])
    return res.rows
  })
  return rows[0] as JobRunRow
}

/**
 * claimDueRuns claims the globally oldest-due rows first. This test file
 * shares one Postgres instance with every other integration test file, so
 * other files' fixtures can leave older due rows ahead of the one this test
 * just enqueued. Drain claim batches until the specific run we care about
 * shows up, instead of assuming it is claimed first.
 */
async function claimSpecificRun(pool: Pool, runId: string, workerId: string, maxIterations = 200): Promise<JobRunRow> {
  for (let i = 0; i < maxIterations; i++) {
    const batch = await claimDueRuns(pool, 25, workerId, 60)
    if (batch.length === 0) break
    const found = batch.find((r) => r.run_id === runId)
    if (found) return found
  }
  throw new Error(`Run ${runId} was not claimed after ${maxIterations} claim iterations`)
}
