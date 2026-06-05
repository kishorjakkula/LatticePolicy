import type { APIRequestContext, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const tenantId = process.env.E2E_TENANT_ID || 'sample-carrier'
export const apiBaseUrl = process.env.E2E_API_BASE_URL || 'http://localhost:3300'
export const defaultPassword = process.env.E2E_PASSWORD || 'password'

export type AuthSession = {
  token: string
  user: {
    id: string
    username: string
    tenantId: string
    roles: string[]
    permissions?: string[]
    customerId?: string | null
    customerKey?: string | null
    customerName?: string | null
  }
}

type ApiOptions = {
  token?: string
  data?: unknown
  query?: Record<string, string | number | boolean | undefined>
  expectedStatus?: number | number[]
}

function e2eSuffix() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function uniqueName(prefix: string) {
  return `${prefix}-${e2eSuffix()}`
}

function withQuery(path: string, query?: ApiOptions['query']) {
  if (!query) return path
  const url = new URL(path, apiBaseUrl)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

export async function apiJson<T>(
  request: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const expected = Array.isArray(options.expectedStatus)
    ? options.expectedStatus
    : [options.expectedStatus ?? (method === 'POST' ? 200 : 200)]
  const response = await request.fetch(`${apiBaseUrl}${withQuery(path, options.query)}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': tenantId,
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    data: options.data,
  })
  const text = await response.text()
  let body: any = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  expect(
    expected,
    `${method} ${path} returned ${response.status()} ${typeof body === 'string' ? body : JSON.stringify(body)}`,
  ).toContain(response.status())
  return body?.ok === true && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body
}

export async function loginApi(request: APIRequestContext, username: string, password = defaultPassword): Promise<AuthSession> {
  return apiJson<AuthSession>(request, 'POST', '/auth/login', {
    data: { tenantId, username, password },
  })
}

export async function installAuthState(page: Page, session: AuthSession) {
  await page.addInitScript(({ token, user, tenant }) => {
    window.localStorage.setItem('tenantId', tenant)
    window.localStorage.setItem('auth-storage', JSON.stringify({
      state: { token, user },
      version: 0,
    }))
  }, { token: session.token, user: session.user, tenant: tenantId })
}

export async function loginThroughUi(page: Page, username: string, password = defaultPassword) {
  await page.goto('/login')
  await page.getByLabel('Organization Slug').fill(tenantId)
  await page.getByLabel('Email / Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Login' }).click()
}

export function quotePayload(name = 'E2E Insured', overrides: Record<string, unknown> = {}) {
  const [firstName, lastName = 'Insured'] = name.split(' ')
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    country: 'US',
    state: 'CA',
    applicant: {
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
    },
    insureds: {
      primary: {
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      },
    },
    uwAnswers: {
      driverAge: 35,
    },
    risks: [
      {
        type: 'autoVehicle',
        year: 2024,
        make: 'Toyota',
        model: 'Camry',
        vin: `E2E${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
        garagingZip: '94105',
        symbol: 'A',
        usage: 'commute',
        annualMiles: 12_000,
        driverAge: 35,
      },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

export async function createIssuedPolicy(
  request: APIRequestContext,
  token: string,
  name = 'E2E Insured',
  overrides: Record<string, unknown> = {},
) {
  const quote = await apiJson<any>(request, 'POST', '/api/v1/quotes', {
    token,
    data: quotePayload(name, overrides),
  })
  const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, {
    token,
    data: {},
  })
  const issued = await apiJson<any>(request, 'POST', `/api/v1/policies/${bound.policyId}/issue`, {
    token,
    data: {},
  })
  return {
    quote,
    policyId: bound.policyId,
    policyNumber: bound.policyNumber || issued.policyNumber,
    issued,
  }
}

export async function createCustomer(request: APIRequestContext, adminToken: string, name = 'E2E Portal') {
  const [firstName, lastName = 'Customer'] = name.split(' ')
  return apiJson<any>(request, 'POST', '/api/v1/admin/customers', {
    token: adminToken,
    expectedStatus: 201,
    data: {
      entityType: 'INDIVIDUAL',
      status: 'ACTIVE',
      createAnyway: true,
      reason: 'E2E_SETUP',
      identity: {
        person: {
          firstName,
          lastName,
          dob: '1980-01-01',
          driverLicenseState: 'CA',
        },
        company: {},
      },
      contactPoints: [
        {
          contactType: 'EMAIL',
          subType: 'personal',
          value: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
          preferred: true,
          verified: true,
          emailConsent: true,
        },
      ],
      addresses: [
        {
          addressType: 'residence',
          line1: '1 E2E Way',
          city: 'San Francisco',
          state: 'CA',
          postalCode: '94105',
          country: 'US',
          primary: true,
        },
      ],
      metadata: { e2e: true },
    },
  })
}

export async function createPortalUserForPolicy(request: APIRequestContext, adminToken: string) {
  const customer = await createCustomer(request, adminToken, `Portal ${e2eSuffix()}`)
  const policy = await createIssuedPolicy(request, adminToken, customer.displayName || 'Portal Customer')
  await apiJson<any>(request, 'POST', '/api/v1/admin/customers/policy-links/assign', {
    token: adminToken,
    data: {
      policyId: policy.policyId,
      customerKey: customer.customerKey,
      relationshipType: 'PRIMARY_NAMED_INSURED',
      isPrimary: true,
      source: 'e2e',
    },
  })
  const username = uniqueName('portal-user')
  const user = await apiJson<any>(request, 'POST', '/api/v1/admin/users', {
    token: adminToken,
    expectedStatus: 201,
    data: {
      username,
      password: defaultPassword,
      roles: ['customer'],
      customerRef: customer.customerKey,
    },
  })
  return { customer, policy, username, user }
}

export async function seedDemoPolicies(request: APIRequestContext, adminToken: string) {
  return apiJson<any>(request, 'POST', '/api/v1/admin/seed', {
    token: adminToken,
    data: {},
  })
}
