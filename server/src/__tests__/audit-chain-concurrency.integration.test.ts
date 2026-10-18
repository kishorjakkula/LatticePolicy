import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResult } from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closeDb, getDb, initDb, TENANT_RLS_ROLE } from '../db.js'
import { isTenantRlsEnforced } from '../config.js'

const tenant = `audit-concurrency-${randomUUID()}`
const submission = randomUUID()

async function begin(client: PoolClient) {
  await client.query('BEGIN')
  if (isTenantRlsEnforced()) await client.query(`SET LOCAL ROLE ${TENANT_RLS_ROLE}`)
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant])
}

beforeAll(async () => {
  await initDb()
  await getDb()!.query('INSERT INTO tenants(tenant_id,name) VALUES($1,$1)', [tenant])
  await getDb()!.query('INSERT INTO submissions(submission_id,tenant_id,submission_number) VALUES($1,$2,$3)', [submission, tenant, `SUB-${submission}`])
})

afterAll(async () => {
  const client = await getDb()!.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT set_config('app.audit_purge', 'tenant-offboarding', true)")
    await client.query('DELETE FROM tenants WHERE tenant_id=$1', [tenant])
    await client.query('COMMIT')
  } finally { client.release(); await closeDb() }
})

for (const table of ['submission_events', 'llm_release_audit'] as const) {
  it(`${table} serializes positions with the chain lock, ignores supplied positions, and tolerates rollback gaps`, async () => {
    const first = await getDb()!.connect(), waiting = await getDb()!.connect()
    const insert = table === 'submission_events'
      ? `INSERT INTO submission_events(tenant_id,submission_id,actor_type,action,chain_seq) VALUES($1,$2,'system','concurrency_test',-1) RETURNING chain_seq`
      : `INSERT INTO llm_release_audit(tenant_id,release_id,actor_type,action,chain_seq) VALUES($1,$2,'system','CONCURRENCY_TEST',-1) RETURNING chain_seq`
    const params = [tenant, table === 'submission_events' ? submission : null]
    let pending: Promise<QueryResult<{ chain_seq: string }>> | undefined
    try {
      await begin(first)
      await first.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))', [`audit:${table}`, tenant])
      await begin(waiting)
      const firstPid = (await first.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      const waitingPid = (await waiting.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
      // The older implementation allocates a lower sequence before blocking.
      pending = waiting.query<{ chain_seq: string }>(insert, params)
      // Attach a handler immediately; cleanup still observes/rethrows its error.
      void pending.catch(() => {})
      let blocked = false
      for (let i = 0; i < 200; i++) {
        const state = await getDb()!.query('SELECT $1 = ANY(pg_blocking_pids($2)) AS blocked', [firstPid, waitingPid])
        if (state.rows[0].blocked) { blocked = true; break }
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      expect(blocked).toBe(true)
      const committedFirst = await first.query(insert, params)
      await first.query('COMMIT')
      const committedSecond = await pending
      await waiting.query('COMMIT')
      expect(BigInt(committedFirst.rows[0].chain_seq)).toBeGreaterThan(0n)
      expect(BigInt(committedSecond.rows[0].chain_seq)).toBeGreaterThan(BigInt(committedFirst.rows[0].chain_seq))

      await begin(first)
      const rolledBack = await first.query(insert, params)
      await first.query('ROLLBACK')
      await begin(first)
      const afterGap = await first.query(insert, params)
      await first.query('COMMIT')
      expect(BigInt(afterGap.rows[0].chain_seq)).toBeGreaterThan(BigInt(rolledBack.rows[0].chain_seq))
      const integrity = await getDb()!.query('SELECT audit_chain_first_break($1,$2) AS first_break', [table, tenant])
      expect(integrity.rows[0].first_break).toBeNull()
    } finally {
      await first.query('ROLLBACK')
      await pending?.catch(() => {})
      await waiting.query('ROLLBACK')
      first.release(); waiting.release()
    }
  })
}
