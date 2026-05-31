import { config } from '../config'
import { mockApi } from './mock'
import { useAuthStore } from '../store/auth.store'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export const API_PREFIX = '/api'

export function tenantId() {
  return localStorage.getItem('tenantId') || 'sample-carrier'
}

export function readAuthToken(): string {
  const storeToken = useAuthStore.getState().token || ''
  if (storeToken) return storeToken
  const direct = localStorage.getItem('authToken') || ''
  if (direct) return direct
  try {
    const raw = localStorage.getItem('auth-storage')
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    const token = parsed?.state?.token
    return typeof token === 'string' ? token : ''
  } catch {
    return ''
  }
}

export function authHeaders(): Record<string, string> {
  const authToken = readAuthToken()
  return authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
}

export async function request<T>(method: HttpMethod, path: string, body?: any): Promise<T> {
  if (config.useMock || !config.apiBaseUrl) {
    return mockApi<T>(method, path, body)
  }
  const url = `${config.apiBaseUrl}${API_PREFIX}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId(),
      'X-Api-Version': config.apiVersion,
      ...authHeaders()
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized()
    }
    const text = await res.text()
    throw new Error(`API ${method} ${path} failed ${res.status}: ${text}`)
  }
  if (res.status === 204 || res.status === 205) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    const parsed = JSON.parse(text)
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.ok === true &&
      Object.prototype.hasOwnProperty.call(parsed, 'data')
    ) {
      return (parsed as { data: T }).data
    }
    return parsed as T
  } catch {
    return text as unknown as T
  }
}

let _unauthorizedFired = false
export function handleUnauthorized() {
  if (_unauthorizedFired) return
  _unauthorizedFired = true
  localStorage.removeItem('authToken')
  localStorage.removeItem('authUser')
  localStorage.removeItem('auth-storage')
  window.dispatchEvent(new CustomEvent('auth:unauthorized'))
  // Reset the flag after a tick so rapid parallel 401s only fire once
  setTimeout(() => { _unauthorizedFired = false }, 2000)
}

export async function requestBlob(path: string): Promise<Blob> {
  if (config.useMock || !config.apiBaseUrl) {
    const html = '<!doctype html><html><body><h1>Document preview is not available in mock mode.</h1></body></html>'
    return new Blob([html], { type: 'text/html' })
  }
  const url = `${config.apiBaseUrl}${API_PREFIX}${path}`
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Tenant': tenantId(),
      'X-Api-Version': config.apiVersion,
      ...authHeaders()
    }
  })
  if (!res.ok) {
    if (res.status === 401) {
      handleUnauthorized()
    }
    const text = await res.text()
    throw new Error(`API GET ${path} failed ${res.status}: ${text}`)
  }
  return res.blob()
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.onload = () => {
      const raw = String(reader.result || '')
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw
      resolve(base64)
    }
    reader.readAsDataURL(file)
  })
}
