import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, isoDate, quotePayload, uniqueName } from './support/api'

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
    const { quote, referralId } = await createReferredQuote(request, admin.token, `${uniqueName('Decl').replace(/[^a-zA-Z0-9]/g, '')} Referral`)
    await signInAs(page, 'uw1')

    // Pre-bind referrals carry no policy number, so locate this one by its
    // position in the list the page actually rendered.
    const listed = page.waitForResponse((response) => /\/uw\/referrals\?/.test(response.url()) && response.ok())
    await page.goto('/uw/queue')
    await expect(page.getByRole('heading', { name: 'UW Referrals' })).toBeVisible()
    const body = await (await listed).json()
    const items: any[] = (body.data ?? body).items
    const index = items.findIndex((item) => item.referralId === referralId)
    expect(index, 'new referral is on the first page of the queue').toBeGreaterThanOrEqual(0)

    const row = page.locator('tbody tr').nth(index)
    await expect(row).toContainText('Pre-bind (quote)')
    await expect(row).toContainText('Annual miles > 35k (refer)')
    await expect(row).toContainText('Open')

    page.once('dialog', (dialog) => void dialog.accept('Mileage outside appetite (E2E)'))
    await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/uw/referrals/${referralId}`) && response.request().method() === 'PATCH' && response.ok()),
      row.getByRole('button', { name: 'Decline' }).click(),
    ])

    const after = await apiJson<any>(request, 'GET', `/api/v1/uw/referrals/${referralId}`, { token: admin.token })
    expect(after.status).toBe('Declined')
    const stillBlocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: admin.token, data: {}, expectedStatus: 400 })
    expect(stillBlocked.code).toMatch(/^UW_/)
  })

  test('review dialog shows the referral and the status filter narrows the queue', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    await createReferredQuote(request, admin.token, `${uniqueName('Rev').replace(/[^a-zA-Z0-9]/g, '')} Referral`)
    await signInAs(page, 'uw1')

    await page.goto('/uw/queue')
    const row = page.getByRole('row').filter({ hasText: 'Open' }).first()
    await row.getByRole('button', { name: 'Review' }).click()
    const dialog = page.getByRole('dialog', { name: 'Referral review' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByLabel('Assignee user UUID')).toBeVisible()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()

    const statusFilter = page.getByRole('combobox').first()
    await statusFilter.selectOption({ label: 'Approved' })
    await expect(page.getByRole('row').filter({ hasText: 'Open' }).filter({ has: page.getByRole('button', { name: 'Approve' }) })).toHaveCount(0)
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
