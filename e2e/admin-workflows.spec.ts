import { expect, test } from '@playwright/test'
import {
  apiJson,
  createIssuedPolicy,
  installAuthState,
  loginApi,
  uniqueName,
} from './support/api'

test.describe('admin browser workflows', () => {
  test('creates a reinsurance treaty through the admin UI', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await installAuthState(page, admin)
    const treatyName = uniqueName('E2E Treaty')

    await page.goto('/admin/reinsurance')
    await expect(page.getByRole('heading', { name: 'Reinsurance' })).toBeVisible()
    await page.getByLabel('Treaty Name').fill(treatyName)
    await page.getByLabel('Effective').fill('2026-01-01')
    await page.getByLabel('Expiration').fill('2026-12-31')
    await page.getByLabel('Ceded %').fill('20')
    await page.getByLabel('Retained %').fill('80')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/admin/reinsurance/treaties') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Save' }).click(),
    ])

    const row = page.getByRole('row').filter({ hasText: treatyName })
    await expect(row).toBeVisible()
    await expect(row).toContainText('QUOTA_SHARE')
    await expect(row).toContainText('20% ceded')
  })

  test('shows issued policy exposure and applies filters', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await createIssuedPolicy(request, admin.token, uniqueName('Exposure Insured'))
    await installAuthState(page, admin)

    await page.goto('/admin/exposure')
    await expect(page.getByRole('heading', { name: 'Exposure Management' })).toBeVisible()
    await page.getByLabel('Product').fill('personal-auto')
    await page.getByLabel('As Of').fill('2026-08-01')

    await expect(page.getByText(/in-force policies as of 2026-08-01/)).toBeVisible()
    const productSection = page.getByRole('heading', { name: 'By Product' }).locator('..')
    await expect(productSection.getByRole('cell', { name: 'personal-auto' })).toBeVisible()
  })

  test('generates a bordereaux batch and opens its rows', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await createIssuedPolicy(request, admin.token, uniqueName('Bordereaux Insured'))
    await installAuthState(page, admin)

    await page.goto('/admin/bordereaux')
    await expect(page.getByRole('heading', { name: 'Bordereaux' })).toBeVisible()
    await page.getByLabel('Period Start').fill('2026-07-01')
    await page.getByLabel('Period End').fill('2026-12-31')
    await page.getByLabel('Product Code').fill('personal-auto')
    await Promise.all([
      page.waitForResponse((response) => response.url().includes('/api/v1/admin/bordereaux/batches') && response.request().method() === 'POST' && response.ok()),
      page.getByRole('button', { name: 'Generate' }).click(),
    ])

    const batchRow = page.getByRole('row').filter({ hasText: '2026-07-01' }).filter({ hasText: 'personal-auto' }).first()
    await expect(batchRow).toContainText('RISK')
    await batchRow.getByRole('button', { name: 'View rows' }).click()
    await expect(page.getByRole('button', { name: 'Hide rows' })).toBeVisible()
  })

  test('stages, validates, and commits a customer import batch', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    await installAuthState(page, admin)
    const suffix = uniqueName('import').replace(/[^a-zA-Z0-9]/g, '')
    const sourceSystem = `E2E_${suffix}`
    const rows = [{
      payload: {
        entityType: 'INDIVIDUAL',
        identity: { person: { firstName: 'E2E', lastName: suffix, dob: '1985-05-15' } },
        contactPoints: [{ contactType: 'EMAIL', value: `${suffix.toLowerCase()}@example.com` }],
        externalIdentifiers: [{ sourceSystem, externalId: `CUST-${suffix}` }],
      },
    }]

    await page.goto('/admin/import')
    await expect(page.getByRole('heading', { name: 'Data Import' })).toBeVisible()
    await page.getByPlaceholder('LEGACY_AMS').fill(sourceSystem)
    await page.locator('textarea').fill(JSON.stringify(rows))
    await page.getByRole('button', { name: 'Stage Batch' }).click()

    const batchRow = page.getByRole('row').filter({ hasText: sourceSystem })
    await expect(batchRow).toContainText('Staged')
    await batchRow.getByRole('button', { name: 'Validate' }).click()
    await expect(batchRow).toContainText('Validated')
    await batchRow.getByRole('button', { name: 'Commit' }).click()
    await expect(batchRow).toContainText('Committed')
    await expect(page.getByRole('cell', { name: `CUST-${suffix}` })).toBeVisible()
  })

  test('shows an enqueued job run and its event history', async ({ page, request }) => {
    const admin = await loginApi(request, 'admin')
    const idempotencyKey = uniqueName('e2e-job')
    const created = await apiJson<any>(request, 'POST', '/api/v1/admin/jobs/runs', {
      token: admin.token,
      expectedStatus: 201,
      data: {
        jobCode: 'stale_quote_cleanup',
        idempotencyKey,
        requestPayload: { staleAfterDays: 90, dryRun: true },
      },
    })
    await installAuthState(page, admin)

    await page.goto('/admin/jobs')
    await expect(page.getByRole('heading', { name: 'Job Queue' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'stale_quote_cleanup' }).first()).toBeVisible()
    const runRow = page.getByRole('row').filter({ hasText: 'stale_quote_cleanup' }).filter({ hasText: created.run.status }).first()
    await expect(runRow).toBeVisible()
    await runRow.getByRole('button', { name: 'View' }).click()
    await expect(page.getByRole('heading', { name: new RegExp(created.run.run_id) })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'No events recorded' })).toBeVisible()
  })
})
