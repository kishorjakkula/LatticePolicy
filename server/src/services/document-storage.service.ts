import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import puppeteer, { type Browser } from 'puppeteer'
import { logger } from '../logger.js'

// ── Rendering ────────────────────────────────────────────────────────────────
// Renders a policy document packet as a styled, print-ready HTML document and
// then rasterizes that HTML to a real PDF via a headless Chromium instance
// (Puppeteer). The HTML-building step below is kept as its own pure function
// (`renderPolicyPacketHtml`) so the content layer stays simple/testable and
// swappable independently of the rendering engine; the storage boundary at the
// bottom of this file is what a different renderer (or storage backend, e.g.
// S3/GCS) would plug into without changing callers.

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

function formatDisplayDate(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '-'
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!match) return raw
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const monthIndex = Number(match[2]) - 1
  const month = months[monthIndex] || match[2]
  return `${month} ${match[3]}, ${match[1]}`
}

function isIdCardForm(form: RenderablePacketForm): boolean {
  const haystack = `${form.code} ${form.title}`.toLowerCase()
  return /\bid[\s-]?card\b/.test(haystack)
}

// Shared print styling for every server-generated document. Declarations-page
// style layout: a letterhead-style header band, a labeled identity grid, and a
// clean bordered table — plus real `@page` print rules (margins, page-break
// control) so multi-page packets paginate the way a real policy packet should.
const DOCUMENT_PRINT_STYLES = `
  @page { size: letter; margin: 0.65in 0.6in 0.75in; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1c2538;
    margin: 0;
    font-size: 11pt;
    line-height: 1.45;
  }
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 3px solid #1f3a8a;
    padding-bottom: 12px;
    margin-bottom: 18px;
  }
  .letterhead .brand { font-size: 20pt; font-weight: 700; color: #1f3a8a; letter-spacing: 0.3px; }
  .letterhead .doc-title { font-size: 11pt; color: #55627f; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.08em; }
  .letterhead .meta { text-align: right; font-size: 9pt; color: #55627f; }
  h1 { font-size: 16pt; margin: 0 0 14px; color: #1c2538; }
  h2 {
    font-size: 11pt;
    margin: 22px 0 8px;
    color: #1f3a8a;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border-bottom: 1px solid #d6dfef;
    padding-bottom: 4px;
    page-break-after: avoid;
  }
  .identity-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px 28px;
    background: #f6f8fd;
    border: 1px solid #d6dfef;
    border-radius: 6px;
    padding: 14px 18px;
    page-break-inside: avoid;
  }
  .identity-grid .item { display: flex; justify-content: space-between; gap: 12px; font-size: 10pt; }
  .identity-grid .item strong { color: #55627f; font-weight: 600; }
  table.forms-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.forms-table th, table.forms-table td {
    border: 1px solid #d6dfef;
    padding: 7px 10px;
    font-size: 9.5pt;
    text-align: left;
    vertical-align: top;
  }
  table.forms-table th { background: #1f3a8a; color: #fff; font-weight: 600; }
  table.forms-table tr { page-break-inside: avoid; }
  table.forms-table tbody tr:nth-child(even) { background: #f6f8fd; }
  .id-card {
    border: 2px solid #1f3a8a;
    border-radius: 10px;
    padding: 14px 18px;
    margin: 10px 0;
    page-break-inside: avoid;
    background: #fdfefe;
  }
  .id-card .card-title { font-weight: 700; font-size: 10.5pt; color: #1f3a8a; margin-bottom: 8px; letter-spacing: 0.04em; }
  .id-card .card-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 20px; font-size: 9.5pt; }
  .id-card .card-grid strong { color: #55627f; font-weight: 600; margin-right: 4px; }
  .footer-note { margin-top: 26px; font-size: 8.5pt; color: #8089a0; }
`

