import { auditRadioControls } from './support/radio-standard'
import type { Page } from '@playwright/test'
import { apiJson, createWizardReadyPolicy, quotePayload, uniqueName } from './support/api'
import { expect, test } from './support/fixtures'

// UI standard: every section on a working screen is a CollapsibleSection.
// These tests visit each screen, fail with a list of any section card that is
// not collapsible, and exercise every collapse toggle. Add new screens to
// SCREENS; a new section built without CollapsibleSection fails here.
const SCREENS: Array<{ name: string; path: string }> = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'policy search', path: '/search' },
  { name: 'quote search', path: '/search?mode=quotes' },
  { name: 'customer search', path: '/search?mode=customers' },
  { name: 'rating workbench', path: '/rating' },
  { name: 'quote wizard', path: '/wizard' },
  { name: 'insureds', path: '/insureds' },
  { name: 'underwriting queue', path: '/uw/queue' },
  { name: 'placements', path: '/placements' },
  { name: 'submissions', path: '/submissions' },
  { name: 'administration home', path: '/admin' },
  { name: 'admin forms', path: '/admin/forms' },
  { name: 'admin underwriting companies', path: '/admin/uw-company' },
  { name: 'admin users', path: '/admin/users' },
  { name: 'admin tenant', path: '/admin/tenant' },
  { name: 'admin security', path: '/admin/security' },
  { name: 'admin customers', path: '/admin/customers' },
  { name: 'admin agency onboarding', path: '/admin/onboarding' },
  { name: 'admin notification templates', path: '/admin/notification-templates' },
  { name: 'admin LLM releases', path: '/admin/llm-releases' },
  { name: 'admin AI audit', path: '/admin/ai-audit' },
  { name: 'admin validation rules', path: '/admin/validation-rules' },
  { name: 'admin compliance', path: '/admin/compliance' },
  { name: 'admin data import', path: '/admin/import' },
  { name: 'admin operations dashboard', path: '/admin/dashboard' },
  { name: 'admin exposure', path: '/admin/exposure' },
  { name: 'admin reinsurance', path: '/admin/reinsurance' },
  { name: 'admin bordereaux', path: '/admin/bordereaux' },
  { name: 'admin jobs', path: '/admin/jobs' },
  { name: 'admin underwriting authority', path: '/admin/underwriting-authority' },
  { name: 'admin underwriting rules', path: '/admin/underwriting-rules' },
]

/** Visible section cards that are not collapsible, described for the failure message. */
async function nonCollapsibleSections(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const SECTION = '.card, .ps-table-card, .ps-content-card, .policy-section-card, .ps-filter-panel'
    // Not sections: page heroes, alerts, KPI tiles, dialogs, and cards that
    // already wrap a native <details> collapsible.
    const EXEMPT = '.policy-hero, .page-shell, .policy-bound-alert, [class*="kpi"], .modal-overlay, .modal-overlay *, .login-shell *'
    const found: string[] = []
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(SECTION))) {
      if (element.matches('.collapsible-section') || element.matches(EXEMPT)) continue
      if (element.offsetParent === null) continue
      if (element.querySelector(':scope > details')) continue
      // A table/filter card nested directly inside a collapsible section is that section's body.
      if (element.parentElement?.closest('.collapsible-section') && !element.querySelector('h2, h3, h4')) continue
      // Text-only placeholders (loading, empty, error) are not sections.
      if (!element.querySelector('table, form, input, select, textarea, h2, h3, h4')) continue
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60)
      found.push(`<${element.tagName.toLowerCase()} class="${element.className}"> ${text}`)
    }
    return found
  })
}

async function exerciseToggles(page: Page) {
  const sections = page.locator('.collapsible-section:visible')
  const count = await sections.count()
  expect(count, 'screen has at least one collapsible section').toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    const section = sections.nth(index)
    const toggle = section.locator(':scope > .collapsible-section-header > .collapsible-section-toggle')
    const body = section.locator(':scope > .collapsible-section-body')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(body).toBeHidden()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(body).not.toHaveAttribute('hidden', /.*/)
  }
}

async function auditScreen(page: Page) {
  await page.waitForLoadState('networkidle')
  expect(await nonCollapsibleSections(page), 'section cards that are not collapsible').toEqual([])
  await exerciseToggles(page)
  await auditRadioControls(page)
}

test.describe('UI standard: every screen section is collapsible', () => {
  for (const screen of SCREENS) {
    test(`${screen.name} (${screen.path})`, async ({ page, signInAs }) => {
      await signInAs(page, 'admin')
      await page.goto(screen.path)
      await auditScreen(page)
    })
  }

  test('policy view', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const policy = await createWizardReadyPolicy(request, admin.token, 'Section Audit')
    await signInAs(page, 'admin')
    await page.goto(`/policies/${policy.policyId}`)
    await expect(page.getByRole('heading', { name: 'Policy Actions' })).toBeVisible()
    await auditScreen(page)
  })

  test('referral detail', async ({ page, request, sessionFor, signInAs }) => {
    const admin = await sessionFor('admin')
    const payload = quotePayload(uniqueName('Detail audit')) as any
    payload.risks[0].annualMiles = 60_000
    const quote = await apiJson<any>(request, 'POST', '/api/v1/quotes', { token: admin.token, data: payload })
    const blocked = await apiJson<any>(request, 'POST', `/api/v1/quotes/${quote.quoteId}/bind`, {
      token: admin.token, data: {}, expectedStatus: 400,
    })
    expect(blocked.code).toBe('UW_REFERRAL_REQUIRED')
    const id = blocked.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(id).toBeTruthy()
    await signInAs(page, 'admin')
    await page.goto(`/uw/queue/${id}`)
    await expect(page.getByRole('heading', { name: /Referral:/ })).toBeVisible()
    await auditScreen(page)
  })
})
