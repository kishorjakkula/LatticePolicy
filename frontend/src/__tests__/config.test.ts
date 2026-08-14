import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadConfig() {
  vi.resetModules()
  return await import('../config')
}

describe('frontend runtime config', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('allows local mock mode outside production builds', async () => {
    vi.stubEnv('PROD', false)
    vi.stubEnv('VITE_API_BASE_URL', '')
    vi.stubEnv('VITE_USE_MOCK', '1')

    await expect(loadConfig()).resolves.toMatchObject({
      config: expect.objectContaining({ apiBaseUrl: '', useMock: true })
    })
  })

  it('rejects production builds that still use mock mode', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    vi.stubEnv('VITE_USE_MOCK', '1')

    await expect(loadConfig()).rejects.toThrow(/VITE_USE_MOCK must be 0\/false/)
  })

  it('rejects non-local HTTP API URLs for production builds', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.example.com')
    vi.stubEnv('VITE_USE_MOCK', '0')

    await expect(loadConfig()).rejects.toThrow(/absolute HTTPS URL/)
  })

  it('allows localhost HTTP API URLs for local production smoke builds', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3300')
    vi.stubEnv('VITE_USE_MOCK', '0')

    await expect(loadConfig()).resolves.toMatchObject({
      config: expect.objectContaining({ apiBaseUrl: 'http://localhost:3300', useMock: false })
    })
  })

  it('accepts non-mock production builds with an HTTPS API URL', async () => {
    vi.stubEnv('PROD', true)
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com')
    vi.stubEnv('VITE_USE_MOCK', '0')

    await expect(loadConfig()).resolves.toMatchObject({
      config: expect.objectContaining({ apiBaseUrl: 'https://api.example.com', useMock: false })
    })
  })
})
