import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, isoDate } from './support/api'
import { createQuote, productLine, productQuotePayload } from './support/products'

// Authority grants gate transactions for a scope. Everything here is scoped to
// professional-liability / WY, which no other spec quotes, and the grant is
// revoked when the test ends so later runs start from "gating OFF".
const pl = productLine('professional-liability')
const SCOPE_STATE = 'WY'

async function revokeScopedGrants(request: any, token: string) {
  const list = await apiJson<any>(request, 'GET', '/api/v1/uw/authority-grants', { token })
  for (const grant of list.items ?? []) {
    if (grant.active && grant.product_code === pl.productCode && grant.state_code === SCOPE_STATE) {
      await apiJson<any>(request, 'PATCH', `/api/v1/uw/authority-grants/${grant.grant_id}`, { token, data: { active: false } })
    }
  }
}

test.describe.configure({ mode: 'serial' })

test.describe('underwriting authority grants', () => {
  test('a grant saved in the admin UI turns gating on and refers binds above the premium limit', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const agent = await sessionFor('agent1')
    await revokeScopedGrants(request, admin.token)
    await signInAs(page, 'admin')

    try {
      await page.goto('/admin/underwriting-authority')
      await expect(page.getByRole('heading', { name: 'Underwriting Authority' })).toBeVisible()

      // Scope check: nothing configured yet, so everything auto-authorizes.
      await page.getByLabel('Scope product code').fill(pl.productCode)
      await page.getByLabel('Scope state code').fill(SCOPE_STATE)
      const status = page.getByRole('alert').first()
      await expect(status).toContainText('gating is OFF')

      await page.getByPlaceholder('role code, user id, or producer id').fill('agent')
      await page.getByPlaceholder('blank = all products').fill(pl.productCode)
      await page.getByPlaceholder('blank = all states').fill(SCOPE_STATE)
      await page.getByPlaceholder('unlimited').first().fill('100')
      await page.getByRole('checkbox', { name: 'NewBusiness' }).check()
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/uw/authority-grants') && response.request().method() === 'POST' && response.status() === 201),
        page.getByRole('button', { name: 'Save Grant' }).click(),
      ])

      const grantRow = page.getByRole('row')
        .filter({ hasText: pl.label })
        .filter({ hasText: SCOPE_STATE })
        .filter({ has: page.getByRole('cell', { name: 'Active', exact: true }) })
      await expect(grantRow).toHaveCount(1)
      await expect(grantRow).toContainText('ROLE: agent')
      await expect(grantRow).toContainText('NewBusiness')
      await expect(grantRow).toContainText('100.00')

      // Agent's PL quote rates far above the $100 authority, so bind is referred.
      const quote = await createQuote(request, agent.token, productQuotePayload(pl, { name: 'Authority Limit', state: SCOPE_STATE }))
      expect(quote.underwriting.decision).toBe('Eligible')
      expect(quote.premium.total.amount).toBeGreaterThan(100)
      const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, { token: agent.token, data: {}, expectedStatus: 400 })
      expect(blocked.code).toBe('UW_REFERRAL_REQUIRED')

      // Revoking the grant from the UI lifts the gate again.
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/uw/authority-grants/') && response.request().method() === 'PATCH' && response.ok()),
        grantRow.getByRole('button', { name: 'Deactivate' }).click(),
      ])
      await expect(grantRow).toHaveCount(0)

      const ungated = await createQuote(request, agent.token, productQuotePayload(pl, { name: 'Authority Lifted', state: SCOPE_STATE }))
      const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${ungated.quoteId}/bind`, { token: agent.token, data: {} })
      expect(bound.status).toBe('Bound')
    } finally {
      await revokeScopedGrants(request, admin.token)
    }
  })

  // Regression: the page compared the API's full timestamp to a YYYY-MM-DD
  // string, so a grant effective today read as "not yet effective".
  test('gating banner switches to ON as soon as a grant effective today is saved', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    await revokeScopedGrants(request, admin.token)
    try {
      await apiJson<any>(request, 'POST', '/api/v1/uw/authority-grants', {
        token: admin.token,
        expectedStatus: 201,
        data: {
          subjectType: 'ROLE', subjectId: 'agent', productCode: pl.productCode, stateCode: SCOPE_STATE,
          transactionTypes: ['NewBusiness'], maxPremium: 100, effectiveDate: isoDate(0),
        },
      })
      await signInAs(page, 'admin')
      await page.goto('/admin/underwriting-authority')
      await page.getByLabel('Scope product code').fill(pl.productCode)
      await page.getByLabel('Scope state code').fill(SCOPE_STATE)
      await expect(page.getByTestId('authority-gating-on-notice')).toBeVisible()
      await expect(page.getByTestId('authority-gating-off-banner')).toHaveCount(0)
      // Effective date shows the calendar date that was saved, in any timezone.
      const [year, month, day] = isoDate(0).split('-')
      const grantRow = page.getByRole('row').filter({ hasText: pl.label }).filter({ has: page.getByRole('cell', { name: 'Active', exact: true }) })
      await expect(grantRow).toContainText(`${month}/${day}/${year}`)

      // An out-of-scope state is still ungated.
      await page.getByLabel('Scope state code').fill('TX')
      await expect(page.getByTestId('authority-gating-off-banner')).toBeVisible()
    } finally {
      await revokeScopedGrants(request, admin.token)
    }
  })

  test('grant API validates input and is closed to agents', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const agent = await sessionFor('agent1')

    const missingTypes = await apiStatus(request, 'POST', '/api/v1/uw/authority-grants', {
      token: admin.token,
      data: { subjectType: 'ROLE', subjectId: 'agent', transactionTypes: [], effectiveDate: isoDate(0) },
    })
    expect(missingTypes.status).toBe(400)
    expect(missingTypes.body.code).toBe('INVALID_INPUT')

    const badSubject = await apiStatus(request, 'POST', '/api/v1/uw/authority-grants', {
      token: admin.token,
      data: { subjectType: 'TEAM', subjectId: 'x', transactionTypes: ['NewBusiness'], effectiveDate: isoDate(0) },
    })
    expect(badSubject.status).toBe(400)

    const asAgent = await apiStatus(request, 'POST', '/api/v1/uw/authority-grants', {
      token: agent.token,
      data: { subjectType: 'ROLE', subjectId: 'agent', transactionTypes: ['NewBusiness'], effectiveDate: isoDate(0), mayOverride: true },
    })
    expect(asAgent.status).toBe(403)
  })
})
