import path from 'node:path'
import { expect, test } from './support/fixtures'
import { apiBaseUrl, apiJson, isoDate, tenantId, uniqueName } from './support/api'
import { fieldByLabel } from './support/wizard'

// Minimal Word document containing {{policyNumber}} and {{insuredName}}.
const templatePath = path.join(__dirname, 'fixtures', 'variables-template.docx')

test.describe('forms management', () => {
  test('seeded declaration forms are listed, searchable, and open read-only', async ({ page, signInAs }, testInfo) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/forms')
    await expect(page.getByRole('heading', { name: 'Forms Administration', exact: true })).toBeVisible()
    for (const form of ['PA-DEC', 'HO-DEC', 'CA-DEC', 'PL-DEC', 'CYB-DEC']) {
      await expect(page.getByRole('row').filter({ hasText: form }).first()).toContainText('Approved')
    }

    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('HO-DEC')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: 'HO-DEC' })).toHaveCount(1)
    await expect(page.getByRole('row').filter({ hasText: 'PA-DEC' })).toHaveCount(0)

    await page.getByRole('button', { name: 'View HO-DEC', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'View Form HO-DEC', exact: true })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Approved - Active')
    const sections = page.getByRole('tablist', { name: 'Forms sections' })
    for (const tab of ['Details & scope', 'Template', 'Attachment', 'Test & publish']) {
      await expect(sections.getByRole('tab', { name: tab, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Save Form', exact: true })).toBeDisabled()
    await sections.getByRole('tab', { name: 'Attachment', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Add rule', exact: true })).toBeDisabled()
    await sections.getByRole('tab', { name: 'Test & publish', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Submit for review', exact: true })).toBeDisabled()

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      for (const tab of ['Details & scope', 'Template', 'Attachment', 'Test & publish']) {
        await sections.getByRole('tab', { name: tab, exact: true }).click()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), {
          message: `${tab} must not overflow the page at ${width}px`,
        }).toBe(true)
        if (tab === 'Attachment') {
          await sections.scrollIntoViewIfNeeded()
          await testInfo.attach(`forms-attachment-${width}px`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
        }
      }
    }
  })

  test('creates a draft form, uploads a Word template, and lists the template variables', async ({ page, signInAs }) => {
    const formNumber = `E2E-${uniqueName('F').replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`
    await signInAs(page, 'admin')

    await page.goto('/admin/forms')
    await page.getByRole('button', { name: 'New Form', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'New Form', exact: true })).toBeVisible()
    await fieldByLabel(page, 'Carrier Code').fill('E2E')
    await fieldByLabel(page, 'Form Number').fill(formNumber)
    await fieldByLabel(page, 'Edition Date (MM/YYYY)').fill('01/2026')
    await fieldByLabel(page, 'Form Title').fill('E2E Template Endorsement')
    await fieldByLabel(page, 'Change Reason').fill('E2E create')
    await Promise.all([
      page.waitForResponse((response) => /\/admin\/forms(\?|$)/.test(response.url()) && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Create Form', exact: true }).click(),
    ])
    await expect(page.getByRole('row').filter({ hasText: formNumber })).toContainText('E2E Template Endorsement')
    await expect(page.getByRole('row').filter({ hasText: formNumber })).toContainText('Draft')

    // The editor stays open on the new form after it is created.
    await page.getByRole('tab', { name: 'Template', exact: true }).click()
    await expect(page.getByRole('main')).toContainText('No uploaded file')

    // The variable reference documents the placeholders a .docx may use.
    await page.getByText(/Template Variable Reference \(\d+\)/).click()
    await expect(page.getByRole('main')).toContainText('policyNumber')

    await page.getByLabel('Upload Template (PDF or Word .docx)', { exact: true }).setInputFiles(templatePath)
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/output/template') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Upload Template', exact: true }).click(),
    ])
    await expect(page.getByRole('main')).toContainText('variables-template.docx')
    await expect(page.getByRole('button', { name: 'Remove Template', exact: true })).toBeEnabled()
    await expect(page.getByRole('status').filter({ hasText: 'uploaded.' })).toContainText('{{policyNumber}}')
    await expect(page.getByRole('status').filter({ hasText: 'uploaded.' })).toContainText('{{insuredName}}')
    await expect(page.getByLabel('Upload Template (PDF or Word .docx)', { exact: true })).not.toHaveAttribute('accept', /xlsx/)
  })

  test('authors a draft attachment rule from the catalog and tests synthetic matching and suppression', async ({ page, request, sessionFor, signInAs }, testInfo) => {
    page.setDefaultTimeout(10_000)
    const admin = await sessionFor('admin')
    const formNumber = `E2E-${uniqueName('R').replace(/[^a-zA-Z0-9]/g, '').slice(-10).toUpperCase()}`
    const created = await apiJson<any>(request, 'POST', '/api/v1/admin/forms', {
      token: admin.token,
      expectedStatus: 201,
      data: {
        carrierCode: 'E2E', authority: 'Carrier', formNumber, formTitle: 'E2E Synthetic Attachment Rule',
        editionDate: '01/2026', formType: 'Endorsement', lineOfBusiness: 'personal-auto',
        jurisdictions: [{ stateCode: 'CA', regulatoryStatus: 'Approved', effectiveDate: isoDate(-1) }],
        applicability: [{ lineOfBusiness: 'personal-auto', productCode: 'personal-auto', riskUnitAssociation: 'Policy', transactionTypes: ['Quote', 'Issue'], active: true }],
      },
    })
    const formId = created.form.formId
    let scenarioFailed = false
    try {
      await signInAs(page, 'admin')
      await page.goto('/admin/forms')
      await page.getByRole('textbox', { name: 'Search', exact: true }).fill(formNumber)
      await page.getByRole('button', { name: 'Apply', exact: true }).click()
      await page.getByRole('button', { name: `Edit ${formNumber}`, exact: true }).click()
      await page.getByRole('tab', { name: 'Attachment', exact: true }).click()
      await page.getByText('Application field catalog', { exact: true }).click()
      await page.getByRole('searchbox', { name: 'Find application field', exact: true }).fill('Transaction premium')
      await page.getByRole('button', { name: 'Use Transaction premium', exact: true }).click()
      await expect(page.getByLabel('Condition expression')).toHaveValue('isSet(premium.total)')
      await page.getByLabel('Condition expression').fill('premium.total >= 1000 && payload.customFields.includeEndorsement == true && transaction.stage == "Issue"')
      await page.getByLabel('Never attach the form when (optional)').fill('policy.status == "Cancelled"')
      await page.getByLabel('Priority', { exact: true }).fill('25')
      const triggerResponse = page.waitForResponse((response) => response.url().includes(`/forms/${formId}/triggers`) && response.request().method() === 'POST' && response.ok(), { timeout: 10_000 })
      await page.getByRole('button', { name: 'Add rule', exact: true }).click()
      await triggerResponse
      await expect(page.getByRole('button', { name: 'Edit rule priority 25', exact: true })).toBeVisible()
      const saved = await apiJson<any>(request, 'GET', `/api/v1/admin/forms/${formId}`, { token: admin.token })
      expect(saved.form.workflowStatus).toBe('Draft')
      expect(saved.form.active).toBe(false)
      expect(saved.form.metadata.attachmentRulesVersion).toBe(1)

      await page.getByRole('tab', { name: 'Test & publish', exact: true }).click()
      await page.getByRole('combobox', { name: 'Test product', exact: true }).selectOption('personal-auto')
      await page.getByRole('combobox', { name: 'Test state', exact: true }).selectOption('CA')
      await page.getByRole('combobox', { name: 'Test transaction', exact: true }).selectOption('Issue')
      await page.getByRole('combobox', { name: 'Test new-business stage', exact: true }).selectOption('Issue')
      await page.getByLabel('Test effective date', { exact: true }).fill(isoDate())
      const scenario = { payload: { customFields: { includeEndorsement: true } }, policy: { status: 'Active' }, premium: { total: 1500 } }
      await page.getByLabel('Synthetic scenario JSON').fill(JSON.stringify(scenario))
      await page.getByRole('button', { name: 'Run Packet Preview', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Would attach', exact: true })).toBeVisible()

      await page.getByLabel('Synthetic scenario JSON').fill(JSON.stringify({ ...scenario, premium: { total: 100 } }))
      await expect(page.getByRole('heading', { name: 'Would attach', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: 'Run Packet Preview', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Would not attach', exact: true })).toBeVisible()

      await page.getByLabel('Synthetic scenario JSON').fill(JSON.stringify({ ...scenario, policy: { status: 'Cancelled' } }))
      await page.getByRole('button', { name: 'Run Packet Preview', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Would not attach', exact: true })).toBeVisible()
      const live = await apiJson<any[]>(request, 'POST', '/api/v1/admin/forms/preview', { token: admin.token, data: { ...scenario, productCode: 'personal-auto', state: 'CA', transactionType: 'Issue', effectiveDate: isoDate() } })
      expect(live.some((form) => form.formId === formId)).toBe(false)
    } catch (error) {
      scenarioFailed = true
      throw error
    } finally {
      try {
        const cleanup = await request.delete(`${apiBaseUrl}/api/v1/admin/forms/${formId}`, {
          headers: { 'X-Tenant': tenantId, Authorization: `Bearer ${admin.token}` },
          data: { reason: 'E2E scoped draft cleanup' },
          timeout: 5_000,
        })
        expect(cleanup.ok(), 'Scoped draft cleanup succeeds').toBe(true)
      } catch (error) {
        if (!scenarioFailed) throw error
        testInfo.annotations.push({ type: 'cleanup', description: String(error) })
      }
    }
  })

  test('template variable catalogue is served to the admin UI', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const catalogue = await apiJson<any>(request, 'GET', '/api/v1/admin/forms/template-variables', { token: admin.token })
    const text = JSON.stringify(catalogue)
    for (const variable of ['policyNumber', 'effectiveDate', 'insuredName']) expect(text).toContain(variable)
  })
})
