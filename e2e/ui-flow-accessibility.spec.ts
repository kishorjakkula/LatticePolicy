import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './support/fixtures'

test.describe('WP-0004 responsive controls and accessibility', () => {
  test('page-size picker remains usable after mobile close and immediate desktop resize', async ({ page, signInAs }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await signInAs(page, 'admin')
    await page.goto('/search')
    const pager = page.getByRole('navigation', { name: 'Pagination' })
    const disclosure = pager.locator('details.ps-pagination-size')
    const summary = pager.getByLabel('Page size options')
    const size = pager.getByRole('combobox', { name: 'Results per page' })
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(size).toBeHidden()
      await summary.click()
      await expect(size).toBeVisible()
      await summary.click()
      await page.setViewportSize({ width: 1440, height: 1000 })
      await expect(disclosure).toHaveCount(0)
      await expect(summary).toBeHidden()
      await expect(size).toBeVisible()
      const nextSize = attempt % 2 === 0 ? '50' : '25'
      await size.selectOption(nextSize)
      await expect(size).toHaveValue(nextSize)
      await expect(page).toHaveURL(new RegExp(`pageSize=${nextSize}(?:&|$)`))
    }
  })

  test('desktop dark-theme primary and active-page controls have readable contrast', async ({ page, signInAs }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signInAs(page, 'admin')
    await page.goto('/search')
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await expect(page.locator('.ps-page-btn--active')).toBeVisible()
    await expect(page.locator('.action-btn--primary').first()).toBeVisible()
    for (const selector of ['.ps-page-btn--active', '.action-btn--primary']) {
      const audit = await new AxeBuilder({ page }).include(selector).withRules(['color-contrast']).analyze()
      expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([])
    }
  })
  for (const theme of ['light', 'dark']) {
    test(`search controls at 390px in ${theme} mode`, async ({ page, signInAs }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await signInAs(page, 'admin')
      await page.goto('/search')
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
      const filters = page.locator('.ps-filter-panel')
      const toggle = filters.getByRole('button', { name: 'Expand section' })
      await expect(toggle).toBeVisible()
      await toggle.click()
      await expect(page.getByRole('search', { name: 'Search filters' })).toBeVisible()
      await filters.getByRole('button', { name: 'Collapse section' }).click()
      const pager = page.getByRole('navigation', { name: 'Pagination' })
      await expect(pager).toBeVisible()
      await expect(pager.locator('.ps-pagination-compact')).toBeVisible()
      const size = pager.getByRole('combobox', { name: 'Results per page' })
      await expect(size).toBeHidden()
      await pager.getByLabel('Page size options').click()
      await expect(size).toBeVisible()
      await size.selectOption('50')
      await expect(page).toHaveURL(/pageSize=50/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`search-${theme}-390.png`), fullPage: true })
      const audit = await new AxeBuilder({ page }).include('.policy-search-shell').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([])
    })
  }

  for (const path of ['/admin', '/uw/queue', '/admin/ai-audit', '/admin/compliance', '/admin/security', '/dashboard']) {
    test(`no page overflow at 390px: ${path}`, async ({ page, signInAs }, testInfo) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await signInAs(page, 'admin')
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`${path.replaceAll('/', '-')}-390.png`), fullPage: true })
    })
  }
})
