export type RuntimeConfigValidation = {
  ok: boolean
  missing: string[]
  invalid: string[]
}

const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CUSTOMER_DATA_KEY',
  'MFA_TOKEN_SECRET',
  'ALLOWED_ORIGINS'
] as const

const REQUIRED_SECRET_ENV = ['JWT_SECRET', 'CUSTOMER_DATA_KEY', 'MFA_TOKEN_SECRET'] as const
const UNSAFE_SECRET_VALUES = new Set([
  'change-me',
  'change-me-please-use-a-long-random-string',
  'customer-data-key',
  'dev-secret',
  'jwt-secret',
  'lattice-policy-customer-dev-key',
  'mfa-token-secret',
  'password',
  'secret',
  'test'
])

const MANAGED_DEPLOYMENT_ENVS = ['test', 'validation', 'staging', 'production'] as const

export function getDeploymentEnv(): string {
  return String(process.env.DEPLOYMENT_ENV || process.env.APP_ENV || '').trim().toLowerCase()
}

export function isManagedDeployment(): boolean {
  const deploymentEnv = getDeploymentEnv()
  if (deploymentEnv === 'local') return false
  return process.env.NODE_ENV === 'production' || MANAGED_DEPLOYMENT_ENVS.some((value) => value === deploymentEnv)
}

export function isTruthyEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

export function getJwtSecret(): string {
  assertDeploymentConfig()
  return process.env.JWT_SECRET || 'dev-secret'
}

export function getMfaTokenSecret(): string {
  assertDeploymentConfig()
  return process.env.MFA_TOKEN_SECRET || `${getJwtSecret()}-mfa`
}

export function getSsoStateSecret(): string {
  assertDeploymentConfig()
  return process.env.SSO_STATE_SECRET || `${getJwtSecret()}-sso-state`
}

export function getAllowedOrigins(): string[] {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

export function getInviteOnlyAllowedUsers(): string[] {
  return String(process.env.DEMO_ALLOWED_EMAILS || process.env.DEMO_ALLOWED_USERS || '')
    .split(',')
    .map((user) => user.trim().toLowerCase())
    .filter(Boolean)
}

export function isInviteOnlyDemoAccess(): boolean {
  return String(process.env.DEMO_ACCESS_MODE || '').trim().toLowerCase() === 'invite_only'
}

export function isDemoUserAllowed(username: string): boolean {
  if (!isInviteOnlyDemoAccess()) return true
  const allowedUsers = getInviteOnlyAllowedUsers()
  if (!allowedUsers.length) return false
  return allowedUsers.includes(String(username || '').trim().toLowerCase())
}

export function getDemoLoginName(username: string): string {
  const normalized = String(username || '').trim().toLowerCase()
  return normalized.includes('@') ? normalized.split('@')[0] : normalized
}

export function validateDeploymentConfig(): RuntimeConfigValidation {
  if (!isManagedDeployment()) return { ok: true, missing: [], invalid: [] }
  const missing: string[] = REQUIRED_PRODUCTION_ENV.filter((name) => !String(process.env[name] || '').trim())
  const invalid: string[] = []

  for (const name of REQUIRED_SECRET_ENV) {
    const value = String(process.env[name] || '').trim()
    if (!value) continue
    const normalized = value.toLowerCase()
    if (UNSAFE_SECRET_VALUES.has(normalized) || normalized.includes('change-me')) {
      invalid.push(`${name} must not use a demo, test, or placeholder value`)
    } else if (value.length < 32) {
      invalid.push(`${name} must be at least 32 characters`)
    }
  }

  const configuredSecrets = REQUIRED_SECRET_ENV
    .map((name) => [name, String(process.env[name] || '').trim()] as const)
    .filter(([, value]) => value)
  for (let i = 0; i < configuredSecrets.length; i += 1) {
    for (let j = i + 1; j < configuredSecrets.length; j += 1) {
      const [leftName, leftValue] = configuredSecrets[i]
      const [rightName, rightValue] = configuredSecrets[j]
      if (leftValue === rightValue) {
        invalid.push(`${leftName} and ${rightName} must use different values`)
      }
    }
  }

  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.some((origin) => origin === '*')) {
    invalid.push('ALLOWED_ORIGINS must list explicit HTTPS origins, not *')
  }
  for (const origin of allowedOrigins) {
    if (origin === '*') continue
    try {
      const url = new URL(origin)
      if (url.protocol !== 'https:') invalid.push(`ALLOWED_ORIGINS contains non-HTTPS origin: ${origin}`)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        invalid.push(`ALLOWED_ORIGINS contains local origin: ${origin}`)
      }
    } catch {
      invalid.push(`ALLOWED_ORIGINS contains invalid origin: ${origin}`)
    }
  }

  if (isTruthyEnv(process.env.CACHE_ENABLED) && !String(process.env.REDIS_URL || '').trim()) {
    invalid.push('REDIS_URL is required when CACHE_ENABLED is true')
  }

  if (isInviteOnlyDemoAccess() && getInviteOnlyAllowedUsers().length === 0) missing.push('DEMO_ALLOWED_EMAILS')
  return { ok: missing.length === 0 && invalid.length === 0, missing: [...missing], invalid: [...invalid] }
}

export function assertDeploymentConfig() {
  const validation = validateDeploymentConfig()
  if (!validation.ok) {
    const messages = [
      validation.missing.length
        ? `Missing required deployment environment variables: ${validation.missing.join(', ')}`
        : '',
      ...validation.invalid
    ].filter(Boolean)
    throw new Error(messages.join('; '))
  }
}

export const isProduction = isManagedDeployment
export const validateProductionConfig = validateDeploymentConfig
export const assertProductionConfig = assertDeploymentConfig
