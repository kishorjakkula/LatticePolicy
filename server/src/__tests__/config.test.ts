import { afterEach, describe, expect, it } from 'vitest'
import {
  getAllowedOrigins,
  getDemoLoginName,
  getJwtSecret,
  getMfaTokenSecret,
  isDemoUserAllowed,
  validateDeploymentConfig
} from '../config.js'

const ORIGINAL_ENV = { ...process.env }

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
      missing: ['DATABASE_URL', 'JWT_SECRET', 'CUSTOMER_DATA_KEY', 'MFA_TOKEN_SECRET', 'ALLOWED_ORIGINS']
    })
  })

  it('requires an allowlist for invite-only test deployments', () => {
    process.env.DEPLOYMENT_ENV = 'test'
    process.env.DATABASE_URL = 'postgres://example'
    process.env.JWT_SECRET = 'jwt-secret'
    process.env.CUSTOMER_DATA_KEY = 'customer-data-key'
    process.env.MFA_TOKEN_SECRET = 'mfa-token-secret'
    process.env.ALLOWED_ORIGINS = 'https://demo.example.com'
    process.env.DEMO_ACCESS_MODE = 'invite_only'
    delete process.env.DEMO_ALLOWED_EMAILS

    expect(validateDeploymentConfig()).toEqual({
      ok: false,
      missing: ['DEMO_ALLOWED_EMAILS']
    })
  })

  it('allows non-production in-memory demo mode', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL

    expect(validateDeploymentConfig()).toEqual({ ok: true, missing: [] })
  })

  it('does not treat NODE_ENV production alone as a managed deployment', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DEPLOYMENT_ENV
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    delete process.env.CUSTOMER_DATA_KEY
    delete process.env.MFA_TOKEN_SECRET
    delete process.env.ALLOWED_ORIGINS

    expect(validateDeploymentConfig()).toEqual({ ok: true, missing: [] })
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
