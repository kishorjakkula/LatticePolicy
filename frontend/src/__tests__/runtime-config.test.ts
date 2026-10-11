import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadConfig() {
  vi.resetModules()
  return await import('../config')
}

function setRuntimeConfig(value: Record<string, unknown> | undefined) {
  ;(window as any).__LATTICE_RUNTIME_CONFIG__ = value
}

describe('frontend container runtime config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    setRuntimeConfig(undefined)
  })

  it('lets a prebuilt production image take its API URL and carrier at container start', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', '')
    vi.stubEnv('VITE_CARRIER_TENANT_ID', '')
    setRuntimeConfig({ VITE_API_BASE_URL: 'https://api.acme.example', VITE_CARRIER_TENANT_ID: ' acme-mutual ' })

    await expect(loadConfig()).resolves.toMatchObject({
      config: expect.objectContaining({
        apiBaseUrl: 'https://api.acme.example',
        useMock: false,
        carrierTenantId: 'acme-mutual'
      })
    })
  })

  it('prefers the container value over the build-time value', async () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_API_BASE_URL', 'https://build.example.com')
    vi.stubEnv('VITE_SHOW_DEMO_CREDENTIALS', '1')
    setRuntimeConfig({ VITE_API_BASE_URL: 'https://runtime.example.com', VITE_SHOW_DEMO_CREDENTIALS: '0' })

    const { config } = await loadConfig()
    expect(config.apiBaseUrl).toBe('https://runtime.example.com')
    expect(config.showDemoCredentials).toBe(false)
  })

  it('falls back to build-time values when the container sets nothing', async () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_API_BASE_URL', 'https://build.example.com')
    vi.stubEnv('VITE_CARRIER_TENANT_ID', 'build-carrier')
    setRuntimeConfig({ VITE_API_BASE_URL: '   ', VITE_CARRIER_TENANT_ID: 42 })

    const { config } = await loadConfig()
    expect(config.apiBaseUrl).toBe('https://build.example.com')
    expect(config.carrierTenantId).toBe('build-carrier')
  })

  it('still applies production validation to container values', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', '')
    setRuntimeConfig({ VITE_API_BASE_URL: 'http://api.acme.example' })

    await expect(loadConfig()).rejects.toThrow(/absolute HTTPS URL/)
  })
})
