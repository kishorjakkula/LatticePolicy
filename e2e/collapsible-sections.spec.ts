import { expect, test } from './support/fixtures'

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
})
