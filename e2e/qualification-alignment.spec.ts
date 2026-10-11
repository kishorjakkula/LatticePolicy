import { auditRadioControls } from './support/radio-standard'
import { expect, test } from './support/fixtures'
import { continueToStep, fieldByLabel, selectProduct } from './support/wizard'

for (const productCode of ['personal-auto', 'homeowners', 'commercial-auto', 'cyber', 'professional-liability']) {
test(`${productCode}: qualification answers align on desktop and mobile`, async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signInAs(page, 'admin')
  await page.goto('/wizard')
  const companySelect = fieldByLabel(page, 'Underwriting Company')
  await expect(companySelect).toBeEnabled()
  let company = ''
  for (const label of (await companySelect.locator('option').allTextContents()).slice(1)) {
    await companySelect.selectOption({ label: label.trim() })
    if (await fieldByLabel(page, 'Product').locator(`option[value="${productCode}"]`).count()) {
      company = label.trim()
      break
    }
  }
  expect(company).not.toBe('')
  await selectProduct(page, { company, productCode, state: 'TX' })
  await continueToStep(page, 2)
  const groups = page.getByRole('radiogroup')
  await expect(groups.first()).toBeVisible()
  await auditRadioControls(page)
  for (const answer of ['Yes', 'No']) {
    const boxes = await Promise.all((await groups.all()).map((group) => group.getByRole('radio', { name: answer }).boundingBox()))
    expect(boxes.every(Boolean)).toBe(true)
    const xs = boxes.map((box) => box!.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1)
  }
  await groups.first().getByRole('radio', { name: 'Yes' }).check()
  await expect(groups.first().getByRole('radio', { name: 'Yes' })).toBeChecked()
  await page.screenshot({ path: `test-results/${productCode}-qualification-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const questionPanel = await page.locator('.qualification-grid').boundingBox()
  expect(questionPanel!.x + questionPanel!.width).toBeLessThanOrEqual(390)
  for (const group of await groups.all()) {
    const label = await group.locator('xpath=preceding-sibling::*[1]').boundingBox()
    const controls = await group.boundingBox()
    expect(controls!.y).toBeGreaterThanOrEqual(label!.y + label!.height)
    expect(controls!.x + controls!.width).toBeLessThanOrEqual(390)
  }
  await groups.first().getByRole('radio', { name: 'No' }).check()
  await expect(groups.first().getByRole('radio', { name: 'No' })).toBeChecked()
  await auditRadioControls(page)
  await page.screenshot({ path: `test-results/${productCode}-qualification-mobile.png`, fullPage: true })
})

}
