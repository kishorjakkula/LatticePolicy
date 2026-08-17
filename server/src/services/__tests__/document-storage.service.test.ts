import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LocalFileSystemDocumentStorageAdapter,
  getDocumentStorageAdapter,
  renderAndStoreDocument,
  renderPolicyPacketHtml,
  retrieveStoredDocument,
  setDocumentStorageAdapter,
} from '../document-storage.service.js'

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

  it('stores rendered content with a matching hash, content type, and byte size', async () => {
    const artifact = await renderAndStoreDocument({
      tenantId: 'sample-carrier',
      documentId: 'doc-1',
      metadata: baseMetadata,
    })

    expect(artifact.contentType).toBe('text/html; charset=utf-8')
    expect(artifact.storageAdapter).toBe('local-fs')
    expect(artifact.storageUri).toBe('local-fs://sample-carrier/doc-1.html')
    expect(artifact.byteSize).toBeGreaterThan(0)

    const stored = await retrieveStoredDocument(artifact.storageUri)
    expect(stored).not.toBeNull()
    expect(stored!.length).toBe(artifact.byteSize)
    const actualHash = crypto.createHash('sha256').update(stored!).digest('hex')
    expect(actualHash).toBe(artifact.contentHash)
  })

  it('returns null when retrieving an unknown storage URI', async () => {
    const missing = await retrieveStoredDocument('local-fs://sample-carrier/does-not-exist.html')
    expect(missing).toBeNull()
    const wrongScheme = await retrieveStoredDocument('s3://bucket/key')
    expect(wrongScheme).toBeNull()
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
    expect(contentA!.toString('utf8')).toContain('PA-2026-000001')
    expect(contentB!.toString('utf8')).toContain('PA-2026-000002')
  })
})
