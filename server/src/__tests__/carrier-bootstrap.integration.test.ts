import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, getSchemaStatus, initDb } from '../db.js'
import { bootstrapCarrier } from '../services/carrier-bootstrap.service.js'
import { resolvePermissionsForRoles } from '../lib/rbac.js'

const STRONG_PASSWORD = 'Carrier-Bootstrap-9!x'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

describe('carrier bootstrap (database path)', () => {
  beforeAll(async () => {
    await initDb()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('creates the tenant, default roles, and one carrier administrator', async () => {
    const tenantId = `boot-${suffix()}`
    const adminUsername = `admin-${tenantId}@example.com`

    const result = await bootstrapCarrier({ tenantId, carrierName: 'Boot Mutual', adminUsername, adminPassword: STRONG_PASSWORD })
    expect(result).toEqual({ tenantId, tenantCreated: true, adminUsername, adminCreated: true })

    const pool = getDb()!
    const tenant = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1', [tenantId])
    expect(tenant.rows).toEqual([{ name: 'Boot Mutual' }])

    const user = await pool.query(
      `SELECT u.tenant_id, u.password_hash, array_agg(ur.role_code) AS roles
         FROM users u JOIN user_roles ur ON ur.user_id = u.user_id
        WHERE u.username = $1 GROUP BY u.tenant_id, u.password_hash`,
      [adminUsername]
    )
    expect(user.rows[0].tenant_id).toBe(tenantId)
    expect(user.rows[0].roles).toEqual(['admin'])
    expect(bcrypt.compareSync(STRONG_PASSWORD, user.rows[0].password_hash)).toBe(true)

    const permissions = await resolvePermissionsForRoles(tenantId, ['admin'])
    expect(permissions).toContain('admin.users.manage')
  })

  it('is safe to run again and never resets the administrator password', async () => {
    const tenantId = `boot-${suffix()}`
    const adminUsername = `admin-${tenantId}@example.com`
    await bootstrapCarrier({ tenantId, adminUsername, adminPassword: STRONG_PASSWORD })

    const again = await bootstrapCarrier({ tenantId, carrierName: 'Renamed', adminUsername, adminPassword: 'Different-Pass-7!q' })
    expect(again).toEqual({ tenantId, tenantCreated: false, adminUsername, adminCreated: false })

    const pool = getDb()!
    const tenant = await pool.query('SELECT name FROM tenants WHERE tenant_id = $1', [tenantId])
    expect(tenant.rows).toEqual([{ name: tenantId }])
    const user = await pool.query('SELECT password_hash FROM users WHERE username = $1', [adminUsername])
    expect(bcrypt.compareSync(STRONG_PASSWORD, user.rows[0].password_hash)).toBe(true)
  })

  it('rejects bad input before creating anything', async () => {
    const tenantId = `boot-${suffix()}`
    const pool = getDb()!

    await expect(
      bootstrapCarrier({ tenantId, adminUsername: `weak-${tenantId}`, adminPassword: 'short' })
    ).rejects.toThrow(/WEAK_PASSWORD/)
    await expect(
      bootstrapCarrier({ tenantId: 'Not A Slug', adminUsername: 'x', adminPassword: STRONG_PASSWORD })
    ).rejects.toThrow(/INVALID_TENANT_ID/)
    await expect(
      bootstrapCarrier({ tenantId, adminUsername: '  ', adminPassword: STRONG_PASSWORD })
    ).rejects.toThrow(/ADMIN_USERNAME_REQUIRED/)

    const tenant = await pool.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [tenantId])
    expect(tenant.rowCount).toBe(0)
  })

  it('refuses an administrator username that belongs to another carrier', async () => {
    const first = `boot-${suffix()}`
    const second = `boot-${suffix()}`
    const adminUsername = `shared-${first}@example.com`
    await bootstrapCarrier({ tenantId: first, adminUsername, adminPassword: STRONG_PASSWORD })

    await expect(
      bootstrapCarrier({ tenantId: second, adminUsername, adminPassword: STRONG_PASSWORD })
    ).rejects.toThrow(/ADMIN_USERNAME_TAKEN/)
    const tenant = await getDb()!.query('SELECT 1 FROM tenants WHERE tenant_id = $1', [second])
    expect(tenant.rowCount).toBe(0)
  })

  it('reports a schema level that matches the shipped migrations', async () => {
    const status = await getSchemaStatus()
    expect(status.appliedVersion).toBe(status.releaseVersion)
    expect(status.appliedVersion).toBeGreaterThanOrEqual(58)
    expect(status.schemaAhead).toBe(false)

    const pool = getDb()!
    await pool.query(`INSERT INTO schema_migrations (tenant_id, version, name) VALUES ('system', 99999, 'future.sql')`)
    try {
      expect(await getSchemaStatus()).toMatchObject({ appliedVersion: 99999, schemaAhead: true })
    } finally {
      await pool.query(`DELETE FROM schema_migrations WHERE tenant_id = 'system' AND version = 99999`)
    }
  })
})
