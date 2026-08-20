import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleLogin } from '../auth.js'
import { getDb } from '../db.js'
import { setMemoryTenantLocalAuthEnabled } from '../config/tenant-identity.js'

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

describe('tenant local-auth restriction', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(null)
    process.env.NODE_ENV = 'test'
    delete process.env.DEMO_ACCESS_MODE
    delete process.env.DEPLOYMENT_ENV
    delete process.env.DATABASE_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('rejects username/password login when the tenant has local auth disabled', async () => {
    setMemoryTenantLocalAuthEnabled('sso-only-tenant', false)

    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'sso-only-tenant' }), res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.body.code).toBe('LOCAL_AUTH_DISABLED')
  })

  it('still allows local login for tenants that have not disabled it', async () => {
    setMemoryTenantLocalAuthEnabled('normal-tenant', true)

    const res = mockRes()
    await handleLogin(mockReq({ username: 'admin', password: 'password', tenantId: 'normal-tenant' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.token).toEqual(expect.any(String))
  })
})
