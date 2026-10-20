import { expect, test } from './support/fixtures'
import { apiJson, uniqueName } from './support/api'
import { createQuote, productLines, productQuotePayload } from './support/products'

test.describe('every product line quotes, binds, and issues', () => {
  for (const line of productLines) {
    test(`${line.label}: quote -> bind -> issue and policy view`, async ({ page, request, sessionFor, signInAs }) => {
      const admin = await sessionFor('admin')
      const name = `${uniqueName(line.policyPrefix.replace('-', '')).replace(/[^a-zA-Z0-9]/g, '')} Line`

      const quote = await createQuote(request, admin.token, productQuotePayload(line, { name }))
      expect(quote.status).toBe('Rated')
      expect(quote.underwriting.decision).toBe('Eligible')
      expect(quote.premium.total.amount).toBeGreaterThan(0)
      expect(quote.premium.byCoverage[0].code).toBe(line.coverage.code)

      const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: admin.token, data: {} })
      expect(bound.status).toBe('Bound')
      expect(bound.policyNumber).toContain(line.policyPrefix)
      const issued = await apiJson<any>(request, 'POST', `/api/v1/policies/${bound.policyId}/issue`, { token: admin.token, data: {} })
      expect(issued.status).toBe('Issued')

      await signInAs(page, 'admin')
      await page.goto(`/policies/${bound.policyId}`)
      await expect(page.getByRole('heading', { name: `Policy ${bound.policyNumber}` })).toBeVisible()
      await expect(page.getByTestId('policy-header')).toContainText(line.label)
      await expect(page.getByTestId('policy-header')).not.toContainText(line.productCode)
      await expect(page.getByRole('main')).toContainText(/In Force|Issued/)
      await expect(page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()).toBeVisible()

      // The product filter on Search finds it.
      await page.goto('/search?mode=policies')
      await page.getByRole('combobox', { name: 'Product' }).selectOption({ label: line.label })
      await page.getByRole('textbox', { name: 'Search' }).fill(bound.policyNumber)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page.getByRole('button', { name: bound.policyNumber }).first()).toBeVisible()
    })
  }

  test('rejects a quote whose risk does not match the contract schema', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const payload = productQuotePayload(productLines[1])
    const invalid = { ...payload, coverages: [] }
    const error = await apiJson<any>(request, 'POST', '/api/v1/quotes', { token: admin.token, data: invalid, expectedStatus: 422 })
    expect(error.code).toBe('INVALID_QUOTE')
    expect(JSON.stringify(error.details)).toContain('/coverages')
  })
})
