import { expect, test } from './support/fixtures'
import { apiJson, apiStatus, uniqueName } from './support/api'
import { createQuote, productLine, productQuotePayload } from './support/products'

// Rules are tenant-wide configuration. Everything here is scoped to cyber / WY,
// which no other spec quotes, and each rule is deactivated when the test ends.
const cyber = productLine('cyber')
const RULE_STATE = 'WY'

async function deactivateRules(request: any, token: string, reasonCode: string) {
  const list = await apiJson<any>(request, 'GET', '/api/v1/admin/underwriting-rules', {
    token,
    query: { productCode: 'cyber', pageSize: 200 },
  })
  for (const rule of list.items ?? []) {
    if (rule.reason_code === reasonCode && rule.active) {
      await apiJson<any>(request, 'PATCH', `/api/v1/admin/underwriting-rules/${rule.rule_id}`, { token, data: { active: false } })
    }
  }
}

function largeHeadcountQuote(name: string, state = RULE_STATE) {
  return productQuotePayload(cyber, { name, state, risk: { employeeCount: 5000 } })
}

test.describe.configure({ mode: 'serial' })

test.describe('admin-configurable underwriting rules', () => {
  test('a Refer rule created in the admin UI routes a matching quote to the UW queue until approved', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const reasonCode = `E2E_REFER_${uniqueName('r').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`
    const reason = `Headcount review ${reasonCode}`
    await signInAs(page, 'admin')

    try {
      await page.goto('/admin/underwriting-rules')
      await expect(page.getByRole('heading', { name: 'Underwriting Rules' })).toBeVisible()
      await page.getByRole('combobox', { name: 'Product' }).selectOption({ label: 'Cyber' })
      await page.getByRole('combobox', { name: 'Field' }).selectOption({ label: 'Employee Count' })
      await page.getByRole('combobox', { name: 'Operator' }).selectOption('greater_than')
      await page.getByLabel('Comparison value').fill('4000')
      await page.getByRole('combobox', { name: 'Outcome' }).selectOption('Refer')
      await page.getByPlaceholder('e.g. HIGH_RISK_AGE').fill(reasonCode)
      await page.getByPlaceholder('Shown to the underwriter on referral').fill(reason)
      await page.getByPlaceholder('blank = all states').fill(RULE_STATE)
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/admin/underwriting-rules') && response.request().method() === 'POST' && response.status() === 201),
        page.getByRole('button', { name: 'Create Rule' }).click(),
      ])
      const ruleRow = page.getByRole('row').filter({ hasText: reasonCode })
      await expect(ruleRow).toContainText('Refer')
      await expect(ruleRow).toContainText(RULE_STATE)

      // Matching risk is referred and cannot be bound.
      const referred = await createQuote(request, admin.token, largeHeadcountQuote('Refer Match'))
      expect(referred.underwriting.decision).toBe('Refer')
      expect(referred.underwriting.reasons).toContain(reason)
      const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${referred.quoteId}/bind`, { token: admin.token, data: {}, expectedStatus: 400 })
      expect(blocked.code).toBe('UW_REFERRAL_REQUIRED')
      const referralId = blocked.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
      expect(referralId).toBeTruthy()

      // Non-matching risk and out-of-scope state are untouched.
      const small = await createQuote(request, admin.token, productQuotePayload(cyber, { name: 'Refer Small', state: RULE_STATE }))
      expect(small.underwriting.decision).toBe('Eligible')
      const otherState = await createQuote(request, admin.token, largeHeadcountQuote('Refer Elsewhere', 'WA'))
      expect(otherState.underwriting.decision).toBe('Eligible')

      // The underwriter sees the referral with the admin-authored reason and approves it.
      await signInAs(page, 'uw1')
      await page.goto(`/uw/queue/${referralId}`)
      await expect(page.getByRole('region', { name: 'Why this was referred' })).toContainText(reason)
      await expect(page.getByRole('region', { name: 'Key facts' })).toContainText('Cyber')
      await page.getByRole('button', { name: 'Approve', exact: true }).click()
      const decision = page.getByRole('dialog', { name: /Approve referral/ })
      await decision.getByLabel('Reason (required)').fill('Approved in E2E after explicit review')
      await decision.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(page).toHaveURL(/\/uw\/queue$/)

      const bound = await apiJson<any>(request, 'POST', `/api/v1/quotes/${referred.quoteId}/bind`, { token: admin.token, data: {} })
      expect(bound.status).toBe('Bound')
    } finally {
      await deactivateRules(request, admin.token, reasonCode)
    }
  })

  test('a Decline rule blocks bind outright and stops applying once deactivated in the UI', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const reasonCode = `E2E_DECLINE_${uniqueName('d').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`
    const reason = `Headcount outside appetite ${reasonCode}`
    await apiJson<any>(request, 'POST', '/api/v1/admin/underwriting-rules', {
      token: admin.token,
      expectedStatus: 201,
      data: {
        productCode: 'cyber', stateCode: RULE_STATE, fieldPath: 'risks[0].employeeCount', operator: 'greater_than',
        comparisonValue: 4000, outcome: 'Decline', reasonCode, reasonDescription: reason,
      },
    })

    try {
      const declined = await createQuote(request, admin.token, largeHeadcountQuote('Decline Match'))
      expect(declined.underwriting.decision).toBe('Decline')
      const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${declined.quoteId}/bind`, { token: admin.token, data: {}, expectedStatus: 400 })
      expect(blocked.code).toBe('UW_DECLINED')
      expect(blocked.message).toContain(reason)

      await signInAs(page, 'admin')
      await page.goto('/admin/underwriting-rules')
      await page.getByRole('combobox', { name: 'Product' }).selectOption({ label: 'Cyber' })
      const ruleRow = page.getByRole('row').filter({ hasText: reasonCode })
      await expect(ruleRow).toContainText('Decline')
      await expect(ruleRow.getByRole('cell', { name: 'Active', exact: true })).toBeVisible()
      await Promise.all([
        page.waitForResponse((response) => response.url().includes('/admin/underwriting-rules/') && response.request().method() === 'PATCH' && response.ok()),
        ruleRow.getByRole('button', { name: 'Deactivate' }).click(),
      ])
      await expect(ruleRow.getByRole('cell', { name: 'Inactive', exact: true })).toBeVisible()
      await expect(ruleRow.getByRole('button', { name: 'Reactivate' })).toBeVisible()

      const afterDeactivation = await createQuote(request, admin.token, largeHeadcountQuote('Decline Lifted'))
      expect(afterDeactivation.underwriting.decision).toBe('Eligible')
    } finally {
      await deactivateRules(request, admin.token, reasonCode)
    }
  })

  test('rejects rules with an unknown field or an operator the field does not support', async ({ request, sessionFor }) => {
    const admin = await sessionFor('admin')
    const base = { productCode: 'cyber', stateCode: RULE_STATE, comparisonValue: 1, outcome: 'Refer', reasonCode: 'E2E_INVALID', reasonDescription: 'invalid' }

    const unknownField = await apiStatus(request, 'POST', '/api/v1/admin/underwriting-rules', {
      token: admin.token, data: { ...base, fieldPath: 'risks[0].notARealField', operator: 'equals' },
    })
    expect(unknownField.status).toBe(400)

    const badOperator = await apiStatus(request, 'POST', '/api/v1/admin/underwriting-rules', {
      token: admin.token, data: { ...base, fieldPath: 'risks[0].industry', operator: 'greater_than' },
    })
    expect(badOperator.status).toBe(400)

    const badOutcome = await apiStatus(request, 'POST', '/api/v1/admin/underwriting-rules', {
      token: admin.token, data: { ...base, fieldPath: 'risks[0].employeeCount', operator: 'greater_than', outcome: 'Approve' },
    })
    expect(badOutcome.status).toBe(400)
    expect(badOutcome.body.code).toBe('INVALID_OUTCOME')
  })

  test('only roles with the rules permission can read or change rules', async ({ page, request, sessionFor, signInAs }) => {
    const agent = await sessionFor('agent1')
    const list = await apiStatus(request, 'GET', '/api/v1/admin/underwriting-rules?productCode=cyber', { token: agent.token })
    expect(list.status).toBe(403)
    const create = await apiStatus(request, 'POST', '/api/v1/admin/underwriting-rules', {
      token: agent.token,
      data: { productCode: 'cyber', fieldPath: 'risks[0].employeeCount', operator: 'greater_than', comparisonValue: 1, outcome: 'Decline', reasonCode: 'E2E_AGENT', reasonDescription: 'agent attempt' },
    })
    expect(create.status).toBe(403)

    await signInAs(page, 'agent1')
    await page.goto('/admin/underwriting-rules')
    await expect(page.getByRole('heading', { name: 'Underwriting Rules' })).toHaveCount(0)
    await expect(page).not.toHaveURL(/underwriting-rules/)
  })
})
