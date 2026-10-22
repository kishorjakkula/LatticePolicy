// Read-only browser regression with synthetic API responses; never touches a demo database.
import { chromium, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const browser = await chromium.launch({ headless: true })
const base = process.env.DASHBOARD_TEST_URL || 'http://127.0.0.1:5191'
const now = new Date()
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const expiry = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const policy = { policyId: 'renew', policyNumber: 'POL-1', internalStatus: 'Issued', productCode: 'personal-auto', term: { effectiveDate: '2025-01-01', expirationDate: expiry } }
const submission = { submissionId: 's1', insuredName: 'Sample insured', submissionNumber: 'SUB-1', productCode: 'homeowners' }
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    await context.addInitScript(() => {
      localStorage.setItem('auth-storage', JSON.stringify({ state: { token: 'synthetic-browser-test', user: {
        id: 'person', tenantId: 'carrier', roles: [], username: 'Synthetic tester',
        permissions: ['menu.search.view', 'page.search.view', 'page.policy.view', 'page.wizard.view', 'page.uw_queue.view', 'uw.referrals.read', 'page.submissions.view', 'submissions.read'],
      } }, version: 0 }))
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://localhost:3300/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname
      let body = {}
      if (path.endsWith('/policies')) body = { items: [policy], total: 1 }
      else if (path.endsWith('/quotes')) body = { items: [{ quoteId: 'q1', effectiveDate: `${month}-01` }], total: 1 }
      else if (path.endsWith('/uw/referrals')) body = { items: [], total: 4 }
      else if (path.endsWith('/submissions')) body = { items: [submission], total: 1, statusCounts: { READY_FOR_REVIEW: 1 } }
      else if (path.endsWith('/ai/dashboard/insights')) body = { aiInsights: {
        enabled: true, provider: 'existing', modelVersion: 'existing-carrier-model', portfolioHealthScore: 90, conversionRate: 0.5, cancellationRate: 0, expiringNext30Days: 1,
        predictions: { next30Days: { projectedQuotes: 10, projectedPolicies: 5, projectedConversionRate: 0.5, projectedCancellationRate: 0, projectedPremium: 5000 }, next90Days: { projectedQuotes: 30, projectedPolicies: 15, projectedConversionRate: 0.5 } },
        trend: { historical: [{ monthKey: month, quotes: 1, policies: 1, cancellations: 0 }], forecast: [{ monthKey: month, projectedQuotes: 9, projectedPolicies: 4, projectedCancellations: 1 }, { monthKey: '2099-01', projectedQuotes: 10, projectedPolicies: 5, projectedCancellations: 1 }] },
      } }
      await route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    })
    await page.goto(`${base}/dashboard`)
    await expect(page.getByRole('link', { name: 'Open referrals 4' })).toBeVisible().catch(async (error) => {
      console.log(JSON.stringify({ url: page.url(), errors, text: await page.locator('body').innerText() }))
      throw error
    })
    await expect(page.getByText(/Last refreshed:/)).toContainText(/\d{1,2}:\d{2} (AM|PM)/)
    if (width === 390) await page.locator('.dashboard-portfolio > .collapsible-section-header button').click()
    await expect(page.getByRole('region', { name: 'Actual and future forecast by month' })).toBeVisible()
    const rowLayout = await page.locator('.dashboard-data-table').evaluateAll((tables) => tables.map((table) => {
      const header = table.tHead.getBoundingClientRect()
      const rows = [...table.tBodies[0].rows].map((row) => row.getBoundingClientRect())
      return { headerFirst: header.bottom <= rows[0].top + 1, rowsDoNotOverlap: rows.every((row, index) => index === 0 || row.top >= rows[index - 1].bottom - 1) }
    }))
    expect(rowLayout.every((layout) => layout.headerFirst && layout.rowsDoNotOverlap)).toBe(true)
    const draftWidth = await page.getByLabel('Draft: 0', { exact: true }).locator('.dashboard-bar-fill').evaluate((el) => el.getBoundingClientRect().width)
    expect(draftWidth).toBe(0)
    const axisOverlap = await page.locator('.dashboard-trend-chart svg').evaluate((svg) => {
      const labels = [...svg.querySelectorAll('g > text')].slice(-6).map((node) => node.getBoundingClientRect())
      return labels.some((rect, index) => index > 0 && rect.left < labels[index - 1].right)
    })
    expect(axisOverlap).toBe(false)
    const measure = async () => page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
    expect(await measure()).toEqual({ viewport: width, document: width })
    await page.screenshot({ path: `/tmp/wp-0004-dashboard-${width}.png`, fullPage: true })
    const axe = await new AxeBuilder({ page }).include('.dashboard-page-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    console.log(JSON.stringify({ width, overflow: await measure(), axe: axe.violations.map(({ id, nodes }) => ({ id, elements: nodes.map((node) => node.target) })), errors }))
    await page.getByRole('link', { name: 'Submissions to review 1 Ready for review' }).click()
    await expect(page.getByRole('link', { name: 'Sample insured' })).toHaveAttribute('href', '/submissions/s1')
    expect(await measure()).toEqual({ viewport: width, document: width })
    await page.getByRole('link', { name: 'Renewals due 1 Next 30 days' }).click()
    await expect(page.getByRole('link', { name: 'POL-1' })).toHaveAttribute('href', '/policies/renew')
    expect(await measure()).toEqual({ viewport: width, document: width })
    expect(errors).toEqual([])
    await context.close()
  }
} finally {
  await browser.close()
}
