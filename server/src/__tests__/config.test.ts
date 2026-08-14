import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertDeploymentConfig,
  getAllowedOrigins,
  getDemoLoginName,
  getJwtSecret,
  getMfaTokenSecret,
  isManagedDeployment,
  isDemoUserAllowed,
  validateDeploymentConfig
} from '../config.js'

const ORIGINAL_ENV = { ...process.env }
const SAFE_JWT_SECRET = 'jwt-secret-for-production-runtime-tests-12345'
const SAFE_CUSTOMER_DATA_KEY = 'customer-data-key-for-production-tests-12345'
const SAFE_MFA_TOKEN_SECRET = 'mfa-token-secret-for-production-tests-12345'

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.APP_ENV
  delete process.env.CACHE_ENABLED
  delete process.env.DEMO_ACCESS_MODE
  delete process.env.DEMO_ALLOWED_EMAILS
  delete process.env.DEMO_ALLOWED_USERS
  delete process.env.DEPLOYMENT_ENV
  delete process.env.REDIS_URL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('runtime config', () => {
  it('requires managed test deployment secrets and database configuration', () => {
    process.env.DEPLOYMENT_ENV = 'test'
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    delete process.env.CUSTOMER_DATA_KEY
    delete process.env.MFA_TOKEN_SECRET
    delete process.env.ALLOWED_ORIGINS

    expect(validateDeploymentConfig()).toEqual({
      ok: false,
      missing: ['DATABASE_URL', 'JWT_SECRET', 'CUSTOMER_DATA_KEY', 'MFA_TOKEN_SECRET', 'ALLOWED_ORIGINS'],
      invalid: []
    })
  })

  it('requires an allowlist for invite-only test deployments', () => {
    process.env.DEPLOYMENT_ENV = 'test'
    process.env.DATABASE_URL = 'postgres://example'
    process.env.JWT_SECRET = SAFE_JWT_SECRET
    process.env.CUSTOMER_DATA_KEY = SAFE_CUSTOMER_DATA_KEY
    process.env.MFA_TOKEN_SECRET = SAFE_MFA_TOKEN_SECRET
    process.env.ALLOWED_ORIGINS = 'https://demo.example.com'
    process.env.DEMO_ACCESS_MODE = 'invite_only'
    delete process.env.DEMO_ALLOWED_EMAILS

    expect(validateDeploymentConfig()).toEqual({
      ok: false,
      missing: ['DEMO_ALLOWED_EMAILS'],
      invalid: []
    })
  })

  it('allows non-production in-memory demo mode', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL

    expect(validateDeploymentConfig()).toEqual({ ok: true, missing: [], invalid: [] })
  })

  it('treats NODE_ENV production as a managed deployment', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DEPLOYMENT_ENV
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    delete process.env.CUSTOMER_DATA_KEY
    delete process.env.MFA_TOKEN_SECRET
    delete process.env.ALLOWED_ORIGINS

    expect(isManagedDeployment()).toBe(true)
    expect(validateDeploymentConfig()).toEqual({
      ok: false,
      missing: ['DATABASE_URL', 'JWT_SECRET', 'CUSTOMER_DATA_KEY', 'MFA_TOKEN_SECRET', 'ALLOWED_ORIGINS'],
      invalid: []
    })
  })

  it('throws from reusable secret helpers when managed deployment config is incomplete', () => {
    process.env.DEPLOYMENT_ENV = 'test'
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    delete process.env.CUSTOMER_DATA_KEY
    delete process.env.MFA_TOKEN_SECRET

    expect(() => getJwtSecret()).toThrow(/Missing required deployment environment variables/)
    expect(() => getMfaTokenSecret()).toThrow(/Missing required deployment environment variables/)
  })

  it('rejects placeholder, short, or reused production secrets', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://example'
    process.env.JWT_SECRET = 'dev-secret'
    process.env.CUSTOMER_DATA_KEY = 'short'
    process.env.MFA_TOKEN_SECRET = 'short'
    process.env.ALLOWED_ORIGINS = 'https://demo.example.com'

    const validation = validateDeploymentConfig()

    expect(validation.ok).toBe(false)
    expect(validation.missing).toEqual([])
    expect(validation.invalid).toEqual(expect.arrayContaining([
      'JWT_SECRET must not use a demo, test, or placeholder value',
      'CUSTOMER_DATA_KEY must be at least 32 characters',
      'MFA_TOKEN_SECRET must be at least 32 characters',
      'CUSTOMER_DATA_KEY and MFA_TOKEN_SECRET must use different values'
    ]))
    expect(() => assertDeploymentConfig()).toThrow(/JWT_SECRET must not use/)
  })

  it('rejects unsafe managed CORS origins and cache configuration', () => {
    process.env.DEPLOYMENT_ENV = 'staging'
    process.env.DATABASE_URL = 'postgres://example'
    process.env.JWT_SECRET = SAFE_JWT_SECRET
    process.env.CUSTOMER_DATA_KEY = SAFE_CUSTOMER_DATA_KEY
    process.env.MFA_TOKEN_SECRET = SAFE_MFA_TOKEN_SECRET
    process.env.ALLOWED_ORIGINS = '*,http://demo.example.com,https://localhost:5173'
    process.env.CACHE_ENABLED = '1'
    delete process.env.REDIS_URL

    expect(validateDeploymentConfig()).toEqual({
      ok: false,
      missing: [],
      invalid: [
        'ALLOWED_ORIGINS must list explicit HTTPS origins, not *',
        'ALLOWED_ORIGINS contains non-HTTPS origin: http://demo.example.com',
        'ALLOWED_ORIGINS contains local origin: https://localhost:5173',
        'REDIS_URL is required when CACHE_ENABLED is true'
      ]
    })
  })

  it('accepts complete production runtime configuration', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://example'
    process.env.JWT_SECRET = SAFE_JWT_SECRET
    process.env.CUSTOMER_DATA_KEY = SAFE_CUSTOMER_DATA_KEY
    process.env.MFA_TOKEN_SECRET = SAFE_MFA_TOKEN_SECRET
    process.env.ALLOWED_ORIGINS = 'https://demo.example.com'

    expect(validateDeploymentConfig()).toEqual({ ok: true, missing: [], invalid: [] })
  })

  it('enforces invite-only demo users when configured', () => {
    process.env.DEMO_ACCESS_MODE = 'invite_only'
    process.env.DEMO_ALLOWED_EMAILS = 'allowed@example.com, ADMIN'

    expect(isDemoUserAllowed('allowed@example.com')).toBe(true)
    expect(isDemoUserAllowed('admin')).toBe(true)
    expect(isDemoUserAllowed('other@example.com')).toBe(false)
  })

  it('maps allowed demo emails to local demo usernames', () => {
    expect(getDemoLoginName('Admin@example.com')).toBe('admin')
    expect(getDemoLoginName('agent1')).toBe('agent1')
  })

  it('parses allowed CORS origins', () => {
    process.env.ALLOWED_ORIGINS = 'https://demo.example.com, https://admin.example.com '

    expect(getAllowedOrigins()).toEqual(['https://demo.example.com', 'https://admin.example.com'])
  })
})
