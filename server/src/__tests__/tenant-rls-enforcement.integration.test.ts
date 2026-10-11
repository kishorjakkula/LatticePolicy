import crypto from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx, TENANT_RLS_ROLE } from '../db.js'

const tenantA = `rls-test-a-${crypto.randomUUID().slice(0, 8)}`
const tenantB = `rls-test-b-${crypto.randomUUID().slice(0, 8)}`
const originalEnforced = process.env.TENANT_RLS_ENFORCED

async function seedTenant(tenantId: string) {
  const pool = getDb()!
  await pool.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,$2,'en-US','USD')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, `RLS ${tenantId}`]
  )
  const user = await pool.query(
    `INSERT INTO users (tenant_id, username, password_hash) VALUES ($1,$2,'x') RETURNING user_id`,
    [tenantId, `rls-user-${tenantId}`]
  )
  await pool.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1,'agent')`, [user.rows[0].user_id])
  return String(user.rows[0].user_id)
}

describe('tenant row-level security enforcement (database path)', () => {
  let userA = ''
  let userB = ''

  beforeAll(async () => {
    await initDb()
    userA = await seedTenant(tenantA)
    userB = await seedTenant(tenantB)
  })

  afterEach(() => {
    if (originalEnforced === undefined) delete process.env.TENANT_RLS_ENFORCED
    else process.env.TENANT_RLS_ENFORCED = originalEnforced
  })

  afterAll(async () => {
    await closeDb()
  })

  it('migration 058 leaves no RLS-enabled table without a policy and no tenant table without RLS', async () => {
    const pool = getDb()!
    const noPolicy = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = n.nspname AND p.tablename = c.relname)`
    )
    expect(noPolicy.rows).toEqual([])

    const tenantTablesWithoutRls = await pool.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind = 'r' AND NOT c.relrowsecurity
          AND c.relname <> 'schema_migrations'
          AND EXISTS (SELECT 1 FROM information_schema.columns k
                       WHERE k.table_schema = n.nspname AND k.table_name = c.relname AND k.column_name = 'tenant_id')`
    )
    expect(tenantTablesWithoutRls.rows).toEqual([])
  })

  it('creates a restricted role that cannot bypass RLS', async () => {
    const role = await getDb()!.query(
      'SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1',
      [TENANT_RLS_ROLE]
    )
    expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false, rolcanlogin: false }])
  })

  it('without enforcement an unfiltered query still sees every tenant (legacy behavior)', async () => {
    delete process.env.TENANT_RLS_ENFORCED
    const rows = await withTenantTx(tenantA, (db) =>
      toRawQuery(db)('SELECT tenant_id FROM users WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]])
    )
    expect(rows.rows.map((r: any) => r.tenant_id).sort()).toEqual([tenantA, tenantB].sort())
  })

  it('with enforcement an unfiltered query only sees the transaction tenant', async () => {
    process.env.TENANT_RLS_ENFORCED = '1'
    const result = await withTenantTx(tenantA, async (db) => {
      const q = toRawQuery(db)
      const who = await q('SELECT current_user AS role')
      const users = await q('SELECT tenant_id FROM users WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]])
      const tenants = await q('SELECT tenant_id FROM tenants WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]])
      // user_roles has no tenant_id; it is scoped through users.
      const roles = await q('SELECT user_id FROM user_roles WHERE user_id = ANY($1::uuid[])', [[userA, userB]])
      return { who: who.rows[0].role, users: users.rows, tenants: tenants.rows, roles: roles.rows }
    })
    expect(result.who).toBe(TENANT_RLS_ROLE)
    expect(result.users).toEqual([{ tenant_id: tenantA }])
    expect(result.tenants).toEqual([{ tenant_id: tenantA }])
    expect(result.roles).toEqual([{ user_id: userA }])
  })

  it('with enforcement a write for another tenant is rejected or affects nothing', async () => {
    process.env.TENANT_RLS_ENFORCED = '1'
    await expect(
      withTenantTx(tenantA, (db) =>
        toRawQuery(db)(`INSERT INTO users (tenant_id, username, password_hash) VALUES ($1,$2,'x')`, [
          tenantB,
          `rls-cross-${crypto.randomUUID().slice(0, 8)}`,
        ])
      )
    ).rejects.toThrow(/row-level security/)

    const updated = await withTenantTx(tenantA, (db) =>
      toRawQuery(db)('UPDATE users SET disabled = true WHERE user_id = $1', [userB])
    )
    expect(updated.rowCount).toBe(0)

    const deleted = await withTenantTx(tenantA, (db) =>
      toRawQuery(db)('DELETE FROM user_roles WHERE user_id = $1', [userB])
    )
    expect(deleted.rowCount).toBe(0)

    const untouched = await getDb()!.query('SELECT disabled FROM users WHERE user_id = $1', [userB])
    expect(untouched.rows).toEqual([{ disabled: false }])
  })

  it('returns the pooled connection to the owner role after the transaction', async () => {
    process.env.TENANT_RLS_ENFORCED = '1'
    await withTenantTx(tenantA, (db) => toRawQuery(db)('SELECT 1'))
    await expect(
      withTenantTx(tenantA, async () => {
        throw new Error('force rollback')
      })
    ).rejects.toThrow('force rollback')

    const pool = getDb()!
    const roles = await Promise.all(Array.from({ length: 12 }, () => pool.query('SELECT current_user AS role')))
    for (const result of roles) expect(result.rows[0].role).not.toBe(TENANT_RLS_ROLE)
  })
})
