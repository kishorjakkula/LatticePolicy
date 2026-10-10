import { expect, test } from './support/fixtures'
import { fieldByLabel } from './support/wizard'

test.describe('collapsible screen sections', () => {
  test('a section collapses to its header and expands again without losing entered values', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/admin/underwriting-authority')

    const section = page.locator('.collapsible-section').filter({ hasText: 'Check gating status for a scope' })
    const productCode = section.getByLabel('Scope product code')
    await productCode.fill('cyber')

    await section.getByRole('button', { name: 'Collapse section' }).click()
    await expect(productCode).toBeHidden()
    await expect(section.getByText('Check gating status for a scope')).toBeVisible()

    await section.getByRole('button', { name: 'Expand section' }).click()
    await expect(productCode).toBeVisible()
    await expect(productCode).toHaveValue('cyber')
  })

  test('search filters and results are separate collapsible sections', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/search')

    const results = page.locator('.collapsible-section').filter({ has: page.getByRole('heading', { name: 'Results' }) })
    await expect(results.getByRole('grid')).toBeVisible()
    await results.getByRole('button', { name: 'Collapse section' }).click()
    await expect(results.getByRole('grid')).toBeHidden()
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeVisible()
  })

  test('quote and customer search tabs have collapsible result sections', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/search?mode=quotes')
    await expect(page.getByRole('heading', { name: 'Quote Results' })).toBeVisible()
    await page.goto('/search?mode=customers')
    const customers = page.locator('.collapsible-section').filter({ has: page.getByRole('heading', { name: 'Customer Results' }) })
    await expect(customers.getByRole('table')).toBeVisible()
    await customers.getByRole('button', { name: 'Collapse section' }).click()
    await expect(customers.getByRole('table')).toBeHidden()
  })

  test('quote wizard steps are split into collapsible sections that keep their values', async ({ page, signInAs }) => {
    await signInAs(page, 'admin')
    await page.goto('/wizard')

    for (const title of ['Company & Agency', 'Product & Term', 'Prior Insurance']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible()
    }
    // New business has no transaction details section.
    await expect(page.getByRole('heading', { name: 'Transaction Details' })).toHaveCount(0)

    const prior = page.locator('.wizard-section').filter({ has: page.getByRole('heading', { name: 'Prior Insurance' }) })
    const priorPolicy = fieldByLabel(prior, 'Prior Policy Number')
    await priorPolicy.fill('PP-12345')
    await prior.getByRole('button', { name: 'Collapse section' }).click()
    await expect(priorPolicy).toBeHidden()
    await prior.getByRole('button', { name: 'Expand section' }).click()
    await expect(priorPolicy).toHaveValue('PP-12345')
  })
})
