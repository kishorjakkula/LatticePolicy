import { withTenantTx, toRawQuery } from '../db.js'
import { ensureTenantRbacDefaults } from '../lib/rbac.js'
import { validatePasswordPolicy } from '../lib/password-policy.js'
import { createUser, findByUsername } from './user.service.js'

export type CarrierBootstrapInput = {
  tenantId: string
  carrierName?: string
  adminUsername: string
  adminPassword: string
}

export type CarrierBootstrapResult = {
  tenantId: string
  tenantCreated: boolean
  adminUsername: string
  adminCreated: boolean
}

const TENANT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

/**
 * First-run setup for a carrier stack: the tenant row, the default roles and
 * permissions, and one carrier administrator. Safe to run again; an existing
 * tenant or administrator is left untouched (the password is never reset).
 */
export async function bootstrapCarrier(input: CarrierBootstrapInput): Promise<CarrierBootstrapResult> {
  const tenantId = String(input.tenantId || '').trim()
  const adminUsername = String(input.adminUsername || '').trim()
  const adminPassword = String(input.adminPassword || '')
  const carrierName = String(input.carrierName || '').trim() || tenantId

  if (!TENANT_ID_PATTERN.test(tenantId)) {
    throw new Error('INVALID_TENANT_ID: use 2-63 lowercase letters, digits, or hyphens, starting with a letter or digit')
  }
  if (!adminUsername) throw new Error('ADMIN_USERNAME_REQUIRED')

  // Check everything that can fail on input before writing, so a rejected run
  // leaves nothing half-created.
  const existing = await findByUsername(adminUsername)
  // Usernames are unique across the database, so a match in another tenant
  // cannot become this carrier's administrator.
  if (existing && existing.tenantId !== tenantId) throw new Error('ADMIN_USERNAME_TAKEN')
  if (!existing) {
    const policy = validatePasswordPolicy(adminPassword)
    if (!policy.ok) throw new Error(`WEAK_PASSWORD: ${policy.errors.join('; ')}`)
  }

  const tenantCreated = await withTenantTx(tenantId, async (db) => {
    const inserted = await toRawQuery(db)(
      `INSERT INTO tenants (tenant_id, name) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO NOTHING
       RETURNING tenant_id`,
      [tenantId, carrierName]
    )
    return (inserted.rowCount || 0) > 0
  })

  await ensureTenantRbacDefaults(tenantId)

  if (existing) return { tenantId, tenantCreated, adminUsername: existing.username, adminCreated: false }

  const created = await createUser({ username: adminUsername, password: adminPassword, tenantId, roles: ['admin'] })
  return { tenantId, tenantCreated, adminUsername: created.username, adminCreated: true }
}
