/* eslint-disable no-console */

const API_BASE = normalizeBaseUrl(process.env.API_BASE || 'http://localhost:3000/api/v1')
const TENANT = process.env.API_TENANT || 'sample-carrier'
const API_USERNAME = process.env.API_USERNAME || 'admin'
const API_PASSWORD = process.env.API_PASSWORD || 'password'

async function main() {
  console.log(`Running transaction smoke test against ${API_BASE} (tenant ${TENANT})`)
  const token = await getAuthToken()
  const today = new Date().toISOString().slice(0, 10)

  const quotePayload = {
    productCode: 'personal-auto',
    effectiveDate: today,
    termMonths: 12,
    state: 'PA',
    applicant: { firstName: 'Flow', lastName: 'Test', email: 'flow@test.local' },
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
    coverages: [{ code: 'PA.LIAB.BI', selected: true, limit: 25000 }]
  }

  const quote = await apiFetch('POST', '/quotes', quotePayload, token)
  const bind = await apiFetch('POST', `/quotes/${quote.quoteId}/bind`, {}, token)
  await apiFetch('POST', `/policies/${bind.policyId}/issue`, undefined, token)

  let payload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const endorseAddPayload = clone(payload)
  endorseAddPayload.applicant.firstName = 'TxEndorseAdd'
  setCoverageLimit(endorseAddPayload, 'PA.LIAB.BI', 100000)
  const endorseAdd = await apiFetch('POST', `/policies/${bind.policyId}/endorse`, {
    effectiveDate: today,
    payload: endorseAddPayload
  }, token)

  payload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const endorseReturnPayload = clone(payload)
  endorseReturnPayload.applicant.firstName = 'TxEndorseReturn'
  setCoverageLimit(endorseReturnPayload, 'PA.LIAB.BI', 25000)
  const endorseReturn = await apiFetch('POST', `/policies/${bind.policyId}/endorse`, {
    effectiveDate: today,
    payload: endorseReturnPayload
  }, token)

  payload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const cancelPayload = clone(payload)
  cancelPayload.applicant.lastName = 'TxCancel'
  await apiFetch('POST', `/policies/${bind.policyId}/cancel`, {
    effectiveDate: today,
    payload: cancelPayload
  }, token)

  payload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const reinstatePayload = clone(payload)
  reinstatePayload.applicant.email = 'reinstate@test.local'
  await apiFetch('POST', `/policies/${bind.policyId}/reinstate`, {
    effectiveDate: today,
    payload: reinstatePayload
  }, token)

  payload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const renewPayload = clone(payload)
  renewPayload.applicant.firstName = 'TxRenew'
  const policy = await apiFetch('GET', `/policies/${bind.policyId}`, undefined, token)
  const renewEffective = policy.term.expirationDate
  await apiFetch('POST', `/policies/${bind.policyId}/renew`, {
    effectiveDate: renewEffective,
    payload: renewPayload
  }, token)

  const finalPolicy = await apiFetch('GET', `/policies/${bind.policyId}`, undefined, token)
  const finalPayload = await apiFetch('GET', `/policies/${bind.policyId}/full`, undefined, token)
  const versions = await apiFetch('GET', `/policies/${bind.policyId}/versions`, undefined, token)
  const requiredTypes = ['NB', 'ENDORSE', 'ENDORSE', 'CANCEL', 'REINSTATE', 'RENEW']
  const txTypes = (versions || []).map(v => normalizeTxType(v.transactionType))
  const tail = txTypes.slice(-requiredTypes.length)

  assert(
    requiredTypes.every((type, idx) => tail[idx] === type),
    `Unexpected transaction sequence: ${JSON.stringify(tail)}`
  )
  assert(finalPolicy.status === 'Issued', `Expected final status Issued, got ${finalPolicy.status}`)
  assert(typeof endorseAdd?.premium?.total?.amount === 'number', 'First endorsement missing premium summary')
  assert(typeof endorseReturn?.premium?.total?.amount === 'number', 'Second endorsement missing premium summary')
  assert(hasCoverageLimit(endorseAdd, 'PA.LIAB.BI', 100000), 'First endorsement did not apply the requested BI limit')
  assert(hasCoverageLimit(endorseReturn, 'PA.LIAB.BI', 25000), 'Second endorsement did not restore the requested BI limit')
  assert(hasMetaChange(endorseAdd, '/coverages'), 'First endorsement did not record the coverage change')
  assert(hasMetaChange(endorseReturn, '/coverages'), 'Second endorsement did not record the coverage change')
  assert(finalPayload?.applicant?.firstName === 'TxRenew', 'Final payload missing renewal edit (applicant.firstName)')
  assert(finalPayload?.applicant?.lastName === 'TxCancel', 'Final payload missing cancellation edit (applicant.lastName)')
  assert(finalPayload?.applicant?.email === 'reinstate@test.local', 'Final payload missing reinstatement edit (applicant.email)')
  assert(getCoverageLimit(finalPayload, 'PA.LIAB.BI') === 25000, 'Final payload missing reverted BI limit after the second endorsement')

  console.log(`Policy: ${finalPolicy.policyNumber} (${finalPolicy.policyId})`)
  console.log(`Transactions: ${tail.join(' -> ')}`)
  console.log(`Final term: ${finalPolicy.term.effectiveDate} -> ${finalPolicy.term.expirationDate}`)
  console.log('Transaction smoke test completed successfully')
}

