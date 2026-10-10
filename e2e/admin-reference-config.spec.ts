import { expect, test } from './support/fixtures'
import { uniqueName } from './support/api'
import { fieldByLabel } from './support/wizard'

test.describe('administration: reference configuration', () => {
  test('administration shell lists every section and defaults to Forms', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/admin\/forms/)
    const nav = page.getByRole('complementary').getByRole('navigation')
    for (const section of [
      'Forms', 'Underwriting Companies', 'Users', 'Tenant', 'Security', 'Customers', 'Agency Onboarding', 'Notifications',
      'Compliance', 'Data Import', 'Operations Dashboard', 'Exposure', 'Reinsurance', 'Bordereaux', 'Jobs',
      'Underwriting Authority', 'Underwriting Rules',
    ]) {
      await expect(nav.getByRole('link', { name: section, exact: true })).toBeVisible()
    }
    await nav.getByRole('link', { name: 'Underwriting Rules', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Underwriting Rules' })).toBeVisible()
    // Legacy path still resolves.
    await page.goto('/admin/underwriting-companies')
    await expect(page).toHaveURL(/\/admin\/uw-company/)
  })

  test('adds and removes an underwriting company', async ({ page, signInAs }) => {
    const name = uniqueName('E2E Underwriters')
    await signInAs(page, 'admin')

    await page.goto('/admin/uw-company')
    await expect(page.getByRole('heading', { name: 'Underwriting Companies', level: 2 })).toBeVisible()
    await fieldByLabel(page, 'Company Name').fill(name)
    await fieldByLabel(page, 'Product').selectOption('cyber')
    await fieldByLabel(page, 'Country').selectOption('US')
    await fieldByLabel(page, 'State/Province').selectOption('NV')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/admin/underwriting-companies') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Add', exact: true }).click(),
    ])
    const row = page.getByRole('row').filter({ hasText: name })
    await expect(row).toContainText('NV')
    await expect(row).toContainText(/Active/)

    page.once('dialog', (dialog) => void dialog.accept())
    await row.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0)
  })

  test('tenant settings load and the reference-data seed is idempotent', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/tenant')
    await expect(page.getByRole('heading', { name: 'Tenant', exact: true })).toBeVisible()
    await expect(fieldByLabel(page, 'Tenant ID')).toHaveValue('sample-carrier')
    await expect(page.getByRole('heading', { name: 'Policy Number Format by Product' })).toBeVisible()
    await expect(page.getByRole('row').filter({ has: page.locator('input[value="PC-{ID8}"]') })).toHaveCount(1)

    const [seed] = await Promise.all([
      page.waitForResponse((response) => response.url().includes('/admin/seed-reference-data') && response.ok()),
      page.getByRole('button', { name: 'Seed Reference Data' }).click(),
    ])
    const summary = (await seed.json()).summary
    // Global setup already seeded, so a second run must create nothing new.
    expect(summary.underwritingCompanies.created).toEqual([])
    expect(summary.underwritingCompanies.skipped).toEqual(expect.arrayContaining(['personal-auto', 'homeowners', 'cyber']))
    expect(summary.forms.created).toEqual([])
  })

  test('compliance shows state/product eligibility and the OFAC review queue', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/compliance')
    await expect(page.getByRole('heading', { name: 'Compliance' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Commercial Auto' }).filter({ hasText: 'CA' }).first()).toContainText('ACTIVE')
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()

    await page.getByRole('button', { name: 'OFAC Review Queue' }).click()
    await expect(page.getByRole('main')).toContainText(/OFAC|review/i)
    await page.getByRole('button', { name: 'State/Product Eligibility' }).click()
    await expect(page.getByPlaceholder('personal-auto')).toBeVisible()
  })

  test('creates and previews a notification template', async ({ page, signInAs }) => {
    const code = uniqueName('e2e-tpl')
    await signInAs(page, 'admin')

    await page.goto('/admin/notification-templates')
    await expect(page.getByRole('heading', { name: 'Notification Templates' })).toBeVisible()
    await page.getByPlaceholder('pa-cancel-ca').fill(code)
    await page.getByPlaceholder('POLICY_CANCELLED').fill('POLICY_ISSUED')
    // Scoped to the example product so it never competes with the default templates.
    await page.getByPlaceholder('personal-auto').fill('example-identity-protection')
    await page.getByPlaceholder('Policy {{policyNumber}} cancellation notice').fill('Policy {{policyNumber}} issued')
    await page.getByPlaceholder(/is cancelled effective/).fill('Policy {{policyNumber}} is active from {{effectiveDate}}.')

    await page.getByRole('button', { name: 'Preview' }).click()
    await expect(page.getByRole('main')).toContainText(/Preview/)

    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/notification-templates') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Add', exact: true }).click(),
    ])
    const row = page.getByRole('row').filter({ hasText: code })
    await expect(row).toContainText('POLICY_ISSUED')
  })

  test('operations dashboard summarises queues and links referrals', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/dashboard')
    await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible()
    for (const tile of ['Outbox Pending/Retry', 'Outbox Failed', 'OFAC Pending Review', 'UW Referrals Open', 'Notifications Failed']) {
      await expect(page.getByRole('main')).toContainText(tile)
    }
    for (const heading of ['Policy Integrity Exceptions', 'Outbox Delivery Failures', 'Notification Failures', 'OFAC Review Queue', 'Open Underwriting Referrals']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
  })

  test('onboards a new agency', async ({ page, signInAs }) => {
    const legalName = uniqueName('E2E Agency')
    await signInAs(page, 'admin')

    await page.goto('/admin/onboarding')
    await expect(page.getByRole('heading', { name: 'Agency Onboarding' })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Sample Carrier Agency' })).toBeVisible()
    await page.getByRole('button', { name: 'New Agency' }).click()
    await expect(page.getByRole('heading', { name: 'New Agency' })).toBeVisible()
    const input = (label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::input[1]')
    await input('Legal Name *').fill(legalName)

    // An agency needs an NPN or FEIN before it can be saved.
    await page.getByRole('button', { name: 'Create Agency' }).click()
    await expect(page.getByText('Please correct the required fields before saving the agency.')).toBeVisible()
    await expect(page.getByText('Enter Agency NPN or FEIN Last4.').first()).toBeVisible()

    await input('NPN *').fill(String(Date.now()).slice(-8))
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/onboarding') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Create Agency' }).click(),
    ])

    await page.goto('/admin/onboarding')
    await page.getByRole('textbox', { name: 'Query' }).fill(legalName)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: legalName })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(/AG\d+/)
  })
})
