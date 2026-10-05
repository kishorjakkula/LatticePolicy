import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { eq, and, sql, inArray, getTableColumns } from 'drizzle-orm'
import { createDrizzleDb, getDb, withTenantTx, type DrizzleDB } from '../db.js'
import { isUuidLike } from '../lib/utils.js'
import { tenants, users, userRoles, customers } from '../schema.js'
import { recordFailedAttempt, clearLockoutState, validatePasswordPolicy } from '../lib/password-policy.js'

export type UserRecord = {
  id: string
  username: string
  passwordHash: string
  tenantId: string
  roles: string[]
  disabled?: boolean
  mfaEnabled?: boolean
  mfaSecret?: string | null
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
  failedLoginAttempts?: number
  lockedUntil?: Date | null
  authProvider?: string
  externalSubject?: string | null
}


/** Get a Drizzle DB instance from the pool (no tenant isolation, no transaction). */
function getPoolDrizzle(): DrizzleDB {
  const pool = getDb()
  if (!pool) throw new Error('DB not initialized')
  return createDrizzleDb(pool)
}

async function resolveCustomerLink(db: DrizzleDB, tenantId: string, customerRefInput?: string | null): Promise<{ customerId: string; customerKey: string | null; customerName: string | null } | null> {
  const customerRef = String(customerRefInput || '').trim()
  if (!customerRef) return null
  const byId = isUuidLike(customerRef)
  let row: typeof customers.$inferSelect | undefined
  if (byId) {
    const results = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        eq(customers.customerId, customerRef as any)
      ))
      .limit(1)
    row = results[0]
  } else {
    const results = await db
      .select()
      .from(customers)
      .where(and(
        eq(customers.tenantId, tenantId),
        sql`LOWER(${customers.customerKey}) = LOWER(${customerRef})`
      ))
      .limit(1)
    row = results[0]
  }
  if (!row) throw new Error('CUSTOMER_NOT_FOUND')
  return {
    customerId: String(row.customerId),
    customerKey: row.customerKey ? String(row.customerKey) : null,
    customerName: row.displayName ? String(row.displayName) : null
  }
}

export async function findByUsername(username: string): Promise<UserRecord | undefined> {
  const pool = getDb()
  if (!pool) return undefined
  const db = getPoolDrizzle()

  const rows = await db
    .select({
      ...getTableColumns(users),
      customerKey: customers.customerKey,
      displayName: customers.displayName,
    })
    .from(users)
    .leftJoin(customers, and(
      eq(customers.tenantId, users.tenantId),
      eq(customers.customerId, users.customerId as any)
    ))
    .where(sql`LOWER(${users.username}) = LOWER(${username})`)
    .limit(1)

  if (!rows.length) return undefined
  const u = rows[0]

  const rolesRows = await db
    .select({ roleCode: userRoles.roleCode })
    .from(userRoles)
    .where(eq(userRoles.userId, u.userId as any))

  return {
    id: String(u.userId),
    username: u.username,
    passwordHash: u.passwordHash,
    tenantId: u.tenantId,
    roles: rolesRows.map(r => r.roleCode),
    disabled: u.disabled ?? false,
    mfaEnabled: Boolean(u.mfaEnabled),
    mfaSecret: u.mfaSecret || null,
    customerId: u.customerId ? String(u.customerId) : null,
    customerKey: u.customerKey ? String(u.customerKey) : null,
    customerName: u.displayName ? String(u.displayName) : null,
    failedLoginAttempts: u.failedLoginAttempts ?? 0,
    lockedUntil: u.lockedUntil ?? null,
    authProvider: u.authProvider || 'local',
    externalSubject: u.externalSubject ?? null
  }
}

/** Records a failed login attempt and applies lockout once the threshold is reached. */
export async function recordFailedLoginAttempt(tenantId: string, userId: string): Promise<void> {
  const db = getPoolDrizzle()
  const rows = await db
    .select({ failedLoginAttempts: users.failedLoginAttempts, lockedUntil: users.lockedUntil })
    .from(users)
    .where(and(eq(users.userId, userId as any), eq(users.tenantId, tenantId)))
    .limit(1)
  if (!rows.length) return
  const next = recordFailedAttempt({
    failedLoginAttempts: rows[0].failedLoginAttempts ?? 0,
    lockedUntil: rows[0].lockedUntil ?? null
  })
  await db
    .update(users)
    .set({ failedLoginAttempts: next.failedLoginAttempts, lockedUntil: next.lockedUntil as any })
    .where(eq(users.userId, userId as any))
}

