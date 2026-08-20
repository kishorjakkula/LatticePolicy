import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { findByUsername, ensureDefaults } from './users.js'
import { withTenantTx, getDb, toRawQuery } from './db.js'
import { ensureTenantRbacDefaults, getDefaultPermissionCodesForRoles, resolvePermissionsForRoles } from './rbac.js'
import { buildOtpAuthUri, generateMfaSecret, normalizeOtpCode, verifyTotpCode } from './mfa.js'
import { getMemoryTenantMfaRequired } from './tenantSecurity.js'
import { getDemoLoginName, getJwtSecret, getMfaTokenSecret, isDemoUserAllowed, isManagedDeployment } from './config.js'
import { loadTenantLocalAuthEnabled } from './config/tenant-identity.js'
import { isLockedOut } from './lib/password-policy.js'
import { recordFailedLoginAttempt, resetLoginFailureState } from './services/user.service.js'

type User = {
  id: string
  username: string
  tenantId: string
  roles: string[]
  permissions?: string[]
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
}

const MFA_ISSUER = process.env.MFA_ISSUER || 'LatticePolicy'

type MfaTokenKind = 'challenge' | 'setup'
type MfaTokenPayload = {
  kind: MfaTokenKind
  sub: string
  username: string
  tenantId: string
  roles: string[]
  permissions: string[]
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
  pendingSecret?: string
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User
    }
  }
}

export function issueToken(user: User): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions || [],
      customerId: user.customerId || null,
      customerKey: user.customerKey || null,
      customerName: user.customerName || null
    },
    getJwtSecret(),
    { expiresIn: '8h' }
  )
}

function issueMfaToken(
  payload: Omit<MfaTokenPayload, 'sub'> & { sub: string },
  expiresIn: jwt.SignOptions['expiresIn']
): string {
  return jwt.sign(payload, getMfaTokenSecret(), { expiresIn } as jwt.SignOptions)
}

function verifyMfaToken(token: string, expectedKind: MfaTokenKind): MfaTokenPayload | null {
  try {
    const payload = jwt.verify(token, getMfaTokenSecret()) as any
    if (!payload || payload.kind !== expectedKind) return null
    return {
      kind: payload.kind,
      sub: String(payload.sub || ''),
      username: String(payload.username || ''),
      tenantId: String(payload.tenantId || ''),
      roles: Array.isArray(payload.roles) ? payload.roles.map((x: any) => String(x)) : [],
      permissions: Array.isArray(payload.permissions) ? payload.permissions.map((x: any) => String(x)) : [],
      customerId: payload.customerId ? String(payload.customerId) : null,
      customerKey: payload.customerKey ? String(payload.customerKey) : null,
      customerName: payload.customerName ? String(payload.customerName) : null,
      pendingSecret: typeof payload.pendingSecret === 'string' ? payload.pendingSecret : undefined
    }
  } catch {
    return null
  }
}

async function resolvePermissions(tenantId: string, roles: string[]): Promise<string[]> {
  if (!roles.length) return []
  try {
    return await resolvePermissionsForRoles(tenantId, roles)
  } catch {
    return getDefaultPermissionCodesForRoles(roles)
  }
}

