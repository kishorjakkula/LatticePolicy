import { expect, test } from './support/fixtures'
import { apiJson, createWizardReadyPolicy, uniqueName } from './support/api'
import { selectProduct } from './support/wizard'

test.describe('WP-0004 operational workflows', () => {
  test('changes ten state filings with a required reason and reloads their statuses', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const product = uniqueName('wp4-filings').toLowerCase().replace(/[^a-z0-9-]/g, '')
    const states = ['CA', 'NY', 'NJ', 'PA', 'OH', 'TX', 'FL', 'WA', 'OR', 'AZ']
    for (const stateCode of states) {
      await apiJson(request, 'POST', '/api/v1/admin/compliance/eligibility', {
        token: admin.token, data: { productCode: product, stateCode, status: 'ACTIVE' }, expectedStatus: 201,
      })
    }
    await signInAs(page, 'admin')
    await page.goto('/admin/compliance')
    await page.getByRole('combobox', { name: 'Product', exact: true }).selectOption(product)
    await page.getByRole('checkbox', { name: 'Select all visible eligibility records' }).check()
    await expect(page.getByRole('status')).toHaveText('10 selected')
    await page.getByRole('combobox', { name: 'New status', exact: true }).selectOption('CLOSED')
    await page.getByRole('button', { name: 'Change status', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Change 10 eligibility records' })
    await dialog.getByRole('button', { name: 'Change status' }).click()
    await expect(dialog.getByRole('alert')).toContainText('Enter a reason')
    await dialog.getByLabel('Reason (required)').fill('Carrier filing withdrawn after review')
    await dialog.getByRole('button', { name: 'Change status' }).click()
    await expect(dialog).toBeHidden()
    const matrix = page.getByRole('region', { name: 'Product and state eligibility' })
    await expect(matrix.getByText('Closed', { exact: true })).toHaveCount(10)
    const records = await apiJson<{ items: Array<{ status: string }> }>(request, 'GET', `/api/v1/admin/compliance/eligibility?productCode=${product}`, { token: admin.token })
    expect(records.items).toHaveLength(10)
    expect(records.items.every(row => row.status === 'CLOSED')).toBe(true)
  })

  test('policy transactions and wizard remain usable at 390px', async ({ page, request, sessionFor, signInAs }, testInfo) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, 'Phone workflow')
    await page.setViewportSize({ width: 390, height: 844 })
    await signInAs(page, 'admin')
    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.locator('.policy-versions-card .table')).toHaveClass(/table-mobile-cards/)
    await expect(page.locator('.policy-versions-card td[data-label="Transaction #"]').first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('policy-390.png'), fullPage: true })
    await page.goto('/wizard')
    await selectProduct(page)
    const steps = page.getByRole('button', { name: /Step 1 of \d+:/ })
    await expect(steps).toHaveAttribute('aria-expanded', 'false')
    await steps.click()
    await expect(steps).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.wizard-stepper-compact-list .step').first()).toBeVisible()
    await steps.click()
    await expect(page.locator('.wizard-stepper-compact-list')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('wizard-390.png'), fullPage: true })
    const submission = await apiJson<any>(request, 'POST', '/api/v1/submissions', {
      token: admin.token, expectedStatus: 201, data: {
        productCode: 'personal-auto',
        documents: [{ fileName: 'phone-application.txt', dataBase64: Buffer.from('Applicant: Synthetic phone review insured\nState: CA').toString('base64') }],
      },
    })
    await expect.poll(async () => (await apiJson<any>(request, 'GET', `/api/v1/submissions/${submission.submissionId}`, { token: admin.token })).status).toBe('READY_FOR_REVIEW')
    await page.goto('/submissions')
    await expect(page.getByRole('region', { name: 'Submission queue', exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Submission queue table' })).toBeVisible()
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      overflow: Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(element => element.offsetParent && element.getBoundingClientRect().right > window.innerWidth)
        .slice(0, 15).map(element => ({ tag: element.tagName, class: element.className, width: element.getBoundingClientRect().width })),
    }))
    expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport)
  })
})
