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
  await page.getByRole('button', { name: /^Continue to/ }).click()
  await expect(page.getByRole('main')).toContainText(/required|select.*company/i)
  await selectProduct(page, { productCode: 'homeowners', state: 'TX' })
  await continueToStep(page, 2)
  await page.getByRole('button', { name: /^Continue to/ }).click()
  await expect(page.getByRole('main')).toContainText(/required|answer/i)
})

test('endorsement retains base controls, original additive fields, and a null original screen', async ({ page, request, sessionFor, signInAs }) => {
  const auth = await sessionFor(username)
  const originals = new Map([screenPath, fieldsPath].map(p => [p, fs.existsSync(p) ? fs.readFileSync(p) : null]))
  const payload = () => ({
    ...productQuotePayload(productLine('homeowners'), { name: `${uniqueName('Pilot').replace(/[^a-zA-Z0-9]/g, '')} Holder`, effectiveDate: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) }),
    underwritingCompanyName: 'Sample Carrier Property',
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
      await page.goto(`/policies/${policy.policyId}`)
      await page.getByRole('button', { name: 'Endorse', exact: true }).click()
      await walkTransactionWizardToIssue(page, async step => {
        if (step !== 4) return
        await expect(fieldByLabel(page, 'Address')).toBeVisible()
        await expect(fieldByLabel(page, 'Year Built')).toBeVisible()
        if (withScreen) {
          await expect(page.getByText('Pilot extras', { exact: true })).toBeVisible()
          await expect(page.getByText('Changed extras', { exact: true })).toHaveCount(0)
          await page.getByLabel('Pilot note', { exact: true }).fill('Endorsed note')
        } else await expect(page.getByText('Changed extras', { exact: true })).toHaveCount(0)
        await fieldByLabel(page, 'Roof Age (years)').fill('6')
      })
      await page.getByRole('button', { name: 'Issue', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()
      const stored = await apiJson<any>(request, 'GET', `/api/v1/policies/${policy.policyId}/full`, { token: auth.token })
      expect(stored.risks[0].roofAgeYears).toBe(6)
      if (withScreen) expect(stored.risks[0].pilotNote).toBe('Endorsed note')
    }
  } finally {
    for (const [p, contents] of originals) if (contents) fs.writeFileSync(p, contents); else fs.rmSync(p, { force: true })
  }
})
