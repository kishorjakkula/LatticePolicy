import { expect, test } from './support/fixtures'
import { apiStatus, loginThroughUi, tenantId } from './support/api'

test.describe('sign-in, sign-out, and session handling', () => {
  test('rejects a wrong password and keeps the user on the login page', { tag: '@smoke' }, async ({ page }) => {
    await loginThroughUi(page, 'admin', 'definitely-not-the-password')
    await expect(page.locator('p.error')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
    expect(await page.evaluate(() => window.localStorage.getItem('auth-storage') || '')).not.toContain('"token":"ey')
  })

  test('rejects an unknown organization slug', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Organization Slug').fill('no-such-carrier')
    await page.getByLabel('Email / Username').fill('admin')
    await page.getByLabel('Password').fill('password')
    await page.getByRole('button', { name: 'Login' }).click()
    await expect(page.locator('p.error')).toBeVisible()
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated visitors are sent to login from every protected route', { tag: '@smoke' }, async ({ page }) => {
    for (const route of ['/dashboard', '/search', '/wizard', '/uw/queue', '/admin/users', '/portal', '/rating', '/placements']) {
      await page.goto(route)
      await expect(page, `route ${route}`).toHaveURL(/\/login/)
    }
  })

  test('sign out clears the session and protected routes stop working', async ({ page }) => {
    await loginThroughUi(page, 'admin')
    await expect(page).toHaveURL(/\/search/)

    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
    await page.goto('/search')
    await expect(page).toHaveURL(/\/login/)
  })

  test('underwriter signs in through the UI and lands on a permitted page', async ({ page }) => {
    await loginThroughUi(page, 'uw1')
    await expect(page).not.toHaveURL(/\/login/)
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Administration/ })).toHaveCount(0)
  })

  test('login API enforces credentials and tenant', async ({ request }) => {
    const badPassword = await apiStatus(request, 'POST', '/auth/login', { data: { tenantId, username: 'admin', password: 'nope' } })
    expect(badPassword.status).toBe(401)
    expect(JSON.stringify(badPassword.body)).not.toContain('token')

    const unknownUser = await apiStatus(request, 'POST', '/auth/login', { data: { tenantId, username: 'ghost-user', password: 'password' } })
    expect(unknownUser.status).toBe(401)
    // Same answer for unknown user and wrong password: no account enumeration.
    expect(unknownUser.body.code).toBe(badPassword.body.code)
  })
})