/** Resets lockout state after a successful login. */
export async function resetLoginFailureState(tenantId: string, userId: string): Promise<void> {
  const db = getPoolDrizzle()
  const cleared = clearLockoutState()
  await db
    .update(users)
    .set({ failedLoginAttempts: cleared.failedLoginAttempts, lockedUntil: cleared.lockedUntil as any })
    .where(and(eq(users.userId, userId as any), eq(users.tenantId, tenantId)))
}

/**
 * Finds an existing SSO-linked user by (tenantId, externalSubject), or
 * creates one on first login with the mapped roles. Never used for local
 * password auth — SSO users get a random unusable password hash.
 */
export async function findOrCreateSsoUser(params: {
  tenantId: string
  externalSubject: string
  username: string
  roles: string[]
}): Promise<Omit<UserRecord, 'passwordHash'>> {
  const db = getPoolDrizzle()

  const existing = await db
    .select({
      ...getTableColumns(users),
      customerKey: customers.customerKey,
      displayName: customers.displayName,
    })
    .from(users)
    .leftJoin(customers, and(
      eq(customers.tenantId, users.tenantId),
      eq(customers.customerId, users.customerId as any)
    ))
    .where(and(eq(users.tenantId, params.tenantId), eq(users.externalSubject, params.externalSubject)))
    .limit(1)

  if (existing.length) {
    const u = existing[0]
    const currentRoles = await db
      .select({ roleCode: userRoles.roleCode })
      .from(userRoles)
      .where(eq(userRoles.userId, u.userId as any))
    return {
      id: String(u.userId),
      username: u.username,
      tenantId: u.tenantId,
      roles: currentRoles.map((r) => r.roleCode),
      disabled: u.disabled ?? false,
      mfaEnabled: Boolean(u.mfaEnabled),
      customerId: u.customerId ? String(u.customerId) : null,
      customerKey: u.customerKey ? String(u.customerKey) : null,
      customerName: u.displayName ? String(u.displayName) : null,
      authProvider: u.authProvider || 'oidc',
      externalSubject: u.externalSubject
    }
  }

  const unusablePasswordHash = bcrypt.hashSync(crypto.randomUUID() + crypto.randomUUID(), 10)
  const [rec] = await db
    .insert(users)
    .values({
      tenantId: params.tenantId,
      username: params.username,
      passwordHash: unusablePasswordHash,
      authProvider: 'oidc',
      externalSubject: params.externalSubject
    })
    .returning()

  for (const role of params.roles) {
    await db.insert(userRoles).values({ userId: rec.userId as any, roleCode: role }).onConflictDoNothing()
  }

  return {
    id: String(rec.userId),
    username: params.username,
    tenantId: params.tenantId,
    roles: params.roles,
    disabled: rec.disabled ?? false,
    mfaEnabled: false,
    customerId: null,
    customerKey: null,
    customerName: null,
    authProvider: 'oidc',
    externalSubject: params.externalSubject
  }
}

export async function listByTenant(tenantId: string): Promise<Omit<UserRecord, 'passwordHash'>[]> {
  const db = getPoolDrizzle()

  const rows = await db
    .select({
      ...getTableColumns(users),
      customerKey: customers.customerKey,
      displayName: customers.displayName,
    })
    .from(users)
    .leftJoin(customers, and(
      eq(customers.tenantId, users.tenantId),
      eq(customers.customerId, users.customerId as any)
    ))
    .where(eq(users.tenantId, tenantId))
    .orderBy(users.username)

  const ids = rows.map(u => u.userId as string)
  let rolesMap = new Map<string, string[]>()
  if (ids.length > 0) {
    const rolesRows = await db
      .select({ userId: userRoles.userId, roleCode: userRoles.roleCode })
      .from(userRoles)
      .where(inArray(userRoles.userId, ids as any[]))
    for (const row of rolesRows) {
      const arr = rolesMap.get(String(row.userId)) || []
      arr.push(row.roleCode)
      rolesMap.set(String(row.userId), arr)
    }
  }

  return rows.map(u => ({
    id: String(u.userId),
    username: u.username,
    tenantId: u.tenantId,
    roles: rolesMap.get(String(u.userId)) || [],
    disabled: u.disabled ?? false,
    mfaEnabled: Boolean(u.mfaEnabled),
    customerId: u.customerId ? String(u.customerId) : null,
    customerKey: u.customerKey ? String(u.customerKey) : null,
    customerName: u.displayName ? String(u.displayName) : null
  }))
}

