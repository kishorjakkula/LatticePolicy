import { expect, test } from '@playwright/test'
import { apiJson, createIssuedPolicy, installAuthState, loginApi } from './support/api'

test.describe('production policy critical paths', () => {
  test('issued policy cancellation is visible with its transaction audit trail', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Scenario Cancel')
    const cancelled = await apiJson<any>(request, 'POST', `/api/v1/policies/${policy.policyId}/cancel`, {
      token: admin.token,
      data: {
        effectiveDate: '2026-10-01',
        cancellationReasonCode: 'DECEASED',
        reason: 'Production scenario browser validation',
      },
    })
    expect(cancelled.transactionType).toBe('Cancel')
    expect(cancelled.premium.total.amount).toBeLessThanOrEqual(0)

    await installAuthState(page, admin)
    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByText(policy.policyNumber).first()).toBeVisible()
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Cancel/).first()).toBeVisible()
  })
})
