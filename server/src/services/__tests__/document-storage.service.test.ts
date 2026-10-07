import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LocalFileSystemDocumentStorageAdapter,
  closePdfRenderer,
  getDocumentStorageAdapter,
  renderAndStoreDocument,
  renderHtmlToPdf,
  renderPolicyPacketHtml,
  retrieveStoredDocument,
  retrieveAndVerifyStoredDocument,
  regenerateAndVerifyDocument,
  setDocumentStorageAdapter,
} from '../document-storage.service.js'

// PDF bytes start with this magic header regardless of content.
const PDF_MAGIC = '%PDF-'

describe('document storage service', () => {
  let tempDir: string
  let originalAdapter: ReturnType<typeof getDocumentStorageAdapter>

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lattice-doc-storage-test-'))
    originalAdapter = getDocumentStorageAdapter()
    setDocumentStorageAdapter(new LocalFileSystemDocumentStorageAdapter(tempDir))
  })

  afterEach(async () => {
    setDocumentStorageAdapter(originalAdapter)
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Closes the shared headless Chromium instance after this file's tests so
  // the vitest worker process can exit cleanly instead of hanging on an open
  // browser process.
  afterAll(async () => {
    await closePdfRenderer()
  })

  const baseMetadata = {
    policyId: 'policy-1',
    policyNumber: 'PA-2026-000001',
    transactionId: 'transaction-1',
    transactionType: 'NB',
    transactionNumber: 'NB-20260801-ABCD',
    productCode: 'personal-auto',
    state: 'CA',
    effectiveDate: '2026-08-01',
    generatedAt: '2026-08-01T00:00:00.000Z',
    forms: [{ code: 'PA-DEC', title: 'Declarations', edition: '2026-01-01', source: 'forms_admin', customerSafe: true }],
  }

  it('renders HTML that includes the policy/transaction identifiers and escapes untrusted text', () => {
    const html = renderPolicyPacketHtml(baseMetadata)
    expect(html).toContain('PA-2026-000001')
    expect(html).toContain('NB-20260801-ABCD')
    expect(html).toContain('PA-DEC')

    const escaped = renderPolicyPacketHtml({
      ...baseMetadata,
      policyNumber: '<script>alert(1)</script>',
    })
    expect(escaped).not.toContain('<script>alert(1)</script>')
    expect(escaped).toContain('&lt;script&gt;')
  })

  it('renders real PDF bytes via the shared headless browser, not an HTML stub', async () => {
    const html = renderPolicyPacketHtml(baseMetadata)
    const pdf = await renderHtmlToPdf(html, baseMetadata.generatedAt)
    expect(pdf.subarray(0, PDF_MAGIC.length).toString('latin1')).toBe(PDF_MAGIC)
    expect(pdf.length).toBeGreaterThan(500)
  })

  it('stores rendered content as a real PDF with a matching hash, content type, and byte size', async () => {
    const artifact = await renderAndStoreDocument({
      tenantId: 'sample-carrier',
      documentId: 'doc-1',
      metadata: baseMetadata,
    })

    expect(artifact.contentType).toBe('application/pdf')
    expect(artifact.storageAdapter).toBe('local-fs')
    expect(artifact.storageUri).toBe('local-fs://sample-carrier/doc-1.pdf')
    expect(artifact.byteSize).toBeGreaterThan(0)

    const stored = await retrieveStoredDocument(artifact.storageUri)
    expect(stored).not.toBeNull()
    expect(stored!.subarray(0, PDF_MAGIC.length).toString('latin1')).toBe(PDF_MAGIC)
    expect(stored!.length).toBe(artifact.byteSize)
    const actualHash = crypto.createHash('sha256').update(stored!).digest('hex')
    expect(actualHash).toBe(artifact.contentHash)
  })

  it('returns null when retrieving an unknown storage URI', async () => {
    const missing = await retrieveStoredDocument('local-fs://sample-carrier/does-not-exist.pdf')
    expect(missing).toBeNull()
    const wrongScheme = await retrieveStoredDocument('s3://bucket/key')
    expect(wrongScheme).toBeNull()
  })

  it('rejects stored bytes when the expected content hash does not match', async () => {
    const artifact = await renderAndStoreDocument({
      tenantId: 'sample-carrier', documentId: 'doc-integrity', metadata: baseMetadata,
    })
    expect(await retrieveAndVerifyStoredDocument(artifact.storageUri, artifact.contentHash)).not.toBeNull()
    expect(await retrieveAndVerifyStoredDocument(artifact.storageUri, '0'.repeat(64))).toBeNull()
  })

  it('regenerates byte-for-byte deterministic PDF content with the original hash, despite real wall-clock rendering', async () => {
    const first = await renderAndStoreDocument({
      tenantId: 'sample-carrier', documentId: 'doc-regenerate', metadata: baseMetadata,
    })
    const regenerated = await regenerateAndVerifyDocument({
      tenantId: 'sample-carrier', documentId: 'doc-regenerate', metadata: baseMetadata,
      expectedHash: first.contentHash,
    })
    expect(regenerated?.contentHash).toBe(first.contentHash)
    expect(await regenerateAndVerifyDocument({
      tenantId: 'sample-carrier', documentId: 'doc-regenerate', metadata: baseMetadata,
      expectedHash: '0'.repeat(64),
    })).toBeNull()
  })

  it('isolates artifacts per tenant', async () => {
    const a = await renderAndStoreDocument({
      tenantId: 'tenant-a',
      documentId: 'doc-shared-id',
      metadata: baseMetadata,
    })
    const b = await renderAndStoreDocument({
      tenantId: 'tenant-b',
      documentId: 'doc-shared-id',
      metadata: { ...baseMetadata, policyNumber: 'PA-2026-000002' },
    })
    expect(a.storageUri).not.toBe(b.storageUri)
    const contentA = await retrieveStoredDocument(a.storageUri)
    const contentB = await retrieveStoredDocument(b.storageUri)
    expect(contentA!.subarray(0, PDF_MAGIC.length).toString('latin1')).toBe(PDF_MAGIC)
    expect(contentB!.subarray(0, PDF_MAGIC.length).toString('latin1')).toBe(PDF_MAGIC)
    // Different policy numbers render to a different byte-for-byte document.
    expect(contentA!.equals(contentB!)).toBe(false)
  })

  it('normalizes embedded PDF timestamps so re-rendering the same metadata at a different wall-clock time still hashes identically', async () => {
    const pdfOne = await renderHtmlToPdf(renderPolicyPacketHtml(baseMetadata), baseMetadata.generatedAt)
    // A tiny real delay to prove this isn't passing by coincidence of identical timestamps.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const pdfTwo = await renderHtmlToPdf(renderPolicyPacketHtml(baseMetadata), baseMetadata.generatedAt)
    expect(pdfOne.equals(pdfTwo)).toBe(true)
  })
})
