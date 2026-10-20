import { expect, test } from './support/fixtures'
import { apiJson, createIssuedPolicy, createWizardReadyPolicy, isoDate, uniqueName } from './support/api'
import { fieldByLabel, walkTransactionWizardToIssue } from './support/wizard'

function insured(prefix: string) {
  return `${uniqueName(prefix).replace(/[^a-zA-Z0-9]/g, '')} Lifecycle`
}

test.describe('policy lifecycle transactions in the browser', () => {
  test('policy view shows summary, actions, transactions, and documents for an in-force policy', { tag: '@smoke' }, async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('View'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('heading', { name: `Policy ${policy.policyNumber}` })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('In Force')
    const header = page.getByTestId('policy-header')
    await expect(header).toContainText('Personal Auto')
    await expect(header).not.toContainText('personal-auto')
    await expect(header).toContainText(/Premium this term\s*\$[\d,]+\.\d{2}/)

    // Actions that are valid for an in-force policy are enabled; the rest are not.
    for (const name of ['Endorse', 'Cancel', 'Renew', 'Non-Renew']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled()
    }
    await expect(page.getByRole('button', { name: 'Reinstate', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Rewrite', exact: true })).toBeDisabled()

    await expect(page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()).toContainText('admin')
    await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()
    const documentsPanel = page.getByTestId('policy-documents-panel')
    await expect(documentsPanel.getByRole('row').filter({ hasText: 'Policy packet' }).first()).toContainText('VERIFIED')
    await expect(documentsPanel.getByRole('row').filter({ hasText: 'Rating worksheet' }).first()).toBeVisible()
    await expect(documentsPanel).not.toContainText(/POLICY_PACKET|RATING_WORKSHEET/)
  })

  test('endorses a policy through the endorsement wizard', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Endorse'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('button', { name: 'Endorse', exact: true }).click()
    await expect(page).toHaveURL(/mode=endorse/)
    await expect(page.getByRole('heading', { name: 'Endorsement Wizard' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText(/Endorsement #\s*EN-\d{8}-/)

    await walkTransactionWizardToIssue(page, async (step) => {
      // Change the exposure on the vehicle step so the endorsement re-rates.
      if (step === 4) await fieldByLabel(page, 'Annual Miles').fill('18000')
    })
    await page.getByRole('button', { name: 'Issue', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('row').filter({ hasText: /EN-\d{8}-/ }).first()).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()).toBeVisible()
    await expect(page.getByRole('main')).toContainText('In Force')
  })

  test('cancels a policy through the cancellation wizard and then allows reinstatement', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Cancel'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page).toHaveURL(/mode=cancel/)
    await expect(page.getByRole('heading', { name: 'Cancellation Wizard' })).toBeVisible()

    await walkTransactionWizardToIssue(page, async (step) => {
      if (step !== 1) return
      await fieldByLabel(page, 'Cancellation Reason Code').selectOption('INSURED_REQUEST')
      await page.getByPlaceholder(/Enter cancellation notes/).fill('E2E cancellation at insured request')
    })
    await page.getByRole('button', { name: 'Issue', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Issued|Cancelled/ })).toBeVisible()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('main')).toContainText('Cancelled')
    await expect(page.getByRole('row').filter({ hasText: /CN-\d{8}-/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reinstate', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Endorse', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  })

  test('a cancellation started in the wizard can be abandoned without changing the policy', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Abandon'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await walkTransactionWizardToIssue(page, async (step) => {
      if (step === 1) await fieldByLabel(page, 'Cancellation Reason Code').selectOption('VEHICLE_SOLD')
    })
    page.once('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Cancel Transaction' }).click()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('heading', { name: `Policy ${policy.policyNumber}` })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('In Force')
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()
  })

  // Regression: the cancellation wizard re-validated the read-only vehicle step,
  // so a policy created through the API (no body style, short VIN, no ownership)
  // could never be cancelled in the browser.
  test('cancels a policy whose stored risk lacks wizard-only fields', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createIssuedPolicy(request, admin.token, insured('Sparse'), { effectiveDate: isoDate(-30) })
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Cancellation Wizard' })).toBeVisible()
    await walkTransactionWizardToIssue(page, async (step) => {
      if (step === 1) await fieldByLabel(page, 'Cancellation Reason Code').selectOption('REPLACED_COVERAGE')
      // The vehicle is shown read-only and incomplete, and that is fine.
      if (step === 4) await expect(fieldByLabel(page, 'Make')).toBeDisabled()
    })
    await page.getByRole('button', { name: 'Issue', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Issued|Cancelled/ })).toBeVisible()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('main')).toContainText('Cancelled')
    await expect(page.getByRole('row').filter({ hasText: /CN-\d{8}-/ }).first()).toContainText('Cancellation')
  })

  test('transaction and policy dates show the stored calendar date', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const effective = isoDate(-30)
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Dates'), { effectiveDate: effective })
    await signInAs(page, 'admin')

    const [year, month, day] = effective.split('-')
    const shown = `${month}/${day}/${year}`
    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('main')).toContainText(new RegExp(`Policy Effective Date\\s*${shown}`))
    // The transaction grid must agree with the header (it used to be a day early).
    const row = page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).first()
    await expect(row.getByRole('cell', { name: shown, exact: true }).first()).toBeVisible()
  })

  test('reinstates a cancelled policy', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Reinstate'))
    await apiJson<any>(request, 'POST', `/api/v1/policies/${policy.policyId}/cancel`, {
      token: admin.token,
      data: { effectiveDate: isoDate(-1), cancellationReasonCode: 'INSURED_REQUEST', reason: 'E2E reinstatement setup' },
    })
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('main')).toContainText('Cancelled')
    await expect(page.getByRole('row').filter({ hasText: /CN-\d{8}-/ }).first()).toContainText('Cancellation')

    // Reinstatement is a single action on the policy view (no wizard).
    await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/policies/${policy.policyId}/reinstate`) && response.ok()),
      page.getByRole('button', { name: 'Reinstate', exact: true }).click(),
    ])
    await expect(page.getByRole('row').filter({ hasText: /RI-\d{8}-/ }).first()).toContainText('Reinstatement')
    await expect(page.getByRole('main')).toContainText('In Force')
    await expect(page.getByRole('button', { name: 'Reinstate', exact: true })).toBeDisabled()
  })

  test('starts a renewal from the policy view', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Renew'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('button', { name: 'Renew', exact: true }).click()
    await expect(page).toHaveURL(/mode=renew/)
    await expect(page.getByRole('heading', { name: /Renewal Wizard/ })).toBeVisible()
    await walkTransactionWizardToIssue(page)
    await page.getByRole('button', { name: 'Issue', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Issued' })).toBeVisible()

    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('row').filter({ hasText: /RN-\d{8}-/ }).first()).toBeVisible()
  })

  test('opens the transaction audit panel and the as-of view', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, insured('Audit'))
    await signInAs(page, 'admin')

    await page.goto(`/policies/${policy.policyId}`)
    await page.getByRole('row').filter({ hasText: /NB-\d{8}-/ }).getByRole('button', { name: 'Audit' }).click()
    await expect(page.getByRole('main')).toContainText(/Audit|Change|Transaction/)

    // The "As of" control sits in the policy header and drives the as-of snapshot.
    await page.getByTestId('policy-header').getByLabel('As of date').fill(isoDate(0))
    await page.getByRole('button', { name: 'View as of', exact: true }).click()
    await expect(page.getByTestId('policy-asof-result')).toContainText(/State as of/)
  })
})
