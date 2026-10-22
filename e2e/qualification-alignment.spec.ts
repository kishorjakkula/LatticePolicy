import { auditRadioControls } from './support/radio-standard'
import { expect, test } from './support/fixtures'
import { continueToStep, selectProduct } from './support/wizard'

for (const productCode of ['personal-auto', 'homeowners', 'commercial-auto', 'cyber', 'professional-liability']) {
test(`${productCode}: qualification answers align on desktop and mobile`, async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await signInAs(page, 'admin')
  await page.goto('/wizard')
  // Step 1 asks product before company (WP-0004 REQ-8); selectProduct then picks
  // a company that writes the product and fails if none is offered.
  await selectProduct(page, { productCode, state: 'TX' })
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
  // Resize can move the focused radio through scroll anchoring. Measure both
  // elements in one frame so their viewport coordinates remain comparable.
  await expect.poll(() => page.locator('.qualification-grid').evaluate(panel => {
    const withinWidth = panel.getBoundingClientRect().right <= 390
    const aligned = Array.from(panel.querySelectorAll('[role="radiogroup"]')).every(group => {
      const label = group.previousElementSibling?.getBoundingClientRect()
      const controls = group.getBoundingClientRect()
      return !!label && controls.top >= label.bottom && controls.right <= 390
    })
    return withinWidth && aligned
  })).toBe(true)
  await groups.first().getByRole('radio', { name: 'No' }).check()
  await expect(groups.first().getByRole('radio', { name: 'No' })).toBeChecked()
  await auditRadioControls(page)
  await page.screenshot({ path: `test-results/${productCode}-qualification-mobile.png`, fullPage: true })
})

}
