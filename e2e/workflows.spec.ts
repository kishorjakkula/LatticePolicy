import { expect, test } from '@playwright/test'
import {
  createIssuedPolicy,
  createPortalUserForPolicy,
  installAuthState,
  loginApi,
  seedDemoPolicies,
} from './support/api'

test.describe('browser workflows', () => {
  test('agent can create quote-to-policy data and view the bound policy in the browser', async ({ page, request }) => {
    const agent = await loginApi(request, 'agent1')
    const policy = await createIssuedPolicy(request, agent.token, 'Workflow Agent')
    await installAuthState(page, agent)

    await page.goto('/wizard')
    await expect(page.getByRole('heading', { name: 'New Quote Wizard' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue to|Next/ })).toBeVisible()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page).toHaveURL(new RegExp(`/policies/${policy.policyId}`))
    await expect(page.getByText(policy.policyNumber).first()).toBeVisible()
    await expect(page.getByText(/Issued|In Force|Bind/).first()).toBeVisible()
  })

  test('underwriter can review seeded referral queue', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await seedDemoPolicies(request, admin.token)
    const underwriter = await loginApi(request, 'uw1')
    await installAuthState(page, underwriter)

    await page.goto('/uw/queue')
    await expect(page.getByRole('heading', { name: 'UW Referrals' })).toBeVisible()
    await expect(page.getByText('Refer').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve' }).first()).toBeVisible()
  })

  test('customer can open portal list and policy summary', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    const setup = await createPortalUserForPolicy(request, admin.token)
    const customer = await loginApi(request, setup.username)
    await installAuthState(page, customer)

    await page.goto('/portal')
    await expect(page.getByRole('heading', { name: 'Customer Portal' })).toBeVisible()
    await page.getByRole('button', { name: setup.policy.policyNumber }).click()
    await expect(page.getByRole('heading', { name: 'Policy Summary' })).toBeVisible()
    await expect(page.getByText(setup.policy.policyNumber).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'View Declaration' })).toBeEnabled()
  })

  test('mobile navigation opens, closes, and routes correctly', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await installAuthState(page, admin)
    await page.setViewportSize({ width: 390, height: 844 })

    await page.goto('/search')
    const nav = page.locator('#topnav-main')
    await expect(nav).not.toHaveClass(/is-open/)

    const toggle = page.getByLabel('Toggle navigation menu')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(nav).toHaveClass(/is-open/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await toggle.click()
    await expect(nav).not.toHaveClass(/is-open/)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await toggle.click()
    await expect(nav).toHaveClass(/is-open/)
    await page.getByRole('link', { name: /Dashboard/ }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(nav).not.toHaveClass(/is-open/)
  })

  test('search filters, pagination, and policy detail navigation work in the browser', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Search Browser')
    await installAuthState(page, admin)

    await page.goto('/search?page=1&pageSize=1&mode=policies&sortBy=effectiveDate&sortDir=desc')
    await expect(page.getByRole('heading', { name: 'Policy Search' })).toBeVisible()
    await expect(page.getByText(/Showing 1-1 of|No policies found/)).toBeVisible()

    const next = page.getByRole('button', { name: 'Go to next page' })
    if (await next.isEnabled()) {
      await next.click()
      await expect(page).toHaveURL(/page=2/)
    }

    await page.getByRole('textbox', { name: 'Search' }).fill(policy.policyNumber)
    await page.getByLabel('Status', { exact: true }).selectOption('Issued')
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('button', { name: policy.policyNumber })).toBeVisible()

    await page.getByRole('button', { name: policy.policyNumber }).click()
    await expect(page).toHaveURL(new RegExp(`/policies/${policy.policyId}`))
    await expect(page.getByText(policy.policyNumber).first()).toBeVisible()
  })
})
