import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, createCustomer, createPortalUserForPolicy, uniqueName } from './support/api'
import { fieldByLabel } from './support/wizard'

test.describe('customer administration', () => {
  test('creates a customer through the admin form and finds it in the list', async ({ page, signInAs }) => {
    const lastName = uniqueName('Cust').replace(/[^a-zA-Z0-9]/g, '')
    await signInAs(page, 'admin')

    await page.goto('/admin/customers')
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible()
    await page.getByRole('button', { name: 'New Customer' }).click()
    await expect(page).toHaveURL(/\/admin\/customers\/new/)
    await expect(fieldByLabel(page, 'Customer Key')).toHaveValue('Will be generated')

    await fieldByLabel(page, 'First Name').fill('Evelyn')
    await fieldByLabel(page, 'Last Name').fill(lastName)
    await fieldByLabel(page, 'DOB').fill('1979-03-21')

    // A customer needs at least one way to be reached.
    await page.getByRole('button', { name: 'Save Draft' }).click()
    await expect(page.getByText('At least one contact method or address is required')).toBeVisible()

    await page.getByRole('button', { name: 'Contact & Address' }).click()
    await page.getByRole('button', { name: 'Add Contact' }).click()
    const contactRow = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Remove' }) }).first()
    await contactRow.getByRole('combobox').selectOption('EMAIL')
    await contactRow.getByRole('textbox').nth(1).fill(`${lastName.toLowerCase()}@example.com`)

    const [saved] = await Promise.all([
      page.waitForResponse((response) => /\/api\/v1\/admin\/customers(\?|$)/.test(response.url()) && response.request().method() === 'POST'),
      page.getByRole('button', { name: 'Save Draft' }).click(),
    ])
    expect(saved.status()).toBeLessThan(300)
    const body = await saved.json()
    const customerKey: string = (body.data ?? body).customerKey
    expect(customerKey).toMatch(/^CUST-\d{4}-\d+/)

    await page.goto('/admin/customers')
    await page.getByRole('textbox', { name: 'Search' }).fill(lastName)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: customerKey })
    await expect(row).toContainText(`Evelyn ${lastName}`)
    await expect(row).toContainText('INDIVIDUAL')

    await row.getByRole('button', { name: `View customer ${customerKey}` }).click()
    await expect(page).toHaveURL(/\/admin\/customers\/view\//)
    // The key is rendered inside a read-only input on the detail form.
    await expect(fieldByLabel(page, 'Customer Key')).toHaveValue(customerKey)
    await expect(fieldByLabel(page, 'Last Name')).toHaveValue(lastName)
  })

  test('customer view links the customer to their policies', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const setup = await createPortalUserForPolicy(request, admin.token)
    await signInAs(page, 'admin')

    await page.goto(`/customers/${setup.customer.customerId}`)
    await expect(page.getByRole('main')).toContainText(setup.customer.customerKey)
    await expect(page.getByRole('main')).toContainText(setup.policy.policyNumber)

    // And the policy view links back to the customer.
    await page.goto(`/policies/${setup.policy.policyId}`)
    await expect(page.getByRole('link', { name: new RegExp(setup.customer.customerKey) })).toBeVisible()
  })

  test('sensitive identity fields are masked in API responses and reveal is audited', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const customer = await createCustomer(request, admin.token, `Masked ${uniqueName('pii').replace(/[^a-zA-Z0-9]/g, '')}`)

    const read = await apiJson<any>(request, 'GET', `/api/v1/admin/customers/${customer.customerKey}`, { token: admin.token })
    // DOB was supplied as 1980-01-01; a plain read must not echo it back.
    expect(JSON.stringify(read)).not.toContain('1980-01-01')

    const reveal = await apiJson<any>(request, 'POST', `/api/v1/admin/customers/${customer.customerKey}/reveal`, {
      token: admin.token, data: { field: 'dob', reason: 'E2E_VERIFICATION' },
    })
    expect(JSON.stringify(reveal)).toContain('1980-01-01')

    const audit = await apiJson<any>(request, 'GET', `/api/v1/admin/customers/${customer.customerKey}/audit`, { token: admin.token })
    expect(JSON.stringify(audit)).toMatch(/REVEAL|reveal/)
  })

  test('agents cannot read or create customer records through the admin API', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const agent = await sessionFor('agent1')
    const customer = await createCustomer(request, admin.token, `Guarded ${uniqueName('g').replace(/[^a-zA-Z0-9]/g, '')}`)
    expect((await apiStatus(request, 'GET', `/api/v1/admin/customers/${customer.customerKey}`, { token: agent.token })).status).toBe(403)
    expect((await apiStatus(request, 'POST', `/api/v1/admin/customers/${customer.customerKey}/reveal`, { token: agent.token, data: { field: 'dob', reason: 'x' } })).status).toBe(403)
    expect((await apiStatus(request, 'POST', '/api/v1/admin/customers', { token: agent.token, data: {} })).status).toBe(403)
  })
})
