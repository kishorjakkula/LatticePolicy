import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { createRole } from '../lib/rbac.js'

const app = createApp()
const tenant = `bulk-${crypto.randomUUID()}`
const foreignTenant = `${tenant}-foreign`
let token: string
let readerToken: string
let actor: string
const q = (sql: string, params?: unknown[]) => getDb()!.query(sql, params)
const post = (body: object, auth = token) => request(app).post('/api/v1/admin/compliance/eligibility/bulk')
  .set('Authorization', `Bearer ${auth}`).set('X-Tenant', tenant).send(body)

async function seed(count = 2, tenantId = tenant) {
  const prefix = crypto.randomUUID()
  const result = await q(`INSERT INTO product_state_eligibility (tenant_id,product_code,state_code,status)
    SELECT $1,$2 || '-' || n,'NY','ACTIVE' FROM generate_series(1,$3::int) n RETURNING *`, [tenantId, prefix, count])
  return result.rows.map(row => row.eligibility_id as string).sort()
}

async function unchanged(ids: string[]) {
  const rows = await q('SELECT status FROM product_state_eligibility WHERE eligibility_id=ANY($1::uuid[])', [ids])
  expect(rows.rows.every(row => row.status === 'ACTIVE')).toBe(true)
  const events = await q('SELECT * FROM ledger_events WHERE entity_id=ANY($1::uuid[])', [ids])
  expect(events.rowCount).toBe(0)
}

