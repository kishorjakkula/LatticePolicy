import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Wizard and several admin forms render `<label>Text</label><control>` without
 * a `for`/`id` association, so `getByLabel` cannot resolve them. This finds the
 * control that immediately follows the label.
 */
export function fieldByLabel(scope: Page | Locator, label: string): Locator {
  return scope
    .locator(`label:text-is("${label}")`)
    .locator('xpath=following-sibling::*[self::select or self::input or self::textarea][1]')
    .first()
}

export async function expectWizardStep(page: Page, step: number) {
  // The label and the counter are separate elements, so match on the container.
  await expect(page.getByRole('main')).toContainText(new RegExp(`Workflow\\s*${step} of 8`))
}

/** Clicks the step's Continue button and waits for the workflow counter to move. */
export async function continueToStep(page: Page, step: number) {
  await page.getByRole('button', { name: /^Continue to/ }).click()
  await expectWizardStep(page, step)
}

const seededCompany = process.env.E2E_UW_COMPANY || 'Sample Carrier Personal Lines'

/**
 * Picks the underwriting company, jurisdiction, and product. A freshly seeded
 * stack has the seeded company; a long-lived environment (local demo stack, a
 * deployed test environment) has its own, so when the seeded one is missing
 * fall back to the first company that writes the requested product.
 */
export async function selectProduct(
  page: Page,
  options: { company?: string; state?: string; productCode?: string } = {},
) {
  const productCode = options.productCode ?? 'personal-auto'
  const companySelect = fieldByLabel(page, 'Underwriting Company')
  const productSelect = fieldByLabel(page, 'Product')
  await expect(companySelect).toBeEnabled()
  const labels = (await companySelect.locator('option').allTextContents()).map((label) => label.trim())
  const wanted = options.company ?? seededCompany

  if (options.company || labels.includes(wanted)) {
    await companySelect.selectOption({ label: wanted })
  } else {
    let matched = false
    for (const label of labels.slice(1)) {
      await companySelect.selectOption({ label })
      if (await productSelect.locator(`option[value="${productCode}"]`).count()) {
        matched = true
        break
      }
    }
    expect(matched, `an underwriting company that writes ${productCode}`).toBe(true)
  }
  await fieldByLabel(page, 'Country').selectOption('US')
  await fieldByLabel(page, 'State').selectOption(options.state ?? 'CA')
  await productSelect.selectOption(productCode)
}

export async function answerAllQualificationQuestions(page: Page, answer: 'Yes' | 'No' = 'Yes') {
  const groups = page.getByRole('radiogroup')
  await expect(groups.first()).toBeVisible()
  for (const group of await groups.all()) {
    await group.getByRole('radio', { name: answer }).check()
  }
}

/** Uses the "no match -> Create New Customer" path on the Insureds step. */
export async function createPrimaryInsured(page: Page, firstName: string, lastName: string) {
  await page.getByPlaceholder('Search customer by name, email, or phone...').first().fill(`${firstName} ${lastName}`)
  await page.getByRole('button', { name: '+ Create New Customer' }).click()
  await fieldByLabel(page, 'Date of Birth').fill('1985-05-15')
  await fieldByLabel(page, 'Email').fill(`${firstName.toLowerCase()}@example.com`)
  await page.getByRole('button', { name: 'Create & Select' }).click()
  await expect(page.getByRole('row').filter({ hasText: `${firstName} ${lastName}` }).first()).toBeVisible()
}

export async function fillVehicle(page: Page, principalDriver: string) {
  await fieldByLabel(page, 'Make').fill('Toyota')
  await fieldByLabel(page, 'Model').fill('Camry')
  await fieldByLabel(page, 'Body Style').selectOption('sedan')
  await fieldByLabel(page, 'VIN').fill(`1HGCM82633A${String(Date.now()).slice(-6)}`)
  await fieldByLabel(page, 'Garaging ZIP').fill('94105')
  await fieldByLabel(page, 'Registration State').fill('CA')
  await fieldByLabel(page, 'Usage').selectOption('pleasure')
  await fieldByLabel(page, 'Driver Age').fill('35')
  await fieldByLabel(page, 'Principal Driver').fill(principalDriver)
  await fieldByLabel(page, 'Ownership').selectOption('owned')
}

/** On the Rating step: rate, then wait for the premium total to render. */
export async function ratePremium(page: Page) {
  await Promise.all([
    page.waitForResponse((response) => response.url().includes('/api/v1/') && response.request().method() !== 'GET' && response.ok()),
    page.getByRole('button', { name: 'Rate Premium' }).click(),
  ])
  await expect(page.getByText('Coverage Premium Allocation')).toBeVisible()
}

/**
 * Endorsement / Cancellation / Renewal wizards reuse the 8-step quote wizard
 * with the policy data pre-filled. Walk it to the final step, re-rate, and
 * leave the caller on "Forms & Documents" with the Issue button available.
 */
export async function walkTransactionWizardToIssue(page: Page, beforeContinue?: (step: number) => Promise<void>) {
  for (let step = 1; step <= 5; step += 1) {
    await expectWizardStep(page, step)
    if (beforeContinue) await beforeContinue(step)
    await continueToStep(page, step + 1)
  }
  await ratePremium(page)
  await continueToStep(page, 8)
  await expect(page.getByRole('button', { name: 'Issue', exact: true })).toBeVisible()
}
