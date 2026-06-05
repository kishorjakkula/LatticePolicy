import { expect, test } from '@playwright/test'
import {
  createPortalUserForPolicy,
  installAuthState,
  loginApi,
  loginThroughUi,
} from './support/api'

test.describe('authentication and route access', () => {
  test('admin login opens search and renders permission-gated navigation', async ({ page }) => {
    await loginThroughUi(page, 'admin')

    await expect(page).toHaveURL(/\/search/)
    await expect(page.getByRole('heading', { name: 'Policy Search' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Dashboard/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Search/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Administration/ })).toBeVisible()

    await page.getByRole('link', { name: /Dashboard/ }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })

  test('agent can access search and quote routes without admin navigation', async ({ page, request }) => {
    const agent = await loginApi(request, 'agent1')
    await installAuthState(page, agent)

    await page.goto('/search')
    await expect(page.getByRole('heading', { name: 'Policy Search' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Administration/ })).toHaveCount(0)

    await page.goto('/wizard')
    await expect(page.getByRole('heading', { name: 'New Quote Wizard' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue to|Next/ })).toBeVisible()
  })

  test('customer can access portal and is redirected away from internal routes', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    const setup = await createPortalUserForPolicy(request, admin.token)
    const customer = await loginApi(request, setup.username)
    await installAuthState(page, customer)

    await page.goto('/portal')
    await expect(page.getByRole('heading', { name: 'Customer Portal' })).toBeVisible()
    await expect(page.getByText(setup.customer.displayName).first()).toBeVisible()
    await expect(page.getByRole('button', { name: setup.policy.policyNumber })).toBeVisible()
    await expect(page.getByRole('link', { name: /Portal/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Search/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Administration/ })).toHaveCount(0)

    await page.goto('/search')
    await expect(page).toHaveURL(/\/portal/)

    await page.goto('/admin')
    await expect(page).toHaveURL(/\/portal/)

    await page.goto(`/policies/${setup.policy.policyId}`)
    await expect(page).toHaveURL(/\/portal/)
  })
})
