import { test, expect } from '@playwright/test'
import { auditRadioControls } from './support/radio-standard'

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`technical-admin staged publication UI ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(() => {
      localStorage.setItem(
        'auth-storage',
        JSON.stringify({
          state: {
            token: 'synthetic-browser-test-token',
            user: {
              id: 'technical-admin',
              username: 'technical-admin',
              tenantId: 'synthetic-carrier',
              roles: ['carrier_technical_admin'],
            },
          },
          version: 0,
        }),
      )
      localStorage.setItem('tenantId', 'synthetic-carrier')
    })
    await page.route('**/runtime-config.js', (route) =>
      route.fulfill({
        contentType: 'application/javascript',
        body: 'window.__LATTICE_RUNTIME_CONFIG__ = { VITE_API_BASE_URL: window.location.origin, VITE_USE_MOCK: "0" }',
      }),
    )
    const release: any = {
      release_id: 'synthetic-release',
      version_label: 'candidate-1',
      status: 'READY_FOR_VALIDATION',
      artifact_digest: 'a'.repeat(64),
      artifacts: {
        model: 'private-model-v1',
        profileId: 'submission',
        profileVersion: '1.0.0',
      },
      evaluation: {
        sampleCount: 50,
        fieldAccuracy: 0.98,
        evidenceAccuracy: 0.99,
      },
      notifications: [],
    }
    const actions: string[] = []
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname.endsWith('/admin/llm/releases'))
        return route.fulfill({
          json: {
            items: [release],
            canReview: true,
            contactEmail: '',
            emailEnabled: false,
          },
        })
      const action = url.pathname.split('/').pop()!
      if (
        route.request().method() === 'POST' &&
        url.pathname.includes('/admin/llm/releases/')
      ) {
        actions.push(action)
        if (action === 'start-validation') {
          release.status = 'IN_VALIDATION'
          release.validation_authorization = {
            payload: { environment: 'validation' },
            signature: 'synthetic-test-only',
          }
        }
        if (action === 'record-validation') {
          const body = route.request().postDataJSON()
          expect(body.attestation).toBe(true)
          expect(body.passed).toBe(true)
          expect(body.environment).toBe('test')
          release.status = 'VALIDATED'
          release.validation = body
        }
        if (action === 'authorize-production') {
          expect(route.request().postDataJSON().attestation).toBe(true)
          release.status = 'PRODUCTION_AUTHORIZED'
          release.production_authorization = {
            payload: { environment: 'production' },
            signature: 'synthetic-test-only',
          }
        }
        return route.fulfill({ json: release })
      }
      return route.fulfill({ json: {} })
    })
    await page.route('**/brand', (route) =>
      route.fulfill({
        json: {
          name: 'Synthetic Carrier',
          primaryColor: '#1f3a8a',
          logoDataUrl: null,
          documentFooter: '',
        },
      }),
    )
    await page.goto('/admin/llm-releases?release=synthetic-release')
    await expect(
      page.getByRole('heading', { name: 'LLM Releases', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('Release email disabled.')).toBeVisible()
    await expect(page.getByLabel('Technical-admin email')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Authorize Production Publication' }),
    ).toHaveCount(0)
    await page
      .getByRole('button', { name: 'Authorize Lower-Environment Test' })
      .click()
    await page.getByLabel('Test run ID').fill('test-run-42')
    await page.getByLabel('Test report SHA-256').fill('b'.repeat(64))
    await page
      .getByLabel('Validation notes')
      .fill('Synthetic application mappings and evidence checked')
    await page.getByRole('radio', { name: 'Passed', exact: true }).check()
    await auditRadioControls(page)
    await expect(
      page.getByRole('button', { name: 'Record Validation' }),
    ).toBeDisabled()
    await page
      .getByLabel(
        'I tested these exact artifacts in the selected lower environment.',
      )
      .check()
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({
      path: `test-results/llm-validation-${viewport.width}.png`,
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Record Validation' }).click()
    const production = page.getByRole('button', {
      name: 'Authorize Production Publication',
    })
    await expect(production).toBeDisabled()
    await page
      .getByLabel('I authorize these tested artifacts for production.')
      .check()
    await production.click()
    const download = page.waitForEvent('download')
    await page
      .getByRole('button', { name: 'Download Production Authorization' })
      .click()
    expect((await download).suggestedFilename()).toBe(
      'candidate-1-production.json',
    )
    expect(actions).toEqual([
      'start-validation',
      'record-validation',
      'authorize-production',
    ])
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
  })
}