async function loadRolesForUser(tenantId: string, userId: string, fallbackRoles: string[]): Promise<string[]> {
  if (!getDb()) return fallbackRoles
  try {
    const rolesRes = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT ur.role_code
           FROM user_roles ur
           JOIN users u ON u.user_id = ur.user_id
          WHERE u.tenant_id = $1
            AND ur.user_id = $2`,
        [tenantId, userId]
      )
    })
    const rows = ((rolesRes as any).rows || [])
      .map((row: any) => String(row.role_code || ''))
      .filter(Boolean)
    return rows.length ? rows : fallbackRoles
  } catch {
    return fallbackRoles
  }
}

export async function buildAuthUser(base: User): Promise<User> {
  const roles = await loadRolesForUser(base.tenantId, base.id, base.roles || [])
  const permissions = await resolvePermissions(base.tenantId, roles)
  if (!getDb()) return { ...base, roles, permissions }
  try {
    const linkRes = await withTenantTx(base.tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT u.customer_id, c.customer_key, c.display_name
           FROM users u
           LEFT JOIN customers c
             ON c.tenant_id = u.tenant_id
            AND c.customer_id = u.customer_id
          WHERE u.tenant_id = $1 AND u.user_id = $2
          LIMIT 1`,
        [base.tenantId, base.id]
      )
    })
    const row = (linkRes as any).rows?.[0]
    return {
      ...base,
      roles,
      permissions,
      customerId: row?.customer_id ? String(row.customer_id) : (base.customerId || null),
      customerKey: row?.customer_key ? String(row.customer_key) : (base.customerKey || null),
      customerName: row?.display_name ? String(row.display_name) : (base.customerName || null)
    }
  } catch {
    return { ...base, roles, permissions }
  }
}

async function resolveTenantMfaRequired(tenantId: string): Promise<boolean> {
  const db = getDb()
  if (!db) return getMemoryTenantMfaRequired(tenantId)
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT mfa_required FROM tenants WHERE tenant_id=$1 LIMIT 1', [tenantId])
    })
    if (!((result as any).rowCount > 0)) return false
    return Boolean((result as any).rows[0]?.mfa_required)
  } catch {
    return false
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const hdr = req.header('Authorization') || ''
  const bearerPrefix = 'Bearer '
  const headerToken = hdr.startsWith(bearerPrefix) ? hdr.slice(bearerPrefix.length) : ''
  const queryTokenAllowed = req.path === '/api-docs' || req.path === '/openapi.json'
  const queryToken = queryTokenAllowed ? String((req.query as any)?.token || '').trim() : ''
  const rawToken = (headerToken || queryToken || '').trim()
  if (rawToken) {
    try {
      const payload: any = jwt.verify(rawToken, getJwtSecret())
      req.user = {
        id: payload.sub,
        username: payload.username,
        tenantId: payload.tenantId,
        roles: payload.roles,
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
        customerId: payload.customerId ? String(payload.customerId) : null,
        customerKey: payload.customerKey ? String(payload.customerKey) : null,
        customerName: payload.customerName ? String(payload.customerName) : null
      }
    } catch {}
  }
  next()
}