async function getAuthToken() {
  const suppliedToken = String(process.env.API_TOKEN || '').trim()
  if (suppliedToken) return suppliedToken
  const authBase = resolveAuthBase(API_BASE)
  const login = await apiFetch(
    'POST',
    '/auth/login',
    { username: API_USERNAME, password: API_PASSWORD },
    undefined,
    authBase
  )
  if (!login?.token) throw new Error('Login did not return a token')
  return login.token
}

async function apiFetch(method, path, body, token, baseUrl = API_BASE) {
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
  return unwrapResponse(parsed)
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizeTxType(value) {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'ISSUE') return 'NB'
  return normalized
}

function hasCoverageLimit(version, coverageCode, expectedLimit) {
  const byCoverage = Array.isArray(version?.premium?.byCoverage) ? version.premium.byCoverage : []
  const targetCode = String(coverageCode || '').toUpperCase()
  return byCoverage.some((entry) =>
    String(entry?.code || '').toUpperCase() === targetCode &&
    Number(entry?.limit) === Number(expectedLimit)
  )
}

function hasMetaChange(version, expectedPath) {
  const changes = Array.isArray(version?.meta?.changes) ? version.meta.changes : []
  return changes.includes(expectedPath)
}

function setCoverageLimit(payload, coverageCode, limit) {
  if (!payload || !Array.isArray(payload.coverages)) return
  const match = payload.coverages.find((cov) => String(cov?.code || '').toUpperCase() === String(coverageCode || '').toUpperCase())
  if (match) match.limit = limit
}

function getCoverageLimit(payload, coverageCode) {
  if (!payload || !Array.isArray(payload.coverages)) return null
  const match = payload.coverages.find((cov) => String(cov?.code || '').toUpperCase() === String(coverageCode || '').toUpperCase())
  return match ? Number(match.limit) : null
}

function unwrapResponse(value) {
  if (
    value &&
    typeof value === 'object' &&
    value.ok === true &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return value.data
  }
  return value
}

function parseResponseBody(text) {
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function formatErrorBody(parsed, fallback) {
  if (typeof parsed === 'string') return parsed
  if (parsed === undefined) return fallback
  try {
    return JSON.stringify(parsed)
  } catch {
    return fallback
  }
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '')
}

function resolveAuthBase(apiBase) {
  const normalized = normalizeBaseUrl(apiBase)
  return normalized
    .replace(/\/api\/v\d+$/i, '')
    .replace(/\/v\d+$/i, '')
}

main().catch((err) => {
  console.error('Transaction smoke test failed', err)
  process.exitCode = 1
})
