#!/usr/bin/env tsx
/* eslint-disable no-console */

const API_BASE = process.env.API_BASE || 'http://localhost:3000/v1'
const TENANT = process.env.API_TENANT || 'sample-carrier'

type QuoteResponse = { quoteId: string; premium?: any }
type BindResponse = { policyId: string; policyNumber: string }
type PolicyResponse = {
  policyId: string
  policyNumber: string
  status: string
  term: { effectiveDate: string; expirationDate: string }
  payload?: any
  versions?: Array<{ transactionType: string }>
}

async function main() {
  console.log(`Running transaction smoke test against ${API_BASE} (tenant ${TENANT})`)
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

  const quote = await apiFetch<QuoteResponse>('POST', '/quotes', quotePayload)
  const bind = await apiFetch<BindResponse>('POST', `/quotes/${quote.quoteId}/bind`, {})
  await apiFetch<any>('POST', `/policies/${bind.policyId}/issue`)

  let payload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const endorseAddPayload = clone(payload)
  endorseAddPayload.applicant.firstName = 'TxEndorseAdd'
  setCoverageLimit(endorseAddPayload, 'PA.LIAB.BI', 100000)
  const endorseAdd = await apiFetch<any>('POST', `/policies/${bind.policyId}/endorse`, {
    effectiveDate: today,
    payload: endorseAddPayload
  })

  payload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const endorseReturnPayload = clone(payload)
  endorseReturnPayload.applicant.firstName = 'TxEndorseReturn'
  setCoverageLimit(endorseReturnPayload, 'PA.LIAB.BI', 25000)
  const endorseReturn = await apiFetch<any>('POST', `/policies/${bind.policyId}/endorse`, {
    effectiveDate: today,
    payload: endorseReturnPayload
  })

  payload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const cancelPayload = clone(payload)
  cancelPayload.applicant.lastName = 'TxCancel'
  await apiFetch<any>('POST', `/policies/${bind.policyId}/cancel`, {
    effectiveDate: today,
    payload: cancelPayload
  })

  payload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const reinstatePayload = clone(payload)
  reinstatePayload.applicant.email = 'reinstate@test.local'
  await apiFetch<any>('POST', `/policies/${bind.policyId}/reinstate`, {
    effectiveDate: today,
    payload: reinstatePayload
  })

  payload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const renewPayload = clone(payload)
  renewPayload.applicant.firstName = 'TxRenew'
  const policy = await apiFetch<PolicyResponse>('GET', `/policies/${bind.policyId}`)
  const renewEffective = policy.term.expirationDate
  await apiFetch<any>('POST', `/policies/${bind.policyId}/renew`, {
    effectiveDate: renewEffective,
    payload: renewPayload
  })

  const finalPolicy = await apiFetch<PolicyResponse>('GET', `/policies/${bind.policyId}`)
  const finalPayload = await apiFetch<any>('GET', `/policies/${bind.policyId}/full`)
  const versions = await apiFetch<Array<{ transactionType: string }>>('GET', `/policies/${bind.policyId}/versions`)
  const requiredTypes = ['NB', 'ENDORSE', 'ENDORSE', 'CANCEL', 'REINSTATE', 'RENEW']
  const txTypes = (versions || []).map(v => normalizeTxType(v.transactionType))
  const tail = txTypes.slice(-requiredTypes.length)

  assert(
    requiredTypes.every((type, idx) => tail[idx] === type),
    `Unexpected transaction sequence: ${JSON.stringify(tail)}`
  )
  assert(finalPolicy.status === 'Issued', `Expected final status Issued, got ${finalPolicy.status}`)
  assert(endorseAdd?.premium?.total?.amount > 0, `Expected first endorsement delta > 0, got ${endorseAdd?.premium?.total?.amount}`)
  assert(endorseReturn?.premium?.total?.amount < 0, `Expected second endorsement delta < 0, got ${endorseReturn?.premium?.total?.amount}`)
  assert(hasCoverageDeltaType(endorseAdd, 'ADD'), 'First endorsement missing ADD coverage delta')
  assert(hasCoverageDeltaType(endorseReturn, 'RETURN'), 'Second endorsement missing RETURN coverage delta')
  assert(finalPayload?.applicant?.firstName === 'TxRenew', 'Final payload missing renewal edit (applicant.firstName)')
  assert(finalPayload?.applicant?.lastName === 'TxCancel', 'Final payload missing cancellation edit (applicant.lastName)')
  assert(finalPayload?.applicant?.email === 'reinstate@test.local', 'Final payload missing reinstatement edit (applicant.email)')

  console.log(`Policy: ${finalPolicy.policyNumber} (${finalPolicy.policyId})`)
  console.log(`Transactions: ${tail.join(' -> ')}`)
  console.log(`Final term: ${finalPolicy.term.effectiveDate} -> ${finalPolicy.term.expirationDate}`)
  console.log('Transaction smoke test completed successfully')
}

async function apiFetch<T>(method: string, path: string, body?: any): Promise<T> {
  const url = `${API_BASE}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant': TENANT,
      'X-Api-Version': '1'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function assert(condition: any, message: string) {
  if (!condition) throw new Error(message)
}

function normalizeTxType(value: any): string {
  const normalized = String(value || '').trim().toUpperCase()
  if (normalized === 'ISSUE') return 'NB'
  return normalized
}

function hasCoverageDeltaType(version: any, expected: string): boolean {
  const byCoverage = Array.isArray(version?.premium?.byCoverage) ? version.premium.byCoverage : []
  const target = String(expected || '').toUpperCase()
  return byCoverage.some((entry: any) => String(entry?.deltaType || '').toUpperCase() === target)
}

function setCoverageLimit(payload: any, coverageCode: string, limit: number): void {
  if (!payload || !Array.isArray(payload.coverages)) return
  const match = payload.coverages.find((cov: any) => String(cov?.code || '').toUpperCase() === String(coverageCode || '').toUpperCase())
  if (match) match.limit = limit
}

main().catch((err) => {
  console.error('Transaction smoke test failed', err)
  process.exitCode = 1
})
// legacy file