export async function handleLogin(req: Request, res: Response) {
  const { username, password, tenantId: bodyTenant, otp } = req.body || {}
  const headerTenant = (req.header('X-Tenant') || '').toString().trim()
  const tenantId = (bodyTenant || headerTenant)
  if (!tenantId) return res.status(400).json({ code: 'TENANT_REQUIRED', message: 'Provide tenantId in body or X-Tenant header' })
  if (!username || !password) return res.status(400).json({ code: 'INVALID_CREDENTIALS' })
  if (!isDemoUserAllowed(username)) return res.status(403).json({ code: 'DEMO_ACCESS_NOT_ALLOWED', message: 'This demo is invite-only' })
  const localAuthEnabled = await loadTenantLocalAuthEnabled(tenantId)
  if (!localAuthEnabled) {
    return res.status(403).json({ code: 'LOCAL_AUTH_DISABLED', message: 'Local username/password login is disabled for this tenant. Use single sign-on instead.' })
  }
  // If DB is not configured, allow demo logins to unblock UI exploration
  if (!getDb()) {
    if (isManagedDeployment()) return res.status(503).json({ code: 'DATABASE_UNAVAILABLE', message: 'Database is required in managed deployments' })
    const demoLoginName = getDemoLoginName(username)
    const demoUsers: Record<string, string[]> = {
      admin: ['admin'],
      actuary1: ['actuary'],
      uw1: ['underwriter'],
      agent1: ['agent'],
      customer1: ['customer']
    }
    const roles = demoUsers[demoLoginName as keyof typeof demoUsers]
    if (!roles || password !== 'password') return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
    const permissions = getDefaultPermissionCodesForRoles(roles)
    const user: User = { id: `demo-${username}`, username, tenantId, roles, permissions }
    const token = issueToken(user)
    return res.json({ token, user })
  }

  if (!isManagedDeployment()) await ensureDefaults()
  await ensureTenantRbacDefaults(tenantId)
  // Run user lookup under tenant RLS
  const u = await withTenantTx(tenantId, async () => await findByUsername(username))
  if (!u || u.disabled) return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
  if (u.authProvider === 'oidc') return res.status(401).json({ code: 'SSO_ACCOUNT', message: 'This account signs in through SSO, not username/password' })
  if (isLockedOut({ lockedUntil: u.lockedUntil ?? null })) {
    return res.status(423).json({ code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked after too many failed login attempts. Try again later.' })
  }
  if (!bcrypt.compareSync(password, u.passwordHash)) {
    await recordFailedLoginAttempt(tenantId, u.id)
    return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
  }
  await resetLoginFailureState(tenantId, u.id)
  const user = await buildAuthUser({ id: u.id, username: u.username, tenantId: u.tenantId, roles: u.roles || [] })
  const mfaRequired = await resolveTenantMfaRequired(tenantId)
  if (!mfaRequired) {
    const token = issueToken(user)
    return res.json({ token, user })
  }

  const normalizedOtp = normalizeOtpCode(otp)
  if (u.mfaEnabled && u.mfaSecret) {
    if (normalizedOtp && verifyTotpCode(u.mfaSecret, normalizedOtp)) {
      const token = issueToken(user)
      return res.json({ token, user })
    }
    const challengeToken = issueMfaToken(
      {
        kind: 'challenge',
        sub: user.id,
        username: user.username,
        tenantId: user.tenantId,
        roles: user.roles,
        permissions: user.permissions || []
      },
      '5m'
    )
    return res.json({ mfaRequired: true, challengeToken })
  }

  const pendingSecret = generateMfaSecret()
  const setupToken = issueMfaToken(
    {
      kind: 'setup',
      sub: user.id,
      username: user.username,
      tenantId: user.tenantId,
      roles: user.roles,
      permissions: user.permissions || [],
      pendingSecret
    },
    '10m'
  )
  return res.json({
    mfaRequired: true,
    setupRequired: true,
    setupToken,
    manualKey: pendingSecret,
    otpAuthUri: buildOtpAuthUri({
      issuer: MFA_ISSUER,
      username: user.username,
      tenantId: user.tenantId,
      secret: pendingSecret
    })
  })
}

export async function handleMfaVerify(req: Request, res: Response) {
  const { challengeToken, otp } = req.body || {}
  const parsed = verifyMfaToken(String(challengeToken || ''), 'challenge')
  if (!parsed) return res.status(401).json({ code: 'INVALID_MFA_CHALLENGE', message: 'Challenge expired or invalid' })
  const normalizedOtp = normalizeOtpCode(otp)
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return res.status(400).json({ code: 'INVALID_OTP', message: 'Enter a valid 6-digit verification code' })
  }
  if (!getDb()) {
    return res.status(400).json({ code: 'MFA_UNAVAILABLE', message: 'MFA verification requires database mode' })
  }
  const userRow = await withTenantTx(parsed.tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT user_id, username, disabled, mfa_enabled, mfa_secret
         FROM users
        WHERE tenant_id=$1 AND user_id=$2
        LIMIT 1`,
      [parsed.tenantId, parsed.sub]
    )
  })
  if (!((userRow as any).rowCount > 0)) {
    return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
  }
  const row = (userRow as any).rows[0]
  if (row.disabled) return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
  if (!row.mfa_enabled || !row.mfa_secret) {
    return res.status(400).json({ code: 'MFA_NOT_ENROLLED', message: 'MFA is not enrolled for this user' })
  }
  if (!verifyTotpCode(String(row.mfa_secret), normalizedOtp)) {
    return res.status(401).json({ code: 'INVALID_OTP', message: 'Invalid verification code' })
  }
  const user = await buildAuthUser({
    id: row.user_id,
    username: row.username,
    tenantId: parsed.tenantId,
    roles: parsed.roles
  })
  const token = issueToken(user)
  return res.json({ token, user })
}

export async function handleMfaSetupConfirm(req: Request, res: Response) {
  const { setupToken, otp } = req.body || {}
  const parsed = verifyMfaToken(String(setupToken || ''), 'setup')
  if (!parsed || !parsed.pendingSecret) {
    return res.status(401).json({ code: 'INVALID_MFA_SETUP', message: 'Setup token expired or invalid' })
  }
  const normalizedOtp = normalizeOtpCode(otp)
  if (!/^\d{6}$/.test(normalizedOtp)) {
    return res.status(400).json({ code: 'INVALID_OTP', message: 'Enter a valid 6-digit verification code' })
  }
  if (!verifyTotpCode(parsed.pendingSecret, normalizedOtp)) {
    return res.status(401).json({ code: 'INVALID_OTP', message: 'Invalid verification code' })
  }
  if (!getDb()) {
    return res.status(400).json({ code: 'MFA_UNAVAILABLE', message: 'MFA enrollment requires database mode' })
  }
  const updated = await withTenantTx(parsed.tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `UPDATE users
          SET mfa_enabled = true,
              mfa_secret = $3
        WHERE tenant_id = $1
          AND user_id = $2
          AND disabled = false
      RETURNING user_id, username`,
      [parsed.tenantId, parsed.sub, parsed.pendingSecret]
    )
  })
  if (!((updated as any).rowCount > 0)) {
    return res.status(401).json({ code: 'INVALID_CREDENTIALS' })
  }
  const row = (updated as any).rows[0]
  const user = await buildAuthUser({
    id: row.user_id,
    username: row.username,
    tenantId: parsed.tenantId,
    roles: parsed.roles
  })
  const token = issueToken(user)
  return res.json({ token, user })
}

export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Login required' })
    }
    const roles = req.user?.roles || []
    if (!roles.includes(role) && !roles.includes('admin')) {
      return res.status(403).json({ code: 'FORBIDDEN', message: `Role ${role} required` })
    }
    next()
  }
}

export function hasPermission(req: Request, permission: string): boolean {
  const user = req.user
  if (!user) return false
  const roles = user.roles || []
  if (roles.includes('admin')) return true
  const permissions = Array.isArray(user.permissions) ? user.permissions : []
  return permissions.includes(permission)
}

async function hydratePermissions(req: Request): Promise<string[]> {
  if (!req.user) return []
  const tenantId = req.tenant?.tenantId || req.user.tenantId
  if (!tenantId) return []
  let roles = req.user.roles || []
  if (getDb() && req.user.id) {
    try {
      const dbRoles = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        return q(
          `SELECT ur.role_code
             FROM user_roles ur
             JOIN users u ON u.user_id = ur.user_id
            WHERE u.tenant_id = $1
              AND ur.user_id = $2`,
          [tenantId, req.user!.id]
        )
      })
      const nextRoles = ((dbRoles as any).rows || [])
        .map((x: any) => String(x.role_code || ''))
        .filter(Boolean)
      if (nextRoles.length) {
        roles = nextRoles
        req.user.roles = nextRoles
      }
    } catch {
      // Fall back to token roles when role refresh fails.
    }
  }
  if (!roles.length) return []
  try {
    const resolved = await resolvePermissionsForRoles(tenantId, roles)
    req.user.permissions = resolved
    return resolved
  } catch {
    const fallback = getDefaultPermissionCodesForRoles(roles)
    req.user.permissions = fallback
    return fallback
  }
}

export function requirePermission(permission: string | string[]) {
  const needed = Array.isArray(permission) ? permission : [permission]
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ code: 'UNAUTHENTICATED', message: 'Login required' })
    }
    const permissions = await hydratePermissions(req)
    const allowed = needed.some((code) => permissions.includes(code) || hasPermission(req, code))
    if (!allowed) {
      return res.status(403).json({ code: 'FORBIDDEN', message: `Permission required: ${needed.join(' or ')}` })
    }
    next()
  }
}
