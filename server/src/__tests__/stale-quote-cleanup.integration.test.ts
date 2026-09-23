import crypto from 'node:crypto'
import type { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { claimDueRuns, checkpointRun, enqueueJob, type JobRunRow } from '../jobs/jobQueue.js'
import { registerBuiltinJobs } from '../jobs/registerBuiltinJobs.js'
import { getJobDefinition } from '../jobs/registry.js'

const tenantA = 'stale-quote-test-a'
const tenantB = 'stale-quote-test-b'

async function claimRun(pool: Pool, runId: string): Promise<JobRunRow> {
  for (let i = 0; i < 100; i++) {
    const run = (await claimDueRuns(pool, 25, `stale-test-${runId}`, 60)).find((item) => item.run_id === runId)
    if (run) return run
  }
  throw new Error(`Run ${runId} was not claimed`)
}

async function seedQuote(tenantId: string, status: string, ageDays: number): Promise<string> {
  const result = await getDb()!.query(
    `INSERT INTO quotes
       (tenant_id, product_code, effective_date, term_months, payload, status, updated_at)
     VALUES ($1, 'personal-auto', CURRENT_DATE, 12, '{}'::jsonb, $2, now() - ($3 * interval '1 day'))
     RETURNING quote_id`,
    [tenantId, status, ageDays]
  )
  return result.rows[0].quote_id
}

beforeAll(async () => {
  await initDb()
  registerBuiltinJobs()
  for (const tenantId of [tenantA, tenantB]) {
    await getDb()!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1, $2, 'en-US', 'USD') ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, tenantId]
    )
  }
})

afterAll(async () => closeDb())

describe('stale quote cleanup job', () => {
  it('expires only inactive draft and rated quotes for the run tenant', async () => {
    const staleDraft = await seedQuote(tenantA, 'Draft', 120)
    const staleRated = await seedQuote(tenantA, 'Rated', 120)
    const freshDraft = await seedQuote(tenantA, 'Draft', 5)
    const converted = await seedQuote(tenantA, 'Converted', 120)
    const otherTenant = await seedQuote(tenantB, 'Draft', 120)

    const { run } = await enqueueJob({
      tenantId: tenantA,
      jobCode: 'stale_quote_cleanup',
      idempotencyKey: `stale-quote-test:${crypto.randomUUID()}`,
      requestPayload: { staleAfterDays: 90 },
    })
    const claimed = await claimRun(getDb()!, run.run_id)
    const result = await getJobDefinition('stale_quote_cleanup')!.handler({
      run: claimed,
      requestPayload: claimed.request_payload,
      checkpoint: (data) => checkpointRun(claimed, data),
    })

    expect(result.resultPayload).toMatchObject({ candidateCount: 2, expiredCount: 2, dryRun: false })
    const rows = await getDb()!.query(
      `SELECT quote_id, status, updated_by, status_history
         FROM quotes WHERE quote_id = ANY($1::uuid[])`,
      [[staleDraft, staleRated, freshDraft, converted, otherTenant]]
    )
    const byId = new Map(rows.rows.map((row) => [row.quote_id, row]))
    for (const quoteId of [staleDraft, staleRated]) {
      expect(byId.get(quoteId)?.status).toBe('Expired')
      expect(byId.get(quoteId)?.updated_by).toBe('stale_quote_cleanup')
      expect(byId.get(quoteId)?.status_history).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'Expired', updatedBy: 'stale_quote_cleanup' })])
      )
    }
    expect(byId.get(freshDraft)?.status).toBe('Draft')
    expect(byId.get(converted)?.status).toBe('Converted')
    expect(byId.get(otherTenant)?.status).toBe('Draft')
  })

  it('reports candidates without modifying them in dry-run mode', async () => {
    const quoteId = await seedQuote(tenantA, 'Draft', 120)
    const { run } = await enqueueJob({
      tenantId: tenantA,
      jobCode: 'stale_quote_cleanup',
      idempotencyKey: `stale-quote-dry-run:${crypto.randomUUID()}`,
      requestPayload: { staleAfterDays: 90, dryRun: true },
    })
    const claimed = await claimRun(getDb()!, run.run_id)
    const result = await getJobDefinition('stale_quote_cleanup')!.handler({
      run: claimed,
      requestPayload: claimed.request_payload,
      checkpoint: (data) => checkpointRun(claimed, data),
    })

    expect(result.resultPayload).toMatchObject({ candidateCount: 1, expiredCount: 0, dryRun: true })
    const row = await getDb()!.query(`SELECT status FROM quotes WHERE quote_id = $1`, [quoteId])
    expect(row.rows[0].status).toBe('Draft')
  })
})
