import fs from 'node:fs/promises'
import type { Download } from '@playwright/test'
import { expect, test } from './support/fixtures'
import { apiJson, createWizardReadyPolicy, uniqueName } from './support/api'

test('each listed policy document has a distinct stage label and opens real content', async ({ page, context, request, sessionFor, signInAs }) => {
  const admin = await sessionFor('admin')
  const policy = await createWizardReadyPolicy(request, admin.token, uniqueName('Documents'))
  const { documents } = await apiJson<any>(request, 'GET', `/api/v1/policies/${policy.policyId}/documents`, { token: admin.token })
  expect(documents.filter((doc: any) => doc.type === 'POLICY_PACKET')).toHaveLength(2)
  expect(new Set(documents.map((doc: any) => doc.displayName)).size).toBe(documents.length)
  expect(documents.some((doc: any) => doc.type === 'RATING_WORKSHEET')).toBe(true)
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    ;(window as any).__openedDocuments = []
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) (window as any).__openedDocuments.push(blob)
      return original(blob)
    }
  })
  await signInAs(page, 'admin')
  await page.goto(`/policies/${policy.policyId}`)
  const downloads: Download[] = []
  context.on('page', (tab) => tab.on('download', (download) => downloads.push(download)))
  const panel = page.getByTestId('policy-documents-panel')
  for (const [index, doc] of documents.entries()) {
    const row = panel.getByRole('row').filter({ hasText: doc.displayName })
    await expect(row).toHaveCount(1)
    const downloadCount = downloads.length
    const popupPromise = context.waitForEvent('page')
    const responsePromise = page.waitForResponse((response) => response.request().method() === 'GET' && response.url().endsWith(`/documents/${doc.documentId}/content`))
    await row.getByRole('button', { name: 'Open', exact: true }).click()
    const [popup, response] = await Promise.all([popupPromise, responsePromise])
    expect(response.status()).toBe(200)
    await expect.poll(() => page.evaluate((i) => (window as any).__openedDocuments[i]?.size || 0, index)).toBeGreaterThan(100)
    const opened = await page.evaluate(async (i) => {
      const blob = (window as any).__openedDocuments[i] as Blob
      return { text: await blob.text(), type: blob.type }
    }, index)
    if (doc.type === 'RATING_WORKSHEET') {
      expect(response.headers()['content-type']).toContain('text/html')
      expect(opened.text).toContain('Rating worksheet')
      expect(opened.text).toContain(policy.policyNumber)
    } else {
      expect(response.headers()['content-type']).toContain('application/pdf')
      expect(opened.text.slice(0, 5)).toBe('%PDF-')
    }
    // Headless Chromium downloads PDFs instead of hosting its PDF viewer.
    await expect.poll(() => popup.url().startsWith('blob:') || downloads.length > downloadCount).toBe(true)
    if (downloads.length > downloadCount) {
      const download = downloads[downloadCount]
      expect(await download.failure()).toBeNull()
      const bytes = await fs.readFile((await download.path())!)
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    } else if (doc.type === 'RATING_WORKSHEET') {
      await expect(popup.getByRole('heading', { name: 'Rating worksheet' })).toBeVisible()
    }
    await popup.close()
  }
})
