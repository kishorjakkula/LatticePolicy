const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const mockEnv = import.meta.env.VITE_USE_MOCK
const mockDelayEnv = Number(import.meta.env.VITE_MOCK_API_DELAY_MS)
const resolvedUseMock = mockEnv != null
  ? mockEnv === '1' || mockEnv.toLowerCase() === 'true'
  : !apiBaseUrl
const resolvedMockDelayMs = Number.isFinite(mockDelayEnv) && mockDelayEnv >= 0
  ? mockDelayEnv
  : 75

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
  mockApiDelayMs: resolvedMockDelayMs
}
