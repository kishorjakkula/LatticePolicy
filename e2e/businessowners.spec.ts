import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { test, expect } from './support/fixtures'

const config = parse(readFileSync(path.resolve(__dirname, '../products/businessowners/coverage.yaml'), 'utf8'))
const risk = {
  type: 'businessownersLocation', businessName: 'Synthetic BOP Office LLC', businessClass: 'office',
  annualRevenue: 750000, annualPayroll: 200000, employeeCount: 5, yearsInBusiness: 6,
  priorLossCount: 0, priorLossAmount: 0, occupancy: 'tenant', buildingInterest: false,
  locationAddress: { line1: '10 Synthetic Way', line2: 'Suite 4', city: 'Columbus', state: 'OH', postalCode: '43215-1234', country: 'US' },
  yearBuilt: 2015, squareFeet: 2500, construction: 'masonry', protectionClass: 3,
  roofAgeYears: 5, sprinklers: true, fireAlarm: true, burglarAlarm: true, vacancyDays: 0, hazardousOperations: false
}
const requiredCoverages = config.coverages.filter((coverage: any) => coverage.required).map((coverage: any) => ({
  code: coverage.code, selected: true, limit: coverage.defaultLimit ?? coverage.limits?.[0],
  ...(coverage.defaultDeductible != null ? { deductible: coverage.defaultDeductible } : {})
}))
const fields = config.fields.filter((field: any) => field.type !== 'object').map((field: any) => ({
  key: field.path.split('.').pop(), path: field.path, label: field.label, required: field.required,
  type: field.type === 'enum' || field.type === 'bool' ? 'select' : ['int', 'number'].includes(field.type) ? 'number' : 'text',
  options: field.type === 'bool' ? ['true', 'false'] : field.enum, group: field.ui?.group
}))
const sections: any[] = []
for (const field of config.fields.filter((field: any) => field.type !== 'object')) {
  let section = sections.find(section => section.title === field.ui?.group)
  if (!section) { section = { title: field.ui?.group, columns: 2, fields: [] }; sections.push(section) }
  section.fields.push({ key: field.path.split('.').pop(), path: field.path, label: field.label,
    required: field.required, dataType: field.type, options: field.enum,
    widget: field.type === 'bool' ? 'radio' : field.type === 'enum' ? 'select' : ['int', 'number'].includes(field.type) ? 'number' : 'text' })
}

// Phones show the steps behind a "Step n of m" toggle instead of a stepper row.
async function openStep(page: any, name: RegExp) {
  const compact = page.getByRole('button', { name: /^Step \d+ of \d+:/ })
  if (await compact.isVisible()) await compact.click()
  await page.getByRole('button', { name }).click()
}

