import path from 'node:path'
import { expect, test } from './support/fixtures'
import { apiJson, uniqueName } from './support/api'
import { fieldByLabel } from './support/wizard'

// Minimal Word document containing {{policyNumber}} and {{insuredName}}.
const templatePath = path.join(__dirname, 'fixtures', 'variables-template.docx')

test.describe('forms management', () => {
  test('seeded declaration forms are listed, searchable, and open read-only', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/forms')
    await expect(page.getByRole('heading', { name: 'Forms Administration' })).toBeVisible()
    for (const form of ['PA-DEC', 'HO-DEC', 'CA-DEC', 'PL-DEC', 'CYB-DEC']) {
      await expect(page.getByRole('row').filter({ hasText: form }).first()).toContainText('Approved')
    }

    await page.getByRole('textbox', { name: 'Search' }).fill('HO-DEC')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByRole('row').filter({ hasText: 'HO-DEC' })).toHaveCount(1)
    await expect(page.getByRole('row').filter({ hasText: 'PA-DEC' })).toHaveCount(0)

    await page.getByRole('button', { name: 'View HO-DEC' }).click()
    await expect(page.getByRole('heading', { name: 'View Form HO-DEC' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Approved - Active')
    const sections = page.getByRole('navigation', { name: 'Forms sections' })
    for (const tab of ['Catalog', 'Jurisdictions', 'Applicability', 'Output + Delivery', 'Security', 'Audit', 'Packet Preview']) {
      await expect(sections.getByRole('button', { name: tab, exact: true })).toBeVisible()
    }
  })

  test('creates a draft form, uploads a Word template, and lists the template variables', async ({ page, signInAs }) => {
    const formNumber = `E2E-${uniqueName('F').replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`
    await signInAs(page, 'admin')

    await page.goto('/admin/forms')
    await page.getByRole('button', { name: 'New Form' }).click()
    await expect(page.getByRole('heading', { name: 'New Form' })).toBeVisible()
    await fieldByLabel(page, 'Carrier Code').fill('E2E')
    await fieldByLabel(page, 'Form Number').fill(formNumber)
    await fieldByLabel(page, 'Edition Date (MM/YYYY)').fill('01/2026')
    await fieldByLabel(page, 'Form Title').fill('E2E Template Endorsement')
    await fieldByLabel(page, 'Change Reason').fill('E2E create')
    await Promise.all([
      page.waitForResponse((response) => /\/admin\/forms(\?|$)/.test(response.url()) && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Create Form' }).click(),
    ])
    await expect(page.getByRole('row').filter({ hasText: formNumber })).toContainText('E2E Template Endorsement')
    await expect(page.getByRole('row').filter({ hasText: formNumber })).toContainText('Draft')

    // The editor stays open on the new form after it is created.
    await page.getByRole('navigation', { name: 'Forms sections' }).getByRole('button', { name: 'Output + Delivery' }).click()
    await expect(page.getByRole('main')).toContainText('No uploaded file')

    // The variable reference documents the placeholders a .docx may use.
    await page.getByText(/Template Variable Reference \(\d+\)/).click()
    await expect(page.getByRole('main')).toContainText('policyNumber')

    await page.locator('input[type="file"]').setInputFiles(templatePath)
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/output/template') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Upload Template' }).click(),
    ])
    await expect(page.getByRole('main')).toContainText('variables-template.docx')
    await expect(page.getByRole('button', { name: 'Remove Template' })).toBeEnabled()
  })

  test('template variable catalogue is served to the admin UI', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const catalogue = await apiJson<any>(request, 'GET', '/api/v1/admin/forms/template-variables', { token: admin.token })
    const text = JSON.stringify(catalogue)
    for (const variable of ['policyNumber', 'effectiveDate', 'insuredName']) expect(text).toContain(variable)
  })
})
