import { expect, test } from './support/fixtures'
import { apiJson, uniqueName } from './support/api'
import {
  answerAllQualificationQuestions,
  continueToStep,
  createPrimaryInsured,
  expectWizardStep,
  fillVehicle,
  ratePremium,
  selectProduct,
} from './support/wizard'

// Carrier validation rules in the real wizard: a screen-level error stops the
// Coverages screen until it is fixed, and warnings at bind and issue need an
// acknowledgement that is recorded. Rules are tenant-wide, so each one only
// applies to this test's uniquely named insured.

test.describe('validation rules in the quote wizard', () => {
  test('screen errors block Continue, and bind and issue warnings need an acknowledgement', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const first = uniqueName('Valrule').replace(/[^a-zA-Z0-9]/g, '')
    const marker = `startsWith(applicant.firstName, '${first}')`
    const suffix = first.slice(-8).toUpperCase()
    const base = {
      kind: 'condition',
      condition: 'false',
      appliesWhen: marker,
      transactionTypes: ['common'],
      productCode: 'personal-auto',
      active: true,
    }
    const created: string[] = []
    const createRule = async (rule: Record<string, unknown>) => {
      const saved = await apiJson<any>(request, 'POST', '/api/v1/admin/validation-rules', { token: admin.token, data: { ...base, ...rule }, expectedStatus: 201 })
      created.push(saved.ruleId)
      return saved
    }

    try {
      await createRule({
        ruleCode: `E2E_BI_${suffix}`,
        name: 'Bodily injury required',
        condition: 'coverages.BI.selected == true',
        levels: ['screen'],
        screen: 'coverages',
        transactionTypes: ['new_business'],
        severity: 'error',
        message: 'Bodily injury coverage is required',
      })
      await createRule({ ruleCode: `E2E_BIND_${suffix}`, name: 'Driver list', levels: ['bind'], severity: 'warning', message: 'Confirm the driver list with the insured' })
      await createRule({ ruleCode: `E2E_ISSUE_${suffix}`, name: 'Documents', levels: ['issue'], severity: 'warning', message: 'Confirm signed documents are on file' })

      await signInAs(page, 'admin')
      await page.goto('/wizard')
      await expectWizardStep(page, 1)
      await selectProduct(page)
      await continueToStep(page, 2)
      await answerAllQualificationQuestions(page)
      await continueToStep(page, 3)
      await createPrimaryInsured(page, first, 'Tester')
      await continueToStep(page, 4)
      await fillVehicle(page, `${first} Tester`)
      await continueToStep(page, 5)

      // Screen level: the error is shown and Continue does not move on until it is fixed.
      await page.getByRole('button', { name: /^Continue to/ }).click()
      const checks = page.getByRole('region', { name: 'Checks for this screen' })
      await expect(checks.getByRole('alert')).toContainText('Bodily injury coverage is required')
      await expectWizardStep(page, 5)
      await page.getByRole('button', { name: 'Apply Default Coverages' }).click()
      await expect(checks).toHaveCount(0)
      await continueToStep(page, 6)

      await ratePremium(page)
      await continueToStep(page, 8)
      const quoteId = new URL(page.url()).searchParams.get('quoteId')
      expect(quoteId).toBeTruthy()

      // Bind level: a warning needs an acknowledgement.
      await page.getByRole('button', { name: 'Bind', exact: true }).click()
      const bindDialog = page.getByRole('dialog', { name: 'Review warnings before you bind' })
      await expect(bindDialog).toContainText('Confirm the driver list with the insured')
      const acknowledgeBind = bindDialog.getByRole('button', { name: 'Acknowledge and bind' })
      await expect(acknowledgeBind).toBeDisabled()
      await bindDialog.getByLabel(/I reviewed these warnings/).check()
      await acknowledgeBind.click()
      await expect(page.getByRole('status').filter({ hasText: 'Bound' })).toBeVisible()

      // Issue level: the Common warning applies to new business too.
      await page.getByRole('button', { name: 'Issue', exact: true }).click()
      const issueDialog = page.getByRole('dialog', { name: 'Review warnings before you issue' })
      await expect(issueDialog).toContainText('Confirm signed documents are on file')
      await issueDialog.getByLabel(/I reviewed these warnings/).check()
      await issueDialog.getByRole('button', { name: 'Acknowledge and issue' }).click()
      await expect(page.getByText('Policy is issued and locked.')).toBeVisible()

      const quoteAcks = await apiJson<any>(request, 'GET', '/api/v1/validation-acknowledgements', {
        token: admin.token,
        query: { entityType: 'quote', entityId: quoteId! },
      })
      expect(quoteAcks.items).toEqual([expect.objectContaining({ level: 'bind', ruleCode: `E2E_BIND_${suffix}`, acknowledgedBy: 'admin' })])
    } finally {
      for (const ruleId of created) await apiJson(request, 'DELETE', `/api/v1/admin/validation-rules/${ruleId}`, { token: admin.token })
    }
  })

  test('administrators see coverage for every transaction level and edit rules', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const code = `E2E_ADMIN_${uniqueName('r').replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`
    let ruleId = ''
    try {
      await signInAs(page, 'admin')
      await page.goto('/admin/validation-rules')
      await expect(page.getByRole('heading', { name: 'Validation Rules' })).toBeVisible()
      await page.getByRole('button', { name: 'New Rule' }).click()
      await page.getByLabel('Rule code', { exact: true }).fill(code)
      await page.getByLabel('Name', { exact: true }).fill('Cancellation reason')
      await page.getByLabel('Field path', { exact: true }).fill('transaction.reasonCode')
      // The shared Checkbox draws its box over the native input; toggle the input itself.
      const setBox = async (name: string, checked: boolean) => {
        const box = page.getByRole('checkbox', { name, exact: true })
        await box.evaluate((element) => element.scrollIntoView({ block: 'center' }))
        await box.setChecked(checked, { force: true })
        await expect(box).toBeChecked({ checked })
      }
      await setBox('Screen', false)
      await setBox('Rate / preview', false)
      await setBox('Bind', false)
      await setBox('Issue / process', true)
      await setBox('New business', false)
      await setBox('Cancellation', true)
      await page.getByLabel('Product', { exact: true }).selectOption('personal-auto')
      await page.getByLabel('State', { exact: true }).fill('WY')
      await page.getByLabel('Message', { exact: true }).fill('A cancellation reason is required')
      const [response] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/admin/validation-rules') && r.request().method() === 'POST'),
        page.getByRole('button', { name: 'Create Rule' }).click(),
      ])
      expect(response.status()).toBe(201)
      ruleId = (await response.json()).ruleId
      const row = page.getByRole('row').filter({ hasText: code })
      await expect(row).toContainText('Cancellation')
      await expect(row).toContainText('WY')
      await expect(page.getByRole('button', { name: /^Cancellation, Issue \/ process: [1-9]\d* rules$/ })).toBeVisible()

      await row.getByRole('button', { name: 'History' }).click()
      await expect(page.getByRole('heading', { name: `History: ${code}` })).toBeVisible()
    } finally {
      if (ruleId) await apiJson(request, 'DELETE', `/api/v1/admin/validation-rules/${ruleId}`, { token: admin.token })
    }
  })
})
