import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getPinnedTenantId, isTenantRlsEnforced } from '../config.js'
import { assertTenantServed, toRawQuery, withTenantTx } from '../db.js'
import { tenancyMiddleware } from '../tenancy.js'

function mockReq(options: { headers?: Record<string, string>; query?: Record<string, string>; user?: { tenantId: string } } = {}) {
  const headers = options.headers || {}
  return {
    method: 'GET',
    url: '/api/v1/policies',
    query: options.query || {},
    user: options.user,
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

describe('single-carrier tenant pinning', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.CARRIER_TENANT_ID
    delete process.env.TENANT_RLS_ENFORCED
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe('getPinnedTenantId', () => {
    it('is null when CARRIER_TENANT_ID is unset or blank', () => {
      expect(getPinnedTenantId()).toBeNull()
      process.env.CARRIER_TENANT_ID = '   '
      expect(getPinnedTenantId()).toBeNull()
    })

    it('returns the trimmed configured tenant', () => {
      process.env.CARRIER_TENANT_ID = ' acme-mutual '
      expect(getPinnedTenantId()).toBe('acme-mutual')
    })
  })

  describe('isTenantRlsEnforced', () => {
    it('is off unless TENANT_RLS_ENFORCED is truthy', () => {
      expect(isTenantRlsEnforced()).toBe(false)
      process.env.TENANT_RLS_ENFORCED = '0'
      expect(isTenantRlsEnforced()).toBe(false)
      process.env.TENANT_RLS_ENFORCED = 'true'
      expect(isTenantRlsEnforced()).toBe(true)
    })
  })

  describe('assertTenantServed', () => {
    it('rejects a missing tenant id in every mode', () => {
      expect(() => assertTenantServed('')).toThrowError(expect.objectContaining({ code: 'TENANT_REQUIRED', statusCode: 400 }))
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      expect(() => assertTenantServed('  ')).toThrowError(expect.objectContaining({ code: 'TENANT_REQUIRED' }))
    })

    it('accepts any tenant when the stack is not pinned', () => {
      expect(() => assertTenantServed('sample-carrier')).not.toThrow()
      expect(() => assertTenantServed('another-carrier')).not.toThrow()
    })

    it('accepts only the pinned tenant when the stack is pinned', () => {
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      expect(() => assertTenantServed('acme-mutual')).not.toThrow()
      expect(() => assertTenantServed('sample-carrier')).toThrowError(
        expect.objectContaining({ code: 'TENANT_NOT_SERVED', statusCode: 403 })
      )
    })
  })

  describe('withTenantTx', () => {
    it('fails closed on an empty tenant before touching the pool', async () => {
      await expect(withTenantTx('', async () => 'unreachable')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' })
    })

    it('refuses a tenant other than the pinned one', async () => {
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      await expect(withTenantTx('sample-carrier', async () => 'unreachable')).rejects.toMatchObject({ code: 'TENANT_NOT_SERVED' })
    })
  })

  describe('toRawQuery', () => {
    it('uses the transaction-bound client', async () => {
      const query = vi.fn(async () => ({ rows: [{ ok: true }] }))
      const q = toRawQuery({ __pgClient: { query } } as any)
      await expect(q('SELECT 1', [])).resolves.toEqual({ rows: [{ ok: true }] })
      expect(query).toHaveBeenCalledWith('SELECT 1', [])
    })

    it('throws instead of falling back to the shared pool', () => {
      expect(() => toRawQuery({} as any)).toThrow(/tenant-scoped transaction/)
    })
  })

  describe('tenancyMiddleware', () => {
    it('keeps legacy resolution when not pinned: header first, then token tenant', () => {
      const next = vi.fn()
      const fromHeader = mockReq({ headers: { 'X-Tenant': 'sample-carrier' }, user: { tenantId: 'other' } })
      tenancyMiddleware(fromHeader, mockRes(), next)
      expect(fromHeader.tenant).toEqual({ tenantId: 'sample-carrier' })

      const fromToken = mockReq({ user: { tenantId: 'sample-carrier' } })
      tenancyMiddleware(fromToken, mockRes(), next)
      expect(fromToken.tenant).toEqual({ tenantId: 'sample-carrier' })

      const none = mockReq()
      tenancyMiddleware(none, mockRes(), next)
      expect(none.tenant).toBeUndefined()
      expect(next).toHaveBeenCalledTimes(3)
    })

    it('rejects an unresolved tenant when a route opens a transaction', async () => {
      const req = mockReq()
      tenancyMiddleware(req, mockRes(), vi.fn())
      await expect(req.tx(async () => 'unreachable')).rejects.toMatchObject({ code: 'TENANT_REQUIRED' })
    })

    it('resolves to the pinned tenant when the request names none', () => {
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      const req = mockReq()
      const next = vi.fn()
      tenancyMiddleware(req, mockRes(), next)
      expect(req.tenant).toEqual({ tenantId: 'acme-mutual' })
      expect(next).toHaveBeenCalledTimes(1)
    })

    it('rejects a header or query tenant other than the pinned one', () => {
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      for (const req of [
        mockReq({ headers: { 'X-Tenant': 'sample-carrier' } }),
        mockReq({ query: { tenant: 'sample-carrier' } })
      ]) {
        const res = mockRes()
        const next = vi.fn()
        tenancyMiddleware(req, res, next)
        expect(res.statusCode).toBe(403)
        expect(res.body).toMatchObject({ code: 'TENANT_NOT_SERVED' })
        expect(next).not.toHaveBeenCalled()
        expect(req.tenant).toBeUndefined()
      }
    })

    it('rejects a token issued for another tenant', () => {
      process.env.CARRIER_TENANT_ID = 'acme-mutual'
      const req = mockReq({ user: { tenantId: 'sample-carrier' } })
      const res = mockRes()
      const next = vi.fn()
      tenancyMiddleware(req, res, next)
      expect(res.statusCode).toBe(403)
      expect(res.body).toMatchObject({ code: 'TENANT_NOT_SERVED' })
      expect(next).not.toHaveBeenCalled()
    })
  })
})
