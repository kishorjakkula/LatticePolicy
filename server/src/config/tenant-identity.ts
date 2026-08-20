import { getDb, withTenantTx, toRawQuery } from '../db.js'

export type TenantSsoConfig = {
  enabled: boolean
  issuer: string
  clientId: string
  /** Name of the environment variable holding the client secret. Never stored in the DB directly. */
  clientSecretEnvVar: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
  redirectUri: string
  /** Dotted path into decoded ID token claims where role values live, e.g. "roles" or "realm_access.roles". */
  rolesClaim: string
  /** Maps an external claim role value to an internal LatticePolicy role code. */
  roleMapping: Record<string, string>
  /** Applied when no claim value matches roleMapping. */
  defaultRoles: string[]
}

const DEFAULT_SSO_CONFIG: TenantSsoConfig = {
  enabled: false,
  issuer: '',
  clientId: '',
  clientSecretEnvVar: '',
  authorizationEndpoint: '',
  tokenEndpoint: '',
  jwksUri: '',
  redirectUri: '',
  rolesClaim: 'roles',
  roleMapping: {},
  defaultRoles: []
}

const memoryTenantSsoConfig = new Map<string, TenantSsoConfig>()
const memoryTenantLocalAuthEnabled = new Map<string, boolean>()

export function defaultTenantSsoConfig(): TenantSsoConfig {
  return { ...DEFAULT_SSO_CONFIG, roleMapping: {}, defaultRoles: [] }
}

export function normalizeTenantSsoConfig(input: any, fallback: TenantSsoConfig = defaultTenantSsoConfig()): TenantSsoConfig {
  if (!input || typeof input !== 'object') return fallback
  const str = (value: any, current: string) => (typeof value === 'string' ? value.trim() : current)
  const roleMapping: Record<string, string> = { ...fallback.roleMapping }
  if (input.roleMapping && typeof input.roleMapping === 'object') {
    for (const [key, value] of Object.entries(input.roleMapping)) {
      if (typeof value === 'string' && value.trim()) roleMapping[String(key)] = value.trim()
    }
  }
  const defaultRoles = Array.isArray(input.defaultRoles)
    ? input.defaultRoles.map((role: any) => String(role || '').trim()).filter(Boolean)
    : fallback.defaultRoles
  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : fallback.enabled,
    issuer: str(input.issuer, fallback.issuer),
    clientId: str(input.clientId, fallback.clientId),
    clientSecretEnvVar: str(input.clientSecretEnvVar, fallback.clientSecretEnvVar),
    authorizationEndpoint: str(input.authorizationEndpoint, fallback.authorizationEndpoint),
    tokenEndpoint: str(input.tokenEndpoint, fallback.tokenEndpoint),
    jwksUri: str(input.jwksUri, fallback.jwksUri),
    redirectUri: str(input.redirectUri, fallback.redirectUri),
    rolesClaim: str(input.rolesClaim, fallback.rolesClaim) || 'roles',
    roleMapping,
    defaultRoles
  }
}

export function tenantSsoConfigFromRow(row: any): TenantSsoConfig {
  if (!row || typeof row !== 'object') return defaultTenantSsoConfig()
  const raw = row.sso_config ?? row.ssoConfig
  if (raw == null) return defaultTenantSsoConfig()
  const parsed = typeof raw === 'string' ? safeParseJson(raw) : raw
  return normalizeTenantSsoConfig(parsed, defaultTenantSsoConfig())
}

function safeParseJson(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function getMemoryTenantSsoConfig(tenantId: string): TenantSsoConfig {
  const existing = memoryTenantSsoConfig.get(tenantId)
  if (existing) return JSON.parse(JSON.stringify(existing))
  const defaults = defaultTenantSsoConfig()
  memoryTenantSsoConfig.set(tenantId, defaults)
  return JSON.parse(JSON.stringify(defaults))
}

export function setMemoryTenantSsoConfig(tenantId: string, input: any): TenantSsoConfig {
  const current = getMemoryTenantSsoConfig(tenantId)
  const next = normalizeTenantSsoConfig(input, current)
  memoryTenantSsoConfig.set(tenantId, next)
  return JSON.parse(JSON.stringify(next))
}

export async function loadTenantSsoConfig(tenantId: string): Promise<TenantSsoConfig> {
  const db = getDb()
  if (!db) return getMemoryTenantSsoConfig(tenantId)
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT sso_config FROM tenants WHERE tenant_id=$1 LIMIT 1', [tenantId])
    })
    if (!(result.rowCount || 0)) return defaultTenantSsoConfig()
    return tenantSsoConfigFromRow(result.rows[0])
  } catch {
    return defaultTenantSsoConfig()
  }
}

export function defaultTenantLocalAuthEnabled(): boolean {
  return true
}

export function normalizeTenantLocalAuthEnabled(value: any, fallback = true): boolean {
  if (typeof value === 'boolean') return value
  if (value == null) return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true
  if (['false', '0', 'no', 'off'].includes(normalized)) return false
  return fallback
}

export function tenantLocalAuthEnabledFromRow(row: any): boolean {
  if (!row || typeof row !== 'object') return defaultTenantLocalAuthEnabled()
  return normalizeTenantLocalAuthEnabled(row.local_auth_enabled ?? row.localAuthEnabled, defaultTenantLocalAuthEnabled())
}

export function getMemoryTenantLocalAuthEnabled(tenantId: string): boolean {
  if (memoryTenantLocalAuthEnabled.has(tenantId)) return Boolean(memoryTenantLocalAuthEnabled.get(tenantId))
  const fallback = defaultTenantLocalAuthEnabled()
  memoryTenantLocalAuthEnabled.set(tenantId, fallback)
  return fallback
}

export function setMemoryTenantLocalAuthEnabled(tenantId: string, value: any): boolean {
  const current = getMemoryTenantLocalAuthEnabled(tenantId)
  const normalized = normalizeTenantLocalAuthEnabled(value, current)
  memoryTenantLocalAuthEnabled.set(tenantId, normalized)
  return normalized
}

export async function loadTenantLocalAuthEnabled(tenantId: string): Promise<boolean> {
  const db = getDb()
  if (!db) return getMemoryTenantLocalAuthEnabled(tenantId)
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT local_auth_enabled FROM tenants WHERE tenant_id=$1 LIMIT 1', [tenantId])
    })
    if (!(result.rowCount || 0)) return defaultTenantLocalAuthEnabled()
    return tenantLocalAuthEnabledFromRow(result.rows[0])
  } catch {
    return defaultTenantLocalAuthEnabled()
  }
}
