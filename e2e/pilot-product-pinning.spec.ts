import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from './support/fixtures'
import { apiJson, uniqueName } from './support/api'
import { productLine, productQuotePayload } from './support/products'
import { fieldByLabel, walkTransactionWizardToIssue, selectProduct, continueToStep } from './support/wizard'

const pack = process.env.PILOT_PACK_PATH!
const username = process.env.PILOT_USERNAME!
const screenPath = path.join(pack, 'screens/homeowners.yaml')
const fieldsPath = path.join(pack, 'fields/homeowners.json')
const screen = 'product: homeowners\nrisk:\n  sections:\n    - title: Pilot extras\n      fields: [pilotNote]\n'

test('mandatory fields appear on button click in the pilot wizard', async ({ page, signInAs }) => {
  await signInAs(page, username)
  await page.goto('/wizard')
  await fieldByLabel(page, 'Effective Date').fill('')
  await page.getByRole('button', { name: /^Continue to/ }).click()
  await expect(page.getByRole('main')).toContainText(/required|select.*company/i)
  await fieldByLabel(page, 'Effective Date').fill(new Date().toISOString().slice(0, 10))
  await selectProduct(page, { company: 'Sample Carrier Property', productCode: 'homeowners', state: 'TX' })
  await continueToStep(page, 2)
  await page.getByRole('button', { name: /^Continue to/ }).click()
  await expect(page.getByRole('main')).toContainText(/required|answer/i)
})

test('admin activation restricts pilot company and product dropdowns to Homeowners', async ({ page, request, sessionFor, signInAs }) => {
  const { token } = await sessionFor(username)
  const all = await apiJson<any[]>(request, 'GET', '/api/v1/admin/underwriting-companies?includeInactive=true', { token })
  expect(all.some(c => c.productCode !== 'homeowners')).toBe(true)
  expect(all.filter(c => c.active).every(c => c.productCode === 'homeowners')).toBe(true)
  const { items } = await apiJson<any>(request, 'GET', '/api/v1/underwriting-companies', { token })
  expect(items.length).toBeGreaterThan(0)
  expect(items.every((c: any) => c.productCode === 'homeowners')).toBe(true)
  await signInAs(page, username)
  await page.goto('/wizard')
  const company = fieldByLabel(page, 'Underwriting Company')
  await expect(company.locator('option')).toHaveCount(new Set(items.map((c: any) => c.name)).size + 1)
  await company.selectOption({ label: items[0].name })
  await expect(fieldByLabel(page, 'Product').locator('option[value="homeowners"]')).toHaveCount(1)
  expect(await fieldByLabel(page, 'Product').locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value).filter(Boolean))).toEqual(['homeowners'])
})

test('the accepted pilot policy opens every listed document', async ({ page, context, request, sessionFor, signInAs }) => {
  const acceptance = JSON.parse(fs.readFileSync(path.join(pack, '../evidence/acceptance.json'), 'utf8'))
  const auth = await sessionFor(username)
  const { documents } = await apiJson<any>(request, 'GET', `/api/v1/policies/${acceptance.policyId}/documents`, { token: auth.token })
  expect(new Set(documents.map((d: any) => d.displayName)).size).toBe(documents.length)
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    ;(window as any).__pilotOpened = []
    URL.createObjectURL = blob => { if (blob instanceof Blob) (window as any).__pilotOpened.push(blob); return original(blob) }
  })
  await signInAs(page, username)
  await page.goto(`/policies/${acceptance.policyId}`)
  for (const [i, doc] of documents.entries()) {
    const popup = context.waitForEvent('page')
    const response = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith(`/documents/${doc.documentId}/content`))
    await page.getByRole('row').filter({ hasText: doc.displayName }).getByRole('button', { name: 'Open', exact: true }).click()
    const tab = await popup
    expect((await response).status()).toBe(200)
    await expect.poll(() => page.evaluate(index => (window as any).__pilotOpened[index]?.size || 0, i)).toBeGreaterThan(100)
    const text = await page.evaluate(async index => ((window as any).__pilotOpened[index] as Blob).text(), i)
    if (doc.type === 'RATING_WORKSHEET') expect(text).toContain('Rating worksheet')
    else expect(text.slice(0, 5)).toBe('%PDF-')
    await tab.close()
  }
})