describe('atomic compliance bulk status', () => {
  beforeAll(async () => {
    // This suite intentionally refuses an unmarked database; never target demo/pilot data.
    if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true') throw new Error('Disposable test database required')
    await initDb()
    await q('INSERT INTO tenants (tenant_id,name) VALUES ($1,$1),($2,$2)', [tenant, foreignTenant])
    await createRole(tenant, { roleCode: 'reader', roleName: 'Reader', permissionCodes: ['menu.admin.view', 'admin.compliance.read'] }, 'test')
    for (const [username, roles] of [['manager', ['admin']], ['reader', ['reader']]] as const) {
      const uniqueUsername = `${username}-${tenant}`
      await createUser({ username: uniqueUsername, password: 'password', tenantId: tenant, roles: [...roles] })
      const response = await request(app).post('/auth/login').send({ tenantId: tenant, username: uniqueUsername, password: 'password' }).expect(200)
      if (username === 'manager') token = response.body.token
      else readerToken = response.body.token
    }
    actor = (await q('SELECT user_id FROM users WHERE tenant_id=$1 AND username=$2', [tenant, `manager-${tenant}`])).rows[0].user_id
  })
  afterAll(async () => { await closeDb() })

  it('updates all selected rows with one before/after audit per row and the authenticated actor', async () => {
    const ids = await seed(10)
    const result = await post({ ids: [...ids].reverse(), status: 'SUSPENDED', reason: '  Withdrawn filing  ' }).expect(200)
    expect(result.body.updated).toBe(10)
    expect(result.body.items.map((row: any) => row.eligibility_id)).toEqual(ids)
    const audit = await q('SELECT * FROM ledger_events WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])', [tenant, ids])
    expect(audit.rowCount).toBe(10)
    for (const row of audit.rows) {
      expect(row).toMatchObject({ actor, from_state: 'ACTIVE', to_state: 'SUSPENDED', event: 'ELIGIBILITY_STATUS_CHANGED' })
      expect(row.payload).toMatchObject({ reason: 'Withdrawn filing', actorType: 'user', before: { status: 'ACTIVE' }, after: { status: 'SUSPENDED' } })
    }
  })

  it.each([
    { ids: [] }, { ids: Array.from({ length: 501 }, () => crypto.randomUUID()) },
    { ids: ['not-a-uuid'] }, { ids: null }, { ids: [123] },
    { reason: undefined }, { reason: '' }, { reason: ' \n\t' }, { reason: 12 }, { reason: 'x'.repeat(2001) },
    { status: 'Inactive' }, { status: 'BOGUS' }, { extra: true },
  ])('rejects invalid input without writes: %j', async override => {
    const ids = await seed(1)
    const response = await post({ ids, status: 'CLOSED', reason: 'Reviewed', ...override }).expect(400)
    expect(response.body.code).toBe('INVALID_INPUT')
    await unchanged(ids)
  })

  it('rejects duplicate UUIDs, including differently cased duplicates', async () => {
    const ids = await seed(1)
    await post({ ids: [ids[0], ids[0].toUpperCase()], status: 'CLOSED', reason: 'Reviewed' }).expect(400)
    await unchanged(ids)
  })

  it('accepts the inclusive 500-row bound', async () => {
    const ids = await seed(500)
    const response = await post({ ids, status: 'FILING_PENDING', reason: 'Annual filing review' }).expect(200)
    expect(response.body.updated).toBe(500)
    expect((await q('SELECT count(*)::int AS count FROM ledger_events WHERE tenant_id=$1 AND entity_id=ANY($2::uuid[])', [tenant, ids])).rows[0].count).toBe(500)
  })

  it('rejects missing and foreign IDs identically, with no partial changes or audits', async () => {
    const ids = await seed()
    const foreign = await seed(1, foreignTenant)
    for (const id of [crypto.randomUUID(), foreign[0]]) {
      const response = await post({ ids: [...ids, id], status: 'CLOSED', reason: 'Reviewed' }).expect(404)
      expect(response.body.code).toBe('NOT_FOUND')
      await unchanged([...ids, ...foreign])
    }
  })

  it('requires manage permission and authentication', async () => {
    const ids = await seed()
    await post({ ids, status: 'CLOSED', reason: 'Reviewed' }, readerToken).expect(403)
    await request(app).post('/api/v1/admin/compliance/eligibility/bulk').set('X-Tenant', tenant)
      .send({ ids, status: 'CLOSED', reason: 'Reviewed' }).expect(401)
    await unchanged(ids)
  })

  it('rolls every row and audit back when the second audit insert fails', async () => {
    const ids = await seed()
    await q(`CREATE FUNCTION test_bulk_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.entity_id='${ids[1]}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`)
    await q('CREATE TRIGGER test_bulk_audit_failure BEFORE INSERT ON ledger_events FOR EACH ROW EXECUTE FUNCTION test_bulk_audit_failure()')
    try {
      await post({ ids, status: 'CLOSED', reason: 'Reviewed' }).expect(500)
      await unchanged(ids)
    } finally {
      await q('DROP TRIGGER test_bulk_audit_failure ON ledger_events')
      await q('DROP FUNCTION test_bulk_audit_failure()')
    }
  })

  it('serializes a concurrent PATCH and audits its committed before state without losing other fields', async () => {
    const ids = await seed(1)
    const client = await getDb()!.connect()
    let pending: Promise<any> | undefined
    let patch: Promise<any> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT * FROM product_state_eligibility WHERE eligibility_id=$1 FOR UPDATE', [ids[0]])
      patch = request(app).patch(`/api/v1/admin/compliance/eligibility/${ids[0]}`)
        .set('Authorization', `Bearer ${token}`).set('X-Tenant', tenant)
        .send({ status: 'CLOSED', notes: 'Concurrent PATCH preserved' }).expect(200).then(result => result)
      await expect.poll(async () => (await q("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE product_state_eligibility SET %' ")).rows[0].count).toBeGreaterThan(0)
      pending = post({ ids, status: 'SUSPENDED', reason: 'Concurrent review' }).expect(200).then(result => result)
      await expect.poll(async () => (await q("SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%ORDER BY eligibility_id FOR UPDATE%' ")).rows[0].count).toBeGreaterThan(0)
      await client.query('COMMIT')
      await patch
      await pending
      const audit = await q('SELECT from_state,to_state FROM ledger_events WHERE entity_id=$1', [ids[0]])
      expect(audit.rows).toEqual([{ from_state: 'CLOSED', to_state: 'SUSPENDED' }])
      expect((await q('SELECT status,notes FROM product_state_eligibility WHERE eligibility_id=$1', [ids[0]])).rows)
        .toEqual([{ status: 'SUSPENDED', notes: 'Concurrent PATCH preserved' }])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      if (patch) await patch
      if (pending) await pending
    }
  })

  it('returns 409 on bounded lock contention without writing rows or audits', async () => {
    const ids = await seed()
    const client = await getDb()!.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT * FROM product_state_eligibility WHERE eligibility_id=$1 FOR UPDATE', [ids[1]])
      const response = await post({ ids, status: 'CLOSED', reason: 'Review under contention' }).expect(409)
      expect(response.body.code).toBe('CONCURRENT_CHANGE')
      await unchanged(ids)
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  })
})