for (const width of [1440, 390]) {
  test(`synthetic BOP wizard, package and submission ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(() => {
      localStorage.setItem('tenantId', 'synthetic-carrier')
      localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-token', user: {
        id: 'synthetic-admin', username: 'synthetic-admin', tenantId: 'synthetic-carrier', roles: ['admin']
      } }, version: 0 }))
    })
    await page.route('**/runtime-config.js', route => route.fulfill({ contentType: 'application/javascript', body:
      'window.__LATTICE_RUNTIME_CONFIG__ = {VITE_API_BASE_URL: window.location.origin, VITE_USE_MOCK: "0"}' }))
    const payload: any = {
      productCode: 'businessowners', country: 'US', state: 'OH', effectiveDate: '2026-11-01', termMonths: 12,
      underwritingCompanyId: 'bop-company', underwritingCompanyName: 'Synthetic BOP Company',
      agencyId: 'bop-agency', agencyName: 'Synthetic BOP Agency', qualificationAnswers: {},
      applicant: { firstName: 'Synthetic', lastName: 'Business', email: 'synthetic@example.test' },
      insureds: { primary: { firstName: 'Synthetic', lastName: 'Business', displayName: 'Synthetic BOP Office LLC', email: 'synthetic@example.test',
        phone: '6145550100', address: { street: '20 Contact Way', city: 'Columbus', state: 'OH', zip: '43215' } }, secondary: null, additional: [] },
      risks: [structuredClone(risk)], coverages: structuredClone(requiredCoverages)
    }
    let saved = { quoteId: 'bop-quote', quoteNumber: 'Q-SYNTHETIC-BOP', status: 'Draft', progressStep: 4, payload }
    const writes: string[] = []
    // Only API calls: the dev server also serves source modules under /src/api/.
    await page.route(url => url.pathname.startsWith('/api/'), async route => {
      const path = new URL(route.request().url()).pathname
      const method = route.request().method()
      const json = (body: any) => route.fulfill({ json: body })
      if (method !== 'GET') writes.push(path)
      if (path === '/api/v1/products') return json({ items: [{ code: config.product, version: config.version, ...config.capabilities }] })
      if (path.endsWith('/businessowners/config')) return json(config)
      if (path.endsWith('/businessowners/form')) return json({ fields, screen: { layout: 'sections', sections, validations: [] }, tables: {} })
      if (path === '/api/v1/underwriting-companies') return json({ items: [{ companyId: 'bop-company', name: 'Synthetic BOP Company', productCode: 'businessowners', country: 'US', state: 'OH' }] })
      if (path === '/api/v1/reference/agencies') return json({ items: [{ agencyId: 'bop-agency', legalName: 'Synthetic BOP Agency' }] })
      if (path === '/api/v1/quotes/bop-quote' && method === 'GET') return json(saved)
      if (path.endsWith('/draft')) return json({ ...saved, progressStep: route.request().postDataJSON().progressStep ?? 4 })
      if (path === '/api/v1/quotes' && method === 'POST') {
        const body = route.request().postDataJSON()
        expect(body.risks[0]).toMatchObject({ annualPayroll: 200000, employeeCount: 5, priorLossCount: 0, locationAddress: { line2: 'Suite 9' } })
        expect(body.risks).toHaveLength(1)
        const coverages = body.coverages.map((selection: any) => {
          const definition = config.coverages.find((definition: any) => definition.code === selection.code)
          const terms = { ...definition.packageTerms }
          if (definition.aggregateMultiplier) { terms.generalAggregate = selection.limit * definition.aggregateMultiplier; terms.productsCompletedOperationsAggregate = terms.generalAggregate }
          if (definition.personalAdvertisingInjuryMultiplier) terms.personalAdvertisingInjuryLimit = selection.limit * definition.personalAdvertisingInjuryMultiplier
          return { ...selection, ...(definition.packageTerms ? { packageTerms: terms } : {}) }
        })
        saved = { ...saved, status: 'Rated', progressStep: 7, payload: { ...body, coverages } }
        return json({ ...saved, premium: { total: { amount: 800, currency: 'USD' }, byCoverage: [] }, underwriting: { decision: 'Accept', reasons: [] } })
      }
      if (path === '/api/v1/submissions/settings') return json({ provider: 'builtin', label: 'Built-in reader (no AI model)', products: [{ code: 'businessowners', label: 'Businessowners Policy (BOP)' }], attestation: 'I reviewed these values.' })
      if (path === '/api/v1/submissions/bop-submission') return json({
        submissionId: 'bop-submission', submissionNumber: 'SUB-BOP-SYNTHETIC', productCode: 'businessowners', status: 'IN_REVIEW', subject: 'Synthetic BOP intake',
        fields: [{ key: 'cov.BOP_LIAB.limit', label: 'Business liability limit', section: 'Coverages', type: 'number', value: '1000000', aiValue: '1000000', status: 'pending', confidence: 'medium', confidenceScore: 75, options: [], required: true, evidence: [], alternatives: [] }],
        documents: [], events: [], customerChoice: {}, aiRun: { provider: 'builtin', label: 'Built-in reader (no AI model)', counts: {} }, receivedAt: '2026-10-23T00:00:00Z'
      })
      if (path.endsWith('/checks')) return json({ clearance: { customerMatches: [], openSubmissions: [], newCustomerProblems: [] }, appetite: { evaluated: false, reasons: [] }, missingRequired: [], unconfirmed: 1, readyToApprove: false, underwritingCompanies: [] })
      if (path === '/api/v1/agents/published') return json({ items: [] })
      if (path.includes('/validation-rules/')) return json({ items: [] })
      if (path === '/api/v1/addresses/capabilities') return json({ enabled: false })
      if (path === '/api/v1/forms/preview') return json([])
      return json({ items: [] })
    })
    await page.goto('/wizard?quoteId=bop-quote')
    await expect(page.getByRole('heading', { name: 'Business', exact: true })).toBeVisible()
    await expect(page.getByLabel('Annual payroll')).toHaveValue('200000')
    await expect(page.getByLabel('Address line 1')).toHaveValue('10 Synthetic Way')
    await page.getByLabel('Apartment, suite or unit').fill('Suite 9')
    await expect(page.getByRole('button', { name: /Add.*(location|premises)/i })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath(`bop-risk-${width}.png`), fullPage: true })
    await openStep(page, /05 Coverages/)
    await expect(page.getByRole('checkbox', { name: 'Business personal property (Required)' })).toBeDisabled()
    await expect(page.getByRole('checkbox', { name: 'Building', exact: true })).not.toBeChecked()
    await expect(page.getByText('General aggregate: $2,000,000')).toBeVisible()
    await expect(page.getByText('Income waiting period: 72 hours')).toBeVisible()
    await expect(page.getByText('Included - no additional premium')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath(`bop-coverages-${width}.png`), fullPage: true })
    await openStep(page, /06 Rating/)
    await page.getByRole('button', { name: 'Rate Premium', exact: true }).click()
    if (width < 600) await expect(page.getByRole('button', { name: /^Step 7 of \d+:/ })).toBeVisible()
    else await expect(page.getByRole('button', { name: /07 Premium/ })).toHaveAttribute('aria-current', 'step')
    expect(writes).toContain('/api/v1/quotes')
    await page.goto('/submissions/bop-submission')
    await expect(page.getByRole('heading', { name: 'Package terms', exact: true })).toBeVisible()
    await expect(page.getByText('General aggregate: $2,000,000')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue to approval' })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath(`bop-submission-${width}.png`), fullPage: true })
    expect(writes.some(path => path.endsWith('/approve'))).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
