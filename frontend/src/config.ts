// A prebuilt image is configured at container start through
// /runtime-config.js (window.__LATTICE_RUNTIME_CONFIG__). A value set there
// wins; otherwise the build-time VITE_* value applies, as before.
type RuntimeConfigKey = 'VITE_API_BASE_URL' | 'VITE_USE_MOCK' | 'VITE_SHOW_DEMO_CREDENTIALS' | 'VITE_CARRIER_TENANT_ID'

function runtimeValue(key: RuntimeConfigKey, buildValue: string | undefined): string | undefined {
  const runtime = typeof window !== 'undefined' ? (window as any).__LATTICE_RUNTIME_CONFIG__ : undefined
  const value = runtime && typeof runtime[key] === 'string' ? runtime[key].trim() : ''
  return value || buildValue
}

const apiBaseUrl = runtimeValue('VITE_API_BASE_URL', import.meta.env.VITE_API_BASE_URL) || ''
const mockEnv = runtimeValue('VITE_USE_MOCK', import.meta.env.VITE_USE_MOCK)
const mockDelayEnv = Number(import.meta.env.VITE_MOCK_API_DELAY_MS)
const resolvedUseMock = mockEnv != null
  ? mockEnv === '1' || mockEnv.toLowerCase() === 'true'
  : !apiBaseUrl
const resolvedMockDelayMs = Number.isFinite(mockDelayEnv) && mockDelayEnv >= 0
  ? mockDelayEnv
  : 75
const showDemoCredentialsEnv = runtimeValue('VITE_SHOW_DEMO_CREDENTIALS', import.meta.env.VITE_SHOW_DEMO_CREDENTIALS)
const resolvedShowDemoCredentials = showDemoCredentialsEnv != null
  ? showDemoCredentialsEnv === '1' || showDemoCredentialsEnv.toLowerCase() === 'true'
  : import.meta.env.DEV

// Set on a single-carrier stack so the UI always addresses that carrier
// (matches the API's CARRIER_TENANT_ID). Empty keeps the tenant chosen at login.
const carrierTenantId = String(runtimeValue('VITE_CARRIER_TENANT_ID', import.meta.env.VITE_CARRIER_TENANT_ID) || '').trim()

function validateFrontendRuntimeConfig() {
  if (!import.meta.env.PROD) return
  if (resolvedUseMock) {
    throw new Error('VITE_USE_MOCK must be 0/false for production frontend builds')
  }
  if (!apiBaseUrl) {
    throw new Error('VITE_API_BASE_URL is required for production frontend builds')
  }
  try {
    const url = new URL(apiBaseUrl)
    const isLocalApi = ['localhost', '127.0.0.1'].includes(url.hostname)
    if (url.protocol !== 'https:' && !isLocalApi) throw new Error('protocol')
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute HTTPS URL, or localhost URL for local smoke tests, for production frontend builds')
  }
}

validateFrontendRuntimeConfig()

export const config = {
  apiBaseUrl,
  useMock: resolvedUseMock,
  apiVersion: '1',
  mockApiDelayMs: resolvedMockDelayMs,
  showDemoCredentials: resolvedShowDemoCredentials,
  carrierTenantId
}
