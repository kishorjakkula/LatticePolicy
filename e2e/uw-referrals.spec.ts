import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, isoDate, quotePayload, uniqueName } from './support/api'
import type { Page } from '@playwright/test'

async function findReferralInQueue(page: Page, referralId: string) {
  await page.goto('/uw/queue')
  await expect(page.getByRole('heading', { name: 'UW Referrals' })).toBeVisible()
  const listed = (pageNumber: number) => page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/uw/referrals') && url.searchParams.get('page') === String(pageNumber)
      && url.searchParams.get('pageSize') === '10' && url.searchParams.get('status') === 'Open' && response.ok()
  })
  const firstPage = listed(1)
  await page.getByRole('combobox', { name: 'Results per page' }).selectOption('10')
  let response = await firstPage
  for (let pageNumber = 1; ; pageNumber++) {
    const body = await response.json()
    const result = body.data ?? body
    if (result.items.some((item: { referralId: string }) => item.referralId === referralId)) {
      const row = page.locator(`tr[data-referral-id="${referralId}"]`)
      await expect(row).toBeVisible()
      return { row, pageNumber }
    }
    expect(pageNumber * result.pageSize, `Referral ${referralId} exists in the open queue`).toBeLessThan(result.total)
    const nextPage = listed(pageNumber + 1)
    await page.getByRole('button', { name: 'Go to next page' }).click()
    response = await nextPage
  }
}

/** Built-in personal-auto logic refers very high annual mileage. */
async function createReferredQuote(request: any, token: string, name: string) {
  const payload = quotePayload(name) as any
  payload.effectiveDate = isoDate(0)
  payload.risks[0].annualMiles = 60_000
  const quote = await apiJson<any>(request, 'POST', '/api/v1/quotes', { token, data: payload })
  expect(quote.underwriting.decision).toBe('Refer')
  const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token, data: {}, expectedStatus: 400 })
  expect(blocked.code).toBe('UW_REFERRAL_REQUIRED')
  const referralId = String(blocked.message).match(/Referral ([0-9a-f-]{36})/)![1]
  return { quote, referralId }
}

test.describe('underwriting referral queue', () => {
  test('underwriter declines a referral with a reason and the quote stays unbindable', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    // Ensure the target is beyond page one even in a fresh isolated database.
    for (let i = 0; i < 10; i++) {
      await createReferredQuote(request, admin.token, `${uniqueName('Older').replace(/[^a-zA-Z0-9]/g, '')} Referral`)
    }
    const { quote, referralId } = await createReferredQuote(request, admin.token, `${uniqueName('Decl').replace(/[^a-zA-Z0-9]/g, '')} Referral`)
    await signInAs(page, 'uw1')

    const { row, pageNumber } = await findReferralInQueue(page, referralId)
    expect(pageNumber).toBeGreaterThan(1)
    await expect(row).toContainText('Annual miles > 35k (refer)')
    await expect(row).toContainText('Open')

    await expect(row.getByRole('button', { name: 'Decline' })).toHaveCount(0)
    await row.getByRole('link', { name: 'Open' }).click()
    await expect(page).toHaveURL(new RegExp(`/uw/queue/${referralId}$`))
    await expect(page.getByRole('region', { name: 'Key facts' })).toContainText('Not yet bound (quote)')
    await page.getByRole('button', { name: 'Decline', exact: true }).click()
    const decision = page.getByRole('dialog', { name: /Decline referral/ })
    await decision.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(decision.getByRole('alert')).toContainText('Enter a reason')
    await decision.getByLabel('Reason (required)').fill('Mileage outside appetite (E2E)')
    await decision.getByRole('button', { name: 'Decline', exact: true }).click()
    await expect(page).toHaveURL(/\/uw\/queue$/)

    const after = await apiJson<any>(request, 'GET', `/api/v1/uw/referrals/${referralId}`, { token: admin.token })
    expect(after.status).toBe('Declined')
    const stillBlocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: admin.token, data: {}, expectedStatus: 400 })
    expect(stillBlocked.code).toMatch(/^UW_/)
  })

  test('detail page shows the referral and the status filter narrows the queue', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const { referralId } = await createReferredQuote(request, admin.token, `${uniqueName('Rev').replace(/[^a-zA-Z0-9]/g, '')} Referral`)
    await signInAs(page, 'uw1')

    const { row } = await findReferralInQueue(page, referralId)
    await row.getByRole('link', { name: 'Open' }).click()
    await expect(page.getByRole('heading', { name: /Referral:/ })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Why this was referred' })).toContainText('Annual miles')
    await expect(page.getByRole('region', { name: 'Key facts' })).toBeVisible()
    const evidence = await apiJson<any>(request, 'GET', `/api/v1/uw/referrals/${referralId}`, { token: admin.token })
    const proposed = page.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    await expect(proposed).toContainText(evidence.proposalHash)
    await expect(proposed).toContainText('60000')
    await expect(proposed).toContainText('Reviewed proposed premium')
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/referral-proposal-mobile.png', fullPage: true })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.screenshot({ path: 'test-results/referral-proposal-desktop.png', fullPage: true })
    await page.getByRole('button', { name: 'Approve', exact: true }).click()
    const decision = page.getByRole('dialog', { name: /Approve referral/ })
    await decision.getByLabel('Reason (required)').fill('Reviewed mileage for status-filter coverage')
    await decision.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(page).toHaveURL(/\/uw\/queue$/)

    const statusFilter = page.getByRole('combobox', { name: 'Status', exact: true })
    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname.endsWith('/uw/referrals') && url.searchParams.get('status') === 'Approved' && response.ok()
    })
    await statusFilter.selectOption({ label: 'Approved' })
    const body = await (await filtered).json()
    const result = body.data ?? body
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.items.every((item: { status: string }) => item.status === 'Approved')).toBe(true)
    const approvedRow = page.locator(`tr[data-referral-id="${referralId}"]`)
    await expect(approvedRow.locator('td').nth(5).locator('.badge')).toHaveText('Approved')
    const statuses = page.locator('tr[data-referral-id] td:nth-child(6) .badge')
    await expect(statuses).toHaveCount(result.items.length)
    await expect(statuses).toHaveText(result.items.map(() => 'Approved'))
  })

  test('agents cannot open the queue or decide referrals', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const agent = await sessionFor('agent1')
    const { referralId } = await createReferredQuote(request, admin.token, `${uniqueName('Sec').replace(/[^a-zA-Z0-9]/g, '')} Referral`)

    const approve = await apiStatus(request, 'PATCH', `/api/v1/uw/referrals/${referralId}/approve`, { token: agent.token, data: {} })
    expect(approve.status).toBe(403)

    await signInAs(page, 'agent1')
    await page.goto('/uw/queue')
    await expect(page.getByRole('heading', { name: 'UW Referrals' })).toHaveCount(0)
    await expect(page).not.toHaveURL(/\/uw\/queue/)
  })
})