function renderIdCardSection(metadata: RenderablePacketMetadata, form: RenderablePacketForm): string {
  return `<div class="id-card">
    <div class="card-title">AUTO INSURANCE IDENTIFICATION CARD — ${escapeHtml(form.code)}</div>
    <div class="card-grid">
      <div><strong>Policy:</strong> ${escapeHtml(metadata.policyNumber || metadata.policyId)}</div>
      <div><strong>Company:</strong> ${escapeHtml(metadata.productCode)}</div>
      <div><strong>Effective:</strong> ${escapeHtml(formatDisplayDate(metadata.effectiveDate))}</div>
      <div><strong>State:</strong> ${escapeHtml(metadata.state || '-')}</div>
    </div>
  </div>`
}

/**
 * Builds the print-ready HTML content for a policy document packet. This is
 * the content layer only — see `renderHtmlToPdf` for turning this into real
 * PDF bytes. Kept as a pure function (no I/O) so it stays trivially testable.
 */
export function renderPolicyPacketHtml(metadata: RenderablePacketMetadata): string {
  const rows = metadata.forms
    .map(
      (form) =>
        `<tr><td>${escapeHtml(form.code)}</td><td>${escapeHtml(form.title)}</td><td>${escapeHtml(form.edition || '')}</td><td>${escapeHtml(form.source)}</td></tr>`
    )
    .join('')
  const idCardSections = metadata.forms.filter(isIdCardForm).map((form) => renderIdCardSection(metadata, form)).join('')
  const policyLabel = escapeHtml(metadata.policyNumber || metadata.policyId)

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Policy Packet ${policyLabel}</title>
<style>${DOCUMENT_PRINT_STYLES}</style>
</head>
<body>
  <div class="letterhead">
    <div>
      <div class="brand">LatticePolicy</div>
      <div class="doc-title">Policy Document Packet</div>
    </div>
    <div class="meta">
      Generated: ${escapeHtml(metadata.generatedAt)}<br>
      Transaction: ${escapeHtml(metadata.transactionNumber || metadata.transactionId)}
    </div>
  </div>

  <h1>Policy ${policyLabel}</h1>

  <div class="identity-grid">
    <div class="item"><span>Transaction Type</span><strong>${escapeHtml(metadata.transactionType)}</strong></div>
    <div class="item"><span>Product</span><strong>${escapeHtml(metadata.productCode)}</strong></div>
    <div class="item"><span>Effective Date</span><strong>${escapeHtml(formatDisplayDate(metadata.effectiveDate))}</strong></div>
    <div class="item"><span>State</span><strong>${escapeHtml(metadata.state || '-')}</strong></div>
  </div>

  <h2>Attached Forms</h2>
  <table class="forms-table">
    <thead><tr><th>Code</th><th>Title</th><th>Edition</th><th>Source</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">No forms attached.</td></tr>'}</tbody>
  </table>

  ${idCardSections ? `<h2>Identification Cards</h2>${idCardSections}` : ''}

  <div class="footer-note">This document was generated automatically by LatticePolicy and is governed by the policy's terms and conditions.</div>
</body>
</html>`
}

// ── PDF rendering (Puppeteer) ───────────────────────────────────────────────
// Renders the HTML built above to real PDF bytes using a single shared,
// lazily-launched headless Chromium instance. Launching a browser process is
// expensive (hundreds of ms, a real OS process, a chunk of memory) so it is
// launched ONCE per server process and reused for every document — spawning a
// fresh browser per request is the #1 known Puppeteer production pitfall and
// would not scale. Each render gets its own short-lived `page` (cheap, just a
// tab) which is always closed, but the `browser` itself stays warm.
//
// `--no-sandbox` / `--disable-setuid-sandbox` are intentionally always-on,
// not a dev-only workaround: this is the standard, documented Puppeteer
// configuration for running headless Chromium inside a container (Docker
// runs the process as a user without the kernel privileges Chromium's own
// sandbox setup needs), and is exactly how `server/Dockerfile`'s runtime
// image is expected to run this. The same flags are harmless locally.
let browserPromise: Promise<Browser> | null = null

function launchOptions() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined
  return {
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  }
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch(launchOptions()).catch((err) => {
      browserPromise = null
      throw err
    })
  }
  return browserPromise
}

/**
 * Closes the shared Puppeteer browser instance, if one has been launched.
 * Intended for graceful server shutdown and test teardown — not part of the
 * normal request path.
 */
export async function closePdfRenderer(): Promise<void> {
  const pending = browserPromise
  browserPromise = null
  if (!pending) return
  const browser = await pending.catch(() => null)
  if (browser) {
    try {
      await browser.close()
    } catch (err) {
      logger.warn({ err }, 'Failed to close shared Puppeteer browser instance')
    }
  }
}

// Chromium's PDF printer stamps the PDF /Info dictionary's CreationDate and
// ModDate with the wall-clock time of the render, which is otherwise the only
// source of non-determinism in an identically-rendered PDF (verified: for the
// same HTML input, Chromium's PDF output is byte-identical apart from these
// two fields). The document-integrity model in this file (sha256 content hash
// + regenerate-and-compare) requires the *same* logical document to always
// hash the same, so both timestamp fields are normalized to a fixed,
// deterministic value derived from the document's own `generatedAt` metadata
// before hashing/storing. Both the matched text and its replacement always
// have the same fixed-width PDF date format, so this never changes the
// byte length of the file (which would corrupt the PDF's byte-offset xref
// table) — if that ever stopped holding for some input, the (length-checked)
// fallback below leaves the bytes untouched rather than risk corrupting the PDF.
const PDF_DATE_FIELD_PATTERN = /\/(CreationDate|ModDate) \(D:[^)]*\)/g

function toPdfDate(iso: string): string {
  const parsed = new Date(iso)
  const date = Number.isNaN(parsed.getTime()) ? new Date(0) : parsed
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+00'00'`
  )
}

