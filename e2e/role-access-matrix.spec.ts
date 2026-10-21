import { expect, test } from './support/fixtures'
import { apiStatus } from './support/api'

type RouteExpectation = { route: string; heading: string | RegExp }

const allowed: Record<string, RouteExpectation[]> = {
  agent1: [
    { route: '/search', heading: 'Policy Search' },
    { route: '/dashboard', heading: 'Dashboard' },
    { route: '/wizard', heading: 'New Quote Wizard' },
  ],
  uw1: [
    { route: '/uw/queue', heading: 'UW Referrals' },
    { route: '/search', heading: 'Policy Search' },
  ],
  actuary1: [
    { route: '/rating', heading: 'Rating Workbench' },
  ],
  admin: [
    { route: '/search', heading: 'Policy Search' },
    { route: '/rating', heading: 'Rating Workbench' },
    { route: '/uw/queue', heading: 'UW Referrals' },
    { route: '/placements', heading: 'Large Commercial Placements' },
    { route: '/admin/users', heading: 'Users' },
    { route: '/admin/security', heading: 'Security' },
  ],
}

const denied: Record<string, string[]> = {
  agent1: ['/admin', '/admin/users', '/admin/security', '/admin/underwriting-rules', '/admin/underwriting-authority', '/uw/queue', '/rating'],
  uw1: ['/admin', '/admin/users', '/admin/tenant', '/admin/underwriting-rules', '/rating'],
  actuary1: ['/admin', '/admin/users', '/uw/queue', '/wizard'],
}

test.describe('role-based route access', () => {
  for (const [username, routes] of Object.entries(allowed)) {
    test(`${username} can open the pages their role grants`, async ({ page, signInAs }) => {
      await signInAs(page, username)
      for (const { route, heading } of routes) {
        await page.goto(route)
        await expect(page.getByRole('heading', { name: heading }).first(), `${username} -> ${route}`).toBeVisible()
      }
    })
  }

  for (const [username, routes] of Object.entries(denied)) {
    test(`${username} is redirected away from pages outside their role`, async ({ page, signInAs }) => {
      await signInAs(page, username)
      for (const route of routes) {
        await page.goto(route)
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
        await expect.poll(() => new URL(page.url()).pathname, { message: `${username} -> ${route}` }).not.toBe(route)
      }
    })
  }
})

test.describe('navigation follows role permissions', () => {
  test('agent sees Submissions under Work but no Referrals, and makes no referral count request', async ({ page, signInAs }) => {
    const referralRequests: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/v1/uw/referrals')) referralRequests.push(req.url())
    })
    await signInAs(page, 'agent1')
    await page.goto('/search')
    const nav = page.getByRole('navigation', { name: 'Main' })
    const work = nav.getByRole('button', { name: 'Work', exact: true })
    await expect(work).toHaveAttribute('aria-expanded', 'false')
    await work.click()
    await expect(work).toHaveAttribute('aria-expanded', 'true')
    // Waiting for the submissions count means the header's count requests have run.
    await expect(nav.getByRole('link', { name: /^Submissions\s*,\s*\d+ to review$/ })).toBeVisible()
    await expect(nav.getByRole('link', { name: /Referrals/ })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Placements', exact: true })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
    expect(referralRequests).toEqual([])
  })

  test('underwriter sees Work > Referrals with the open referral count', async ({ page, signInAs }) => {
    await signInAs(page, 'uw1')
    await page.goto('/search')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await nav.getByRole('button', { name: 'Work', exact: true }).click()
    const referrals = nav.getByRole('link', { name: /^Referrals\s*,\s*\d+ open$/ })
    await expect(referrals).toBeVisible()
    await referrals.click()
    await expect.poll(() => new URL(page.url()).pathname).toBe('/uw/queue')
    await expect(nav.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)
  })
})

test.describe('backend authorization and tenancy', () => {
  test('API rejects missing credentials, missing tenant, and cross-tenant tokens', { tag: '@smoke' }, async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')

    const anonymous = await apiStatus(request, 'GET', '/api/v1/policies')
    expect(anonymous.status).toBe(401)

    const garbageToken = await apiStatus(request, 'GET', '/api/v1/policies', { token: 'not-a-real-token' })
    expect(garbageToken.status).toBe(401)

    // Without a token there is nothing to derive the tenant from.
    const noTenant = await apiStatus(request, 'GET', '/api/v1/policies', { tenant: null })
    expect([400, 401]).toContain(noTenant.status)

    const otherTenant = await apiStatus(request, 'GET', '/api/v1/policies', { token: admin.token, tenant: 'another-carrier' })
    expect([400, 401, 403, 404]).toContain(otherTenant.status)
    expect(JSON.stringify(otherTenant.body)).not.toContain('policyNumber')
  })

  test('admin-only APIs return 403 to agent, underwriter, and actuary', async ({ request, sessionFor }) => {
    const adminOnly: Array<['GET' | 'POST', string]> = [
      ['GET', '/api/v1/admin/users'],
      ['GET', '/api/v1/admin/tenant'],
      ['GET', '/api/v1/admin/security/permissions'],
      ['POST', '/api/v1/admin/seed'],
      ['GET', '/api/v1/admin/jobs/runs'],
      ['GET', '/api/v1/admin/reinsurance/treaties'],
    ]
    for (const username of ['agent1', 'uw1', 'actuary1']) {
      const session = await sessionFor(username)
      for (const [method, path] of adminOnly) {
        const result = await apiStatus(request, method, path, { token: session.token, data: method === 'POST' ? {} : undefined })
        expect(result.status, `${username} ${method} ${path}`).toBe(403)
      }
    }
  })

  test('API docs and OpenAPI spec are admin-only', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const agent = await sessionFor('agent1')
    expect((await apiStatus(request, 'GET', '/openapi.json', { token: agent.token })).status).toBe(403)
    expect((await apiStatus(request, 'GET', '/openapi.json')).status).toBe(403)
    const spec = await apiStatus(request, 'GET', '/openapi.json', { token: admin.token })
    expect(spec.status).toBe(200)
    expect(spec.body.openapi).toMatch(/^3\./)
    expect(Object.keys(spec.body.paths).length).toBeGreaterThan(20)
  })

  test('health endpoint reports database and cache status without authentication', { tag: '@smoke' }, async ({ request }) => {
    const health = await apiStatus(request, 'GET', '/health', { tenant: null })
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ status: 'ok', db: true, cache: true })
  })
})
