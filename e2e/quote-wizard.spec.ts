import { expect, test } from './support/fixtures'
import { apiJson, isoDate, uniqueName } from './support/api'
import {
  answerAllQualificationQuestions,
  continueToStep,
  createPrimaryInsured,
  expectWizardStep,
  fieldByLabel,
  fillVehicle,
  ratePremium,
  selectProduct,
} from './support/wizard'

function insuredName() {
  const first = uniqueName('Wiz').replace(/[^a-zA-Z0-9]/g, '')
  return { first, last: 'Tester', full: `${first} Tester` }
}

test.describe('new business quote wizard', () => {
  test('quotes, rates, binds, and issues a personal auto policy entirely in the browser', { tag: '@smoke' }, async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    const insured = insuredName()

    await page.goto('/wizard')
    await expect(page.getByRole('heading', { name: 'New Quote Wizard' })).toBeVisible()
    await expectWizardStep(page, 1)
    // WP-0004 REQ-8: billing is not asked in step 1, and one progress indicator.
    await expect(page.getByText('Billing Method')).toHaveCount(0)
    await expect(page.locator('.wizard-nav-progress-dots')).toHaveCount(0)

    await selectProduct(page)
    // The header summarises the quote instead of repeating the effective date.
    await expect(page.getByTestId('wizard-quote-summary')).toContainText(/Personal Auto · CA · Effective \d{2}\/\d{2}\/\d{4}/)
    await continueToStep(page, 2)
    await expect(page.getByRole('main')).toContainText(/Quote #\s*Q\d{8}-/)

    await answerAllQualificationQuestions(page)
    await continueToStep(page, 3)

    await createPrimaryInsured(page, insured.first, insured.last)
    await continueToStep(page, 4)

    await fillVehicle(page, insured.full)
    await continueToStep(page, 5)

    await page.getByRole('button', { name: 'Apply Default Coverages' }).click()
    await expect(page.getByRole('checkbox').first()).toBeChecked()
    await continueToStep(page, 6)

    await expect(page.getByRole('heading', { name: 'Vehicles' })).toBeVisible()
    // VIN decode can refine the model year and trim, so match make and model only.
    await expect(page.getByRole('main')).toContainText(/Vehicle 1\s*\d{4} Toyota Camry/)
    await ratePremium(page)
    await expect(page.getByRole('row').filter({ hasText: 'BI - Bodily Injury Liability' })).toBeVisible()
    // WP-0002: never another product's coverages (the homeowners set seen in the defect).
    await expect(page.getByRole('row').filter({ hasText: /\bEND_(WB|PPRC|ORD|ERC)\b|Dwelling/ })).toHaveCount(0)
    await expect(page.getByRole('status').filter({ hasText: 'Pending' })).toBeVisible()
    await expect(page.getByTestId('wizard-quote-summary')).toContainText(/Personal Auto · CA · \$[\d,]+\.\d{2}/)

    // Billing is chosen on the Premium step, before bind; it does not undo the rating.
    const payment = page.locator('.wizard-section').filter({ has: page.getByRole('heading', { name: 'Payment' }) })
    await payment.getByRole('radio', { name: /Direct bill/ }).check()
    await payment.getByLabel('Payment Plan').selectOption('monthly')
    await expect(page.getByText('Coverage Premium Allocation')).toBeVisible()

    await continueToStep(page, 8)
    await expect(page.getByRole('row').filter({ hasText: 'PA-DEC' }).first()).toBeVisible()

    await page.getByRole('button', { name: 'Bind', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Bound' })).toBeVisible()
    await expect(page.getByText('Policy is bound. Issue to lock it.')).toBeVisible()
    const policyLink = page.getByRole('link', { name: /Policy #PC-/ })
    await expect(policyLink).toBeVisible()
    const policyNumber = ((await policyLink.textContent()) || '').replace('Policy #', '').trim()

    await page.getByRole('button', { name: 'Issue', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()
    await expect(page.getByText('Policy is issued and locked.')).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Issue' }).filter({ hasText: 'PA-DEC' })).toBeVisible()

    await page.getByRole('button', { name: 'View Policy' }).click()
    await expect(page).toHaveURL(/\/policies\//)
    await expect(page.getByRole('heading', { name: `Policy ${policyNumber}` })).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()).toBeVisible()
  })

  test('compatible company choices preserve answers; only an explicit product change asks before clearing them', async ({ page, signInAs }) => {
    await signInAs(page, 'agent1')
    await page.goto('/wizard')
    await expectWizardStep(page, 1)
    await selectProduct(page, { company: 'Sample Carrier Property', state: 'TX', productCode: 'homeowners' })
    const homeownersCompany = (await fieldByLabel(page, 'Underwriting Company').locator('option:checked').textContent())?.trim() || ''
    await continueToStep(page, 2)
    await answerAllQualificationQuestions(page)
    await page.getByRole('button', { name: /Back$/ }).click()
    await expectWizardStep(page, 1)

    const company = fieldByLabel(page, 'Underwriting Company')
    await expect(company.locator('option')).toHaveText(['Select underwriting company', 'Sample Carrier Property'])
    // Incompatible personal-auto companies are unavailable, not a destructive
    // company-change path. Inspect actual saved payloads for silent data loss.
    const savePayload = async () => {
      const response = page.waitForResponse(response => response.url().includes('/api/v1/quotes/') && response.url().endsWith('/draft') && response.request().method() === 'PATCH')
      await page.getByRole('button', { name: 'Save Draft' }).click()
      const saved = await response
      expect(saved.ok()).toBeTruthy()
      return saved.request().postDataJSON().payload
    }
    const before = await savePayload()
    expect(Object.values(before.qualificationAnswers)).toContain('yes')
    await company.selectOption('')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const deselected = await savePayload()
    expect(deselected).toEqual({ ...before, underwritingCompanyId: '', underwritingCompanyName: '' })
    await company.selectOption({ label: homeownersCompany })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const reselected = await savePayload()
    expect(reselected).toEqual({ ...before, underwritingCompanyId: reselected.underwritingCompanyId })

    for (const dismiss of ['Keep', 'Escape']) {
      await fieldByLabel(page, 'Product').selectOption('personal-auto')
      const dialog = page.getByRole('dialog', { name: 'Change product to Personal Auto?' })
      await expect(dialog).toContainText('entered for Homeowners will be cleared')
      if (dismiss === 'Keep') await dialog.getByRole('button', { name: 'Keep Homeowners' }).click()
      else await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(fieldByLabel(page, 'Product')).toHaveValue('homeowners')
      await expect(fieldByLabel(page, 'State')).toHaveValue('TX')
      expect(await savePayload()).toEqual(reselected)
    }
    await expect(company.locator('option:checked')).toHaveText(homeownersCompany)
    await continueToStep(page, 2)
    for (const group of await page.getByRole('radiogroup').all()) {
      await expect(group.getByRole('radio', { name: 'Yes' })).toBeChecked()
    }
    await page.getByRole('button', { name: /Back$/ }).click()
    await fieldByLabel(page, 'Product').selectOption('personal-auto')
    await page.getByRole('dialog').getByRole('button', { name: 'Change product' }).click()
    await expect(fieldByLabel(page, 'Product')).toHaveValue('personal-auto')
    await expect(company.locator('option')).toHaveText(['Select underwriting company', 'Sample Carrier Personal Lines'])
    const changed = await savePayload()
    expect(Object.values(changed.qualificationAnswers).every(value => value === '')).toBe(true)
    for (const key of ['applicant', 'insureds', 'country', 'state', 'effectiveDate', 'termMonths', 'agencyId', 'agencyName', 'agencyCommissionPct',
      'priorPolicyNumber', 'priorCarrier', 'priorExpirationDate', 'yearsWithPriorCarrier', 'billingMethod', 'paymentPlan', 'mailingAddress', 'additionalInterests']) {
      expect(changed[key], key).toEqual(before[key])
    }
  })

  test('blocks each step until its required data is supplied', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    const insured = insuredName()

    await page.goto('/wizard')
    await selectProduct(page)
    await continueToStep(page, 2)

    // Qualification answers are mandatory.
    await page.getByRole('button', { name: /^Continue to/ }).click()
    await expect(page.getByText('Required').first()).toBeVisible()
    await expectWizardStep(page, 2)
    await answerAllQualificationQuestions(page)
    await continueToStep(page, 3)

    // A primary named insured is mandatory.
    await page.getByRole('button', { name: /^Continue to/ }).click()
    await expect(page.getByText('Primary insured first name is required')).toBeVisible()
    await expectWizardStep(page, 3)
    await createPrimaryInsured(page, insured.first, insured.last)
    await continueToStep(page, 4)

    // Vehicle details are mandatory.
    // Carrier/demo defaults can prefill these fields. Clear the exact values
    // whose validation this scenario is exercising instead of assuming blank.
    await fieldByLabel(page, 'Make').fill('')
    await fieldByLabel(page, 'VIN').fill('')
    await fieldByLabel(page, 'Garaging ZIP').fill('')
    await page.getByRole('button', { name: /^Continue to/ }).click()
    await expect(page.getByText('Make is required')).toBeVisible()
    await expect(page.getByText('VIN is required')).toBeVisible()
    await expect(page.getByText('Garaging ZIP is required')).toBeVisible()
    await expectWizardStep(page, 4)
    await fillVehicle(page, insured.full)
    await continueToStep(page, 5)
    await continueToStep(page, 6)

    // Premium must be rated before moving on.
    await page.getByRole('button', { name: /^Continue to/ }).click()
    await expect(page.getByText('Rate premium before continuing to Premium.')).toBeVisible()
    await expectWizardStep(page, 6)
  })

  test('saves a draft that can be found again from the Quotes search tab', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')

    await page.goto('/wizard')
    await selectProduct(page)
    await continueToStep(page, 2)
    await expect(page.getByRole('main')).toContainText(/Q\d{8}-\w+/)
    const quoteNumber = (await page.getByRole('main').innerText()).match(/Q\d{8}-\w+/)![0]

    await page.getByRole('button', { name: 'Save Draft' }).click()
    await expect(page).toHaveURL(/quoteId=/)

    await page.goto('/search?mode=quotes')
    await expect(page.getByRole('tab', { name: /Quotes/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('textbox', { name: 'Search' }).fill(quoteNumber)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const draftRow = page.getByRole('row').filter({ hasText: quoteNumber })
    await expect(draftRow).toContainText('Draft')
    await expect(draftRow).toContainText('Personal Auto')

    // Re-opening the draft resumes on the step where it was saved.
    await draftRow.getByRole('link', { name: quoteNumber }).click()
    await expect(page).toHaveURL(/\/wizard\?quoteId=/)
    await expect(page.getByRole('main')).toContainText(quoteNumber)
    await expectWizardStep(page, 2)
  })

  test('asks product and term first and limits the companies to those that write the product', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')

    await page.goto('/wizard')
    // WP-0004 REQ-8: product and term first, then company and agency, then prior insurance.
    const stepOne = page.locator('.wizard-section')
    await expect(stepOne.getByRole('heading')).toHaveText(['Product & term', 'Company & agency', 'Prior Insurance'])
    await expect(stepOne.first().locator('label')).toHaveText(['Country', 'State', 'Product', 'Effective Date', 'Term', 'Policy Offering'])
    await expect(fieldByLabel(page, 'Product')).toBeDisabled()

    await fieldByLabel(page, 'Country').selectOption('US')
    await fieldByLabel(page, 'State').selectOption('TX')
    await fieldByLabel(page, 'Product').selectOption('homeowners')
    const company = fieldByLabel(page, 'Underwriting Company')
    await expect(company.locator('option')).toHaveText(['Select underwriting company', 'Sample Carrier Property'])

    // A company that does not write the newly chosen product is cleared, with a notice.
    await fieldByLabel(page, 'Product').selectOption('personal-auto')
    const keepOrChange = page.getByRole('button', { name: 'Change product' })
    if (await keepOrChange.isVisible()) await keepOrChange.click()
    await expect(company.locator('option')).toHaveText(['Select underwriting company', 'Sample Carrier Personal Lines'])
    await expect(page.getByRole('status').filter({ hasText: 'Sample Carrier Property does not write Personal Auto in TX, so it was cleared.' })).toBeVisible()
  })

  test('reopens a draft saved with billing and shows it on the Premium step', async ({ page, request, sessionFor, signInAs }) => {
    const { token } = await sessionFor('admin')
    // A draft saved before WP-0004, when billing was asked in step 1; the payload fields are unchanged.
    const draft = await apiJson<any>(request, 'POST', '/api/v1/quotes/draft', {
      token,
      data: {
        progressStep: 7,
        payload: {
          productCode: 'personal-auto', country: 'US', state: 'CA', effectiveDate: isoDate(30), termMonths: 12,
          underwritingCompanyName: 'Sample Carrier Personal Lines', billingMethod: 'agency', paymentPlan: 'quarterly',
        },
      },
    })
    await signInAs(page, 'admin')
    await page.goto(`/wizard?quoteId=${draft.quoteId}`)
    await expectWizardStep(page, 7)
    const payment = page.locator('.wizard-section').filter({ has: page.getByRole('heading', { name: 'Payment' }) })
    await expect(payment.getByRole('radio', { name: 'Agency bill' })).toBeChecked()
    await expect(payment.getByLabel('Payment Plan')).toHaveValue('quarterly')

    await page.getByRole('button', { name: /Product & term/ }).click()
    await expectWizardStep(page, 1)
    await expect(page.getByText('Billing Method')).toHaveCount(0)
    await expect(fieldByLabel(page, 'Product')).toHaveValue('personal-auto')
    await expect(fieldByLabel(page, 'Underwriting Company')).toHaveValue('Sample Carrier Personal Lines')
  })

  // Regression: the Insureds step used the admin customer API, which the agent
  // role cannot call, so producers were stuck on step 3.
  test('agent creates a new insured, finds an existing one, and binds the quote', async ({ page, signInAs }) => {
    await signInAs(page, 'agent1')
    const insured = insuredName()

    await page.goto('/wizard')
    await selectProduct(page)
    await continueToStep(page, 2)
    await answerAllQualificationQuestions(page)
    await continueToStep(page, 3)
    await createPrimaryInsured(page, insured.first, insured.last)
    await continueToStep(page, 4)
    await fillVehicle(page, insured.full)
    await continueToStep(page, 5)
    await page.getByRole('button', { name: 'Apply Default Coverages' }).click()
    await continueToStep(page, 6)
    await ratePremium(page)
    await continueToStep(page, 8)
    await page.getByRole('button', { name: 'Bind', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Bound' })).toBeVisible()

    // A second quote can pick the same customer from search results.
    await page.goto('/wizard')
    await selectProduct(page)
    await continueToStep(page, 2)
    await answerAllQualificationQuestions(page)
    await continueToStep(page, 3)
    await page.getByPlaceholder('Search customer by name, email, or phone...').first().fill(insured.first)
    await expect(page.getByText('Select from results:')).toBeVisible()
    await page.getByText(insured.full, { exact: true }).first().click()
    await expect(page.getByRole('row').filter({ hasText: insured.full }).first()).toBeVisible()
    await continueToStep(page, 4)
  })

  test('a failed customer search is reported as a failure, not as "no matching customers"', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.route('**/api/v1/customers/search**', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'DB_ERROR', message: 'lookup unavailable' }) }))

    await page.goto('/wizard')
    await selectProduct(page)
    await continueToStep(page, 2)
    await answerAllQualificationQuestions(page)
    await continueToStep(page, 3)
    await page.getByPlaceholder('Search customer by name, email, or phone...').first().fill('Anyone')
    await expect(page.getByRole('alert').filter({ hasText: 'Customer search failed' })).toBeVisible()
    await expect(page.getByText('No matching customers found.')).toHaveCount(0)
  })
})