export async function createUser(data: { username: string; password: string; tenantId: string; roles: string[]; customerRef?: string | null; enforcePasswordPolicy?: boolean }): Promise<Omit<UserRecord, 'passwordHash'>> {
  const db = getPoolDrizzle()

  const existsRows = await db
    .select({ userId: users.userId })
    .from(users)
    .where(sql`LOWER(${users.username}) = LOWER(${data.username})`)
    .limit(1)
  if (existsRows.length > 0) throw new Error('USERNAME_EXISTS')

  const linkedCustomer = await resolveCustomerLink(db, data.tenantId, data.customerRef)
  if ((data.roles || []).includes('customer') && !linkedCustomer?.customerId) throw new Error('CUSTOMER_LINK_REQUIRED')

  if (data.enforcePasswordPolicy) {
    const policy = validatePasswordPolicy(data.password)
    if (!policy.ok) throw new Error(`WEAK_PASSWORD: ${policy.errors.join('; ')}`)
  }

  const hash = bcrypt.hashSync(data.password, 10)
  const [rec] = await db
    .insert(users)
    .values({
      tenantId: data.tenantId,
      username: data.username,
      passwordHash: hash,
      customerId: linkedCustomer?.customerId as any || null
    })
    .returning()

  if (Array.isArray(data.roles)) {
    for (const role of data.roles) {
      await db.insert(userRoles).values({ userId: rec.userId as any, roleCode: role })
    }
  }

  return {
    id: String(rec.userId),
    username: data.username,
    tenantId: data.tenantId,
    roles: data.roles || [],
    disabled: rec.disabled,
    mfaEnabled: Boolean(rec.mfaEnabled),
    customerId: rec.customerId ? String(rec.customerId) : null,
    customerKey: linkedCustomer?.customerKey || null,
    customerName: linkedCustomer?.customerName || null
  }
}

