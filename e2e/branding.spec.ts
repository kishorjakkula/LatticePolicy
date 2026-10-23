import AxeBuilder from '@axe-core/playwright'
import { test, expect } from './support/fixtures'
import { createPortalUserForPolicy } from './support/api'

const brand = { name: 'Synthetic Carrier', primaryColor: '#155e75', logoDataUrl: null, documentFooter: 'Synthetic terms.' }
for (const view of ['login', 'header'] as const) {
  for (const width of [1440, 390]) {
    test(`default LatticePolicy logo loads in ${view} at ${width}px`, async ({ page, signInAs }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.route('**/brand', route => route.fulfill({ json: brand }))
      if (view === 'header') await signInAs(page, 'admin')
      await page.goto(view === 'login' ? '/login' : '/search')
      const logo = page.getByRole('img', { name: 'LatticePolicy', exact: true })
      await expect(logo).toBeVisible()
      await expect.poll(() => logo.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      await expect(page.locator('.carrier-brand-name')).toHaveText(brand.name)
      const favicon = await page.request.get('/favicon.svg')
      expect(favicon.ok()).toBe(true)
      expect(await favicon.text()).toContain('<title>LatticePolicy</title>')
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const box = await logo.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width)
        const audit = await new AxeBuilder({ page }).include('.carrier-brand-fallback').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
        expect(audit.violations, JSON.stringify(audit.violations, null, 2)).toEqual([])
        await page.locator(view === 'login' ? '.login-brand' : '.topbar').screenshot({ path: testInfo.outputPath(`${view}-${theme}-${width}.png`) })
      }
    })
  }
}

test('customer portal shares the platform fallback while custom carrier logos remain primary', async ({ page, request, sessionFor, signInAs }) => {
  await page.route('**/brand', route => route.fulfill({ json: brand }))
  const admin = await sessionFor('admin')
  const portal = await createPortalUserForPolicy(request, admin.token)
  await signInAs(page, portal.username, portal.password)
  await page.goto('/portal')
  await expect(page.getByRole('img', { name: 'LatticePolicy', exact: true })).toBeVisible()
  const raster = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGioAAAAASUVORK5CYII='
  await page.unroute('**/brand')
  await page.route('**/brand', route => route.fulfill({ json: { ...brand, logoDataUrl: raster } }))
  await page.reload()
  const carrier = page.getByRole('img', { name: brand.name, exact: true })
  await expect(carrier).toHaveAttribute('src', raster)
  await expect.poll(() => carrier.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(1)
  await expect(page.getByRole('img', { name: 'LatticePolicy', exact: true })).toHaveCount(0)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', raster)
})
