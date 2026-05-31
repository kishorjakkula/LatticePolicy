#!/usr/bin/env tsx
/* eslint-disable no-console */

const API_BASE = normalizeBaseUrl(process.env.API_BASE || 'http://localhost:3000/api/v1')
const TENANT = process.env.API_TENANT || 'sample-carrier'
const API_USERNAME = process.env.API_USERNAME || 'admin'
const API_PASSWORD = process.env.API_PASSWORD || 'password'

type QuoteResponse = { quoteId: string; premium?: any }
type BindResponse = { policyId: string; policyNumber: string }
type LoginResponse = { token: string }

async function main() {
  console.log(`Running smoke test against ${API_BASE} (tenant ${TENANT})`)
  const token = await getAuthToken()
  const quotePayload = {
    productCode: 'personal-auto',
    effectiveDate: new Date().toISOString().slice(0, 10),
    termMonths: 12,
    country: 'US',
    state: 'PA',
    applicant: {
      firstName: 'Smoke',
      lastName: 'Test',
      email: 'smoke@test.example'
    },
    qualificationAnswers: {
      noMajorViolations3Years: 'yes',
      noAtFaultAccidents3Years: 'yes',
      continuousInsurance6Months: 'yes',
      noRideshareOrDeliveryUse: 'yes',
      garagedAtResidence: 'yes'
    },
    uwAnswers: { driverAge: 35 },
    risks: [{
      type: 'autoVehicle',
      year: 2020,
      make: 'Honda',
      model: 'Civic',
      garagingZip: '19019',
      usage: 'commute',
      annualMiles: 12000,
      driverAge: 35
    }],
    coverages: [{ code: 'PA.LIAB.BI', selected: true, limit: 100000 }]
  }

  const quoteResp = await apiFetch<QuoteResponse>('POST', '/quotes', quotePayload, token)
  console.log(`Quote created: ${quoteResp.quoteId} (premium: ${quoteResp.premium?.total?.amount ?? 'n/a'})`)

  const bindResp = await apiFetch<BindResponse>('POST', `/quotes/${quoteResp.quoteId}/bind`, {}, token)
  console.log(`Policy bound: ${bindResp.policyNumber} (${bindResp.policyId})`)

  const policy = await apiFetch<any>('GET', `/policies/${bindResp.policyId}`, undefined, token)
  console.log(`Policy status: ${policy.status}, term ${policy.term?.effectiveDate} -> ${policy.term?.expirationDate}`)

  console.log('Smoke test completed successfully')
}

async function getAuthToken(): Promise<string> {
  const suppliedToken = String(process.env.API_TOKEN || '').trim()
  if (suppliedToken) return suppliedToken
  const authBase = resolveAuthBase(API_BASE)
  const login = await apiFetch<LoginResponse>(
    'POST',
    '/auth/login',
    { username: API_USERNAME, password: API_PASSWORD },
    undefined,
    authBase
  )
  if (!login?.token) throw new Error('Login did not return a token')
  return login.token
}

async function apiFetch<T>(
  method: string,
  path: string,
  body?: any,
  token?: string,
  baseUrl = API_BASE
): Promise<T> {
  const url = `${baseUrl}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT,
      'X-Api-Version': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  const parsed = parseResponseBody(text)
  if (!res.ok) {
    throw new Error(`${method} ${path} failed ${res.status}: ${formatErrorBody(parsed, text)}`)
  }
  return unwrapResponse<T>(parsed)
}

function unwrapResponse<T>(value: unknown): T {
  if (
    value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).ok === true &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return (value as { data: T }).data
  }
  return value as T
}

function parseResponseBody(text: string): unknown {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatErrorBody(parsed: unknown, fallback: string): string {
  if (typeof parsed === 'string') return parsed
  if (parsed === undefined) return fallback
  try {
    return JSON.stringify(parsed)
  } catch {
    return fallback
  }
}

function normalizeBaseUrl(value: string): string {
  return String(value || '').replace(/\/+$/, '')
}

function resolveAuthBase(apiBase: string): string {
  const normalized = normalizeBaseUrl(apiBase)
  return normalized
    .replace(/\/api\/v\d+$/i, '')
    .replace(/\/v\d+$/i, '')
}

main().catch((err) => {
  console.error('Smoke test failed', err)
  process.exitCode = 1
})
