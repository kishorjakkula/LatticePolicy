import { expect, test } from './support/fixtures'
import { uniqueName } from './support/api'
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

    await selectProduct(page)
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

  test('changing the underwriting company asks before clearing another product\'s answers', async ({ page, signInAs }) => {
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
    const otherCompany = (await company.locator('option').allTextContents()).map((label) => label.trim()).find((label, index) => index > 0 && label !== homeownersCompany)
    expect(otherCompany, 'a second underwriting company').toBeTruthy()

    await company.selectOption({ label: otherCompany! })
    const dialog = page.getByRole('dialog', { name: `Change underwriting company to ${otherCompany}?` })
    await expect(dialog).toContainText('entered for Homeowners will be cleared')
    await dialog.getByRole('button', { name: 'Keep Homeowners' }).click()
    await expect(dialog).toBeHidden()
    await expect(fieldByLabel(page, 'Product')).toHaveValue('homeowners')
    await expect(company.locator('option:checked')).toHaveText(homeownersCompany)

    await company.selectOption({ label: otherCompany! })
    await page.getByRole('dialog').getByRole('button', { name: 'Change company' }).click()
    await expect(company.locator('option:checked')).toHaveText(otherCompany!)
    await expect(fieldByLabel(page, 'Product')).not.toHaveValue('homeowners')
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
    await expect(draftRow).toContainText('personal-auto')

    // Re-opening the draft resumes on the step where it was saved.
    await draftRow.getByRole('link', { name: quoteNumber }).click()
    await expect(page).toHaveURL(/\/wizard\?quoteId=/)
    await expect(page.getByRole('main')).toContainText(quoteNumber)
    await expectWizardStep(page, 2)
  })

  test('limits the product list to the selected underwriting company', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')

    await page.goto('/wizard')
    await fieldByLabel(page, 'Underwriting Company').selectOption({ label: 'Sample Carrier Property' })
    await fieldByLabel(page, 'Country').selectOption('US')
    await fieldByLabel(page, 'State').selectOption('TX')
    const product = fieldByLabel(page, 'Product')
    await expect(product.locator('option')).toHaveText(['Select product', 'Homeowners'])
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
