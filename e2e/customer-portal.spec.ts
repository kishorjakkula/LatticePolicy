import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, createPortalUserForPolicy, installAuthState, loginApi } from './support/api'

const INTERNAL_ONLY_KEYS = ['calcTrace', 'commission', 'aiInsights', 'underwriting', 'updatedBy', 'statusHistory']

test.describe('customer portal', () => {
  test('customer sees only their own policy, with a customer-safe projection', async ({ page, request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const mine = await createPortalUserForPolicy(request, admin.token)
    const theirs = await createPortalUserForPolicy(request, admin.token)
    const customer = await loginApi(request, mine.username, mine.password)
    expect(customer.user.roles).toEqual(['customer'])

    // API: own summary lists exactly the linked policy.
    const summary = await apiJson<any>(request, 'GET', '/api/v1/customer-portal/summary', { token: customer.token })
    const summaryText = JSON.stringify(summary)
    expect(summaryText).toContain(mine.policy.policyNumber)
    expect(summaryText).not.toContain(theirs.policy.policyNumber)

    // API: own policy is readable and carries no internal-only fields.
    const ownPolicy = await apiJson<any>(request, 'GET', `/api/v1/customer-portal/policies/${mine.policy.policyId}`, { token: customer.token })
    const ownText = JSON.stringify(ownPolicy)
    expect(ownText).toContain(mine.policy.policyNumber)
    for (const key of INTERNAL_ONLY_KEYS) expect(ownText, `portal projection leaks ${key}`).not.toContain(`"${key}"`)

    // API: another customer's policy and documents are not reachable.
    const otherPolicy = await apiStatus(request, 'GET', `/api/v1/customer-portal/policies/${theirs.policy.policyId}`, { token: customer.token })
    expect([403, 404]).toContain(otherPolicy.status)
    expect(JSON.stringify(otherPolicy.body)).not.toContain(theirs.policy.policyNumber)
    const otherDocs = await apiStatus(request, 'GET', `/api/v1/customer-portal/policies/${theirs.policy.policyId}/documents`, { token: customer.token })
    expect([403, 404]).toContain(otherDocs.status)

    // API: internal endpoints are closed to the customer role.
    for (const path of ['/api/v1/policies', `/api/v1/policies/${mine.policy.policyId}`, '/api/v1/quotes', '/api/v1/admin/customers/search?q=a', '/api/v1/customers/search?q=a', `/api/v1/customers/${theirs.customer.customerKey}`, '/api/v1/uw/referrals']) {
      const result = await apiStatus(request, 'GET', path, { token: customer.token })
      expect(result.status, `customer GET ${path}`).toBe(403)
    }
    const quoteAttempt = await apiStatus(request, 'POST', '/api/v1/quotes', { token: customer.token, data: {} })
    expect(quoteAttempt.status).toBe(403)

    // Browser: the portal lists only the customer's policy.
    await installAuthState(page, customer)
    await page.goto('/portal')
    await expect(page.getByRole('heading', { name: 'Customer Portal' })).toBeVisible()
    await expect(page.getByRole('button', { name: mine.policy.policyNumber })).toBeVisible()
    await expect(page.getByText(theirs.policy.policyNumber)).toHaveCount(0)
  })

  test('customer opens the policy summary and its documents', async ({ page, request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const setup = await createPortalUserForPolicy(request, admin.token)
    const customer = await loginApi(request, setup.username, setup.password)
    await installAuthState(page, customer)

    await page.goto('/portal')
    await page.getByRole('button', { name: setup.policy.policyNumber }).click()
    await expect(page.getByRole('heading', { name: 'Policy Summary' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(setup.policy.policyNumber)
    await expect(page.getByRole('main')).toContainText(/In Force|Issued|Active/)
    await expect(page.getByRole('button', { name: 'View Declaration' })).toBeEnabled()

    const documents = await apiJson<any>(request, 'GET', `/api/v1/customer-portal/policies/${setup.policy.policyId}/documents`, { token: customer.token })
    const items: any[] = Array.isArray(documents) ? documents : documents.items ?? documents.documents ?? []
    // Internal rating worksheets must never be offered to the insured.
    expect(JSON.stringify(items)).not.toContain('RATING_WORKSHEET')
  })

  test('a staff user without a linked customer cannot use the portal', async ({ page, request, sessionFor, signInAs }) => {
    const agent = await sessionFor('agent1')
    const summary = await apiStatus(request, 'GET', '/api/v1/customer-portal/summary', { token: agent.token })
    expect([403, 404]).toContain(summary.status)

    await signInAs(page, 'agent1')
    await page.goto('/portal')
    await expect(page.getByRole('heading', { name: 'Customer Portal' })).toHaveCount(0)
  })
})
