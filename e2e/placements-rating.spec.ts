import { expect, test } from './support/fixtures'
import { uniqueName } from './support/api'

test.describe('large commercial placements', () => {
  test('creates a placement and advances it through the market workflow', async ({ page, signInAs }) => {
    const insuredName = uniqueName('E2E Placement Insured')
    await signInAs(page, 'admin')

    await page.goto('/placements')
    await expect(page.getByRole('heading', { name: 'Large Commercial Placements' })).toBeVisible()
    await page.getByRole('button', { name: '+ New Placement' }).click()
    await expect(page.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
    await page.getByPlaceholder('Insured name').fill(insuredName)
    await page.getByPlaceholder('Product code (optional)').fill('commercial-auto')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/placements') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Create', exact: true }).click(),
    ])

    const row = page.getByRole('row').filter({ hasText: insuredName })
    await expect(row).toContainText('Submission')

    // Submission -> Indication -> Quoted follows the allowed transition list.
    for (const next of ['Indication', 'Quoted']) {
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/api/v1/placements/') && response.request().method() !== 'GET' && response.ok()),
        row.getByRole('button', { name: next, exact: true }).click(),
      ])
      await expect(row).toContainText(next)
    }

    // Declining asks for a reason and is terminal.
    await row.getByRole('button', { name: 'Declined', exact: true }).click()
    const declineDialog = page.getByRole('dialog', { name: `Decline placement for ${insuredName}` })
    await declineDialog.getByLabel('Reason (optional)').fill('Market declined (E2E)')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/placements/') && response.request().method() !== 'GET' && response.ok()),
      declineDialog.getByRole('button', { name: 'Decline', exact: true }).click(),
    ])
    await expect(row).toContainText('Declined')
    await expect(row.getByRole('button')).toHaveCount(0)
  })
})

test.describe('rating workbench', () => {
  test('actuary sees the workbench and import stays disabled until a workbook is chosen', async ({ page, signInAs }) => {
    await signInAs(page, 'actuary1')
    await page.goto('/rating')
    await expect(page.getByRole('heading', { name: 'Rating Workbench' })).toBeVisible()
    for (const heading of ['Import Workbook', 'Rating Models', 'Versions', 'Version Detail', 'Published API Preview']) {
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Import Workbook' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Load API Preview' })).toBeDisabled()
    await page.getByRole('button', { name: 'Refresh' }).click()
    await expect(page.getByRole('heading', { name: 'Rating Models' })).toBeVisible()
  })
})
