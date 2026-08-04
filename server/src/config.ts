export type RuntimeConfigValidation = {
  ok: boolean
  missing: string[]
}

const REQUIRED_PRODUCTION_ENV = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CUSTOMER_DATA_KEY',
  'MFA_TOKEN_SECRET',
  'ALLOWED_ORIGINS'
] as const

export function getDeploymentEnv(): string {
  return String(process.env.DEPLOYMENT_ENV || process.env.APP_ENV || '').trim().toLowerCase()
}

export function isManagedDeployment(): boolean {
  const deploymentEnv = getDeploymentEnv()
  return process.env.NODE_ENV === 'production' || ['test', 'validation', 'staging', 'production'].includes(deploymentEnv)
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
  if (!isManagedDeployment()) return { ok: true, missing: [] }
  const missing: string[] = REQUIRED_PRODUCTION_ENV.filter((name) => !String(process.env[name] || '').trim())
  if (isInviteOnlyDemoAccess() && getInviteOnlyAllowedUsers().length === 0) missing.push('DEMO_ALLOWED_EMAILS')
  return { ok: missing.length === 0, missing: [...missing] }
}

export function assertDeploymentConfig() {
  const validation = validateDeploymentConfig()
  if (!validation.ok) {
    throw new Error(`Missing required deployment environment variables: ${validation.missing.join(', ')}`)
  }
}

export const isProduction = isManagedDeployment
export const validateProductionConfig = validateDeploymentConfig
export const assertProductionConfig = assertDeploymentConfig
