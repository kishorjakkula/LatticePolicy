import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogin } from '../auth.js'

vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

vi.mock('../users.js', () => ({
  ensureDefaults: vi.fn(),
  findByUsername: vi.fn()
}))

function mockReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    body,
    header: (name: string) => headers[name] || headers[name.toLowerCase()] || ''
  } as any
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: vi.fn((body: unknown) => {
      res.body = body
      return res
    })
  }
  return res
}

describe('demo fallback login access', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NODE_ENV = 'test'
    delete process.env.DEMO_ACCESS_MODE
    delete process.env.DEMO_ALLOWED_EMAILS
    delete process.env.DEMO_ALLOWED_USERS
    delete process.env.DEPLOYMENT_ENV
    delete process.env.DATABASE_URL
    delete process.env.JWT_SECRET
    delete process.env.CUSTOMER_DATA_KEY
    delete process.env.MFA_TOKEN_SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('keeps local demo fallback login available outside production', async () => {
    const res = mockRes()

    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'sample-carrier' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.token).toEqual(expect.any(String))
    expect(res.body.user.roles).toEqual(['admin'])
  })

  it('blocks demo fallback login in managed test database-less mode', async () => {
    process.env.DEPLOYMENT_ENV = 'test'
    process.env.JWT_SECRET = 'jwt-secret'
    process.env.CUSTOMER_DATA_KEY = 'customer-data-key'
    process.env.MFA_TOKEN_SECRET = 'mfa-token-secret'

    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'sample-carrier' }), res)

    expect(res.status).toHaveBeenCalledWith(503)
    expect(res.body.code).toBe('DATABASE_UNAVAILABLE')
  })

  it('allows configured demo identities outside production', async () => {
    process.env.DEMO_ACCESS_MODE = 'invite_only'
    process.env.DEMO_ALLOWED_EMAILS = 'admin'

    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'sample-carrier' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.user.roles).toEqual(['admin'])
  })

  it('rejects demo login identities outside the configured allowlist', async () => {
    process.env.DEMO_ACCESS_MODE = 'invite_only'
    process.env.DEMO_ALLOWED_EMAILS = 'admin'

    const res = mockRes()
    await handleLogin(mockReq({ username: 'agent1', password: 'password', tenantId: 'sample-carrier' }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body.code).toBe('DEMO_ACCESS_NOT_ALLOWED')
  })
})
