import { createHash } from 'node:crypto'
import { expect, test } from './support/fixtures'
import { apiJson, createWizardReadyPolicy, isoDate, tenantId, uniqueName } from './support/api'

type Version = {
  versionId: string
  transactionId: string
  transactionNumber: string
  effectiveDate: string
  transactionType: string
}

type ArchivedDocument = {
  documentId: string
  versionId: string
  transactionId: string
  displayName: string
  type: string
  edition?: string
  status: string
  available: boolean
  integrityStatus: string
  contentType: string
  byteSize: number
  stage: string
  contentHash?: string
}

type VersionDetails = {
  policyId: string
  versionId: string
  transactionId: string
  transactionNumber: string
  forms: Array<{ formNumber: string; formTitle: string; editionDate: string }>
  documents: ArchivedDocument[]
}

const formats: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/html': 'HTML',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
}

test('readonly transaction wizard shows pinned forms and opens only exact-version archived bytes', async ({ page, request, sessionFor, signInAs }, testInfo) => {
  const admin = await sessionFor('admin')
  const policy = await createWizardReadyPolicy(request, admin.token, uniqueName('Pinned Documents'))
  await apiJson(request, 'POST', `/api/v1/policies/${policy.policyId}/endorse`, {
    token: admin.token,
    data: { effectiveDate: isoDate(-15), changes: [{ op: 'replace', path: '/risks/0/annualMiles', value: 18000 }] },
  })
  const versions = await apiJson<Version[]>(request, 'GET', `/api/v1/policies/${policy.policyId}/versions`, { token: admin.token })
  const aggregate = await apiJson<{ documents: ArchivedDocument[] }>(request, 'GET', `/api/v1/policies/${policy.policyId}/documents`, { token: admin.token })
  // Bind/issue share the NB version; endorsement supplies a distinct real version.
  expect(versions.length).toBeGreaterThanOrEqual(2)
  expect(versions.some(version => /endorse/i.test(version.transactionType))).toBe(true)
  const snapshots: Array<{ version: Version; details: VersionDetails }> = []
  for (const version of versions) {
    const details = await apiJson<VersionDetails>(request, 'GET', `/api/v1/policies/${policy.policyId}/versions/${version.versionId}/details`, { token: admin.token })
    expect(details).toMatchObject({ policyId: policy.policyId, versionId: version.versionId, transactionId: version.transactionId })
    if (details.documents.length) snapshots.push({ version, details })
  }
  expect(snapshots.length, 'NB and endorsement each retain their own archived output references').toBeGreaterThanOrEqual(2)
  expect(snapshots.some(({ details }) => details.forms.length > 0), 'at least one version supplies pinned form snapshots').toBe(true)

  const forbiddenRequests: string[] = []
  const contentRequests: URL[] = []
  page.on('request', req => {
    const url = new URL(req.url())
    if (/\/forms\/preview\/?$|\/forms\/[^/]+\/document\/?$|\/documents\/[^/]+\/regenerate\/?$|\/versions\/[^/]+\/rating-worksheet\/?$/.test(url.pathname)) {
      forbiddenRequests.push(`${req.method()} ${url.pathname}`)
    }
    if (/\/documents\/[^/]+\/content$/.test(url.pathname)) contentRequests.push(url)
  })
  await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL)
    ;(window as any).__transactionArchiveBlobs = []
    URL.createObjectURL = (value: Blob | MediaSource) => {
      if (value instanceof Blob) (window as any).__transactionArchiveBlobs.push(value)
      return original(value)
    }
  })
  await signInAs(page, 'admin')

  for (const [snapshotIndex, { version, details }] of snapshots.entries()) {
    const params = new URLSearchParams({ readonly: '1', mode: /endorse/i.test(version.transactionType) ? 'endorse' : 'quote', policyId: policy.policyId, policyNumber: policy.policyNumber, versionId: version.versionId, transactionNumber: version.transactionNumber, effectiveDate: version.effectiveDate.slice(0, 10) })
    const detailsResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/policies/${policy.policyId}/versions/${version.versionId}/details`)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(`/wizard?${params}`)
    expect((await detailsResponse).status()).toBe(200)
    await expect(page.getByText('Loading saved quote', { exact: false })).toHaveCount(0)
    await page.getByRole('button', { name: /Forms & Documents/ }).click()
    const workspace = page.locator('.wizard-content section').filter({ has: page.getByRole('button', { name: 'Documents', exact: true }) })
    await expect(workspace).toContainText(`Pinned transaction ${details.transactionNumber}`)
    await expect(workspace).toContainText(`Version ${version.versionId}`)
    const formRows = workspace.locator('table tbody tr')
    if (details.forms.length) await expect(formRows).toHaveCount(details.forms.length)
    else await expect(workspace).toContainText('No pinned forms recorded for this transaction.')
    for (const [index, form] of details.forms.entries()) {
      const row = formRows.nth(index)
      await expect(row.getByRole('cell', { name: form.formNumber, exact: true })).toBeVisible()
      await expect(row.getByRole('cell', { name: form.formTitle || '-', exact: true })).toBeVisible()
      await expect(row.getByRole('cell', { name: form.editionDate || '-', exact: true })).toBeVisible()
    }
    await expect(workspace.getByRole('button', { name: 'View', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Bind|Issue|Generate documents)$/ })).toHaveCount(0)

    // Keep responsive evidence on one version to avoid redundant large attachments.
    if (snapshotIndex === 0) {
      for (const view of ['Forms', 'Documents']) {
        await workspace.getByRole('button', { name: view, exact: true }).click()
        for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
          await page.setViewportSize(viewport)
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${view} must not overflow the ${viewport.name} page`).toBeLessThanOrEqual(1)
          await testInfo.attach(`transaction-${view.toLowerCase()}-${viewport.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' })
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
    }

    await workspace.getByRole('button', { name: 'Documents', exact: true }).click()
    await expect(workspace).toContainText(`Transaction ${details.transactionNumber}`)
    await expect(workspace.locator('table tbody tr')).toHaveCount(details.documents.length)
    const firstContentRequest = contentRequests.length
    let openedCount = 0
    for (const doc of details.documents) {
      expect(doc).toMatchObject({ versionId: version.versionId, transactionId: version.transactionId })
      const format = formats[doc.contentType.split(';', 1)[0].trim().toLowerCase()] || 'Unknown format'
      const name = `${doc.displayName || doc.type}${doc.edition ? ` (${doc.edition})` : ''} - ${format}`
      const row = workspace.getByRole('row')
        .filter({ has: page.getByRole('cell', { name, exact: true }) })
        .filter({ has: page.getByRole('cell', { name: doc.stage, exact: true }) })
      await expect(row).toHaveCount(1)
      const action = row.getByRole('button')
      if (!doc.available || doc.status !== 'READY' || doc.integrityStatus !== 'VERIFIED' || !doc.byteSize) {
        await expect(action).toBeDisabled()
        continue
      }
      const native = format === 'DOCX' || format === 'XLSX'
      await expect(action).toHaveText(native ? 'Download' : 'View')
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/policies/${policy.policyId}/documents/${doc.documentId}/content`)
      const popupPromise = native ? null : page.waitForEvent('popup')
      const downloadPromise = native ? page.waitForEvent('download') : null
      await action.click()
      const response = await responsePromise
      expect(response.status()).toBe(200)
      const url = new URL(response.url())
      expect(url.searchParams.get('versionId')).toBe(version.versionId)
      expect(url.searchParams.get('transactionId')).toBe(version.transactionId)
      expect(response.headers()['content-type']).toContain(doc.contentType)
      const expectedHash = aggregate.documents.find(item => item.documentId === doc.documentId)?.contentHash
      expect(expectedHash).toMatch(/^[a-f0-9]{64}$/)
      // Chromium may expose an empty Playwright response body for popup/download
      // flows. Independently read the same scoped archive, then verify the UI blob.
      const archiveResponse = await request.get(url.toString(), {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant': tenantId },
      })
      expect(archiveResponse.status()).toBe(200)
      expect(archiveResponse.headers()['content-type']).toContain(doc.contentType)
      const archiveUrl = new URL(archiveResponse.url())
      expect(archiveUrl.pathname).toBe(url.pathname)
      expect(archiveUrl.searchParams.get('versionId')).toBe(version.versionId)
      expect(archiveUrl.searchParams.get('transactionId')).toBe(version.transactionId)
      const archiveBytes = await archiveResponse.body()
      expect(archiveBytes.byteLength).toBe(doc.byteSize)
      expect(createHash('sha256').update(archiveBytes).digest('hex')).toBe(expectedHash)
      await archiveResponse.dispose()
      await expect.poll(() => page.evaluate(() => (window as any).__transactionArchiveBlobs.length)).toBe(openedCount + 1)
      const blob = await page.evaluate(async index => {
        const value = (window as any).__transactionArchiveBlobs[index] as Blob
        const digest = await crypto.subtle.digest('SHA-256', await value.arrayBuffer())
        return { size: value.size, hash: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') }
      }, openedCount++)
      expect(blob).toEqual({ size: doc.byteSize, hash: expectedHash })
      if (downloadPromise) expect(await (await downloadPromise).failure()).toBeNull()
      if (popupPromise) {
        const popup = await popupPromise
        if (!popup.isClosed()) await popup.close()
      }
    }
    expect(openedCount, 'at least one ready archived output was opened').toBeGreaterThan(0)
    for (const url of contentRequests.slice(firstContentRequest)) {
      expect(url.searchParams.get('versionId')).toBe(version.versionId)
      expect(url.searchParams.get('transactionId')).toBe(version.transactionId)
      expect(details.documents.some(doc => url.pathname.endsWith(`/documents/${doc.documentId}/content`))).toBe(true)
    }
    expect(forbiddenRequests, 'historical views never preview current templates or regenerate documents').toEqual([])
  }
})
