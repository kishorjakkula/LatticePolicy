import { expect, test } from './support/fixtures'
import { apiBaseUrl, apiJson, createCustomer, createIssuedPolicy, isoDate, tenantId, uniqueName } from './support/api'

test.describe('dashboard', () => {
  test('shows portfolio KPIs and links into search and the quote wizard', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    await createIssuedPolicy(request, admin.token, 'Dashboard Kpi')
    await signInAs(page, 'admin')

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    const main = page.getByRole('main')
    for (const label of ['Total Policies', 'In Force Policies', 'Open Quotes', 'Customers']) await expect(main).toContainText(label)
    for (const heading of ['Policy Status Distribution', 'Product Mix', '6-Month Trend']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
    await expect(main).toContainText(/Personal Auto\s*\d+/)

    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

    await page.getByRole('button', { name: 'New Quote' }).click()
    await expect(page.getByRole('heading', { name: 'New Quote Wizard' })).toBeVisible()
  })

  test('quick lookup in the header finds a policy by number', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Quick Lookup')
    await signInAs(page, 'admin')

    await page.goto('/dashboard')
    const lookup = page.getByRole('searchbox', { name: /Quick lookup/ })
    await lookup.fill(policy.policyNumber)
    await lookup.press('Enter')
    await expect(page.getByText(policy.policyNumber).first()).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/policies/${policy.policyId}|/search`))
  })
})

test.describe('policy search', () => {
  test('status and product filters narrow the grid', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const name = `${uniqueName('Flt').replace(/[^a-zA-Z0-9]/g, '')} Filter`
    const active = await createIssuedPolicy(request, admin.token, name)
    const cancelled = await createIssuedPolicy(request, admin.token, name)
    await apiJson<any>(request, 'POST', `/api/v1/policies/${cancelled.policyId}/cancel`, {
      token: admin.token,
      data: { effectiveDate: isoDate(0), cancellationReasonCode: 'INSURED_REQUEST', reason: 'E2E search filter' },
    })
    await signInAs(page, 'admin')

    await page.goto('/search?mode=policies')
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Cancelled' })
    await page.getByRole('textbox', { name: 'Search' }).fill(cancelled.policyNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const cancelledRow = page.getByRole('row').filter({ hasText: cancelled.policyNumber })
    await expect(cancelledRow).toContainText('Cancelled')

    // The in-force twin is excluded by the status filter.
    await page.getByRole('textbox', { name: 'Search' }).fill(active.policyNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: active.policyNumber })).toHaveCount(0)
    await expect(page.getByRole('main')).toContainText(/No policies found|0 policies/)

    // ...and found again once the status filter is cleared.
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'All Statuses' })
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: active.policyNumber })).toContainText('In Force')

    // A product that the policy does not belong to hides it.
    await page.getByRole('combobox', { name: 'Product' }).selectOption({ label: 'Homeowners' })
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: active.policyNumber })).toHaveCount(0)
  })

  test('customers tab finds a customer and opens the customer view', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const lastName = uniqueName('Srch').replace(/[^a-zA-Z0-9]/g, '')
    const customer = await createCustomer(request, admin.token, `Tabby ${lastName}`)
    await signInAs(page, 'admin')

    await page.goto('/search?mode=customers')
    await expect(page.getByRole('tab', { name: /Customers/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('textbox', { name: 'Search' }).fill(lastName)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: lastName })
    await expect(row.first()).toContainText(customer.customerKey)

    await page.goto(`/customers/${customer.customerId}`)
    await expect(page.getByRole('main')).toContainText(customer.customerKey)
    await expect(page.getByRole('main')).toContainText(lastName)
  })

  test('policy export API returns the filtered result set as CSV', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Export Csv')
    const response = await request.get(`${apiBaseUrl}/api/v1/policies/export?q=${encodeURIComponent(policy.policyNumber)}`, {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant': tenantId },
    })
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')
    const csv = await response.text()
    expect(csv.split('\n')[0].toLowerCase()).toContain('policy')
    expect(csv).toContain(policy.policyNumber)
  })

  test('Export CSV button downloads every policy matching the current filters', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Export Button')
    await signInAs(page, 'admin')

    await page.goto('/search?mode=policies')
    await page.getByRole('textbox', { name: 'Search' }).fill(policy.policyNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('button', { name: policy.policyNumber }).first()).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ])
    expect(download.suggestedFilename()).toBe('policies-export.csv')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(chunk as Buffer)
    const lines = Buffer.concat(chunks).toString('utf8').trim().split('\n')
    expect(lines[0].toLowerCase()).toContain('policy')
    // Filtered to one policy: header plus exactly one data row.
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(policy.policyNumber)
  })

  test('Columns menu hides and restores grid columns and remembers the choice', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createIssuedPolicy(request, admin.token, 'Column Chooser')
    await signInAs(page, 'admin')

    await page.goto('/search?mode=policies')
    await page.getByRole('textbox', { name: 'Search' }).fill(policy.policyNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: policy.policyNumber })
    await expect(row).toContainText('$')
    await expect(page.getByRole('columnheader', { name: 'Premium' })).toBeVisible()

    await page.getByRole('button', { name: 'Columns' }).click()
    const menu = page.getByRole('group', { name: 'Visible columns' })
    await menu.getByRole('checkbox', { name: 'Premium' }).uncheck()
    await menu.getByRole('checkbox', { name: 'Created' }).uncheck()
    await expect(page.getByRole('columnheader', { name: 'Premium' })).toHaveCount(0)
    await expect(page.getByRole('columnheader', { name: 'Created' })).toHaveCount(0)
    await expect(row).not.toContainText('$')
    await expect(row).toContainText(policy.policyNumber)

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await page.reload()
    await expect(page.getByRole('columnheader', { name: 'Policy #' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Premium' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('group', { name: 'Visible columns' }).getByRole('checkbox', { name: 'Premium' }).check()
    await expect(page.getByRole('columnheader', { name: 'Premium' })).toBeVisible()
  })

  test('sorting and page size are reflected in the URL and survive a reload', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/search?mode=policies')
    await page.getByRole('button', { name: 'Premium', exact: true }).click()
    await expect(page).toHaveURL(/sortBy=premium/i)
    await page.getByRole('combobox', { name: 'Results per page' }).selectOption({ label: '25 per page' })
    await expect(page).toHaveURL(/pageSize=25/)
    await page.reload()
    await expect(page.getByRole('combobox', { name: 'Results per page' })).toHaveValue('25')
    await expect(page).toHaveURL(/sortBy=premium/i)
  })
})