function normalizePdfTimestamps(pdf: Buffer, generatedAt: string): Buffer {
  const fixedDate = toPdfDate(generatedAt)
  const text = pdf.toString('latin1')
  const normalized = text.replace(PDF_DATE_FIELD_PATTERN, (_match, field: string) => `/${field} (${fixedDate})`)
  // Safety net: only apply the normalization if it preserved every byte
  // offset after it (same overall length). If Chromium ever changes its PDF
  // date formatting in a way that breaks that assumption, skip normalization
  // rather than risk writing a corrupted PDF.
  if (normalized.length !== text.length) return pdf
  return Buffer.from(normalized, 'latin1')
}

/**
 * Renders HTML to PDF bytes via the shared headless Chromium instance, then
 * normalizes the embedded timestamps for determinism (see above).
 */
export async function renderHtmlToPdf(html: string, generatedAt: string): Promise<Buffer> {
  const browser = await getBrowser()
  const page = await browser.newPage()
  try {
    // The HTML rendered here is fully self-contained (no external resources,
    // fonts, or images), so waiting for the `load` event is sufficient and
    // avoids depending on network-idle heuristics that don't apply here.
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
    })
    return normalizePdfTimestamps(Buffer.from(pdf), generatedAt)
  } finally {
    await page.close()
  }
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
  const content = await renderHtmlToPdf(html, params.metadata.generatedAt)
  const contentType = 'application/pdf'
  const fileName = `${params.documentId}.pdf`
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

export async function retrieveAndVerifyStoredDocument(
  storageUri: string,
  expectedHash: string
): Promise<Buffer | null> {
  const content = await retrieveStoredDocument(storageUri)
  if (!content) return null
  return sha256Bytes(content) === expectedHash ? content : null
}

export async function regenerateAndVerifyDocument(params: {
  tenantId: string
  documentId: string
  metadata: RenderablePacketMetadata
  expectedHash: string
}): Promise<StoredDocumentDescriptor | null> {
  const artifact = await renderAndStoreDocument(params)
  return artifact.contentHash === params.expectedHash ? artifact : null
}
