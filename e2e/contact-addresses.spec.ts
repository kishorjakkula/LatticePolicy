import { test, expect } from './support/fixtures'
import type { Page, TestInfo } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { apiJson, createCustomer, uniqueName } from './support/api'
import { selectProduct, continueToStep, answerAllQualificationQuestions, createPrimaryInsured, fillVehicle } from './support/wizard'

test('customer keeps multiple postal addresses and separate communication through save/reopen', async ({ page, request, signInAs }, testInfo) => {
  const session = await signInAs(page, 'admin')
  const customer = await createCustomer(request, session.token, `Address ${uniqueName('contact')}`)
  await page.goto(`/admin/customers/edit/${customer.customerId}`)
  await page.getByRole('button', { name: 'Contact & Address', exact: true }).click()
  const editor = page.locator('.contact-addresses')
  await editor.getByRole('button', { name: 'Add Address', exact: true }).click()
  await editor.getByLabel('Address line 1', { exact: true }).fill('20 Synthetic Street')
  await editor.getByLabel('Apartment, suite or unit').fill('APT 4B')
  await editor.getByLabel('City', { exact: true }).fill('Boston')
  await editor.getByRole('combobox', { name: 'State', exact: true }).selectOption('MA')
  await editor.getByLabel('ZIP Code').fill('02108-1234')
  await editor.getByRole('button', { name: 'Set address 2 primary' }).click()
  const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes(`/admin/customers/${customer.customerId}`))
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  const response = await saved
  expect(response.status(), await response.text()).toBeLessThan(300)
  const result = await apiJson<any>(request, 'GET', `/api/v1/admin/customers/${customer.customerId}`, { token: session.token })
  expect(result.addresses).toHaveLength(2)
  expect(result.addresses).toContainEqual(expect.objectContaining({ line2: 'APT 4B', postalCode: '02108-1234', primary: true }))
  expect(result.contactPoints).toEqual(customer.contactPoints)
  for (const address of result.addresses) { expect(address).not.toHaveProperty('email'); expect(address).not.toHaveProperty('phone') }
  await page.reload()
  await page.getByRole('button', { name: 'Contact & Address', exact: true }).click()
  await expect(editor.getByText(/20 Synthetic Street, APT 4B/)).toBeVisible()
  await verifyPostalLayout(page, '.contact-addresses', testInfo, 'contact')
})

test('quote contacts have collections while vehicle garaging remains a single address', async ({ page, signInAs }, testInfo) => {
  await signInAs(page, 'admin')
  await page.goto('/wizard')
  await selectProduct(page)
  await continueToStep(page, 2)
  await answerAllQualificationQuestions(page)
  await continueToStep(page, 3)
  const first = uniqueName('Address').replace(/[^a-zA-Z]/g, '')
  await createPrimaryInsured(page, first, 'Example')
  await expect(page.getByRole('textbox', { name: 'Mobile number', exact: true }).first()).toBeVisible()
  await page.locator('.contact-addresses').first().getByRole('button', { name: 'Add Address', exact: true }).click()
  await expect(page.locator('.contact-addresses').first().getByLabel('Apartment, suite or unit')).toBeVisible()
  await continueToStep(page, 4)
  await expect(page.locator('.auto-risk-vehicle-section .postal-editor').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add Address', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'ZIP Code', exact: true })).toHaveCount(1)
  await fillVehicle(page, `${first} Example`)
  await page.getByRole('textbox', { name: 'ZIP Code', exact: true }).fill('94105-1234')
  const saved = page.waitForRequest(r => r.method() === 'PATCH' && /\/quotes\/[^/]+\/draft/.test(r.url()))
  await page.getByRole('button', { name: 'Save Draft', exact: true }).click()
  const payload = (await saved).postDataJSON().payload
  expect(payload.risks[0].garagingZip).toBe('94105')
  expect(payload.risks[0].garagingAddress.postalCode).toBe('94105-1234')
  await expect(page.getByRole('textbox', { name: 'ZIP Code', exact: true })).toHaveValue('94105-1234')
  await verifyPostalLayout(page, '.auto-risk-vehicle-section .postal-editor', testInfo, 'garaging')
})

test('address suggestions are reviewed explicitly and remain readable in both themes', async ({ page, request, signInAs }, testInfo) => {
  const session = await signInAs(page, 'admin')
  const customer = await createCustomer(request, session.token, `Match ${uniqueName('contact')}`)
  let checks = 0
  let writes = 0
  await page.route('**/api/v1/addresses/capabilities', route => route.fulfill({ json: { enabled: true } }))
  await page.route('**/api/v1/addresses/check', route => {
    const body = route.request().postDataJSON()
    expect(Object.keys(body)).toEqual(['address'])
    expect(body.address).not.toHaveProperty('email')
    expect(body.address).not.toHaveProperty('phone')
    checks++
    return route.fulfill({ json: { outcome: 'matched', candidates: [{ address: { ...body.address, line1: body.address.line1.toUpperCase() }, precision: 'address_range' }] } })
  })
  page.on('request', r => { if (r.method() === 'PATCH' && r.url().includes(`/admin/customers/${customer.customerId}`)) writes++ })
  await page.goto(`/admin/customers/edit/${customer.customerId}`)
  await page.getByRole('button', { name: 'Contact & Address', exact: true }).click()
  const editor = page.locator('.contact-addresses')
  const line = editor.getByLabel('Address line 1', { exact: true })
  const original = await line.inputValue()
  const check = editor.getByRole('button', { name: 'Check Address', exact: true })
  await expect(check).toBeDisabled()
  await editor.getByText(/I agree to send/).click()
  await check.click()
  await expect(editor.getByRole('button', { name: 'Use suggested address' })).toBeVisible()
  await expect(line).toHaveValue(original)
  await verifyPostalLayout(page, '.contact-addresses', testInfo, 'suggestion')
  await editor.getByRole('button', { name: 'Keep entered address' }).click()
  await expect(line).toHaveValue(original)
  await editor.getByText(/I agree to send/).click()
  await check.click()
  await editor.getByRole('button', { name: 'Use suggested address' }).click()
  await expect(line).toHaveValue(original.toUpperCase())
  expect(checks).toBe(2)
  expect(writes).toBe(0)
})

async function verifyPostalLayout(page: Page, selector: string, testInfo: TestInfo, name: string) {
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const collection = page.locator(`${selector} .postal-table`)
      if (await collection.count()) {
        expect(await collection.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
        await collection.locator('tbody tr').last().hover()
      }
      const audit = await new AxeBuilder({ page }).include(selector).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([])
      await page.locator(selector).first().screenshot({ path: testInfo.outputPath(`${name}-${theme}-${width}.png`) })
    }
  }
}
