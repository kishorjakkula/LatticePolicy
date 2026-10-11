import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tenantId } from '../request'

const mockConfig = vi.hoisted(() => ({
  apiBaseUrl: 'https://api.example.com',
  useMock: false,
  apiVersion: '1',
  mockApiDelayMs: 0,
  showDemoCredentials: false,
  carrierTenantId: ''
}))

vi.mock('../../config', () => ({ config: mockConfig }))

describe('request tenant resolution', () => {
  beforeEach(() => {
    localStorage.clear()
    mockConfig.carrierTenantId = ''
  })

  it('uses the tenant stored at login, falling back to the sample tenant', () => {
    expect(tenantId()).toBe('sample-carrier')
    localStorage.setItem('tenantId', 'test-tenant')
    expect(tenantId()).toBe('test-tenant')
  })

  it('always uses the configured carrier on a single-carrier stack', () => {
    mockConfig.carrierTenantId = 'acme-mutual'
    expect(tenantId()).toBe('acme-mutual')
    localStorage.setItem('tenantId', 'sample-carrier')
    expect(tenantId()).toBe('acme-mutual')
  })
})
