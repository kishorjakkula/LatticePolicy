import { expect, test } from './support/fixtures'
import { apiJson, createCustomer, isoDate, quotePayload, uniqueName } from './support/api'

function quoteForCustomer(customer: any, overrides: Record<string, unknown> = {}) {
  const payload = quotePayload(customer.displayName || 'Consistency Check') as any
  payload.effectiveDate = isoDate(0)
  payload.insureds.primary.customerId = customer.customerId
  payload.insureds.primary.customerKey = customer.customerKey
  return { ...payload, ...overrides }
}

test.describe('pre-bind internal consistency check', () => {
  test('refers a bind when the insured answers "continuous insurance" but has a recent non-payment cancellation on file', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const customer = await createCustomer(request, admin.token, `Nonpay ${uniqueName('c').replace(/[^a-zA-Z0-9]/g, '')}`)

    // Prior policy for this customer, cancelled for non-payment inside the 6-month lookback.
    const prior = await apiJson<any>(request, 'POST', '/api/v1/quotes', {
      token: admin.token,
      data: quoteForCustomer(customer, { effectiveDate: isoDate(-90) }),
    })
    const priorBound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${prior.quoteId}/bind`, { token: admin.token, data: {} })
    await apiJson<any>(request, 'POST', `/api/v1/policies/${priorBound.policyId}/issue`, { token: admin.token, data: {} })
    await apiJson<any>(request, 'POST', `/api/v1/policies/${priorBound.policyId}/cancel`, {
      token: admin.token,
      data: { effectiveDate: isoDate(-30), cancellationReasonCode: 'NON_PAYMENT', reason: 'E2E non-payment' },
    })

    const contradicting = await apiJson<any>(request, 'POST', '/api/v1/quotes', {
      token: admin.token,
      data: quoteForCustomer(customer, { uwAnswers: { driverAge: 35, continuousInsurance6Months: true } }),
    })
    const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${contradicting.quoteId}/bind`, {
      token: admin.token, data: {}, expectedStatus: 400,
    })
    expect(blocked.code).toBe('UW_REFERRAL_REQUIRED')
    const referralId = String(blocked.message).match(/Referral ([0-9a-f-]{36})/)![1]
    const referral = await apiJson<any>(request, 'GET', `/api/v1/uw/referrals/${referralId}`, { token: admin.token })
    expect(JSON.stringify(referral.reasons)).toContain('INTERNAL_RECORD_PRIOR_NONPAYMENT_CANCELLATION_CONTRADICTS_QUALIFICATION')

    // The underwriter sees the discrepancy reason in the queue.
    await signInAs(page, 'uw1')
    await page.goto('/uw/queue')
    await expect(page.getByRole('row').filter({ hasText: /PRIOR_NONPAYMENT|non-?payment/i }).first()).toBeVisible()

    const overrideAttempt = await apiJson<any>(request, 'POST', `/api/v1/quotes/${contradicting.quoteId}/bind`, {
      token: admin.token, data: { overrideReason: 'Admin reviewed inline' }, expectedStatus: 400,
    })
    expect(overrideAttempt.code).toBe('UW_REFERRAL_REQUIRED')
    const unchanged = await apiJson<any>(request, 'GET', `/api/v1/uw/referrals/${referralId}`, { token: admin.token })
    expect(unchanged).toEqual(referral)

    // Once explicitly approved the same quote binds.
    await apiJson<any>(request, 'PATCH', `/api/v1/uw/referrals/${referralId}/approve`, { token: admin.token, data: { reason: 'Verified payment plan (E2E)' } })
    const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${contradicting.quoteId}/bind`, { token: admin.token, data: {} })
    expect(bound.status).toBe('Bound')
  })

  test('does not refer when the same customer has no adverse history', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const customer = await createCustomer(request, admin.token, `Clean ${uniqueName('c').replace(/[^a-zA-Z0-9]/g, '')}`)
    const quote = await apiJson<any>(request, 'POST', '/api/v1/quotes', {
      token: admin.token,
      data: quoteForCustomer(customer, { uwAnswers: { driverAge: 35, continuousInsurance6Months: true } }),
    })
    const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: admin.token, data: {} })
    expect(bound.status).toBe('Bound')
  })
})
