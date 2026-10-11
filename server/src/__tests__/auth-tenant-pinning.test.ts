import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogin } from '../auth.js'
import { getDb, withTenantTx } from '../db.js'
import { findByUsername } from '../users.js'

vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

vi.mock('../users.js', () => ({
  ensureDefaults: vi.fn(),
  findByUsername: vi.fn()
}))

vi.mock('../rbac.js', () => ({
  ensureTenantRbacDefaults: vi.fn(),
  getDefaultPermissionCodesForRoles: vi.fn((roles: string[]) => roles.map((role) => `${role}:default`)),
  resolvePermissionsForRoles: vi.fn()
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

describe('login tenant scoping', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(null)
    process.env.NODE_ENV = 'test'
    delete process.env.DEMO_ACCESS_MODE
    delete process.env.DEPLOYMENT_ENV
    delete process.env.DATABASE_URL
    delete process.env.CARRIER_TENANT_ID
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('still requires a tenant when the stack is not pinned', async () => {
    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body).toMatchObject({ code: 'TENANT_REQUIRED' })
  })

  it('rejects a login naming a tenant other than the pinned one', async () => {
    process.env.CARRIER_TENANT_ID = 'acme-mutual'
    for (const req of [
      mockReq({ username: 'admin', password: 'password', tenantId: 'sample-carrier' }),
      mockReq({ username: 'admin', password: 'password' }, { 'X-Tenant': 'sample-carrier' })
    ]) {
      const res = mockRes()
      await handleLogin(req, res)
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ code: 'TENANT_NOT_SERVED' })
    }
  })

  it('defaults a login to the pinned tenant when none is supplied', async () => {
    process.env.CARRIER_TENANT_ID = 'acme-mutual'
    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.user).toMatchObject({ username: 'admin', tenantId: 'acme-mutual' })
  })

  it('rejects correct credentials for an account that belongs to another tenant', async () => {
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(withTenantTx).mockImplementation(async (_tenantId: string, fn: any) => fn({}))
    vi.mocked(findByUsername).mockResolvedValue({
      id: 'user-1',
      username: 'admin',
      tenantId: 'other-carrier',
      passwordHash: bcrypt.hashSync('password', 4),
      roles: ['admin'],
      disabled: false
    } as any)

    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'sample-carrier' }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual({ code: 'INVALID_CREDENTIALS' })
  })
})
