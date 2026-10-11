import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export const profile = JSON.parse(fs.readFileSync(new URL('../deploy/pilot/standards.json', import.meta.url), 'utf8'))
export const pilotRoot = path.resolve('.pilot')
export function credentials() { return JSON.parse(fs.readFileSync(path.join(pilotRoot, 'credentials.json'), 'utf8')) }
export function percentile(values, fraction) {
  if (!values.length) throw new Error('No observations')
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}
export async function call(method, endpoint, { token, data, tenant = profile.tenantId, expected = [200], raw = false } = {}) {
  const response = await fetch(`${profile.apiUrl}${endpoint}`, {
    method, signal: AbortSignal.timeout(30000), headers: {
      'X-Tenant': tenant, ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
  })
  // Errors include only the endpoint/status; never print login bodies or tokens.
  assert(expected.includes(response.status), `${method} ${endpoint}: unexpected HTTP ${response.status}`)
  if (raw) return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type') }
  const body = await response.json()
  return body?.ok === true && 'data' in body ? body.data : body
}
export async function login() {
  return call('POST', '/auth/login', { data: { tenantId: profile.tenantId, ...credentials() } })
}
export async function waitForApi(timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  do {
    try {
      const response = await fetch(`${profile.apiUrl}/health`, { signal: AbortSignal.timeout(5000), headers: { Connection: 'close' } })
      const health = await response.json()
      if (response.ok && health.db && health.cache) return
    } catch { /* A restarted Docker API can invalidate an idle HTTP socket. */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  } while (Date.now() < deadline)
  throw new Error('Pilot API did not become healthy from the host')
}
export function date(offset = 0) {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10)
}
export function homeownersPayload(suffix = Date.now().toString(36)) {
  const answers = Object.fromEntries(['noPropertyClaims5Years', 'roofMaintained', 'noBusinessOnPremises', 'noVacancyOver30Days', 'protectiveDevicesInstalled'].map(key => [key, 'yes']))
  return {
    productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: date(-30), termMonths: 12,
    underwritingCompanyName: 'Sample Carrier Property',
    applicant: { firstName: 'Pilot', lastName: `Insured${suffix}`, email: `pilot.${suffix}@example.com` },
    insureds: { primary: { firstName: 'Pilot', lastName: `Insured${suffix}`, displayName: `Pilot Insured${suffix}` } },
    qualificationAnswers: answers, uwAnswers: Object.fromEntries(Object.keys(answers).map(key => [key, true])),
    risks: [{ type: 'dwelling', address: '1 Synthetic Pilot Lane, Austin TX', construction: 'masonry',
      yearBuilt: 2015, squareFeet: 2000, roofAgeYears: 5, protectionClass: 3, occupancy: 'OwnerOccupied' }],
    coverages: [{ code: 'A', selected: true, limit: 300000, deductible: 1000 }],
  }
}
export async function prepare(token) {
  const brand = await call('GET', '/api/v1/admin/branding', { token })
  if (!brand.configured) await call('PATCH', '/api/v1/admin/branding', { token, data: {
    name: profile.name, primaryColor: '#155e75',
    logoDataUrl: `data:image/png;base64,${fs.readFileSync(new URL('../deploy/pilot/acme-mutual-logo.png', import.meta.url)).toString('base64')}`,
    documentFooter: 'Acme Mutual Pilot - Synthetic demonstration only. Coverage is governed by the policy terms and conditions.',
  } })
  await call('POST', '/api/v1/admin/seed-reference-data', { token, data: {} })
  const companies = await call('GET', '/api/v1/admin/underwriting-companies?includeInactive=true', { token })
  for (const company of companies) {
    const active = isPilotCompanyEnabled(company)
    if (company.active !== active) await call('PATCH', `/api/v1/admin/underwriting-companies/${company.companyId}`, { token, data: { active } })
  }
  await call('POST', '/api/v1/admin/compliance/eligibility', { token, expected: [201],
    data: { productCode: 'homeowners', stateCode: 'TX', admitted: true, status: 'ACTIVE', notes: 'Synthetic pilot only' } })
}
export function isPilotCompanyEnabled(company) {
  return company.productCode === profile.product && company.country === 'US'
    && (company.state === 'ALL' || profile.jurisdictions.includes(company.state))
}
export function evidence(name, data) {
  fs.mkdirSync(path.join(pilotRoot, 'evidence'), { recursive: true })
  fs.writeFileSync(path.join(pilotRoot, 'evidence', `${name}.json`), JSON.stringify({ recordedAt: new Date().toISOString(), ...data }, null, 2))
}
