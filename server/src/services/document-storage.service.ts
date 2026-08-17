import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'

// ── Rendering ────────────────────────────────────────────────────────────────
// Renders a policy document packet as a simple, dependency-free HTML artifact.
// This is intentionally template-based rather than a real PDF pipeline; the
// storage boundary below is what a future richer renderer (e.g. PDF) would
// plug into without changing callers.

export type RenderablePacketForm = {
  code: string
  title: string
  edition: string | null
  source: string
  customerSafe: boolean
}

export type RenderablePacketMetadata = {
  policyId: string
  policyNumber?: string | null
  transactionId: string
  transactionType: string
  transactionNumber?: string | null
  productCode: string
  state?: string | null
  effectiveDate: string
  generatedAt: string
  forms: RenderablePacketForm[]
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function renderPolicyPacketHtml(metadata: RenderablePacketMetadata): string {
  const rows = metadata.forms
    .map(
      (form) =>
        `<tr><td>${escapeHtml(form.code)}</td><td>${escapeHtml(form.title)}</td><td>${escapeHtml(form.edition || '')}</td><td>${escapeHtml(form.source)}</td></tr>`
    )
    .join('')
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Policy Packet ${escapeHtml(metadata.policyNumber || metadata.policyId)}</title></head>
<body>
<h1>Policy Document Packet</h1>
<p>Policy: ${escapeHtml(metadata.policyNumber || metadata.policyId)}</p>
<p>Transaction: ${escapeHtml(metadata.transactionNumber || metadata.transactionId)} (${escapeHtml(metadata.transactionType)})</p>
<p>Product: ${escapeHtml(metadata.productCode)} ${metadata.state ? `— ${escapeHtml(metadata.state)}` : ''}</p>
<p>Effective Date: ${escapeHtml(metadata.effectiveDate)}</p>
<p>Generated At: ${escapeHtml(metadata.generatedAt)}</p>
<table border="1" cellpadding="4" cellspacing="0">
<thead><tr><th>Code</th><th>Title</th><th>Edition</th><th>Source</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`
}

// ── Storage adapter boundary ────────────────────────────────────────────────
// Any adapter implementing this interface can be swapped in via
// `setDocumentStorageAdapter`. A production deployment would add a
// cloud/object-storage adapter (e.g. S3, GCS, Azure Blob) implementing the
// same `store`/`retrieve` contract; only the adapter changes, not callers.

export type StoredDocumentDescriptor = {
  storageUri: string
  contentType: string
  byteSize: number
  contentHash: string
  storageAdapter: string
  renderedAt: string
}

export interface DocumentStorageAdapter {
  readonly name: string
  store(params: {
    tenantId: string
    documentId: string
    fileName: string
    contentType: string
    content: Buffer
  }): Promise<{ storageUri: string }>
  retrieve(storageUri: string): Promise<Buffer | null>
}

function sha256Bytes(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

// Local filesystem adapter — used for local development and testing so a
// generated packet has a real, retrievable artifact without any external
// dependency. Not intended for multi-node production use.
export class LocalFileSystemDocumentStorageAdapter implements DocumentStorageAdapter {
  readonly name = 'local-fs'

  constructor(private readonly baseDir: string) {}

  private tenantDir(tenantId: string): string {
    return path.join(this.baseDir, tenantId.replace(/[^a-zA-Z0-9_-]/g, '_'))
  }

  async store(params: {
    tenantId: string
    documentId: string
    fileName: string
    contentType: string
    content: Buffer
  }): Promise<{ storageUri: string }> {
    const dir = this.tenantDir(params.tenantId)
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, params.fileName)
    await fs.writeFile(filePath, params.content)
    return { storageUri: `local-fs://${params.tenantId}/${params.fileName}` }
  }

  async retrieve(storageUri: string): Promise<Buffer | null> {
    if (!storageUri.startsWith('local-fs://')) return null
    const rest = storageUri.slice('local-fs://'.length)
    const [tenantId, ...fileNameParts] = rest.split('/')
    const fileName = fileNameParts.join('/')
    if (!tenantId || !fileName) return null
    const filePath = path.join(this.tenantDir(tenantId), fileName)
    try {
      return await fs.readFile(filePath)
    } catch {
      return null
    }
  }
}

function defaultBaseDir(): string {
  return process.env.DOCUMENT_STORAGE_DIR || path.join(os.tmpdir(), 'lattice-policy-documents')
}

let activeAdapter: DocumentStorageAdapter = new LocalFileSystemDocumentStorageAdapter(defaultBaseDir())

export function setDocumentStorageAdapter(adapter: DocumentStorageAdapter): void {
  activeAdapter = adapter
}

export function getDocumentStorageAdapter(): DocumentStorageAdapter {
  return activeAdapter
}

export async function renderAndStoreDocument(params: {
  tenantId: string
  documentId: string
  metadata: RenderablePacketMetadata
}): Promise<StoredDocumentDescriptor> {
  const html = renderPolicyPacketHtml(params.metadata)
  const content = Buffer.from(html, 'utf8')
  const contentType = 'text/html; charset=utf-8'
  const fileName = `${params.documentId}.html`
  const { storageUri } = await getDocumentStorageAdapter().store({
    tenantId: params.tenantId,
    documentId: params.documentId,
    fileName,
    contentType,
    content,
  })
  return {
    storageUri,
    contentType,
    byteSize: content.length,
    contentHash: sha256Bytes(content),
    storageAdapter: getDocumentStorageAdapter().name,
    renderedAt: new Date().toISOString(),
  }
}

export async function retrieveStoredDocument(storageUri: string): Promise<Buffer | null> {
  return getDocumentStorageAdapter().retrieve(storageUri)
}