test('endorsement retains base controls, original additive fields, and a null original screen', async ({ page, request, sessionFor, signInAs }, testInfo) => {
  const auth = await sessionFor(username)
  const originals = new Map([screenPath, fieldsPath].map(p => [p, fs.existsSync(p) ? fs.readFileSync(p) : null]))
  const payload = () => ({
    ...productQuotePayload(productLine('homeowners'), { name: `${uniqueName('Pilot').replace(/[^a-zA-Z0-9]/g, '')} Holder`, effectiveDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) }),
    underwritingCompanyName: 'Sample Carrier Property',
    qualificationAnswers: Object.fromEntries(['noPropertyClaims5Years', 'roofMaintained', 'noBusinessOnPremises', 'noVacancyOver30Days', 'protectiveDevicesInstalled'].map(k => [k, 'yes'])),
    uwAnswers: Object.fromEntries(['noPropertyClaims5Years', 'roofMaintained', 'noBusinessOnPremises', 'noVacancyOver30Days', 'protectiveDevicesInstalled'].map(k => [k, true])),
    coverages: [{ code: 'A', selected: true, limit: 300000, deductible: 1000 }],
  })
  const issue = async (note?: string) => {
    const data = payload()
    if (note) Object.assign(data.risks[0], { pilotNote: note })
    const quote = await apiJson<any>(request, 'POST', '/api/v1/quotes', { token: auth.token, data })
    const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: auth.token, data: {} })
    await apiJson(request, 'POST', `/api/v1/policies/${bound.policyId}/issue`, { token: auth.token, data: {} })
    return bound
  }
  try {
    fs.rmSync(screenPath, { force: true }); fs.rmSync(fieldsPath, { force: true })
    const absent = await issue()
    fs.writeFileSync(fieldsPath, JSON.stringify([{ path: 'risks.0.pilotNote', label: 'Pilot note', type: 'string', required: true }]))
    fs.writeFileSync(screenPath, screen)
    const additive = await issue('Original note')
    fs.writeFileSync(fieldsPath, JSON.stringify([{ path: 'risks.0.pilotNote', label: 'Changed note', type: 'string', required: true }]))
    fs.writeFileSync(screenPath, screen.replace('Pilot extras', 'Changed extras'))
    await signInAs(page, username)
    for (const [policy, withScreen] of [[additive, true], [absent, false]] as const) {
      const newBusinessRequests: string[] = []
      const observe = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && request.url().endsWith('/api/v1/quotes')) newBusinessRequests.push(request.url())
      }
      page.on('request', observe)
      await page.goto(`/policies/${policy.policyId}`)
      await page.getByRole('button', { name: 'Endorse', exact: true }).click()
      await walkTransactionWizardToIssue(page, async step => {
        if (step !== 4) return
        await expect(fieldByLabel(page, 'Address')).toBeVisible()
        await expect(fieldByLabel(page, 'Year Built')).toBeVisible()
        if (withScreen) {
          await expect(page.getByText('Pilot extras', { exact: true })).toBeVisible()
          await expect(page.getByText('Changed extras', { exact: true })).toHaveCount(0)
          await page.getByRole('textbox', { name: /^Pilot note/ }).fill('Endorsed note')
        } else await expect(page.getByText('Changed extras', { exact: true })).toHaveCount(0)
        await fieldByLabel(page, 'Roof Age (years)').fill('6')
      })
      // Exercise the browser-generated PDF as well as stored server artifacts.
      await page.evaluate(() => {
        const original = URL.createObjectURL.bind(URL)
        URL.createObjectURL = blob => { (window as any).__carrierPdf = blob; return original(blob) }
      })
      await page.getByRole('button', { name: 'Documents', exact: true }).click()
      const popup = page.context().waitForEvent('page')
      await page.getByRole('row').filter({ hasText: /Rating Worksheet/ }).getByRole('button', { name: 'View', exact: true }).click()
      const pdfTab = await popup
      const bytes = Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await (window as any).__carrierPdf.arrayBuffer()))))
      await assertCarrierPdf(bytes, 'Acme Mutual Pilot')
      await testInfo.attach('Carrier branded browser worksheet', { body: bytes, contentType: 'application/pdf' })
      await pdfTab.close()
      await page.getByRole('button', { name: 'Issue', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()
      const stored = await apiJson<any>(request, 'GET', `/api/v1/policies/${policy.policyId}/full`, { token: auth.token })
      expect(stored.risks[0].roofAgeYears).toBe(6)
      if (withScreen) expect(stored.risks[0].pilotNote).toBe('Endorsed note')
      expect(newBusinessRequests).toEqual([])
      page.off('request', observe)
    }
  } finally {
    for (const [p, contents] of originals) if (contents) fs.writeFileSync(p, contents); else fs.rmSync(p, { force: true })
  }
})