export async function updateUser(tenantId: string, id: string, patch: Partial<{ password: string; roles: string[]; disabled: boolean; customerRef: string | null; enforcePasswordPolicy: boolean }>): Promise<Omit<UserRecord, 'passwordHash'>> {
  const db = getPoolDrizzle()

  const existingRows = await db
    .select({
      ...getTableColumns(users),
      customerKey: customers.customerKey,
      displayName: customers.displayName,
    })
    .from(users)
    .leftJoin(customers, and(
      eq(customers.tenantId, users.tenantId),
      eq(customers.customerId, users.customerId as any)
    ))
    .where(and(eq(users.userId, id as any), eq(users.tenantId, tenantId)))
    .limit(1)

  if (!existingRows.length) throw new Error('NOT_FOUND')

  const hasCustomerRefPatch = Object.prototype.hasOwnProperty.call(patch, 'customerRef')
  let linkedCustomer = null as Awaited<ReturnType<typeof resolveCustomerLink>>

  if (hasCustomerRefPatch) {
    linkedCustomer = await resolveCustomerLink(db, tenantId, patch.customerRef)
    if (!patch.roles) {
      const currentRoles = await db
        .select({ roleCode: userRoles.roleCode })
        .from(userRoles)
        .where(eq(userRoles.userId, id as any))
      const hasCustomerRole = currentRoles.some(row => row.roleCode === 'customer')
      if (hasCustomerRole && !(linkedCustomer?.customerId || null)) {
        throw new Error('CUSTOMER_LINK_REQUIRED')
      }
    }
    await db
      .update(users)
      .set({ customerId: linkedCustomer?.customerId as any || null })
      .where(eq(users.userId, id as any))
  }

  if (patch.password) {
    if (patch.enforcePasswordPolicy) {
      const policy = validatePasswordPolicy(patch.password)
      if (!policy.ok) throw new Error(`WEAK_PASSWORD: ${policy.errors.join('; ')}`)
    }
    const hash = bcrypt.hashSync(patch.password, 10)
    await db
      .update(users)
      .set({ passwordHash: hash, passwordUpdatedAt: new Date() })
      .where(eq(users.userId, id as any))
  }

  if (typeof patch.disabled === 'boolean') {
    await db
      .update(users)
      .set({ disabled: patch.disabled })
      .where(eq(users.userId, id as any))
  }

  if (patch.roles) {
    const nextCustomerId = hasCustomerRefPatch
      ? (linkedCustomer?.customerId || null)
      : (existingRows[0].customerId ? String(existingRows[0].customerId) : null)
    if (patch.roles.includes('customer') && !nextCustomerId) throw new Error('CUSTOMER_LINK_REQUIRED')
    await db.delete(userRoles).where(eq(userRoles.userId, id as any))
    for (const role of patch.roles) {
      await db.insert(userRoles).values({ userId: id as any, roleCode: role })
    }
  }

  const updatedRows = await db
    .select({
      ...getTableColumns(users),
      customerKey: customers.customerKey,
      displayName: customers.displayName,
    })
    .from(users)
    .leftJoin(customers, and(
      eq(customers.tenantId, users.tenantId),
      eq(customers.customerId, users.customerId as any)
    ))
    .where(and(eq(users.userId, id as any), eq(users.tenantId, tenantId)))
    .limit(1)

  if (!updatedRows.length) throw new Error('NOT_FOUND')
  const u = updatedRows[0]

  const roles = await db
    .select({ roleCode: userRoles.roleCode })
    .from(userRoles)
    .where(eq(userRoles.userId, id as any))

  return {
    id,
    username: u.username,
    tenantId: u.tenantId,
    disabled: u.disabled ?? false,
    roles: roles.map(r => r.roleCode),
    mfaEnabled: Boolean(u.mfaEnabled),
    customerId: u.customerId ? String(u.customerId) : null,
    customerKey: u.customerKey ? String(u.customerKey) : null,
    customerName: u.displayName ? String(u.displayName) : null
  }
}

export async function deleteUser(tenantId: string, id: string) {
  const db = getPoolDrizzle()

  const existingRows = await db
    .select({ userId: users.userId })
    .from(users)
    .where(and(eq(users.userId, id as any), eq(users.tenantId, tenantId)))
    .limit(1)
  if (!existingRows.length) throw new Error('NOT_FOUND')

  await db.delete(userRoles).where(eq(userRoles.userId, id as any))
  await db.delete(users).where(eq(users.userId, id as any))
}

export async function ensureDefaults() {
  const pool = getDb()
  if (!pool) return
  await withTenantTx('sample-carrier', async (db) => {
    await db
      .insert(tenants)
      .values({ tenantId: 'sample-carrier', name: 'Sample Carrier' })
      .onConflictDoNothing()

    const defs = [
      { username: 'admin', roles: ['admin'] },
      { username: 'actuary1', roles: ['actuary'] },
      { username: 'uw1', roles: ['underwriter'] },
      { username: 'agent1', roles: ['agent'] }
    ]

    const existingUsersRows = await db
      .select({ userId: users.userId, username: users.username })
      .from(users)
      .where(eq(users.tenantId, 'sample-carrier'))

    const existingByUsername = new Map<string, string>()
    for (const row of existingUsersRows) {
      existingByUsername.set(String(row.username || '').toLowerCase(), String(row.userId))
    }

    for (const d of defs) {
      let userId = existingByUsername.get(d.username.toLowerCase()) || ''
      if (!userId) {
        const hash = bcrypt.hashSync('password', 10)
        const [rec] = await db
          .insert(users)
          .values({ tenantId: 'sample-carrier', username: d.username, passwordHash: hash })
          .returning({ userId: users.userId })
        userId = String(rec.userId)
        existingByUsername.set(d.username.toLowerCase(), userId)
      }
      for (const role of d.roles) {
        await db
          .insert(userRoles)
          .values({ userId: userId as any, roleCode: role })
          .onConflictDoNothing()
      }
    }
  })
}
