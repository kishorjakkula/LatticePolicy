const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
const mockEnv = import.meta.env.VITE_USE_MOCK
const mockDelayEnv = Number(import.meta.env.VITE_MOCK_API_DELAY_MS)
const resolvedUseMock = mockEnv != null
  ? mockEnv === '1' || mockEnv.toLowerCase() === 'true'
  : !apiBaseUrl
const resolvedMockDelayMs = Number.isFinite(mockDelayEnv) && mockDelayEnv >= 0
  ? mockDelayEnv
  : 75

export const config = {
  apiBaseUrl,
  useMock: resolvedUseMock,
  apiVersion: '1',
  mockApiDelayMs: resolvedMockDelayMs
}
