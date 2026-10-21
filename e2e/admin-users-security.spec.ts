import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, createdUserPassword, tenantId, uniqueName } from './support/api'
import { fieldByLabel } from './support/wizard'

test.describe('user administration', () => {
  test('admin creates a user in the UI, the user can sign in, and disabling blocks them', async ({ page, request, signInAs }) => {
    const username = uniqueName('e2e-user')
    await signInAs(page, 'admin')

    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()
    await fieldByLabel(page, 'Username').fill(username)
    await fieldByLabel(page, 'Password').fill(createdUserPassword)
    await expect(page.getByRole('checkbox', { name: 'agent', exact: true })).toBeChecked()
    await page.getByRole('checkbox', { name: 'underwriter', exact: true }).check()
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/admin/users') && response.request().method() === 'POST' && response.status() === 201),
      page.getByRole('button', { name: 'Add User' }).click(),
    ])

    const row = page.getByRole('row').filter({ hasText: username })
    await expect(row).toContainText('agent')
    await expect(row).toContainText('underwriter')
    await expect(row).toContainText('Active')

    const login = await apiStatus(request, 'POST', '/auth/login', { data: { tenantId, username, password: createdUserPassword } })
    expect(login.status).toBe(200)
    const session = login.body.data ?? login.body
    expect(session.user.roles.sort()).toEqual(['agent', 'underwriter'])

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/admin/users/') && response.request().method() === 'PATCH' && response.ok()),
      row.getByRole('button', { name: 'Disable' }).click(),
    ])
    await expect(row.getByRole('button', { name: 'Enable' })).toBeVisible()
    const blocked = await apiStatus(request, 'POST', '/auth/login', { data: { tenantId, username, password: createdUserPassword } })
    expect([401, 403]).toContain(blocked.status)

    await row.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('dialog', { name: `Delete user ${username}` }).getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('row').filter({ hasText: username })).toHaveCount(0)
  })

  test('user API rejects weak passwords and duplicate usernames', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const weak = await apiStatus(request, 'POST', '/api/v1/admin/users', {
      token: admin.token, data: { username: uniqueName('weak'), password: 'abc', roles: ['agent'] },
    })
    expect(weak.status).toBe(400)

    const duplicate = await apiStatus(request, 'POST', '/api/v1/admin/users', {
      token: admin.token, data: { username: 'admin', password: createdUserPassword, roles: ['agent'] },
    })
    expect([400, 409]).toContain(duplicate.status)
  })
})

test.describe('roles and permissions', () => {
  test('security page shows each role with its permission mapping', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/security')
    await expect(page.getByRole('heading', { name: 'Security', exact: true })).toBeVisible()
    for (const role of ['admin', 'agent', 'underwriter', 'customer', 'actuary']) {
      await expect(page.getByRole('button', { name: role, exact: true })).toBeVisible()
    }

    await page.getByRole('button', { name: 'agent', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Role: agent' })).toBeVisible()
    const permissions = page.getByRole('region', { name: 'Role and permission matrix', exact: true })
    await expect(permissions.getByRole('checkbox', { name: 'Agent: Search (menu)', exact: true })).toBeChecked()
    await expect(permissions.getByRole('checkbox', { name: 'Agent: Administration (menu)', exact: true })).not.toBeChecked()

    await page.getByRole('button', { name: 'underwriter', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Role: underwriter' })).toBeVisible()
    await expect(permissions.getByRole('checkbox', { name: 'Underwriter: Underwriting queue (menu)', exact: true })).toBeChecked()
  })

  test('a custom role grants exactly the permissions mapped to it', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const roleCode = `e2e_${uniqueName('role').replace(/[^a-z0-9]/g, '_')}`
    await apiJson<any>(request, 'POST', '/api/v1/admin/security/roles', {
      token: admin.token,
      expectedStatus: [200, 201],
      data: { roleCode, roleName: 'E2E Search Only', description: 'E2E', status: 'ACTIVE', permissionCodes: ['menu.search.view', 'page.search.view', 'page.policy.view'] },
    })
    const username = uniqueName('e2e-roleuser')
    await apiJson<any>(request, 'POST', '/api/v1/admin/users', {
      token: admin.token, expectedStatus: 201, data: { username, password: createdUserPassword, roles: [roleCode] },
    })

    try {
      const login = await apiStatus(request, 'POST', '/auth/login', { data: { tenantId, username, password: createdUserPassword } })
      expect(login.status).toBe(200)
      const session = login.body.data ?? login.body
      expect(session.user.permissions).toEqual(expect.arrayContaining(['menu.search.view', 'page.search.view']))
      expect(session.user.permissions).not.toContain('page.wizard.view')

      expect((await apiStatus(request, 'GET', '/api/v1/policies?pageSize=1', { token: session.token })).status).toBe(200)
      expect((await apiStatus(request, 'POST', '/api/v1/quotes', { token: session.token, data: {} })).status).toBe(403)
      expect((await apiStatus(request, 'GET', '/api/v1/admin/users', { token: session.token })).status).toBe(403)
    } finally {
      const users = await apiJson<any>(request, 'GET', '/api/v1/admin/users', { token: admin.token, query: { q: username, pageSize: 200 } })
      const created = (users.items ?? users).find((user: any) => user.username === username)
      if (created) await apiStatus(request, 'DELETE', `/api/v1/admin/users/${created.id}`, { token: admin.token })
      await apiStatus(request, 'DELETE', `/api/v1/admin/security/roles/${roleCode}`, { token: admin.token })
    }
  })
})