test('pilot branding is editable in administration and appears on login and documents', async ({ page, request, sessionFor, signInAs }, testInfo) => {
  const { token } = await sessionFor(username)
  const settings = await apiJson<any>(request, 'GET', '/api/v1/admin/branding', { token })
  expect(settings.configured).toBe(true)
  expect(settings.branding.name).toBe('Acme Mutual Pilot')
  await signInAs(page, username)
  await page.goto('/admin/tenant')
  await expect(page.getByLabel('Carrier display name')).toHaveValue(settings.branding.name)
  await page.getByLabel(/Carrier logo \(/).setInputFiles('deploy/pilot/acme-mutual-logo.png')
  await page.getByRole('button', { name: 'Save carrier branding', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Carrier branding saved.')
  await expect(page.locator('img.topbar-logo')).toHaveAttribute('alt', settings.branding.name)
  expect(await page.locator('img.topbar-logo').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const adminShot = testInfo.outputPath('pilot-carrier-branding-admin.png')
  await page.screenshot({ path: adminShot, fullPage: true, animations: 'disabled' })
  await testInfo.attach('Carrier branding administration', { path: adminShot, contentType: 'image/png' })
  const acceptance = JSON.parse(fs.readFileSync(path.join(pack, '../evidence/acceptance.json'), 'utf8'))
  const { documents } = await apiJson<any>(request, 'GET', `/api/v1/policies/${acceptance.policyId}/documents`, { token })
  for (const doc of documents) {
    const response = await request.get(`${process.env.E2E_API_BASE_URL}/api/v1/policies/${acceptance.policyId}/documents/${doc.documentId}/content`, { headers: { 'X-Tenant': process.env.E2E_TENANT_ID!, Authorization: `Bearer ${token}` } })
    expect(response.ok()).toBe(true)
    const bytes = await response.body()
    if (doc.type === 'RATING_WORKSHEET') {
      expect(bytes.toString()).toContain(settings.branding.name)
      expect(bytes.toString()).not.toMatch(/Lattice\s*Policy/i)
    } else if (doc.type === 'POLICY_PACKET') {
      await assertCarrierPdf(bytes, settings.branding.name)
    }
  }
  await page.context().clearCookies()
  await page.evaluate(() => localStorage.clear())
  await page.goto('/login')
  await expect(page.locator('img.login-brand-logo')).toHaveAttribute('alt', settings.branding.name)
  const loginShot = testInfo.outputPath('pilot-carrier-branding-login.png')
  await page.screenshot({ path: loginShot, fullPage: true, animations: 'disabled' })
  await testInfo.attach('Carrier branded login', { path: loginShot, contentType: 'image/png' })
})

async function assertCarrierPdf(bytes: Buffer, name: string) {
  // Parse downloaded bytes, rather than trusting branding metadata.
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  try {
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent()
      text += content.items.map((item: any) => item.str || '').join(' ')
    }
    expect(text).toContain(name)
    expect(text).not.toMatch(/Lattice\s*Policy/i)
    const operators = await (await pdf.getPage(1)).getOperatorList()
    expect(operators.fnArray).toContain(OPS.paintImageXObject)
  } finally { await pdf.destroy() }
}
