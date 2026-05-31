import { describe, it, expect, vi, beforeEach } from 'vitest'
import { api } from '../client'

// Mock the config module
vi.mock('../../config', () => ({
  config: { apiBaseUrl: 'http://test-api', useMock: false, apiVersion: '1' }
}))

// Mock the mock API
vi.mock('../mock', () => ({
  mockApi: vi.fn()
}))

const mockFetch = global.fetch as ReturnType<typeof vi.fn>

describe('API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    localStorage.setItem('tenantId', 'test-tenant')
  })

  it('getPolicy — builds correct URL with /api prefix', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ policyId: 'POL-1', policyNumber: 'PC-001' })
    })
    const result = await api.getPolicy('POL-1')
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test-api/api/v1/policies/POL-1',
      expect.objectContaining({ method: 'GET' })
    )
    expect(result).toEqual({ policyId: 'POL-1', policyNumber: 'PC-001' })
  })

  it('unwraps the standard ok/data API envelope', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        data: { policyId: 'POL-2', policyNumber: 'PC-002' }
      })
    })
    const result = await api.getPolicy('POL-2')
    expect(result).toEqual({ policyId: 'POL-2', policyNumber: 'PC-002' })
  })

  it('passes auth token in Authorization header', async () => {
    localStorage.setItem('authToken', 'bearer-xyz')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({})
    })
    await api.getPolicy('POL-1')
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer bearer-xyz')
  })

  it('passes tenant ID in X-Tenant header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({})
    })
    await api.getPolicy('POL-1')
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>)['X-Tenant']).toBe('test-tenant')
  })

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => 'Not found'
    })
    await expect(api.getPolicy('MISSING')).rejects.toThrow('404')
  })

  it('dispatches auth:unauthorized on 401', async () => {
    const handler = vi.fn()
    window.addEventListener('auth:unauthorized', handler)
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    })
    await expect(api.getPolicy('POL-1')).rejects.toThrow()
    expect(handler).toHaveBeenCalled()
    window.removeEventListener('auth:unauthorized', handler)
  })

  it('returns undefined for 204 responses', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 204, text: async () => '' })
    const result = await api.issuePolicy('POL-1')
    expect(result).toBeUndefined()
  })
})
