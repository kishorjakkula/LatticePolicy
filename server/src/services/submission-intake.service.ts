import { createHash } from 'node:crypto'
import { withTenantTx, toRawQuery } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { logger } from '../logger.js'
import { BadRequestError, ConflictError, NotFoundError, ValidationError } from '../errors/domain.errors.js'
import {
  contentTypeFor,
  documentKind,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS,
  readDocumentLines,
} from '../lib/intake/document-text.js'
import {
  buildExtractionCatalog,
  buildTargetFields,
  listIntakeProducts,
  PRODUCT_FIELD_KEY,
  COVERAGE_FIELD_PREFIX,
  QUALIFICATION_FIELD_PREFIX,
  RISK_FIELD_PREFIX,
  type IntakeTargetField,
} from '../lib/intake/target-fields.js'
import { normalizeFieldValue } from '../lib/intake/normalize.js'
import {
  createIntakeExtractor,
  readIntakeAiSettings,
  type Evidence,
  type ExtractionDocument,
  type ExtractionResult,
  type IntakeExtractor,
} from '../lib/intake/extractors.js'
import { createCustomerRecord, findPotentialMatches, loadCustomerSettings, normalizeCustomerInput, validateCustomerPayload } from '../routes/customers.routes.js'
import { insertDraftQuote } from './quote.service.js'
import { evaluateUW } from './uw.service.js'
import { getInstalledProductCapabilities } from '../lib/product-registry.js'

/**
 * Submission intake: AI drafts, a person confirms, approval completes.
 *
 * Lifecycle:
 *   RECEIVED → READING → READY_FOR_REVIEW → IN_REVIEW → COMPLETED
 *                     ↘ READ_FAILED (retry or review by hand)
 *   any open state → DECLINED
 *
 * Invariants:
 * - Extraction only writes proposals (submission_fields). It never touches
 *   customers, quotes, or policies.
 * - Approval requires every field confirmed by a person and an attestation,
 *   and creates the customer link and the draft quote in one transaction.
 *   If any step fails, nothing is created and the submission stays open.
 * - Every AI and human action is recorded in submission_events.
 */

type Q = (text: string, params?: any[]) => Promise<any>

export const SUBMISSION_STATUSES = ['RECEIVED', 'READING', 'READ_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW', 'COMPLETED', 'DECLINED'] as const
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number]
const REVIEWABLE: SubmissionStatus[] = ['READY_FOR_REVIEW', 'IN_REVIEW']
const READABLE: SubmissionStatus[] = ['RECEIVED', 'READ_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW']
const OPEN: SubmissionStatus[] = ['RECEIVED', 'READING', 'READ_FAILED', 'READY_FOR_REVIEW', 'IN_REVIEW']

export const SUBMISSION_EXTRACT_JOB = 'submission_extract'

/** A read that has not finished after this long is treated as abandoned and may be restarted. */
const STALE_READ_MS = 15 * 60 * 1000

export const APPROVAL_ATTESTATION = 'I checked the values against the source documents and approve creating the customer and draft quote.'

// ── Row mapping ───────────────────────────────────────────────────────────────

function iso(value: any): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : String(value)
}

function mapSubmission(row: any) {
  return {
    submissionId: row.submission_id,
    submissionNumber: row.submission_number,
    status: row.status as SubmissionStatus,
    channel: row.channel,
    subject: row.subject,
    brokerName: row.broker_name,
    brokerEmail: row.broker_email,
    insuredName: row.insured_name,
    productCode: row.product_code,
    notes: row.notes,
    assignedTo: row.assigned_to,
    aiRun: row.ai_run || {},
    customerChoice: row.customer_choice || {},
    readError: row.read_error,
    approvedBy: row.approved_by,
    approvedAt: iso(row.approved_at),
    attestation: row.attestation,
    declinedBy: row.declined_by,
    declinedAt: iso(row.declined_at),
    declineReason: row.decline_reason,
    customerId: row.customer_id,
    quoteId: row.quote_id,
    quoteNumber: row.quote_number,
    createdBy: row.created_by,
    receivedAt: iso(row.received_at),
    updatedAt: iso(row.updated_at),
  }
}

function mapField(row: any) {
  const value = row.value ?? ''
  const aiValue = row.ai_value ?? ''
  return {
    key: row.field_key,
    section: row.section,
    label: row.label,
    type: row.data_type,
    options: row.options || [],
    required: row.required === true,
    aiValue: row.ai_value,
    confidence: row.confidence,
    confidenceScore: row.confidence_score == null ? null : Number(row.confidence_score),
    evidence: row.evidence || [],
    alternatives: row.alternatives || [],
    reason: row.reason,
    value: row.value,
    status: row.status,
    edited: row.confidence !== 'conflict' && value !== aiValue,
    decidedBy: row.decided_by,
    decidedAt: iso(row.decided_at),
  }
}

export type SubmissionField = ReturnType<typeof mapField>

function mapDocument(row: any) {
  return {
    documentId: row.document_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    lines: row.text_lines || [],
    readableWithoutAi: row.readable_without_ai === true,
    createdAt: iso(row.created_at),
  }
}

async function recordEvent(q: Q, tenantId: string, submissionId: string, actorType: 'ai' | 'user' | 'system', actor: string | null, action: string, detail: Record<string, unknown> = {}) {
  await q(
    `INSERT INTO submission_events (tenant_id, submission_id, actor_type, actor, action, detail) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [tenantId, submissionId, actorType, actor, action, JSON.stringify(detail)]
  )
}

async function loadSubmissionRow(q: Q, tenantId: string, submissionId: string, lock = false) {
  const result = await q(
    `SELECT * FROM submissions WHERE tenant_id = $1 AND submission_id = $2${lock ? ' FOR UPDATE' : ''}`,
    [tenantId, submissionId]
  )
  const row = result.rows?.[0]
  if (!row) throw new NotFoundError('SUBMISSION_NOT_FOUND', 'Submission not found')
  return row
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function requireUuid(value: string, code = 'SUBMISSION_NOT_FOUND'): string {
  if (!isUuid(value)) throw new NotFoundError(code, 'Submission not found')
  return value
}

function submissionNumber(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = Math.floor(Math.random() * 36 ** 4).toString(36).toUpperCase().padStart(4, '0')
  return `SUB-${date}-${suffix}`
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** What the UI shows about the reader in use. Never includes secrets. */
export function getIntakeSettings() {
  const ai = readIntakeAiSettings()
  return {
    provider: ai.provider,
    model: ai.model,
    label: ai.label,
    configured: ai.configured,
    problem: ai.problem,
    readsPdfAndImages: ai.provider === 'anthropic',
    sendsDocumentsOffStack: ai.provider === 'anthropic',
    maxDocuments: MAX_DOCUMENTS,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    products: listIntakeProducts(),
    attestation: APPROVAL_ATTESTATION,
  }
}

// ── Create ────────────────────────────────────────────────────────────────────

export type CreateSubmissionInput = {
  channel?: string
  subject?: string
  brokerName?: string
  brokerEmail?: string
  notes?: string
  productCode?: string
  documents: Array<{ fileName: string; contentType?: string; dataBase64: string }>
}

function cleanText(value: unknown, max = 500): string | null {
  const text = String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

export async function createSubmission(tenantId: string, actor: string, input: CreateSubmissionInput) {
  const documents = Array.isArray(input?.documents) ? input.documents : []
  if (!documents.length) throw new BadRequestError('NO_DOCUMENTS', 'Add at least one document or email.')
  if (documents.length > MAX_DOCUMENTS) throw new BadRequestError('TOO_MANY_DOCUMENTS', `A submission can have at most ${MAX_DOCUMENTS} documents.`)
  const productCode = cleanText(input.productCode, 100)
  if (productCode && !listIntakeProducts().some((product) => product.code === productCode)) {
    throw new BadRequestError('UNKNOWN_PRODUCT', `Product ${productCode} is not installed.`)
  }

  const prepared = [] as Array<{ fileName: string; contentType: string; buffer: Buffer; sha256: string; lines: string[]; readable: boolean }>
  for (const document of documents) {
    const fileName = cleanText(document?.fileName, 200)
    if (!fileName) throw new BadRequestError('INVALID_DOCUMENT', 'Every document needs a file name.')
    if (documentKind(fileName) === 'unsupported') {
      throw new BadRequestError('UNSUPPORTED_DOCUMENT', `${fileName}: this file type is not supported. Use PDF, image, email (.eml), Word (.docx), Excel (.xlsx), CSV, or text.`)
    }
    const data = String(document?.dataBase64 || '').replace(/^data:[^,]*,/, '')
    if (!data || !/^[A-Za-z0-9+/=\s]+$/.test(data)) throw new BadRequestError('INVALID_DOCUMENT', `${fileName}: the file content is not valid base64.`)
    const buffer = Buffer.from(data, 'base64')
    if (!buffer.length) throw new BadRequestError('INVALID_DOCUMENT', `${fileName} is empty.`)
    if (buffer.length > MAX_DOCUMENT_BYTES) throw new BadRequestError('DOCUMENT_TOO_LARGE', `${fileName} is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB.`)
    const { lines, readable } = await readDocumentLines(fileName, buffer)
    prepared.push({
      fileName,
      contentType: contentTypeFor(fileName),
      buffer,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      lines,
      readable,
    })
  }

  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    let row: any = null
    for (let attempt = 0; attempt < 5 && !row; attempt++) {
      const inserted = await q(
        `INSERT INTO submissions (tenant_id, submission_number, channel, subject, broker_name, broker_email, notes, product_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tenant_id, submission_number) DO NOTHING
         RETURNING *`,
        [
          tenantId,
          submissionNumber(),
          cleanText(input.channel, 40) || 'upload',
          cleanText(input.subject, 300),
          cleanText(input.brokerName, 200),
          cleanText(input.brokerEmail, 200),
          cleanText(input.notes, 4000),
          productCode,
          actor,
        ]
      )
      row = inserted.rows?.[0] || null
    }
    if (!row) throw new Error('Could not allocate a submission number')
    for (const document of prepared) {
      await q(
        `INSERT INTO submission_documents (tenant_id, submission_id, file_name, content_type, size_bytes, sha256, content, text_lines, readable_without_ai)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [tenantId, row.submission_id, document.fileName, document.contentType, document.buffer.length, document.sha256, document.buffer, JSON.stringify(document.lines), document.readable]
      )
    }
    await recordEvent(q, tenantId, row.submission_id, 'user', actor, 'received', {
      channel: row.channel,
      documents: prepared.map((document) => ({ fileName: document.fileName, sizeBytes: document.buffer.length, sha256: document.sha256 })),
    })
    return mapSubmission(row)
  })
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function listSubmissions(tenantId: string, options: { status?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, Number(options.page) || 1)
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 25))
  const status = options.status && (SUBMISSION_STATUSES as readonly string[]).includes(options.status) ? options.status : null
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const rows = await q(
      `SELECT s.*,
              COALESCE(f.total, 0)::int AS field_total,
              COALESCE(f.confirmed, 0)::int AS field_confirmed,
              COALESCE(f.attention, 0)::int AS field_attention,
              COALESCE(f.conflicts, 0)::int AS field_conflicts,
              COALESCE(d.documents, 0)::int AS document_count,
              COUNT(*) OVER()::int AS total_count
         FROM submissions s
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE status = 'accepted') AS confirmed,
                  COUNT(*) FILTER (WHERE status = 'pending' AND confidence <> 'high') AS attention,
                  COUNT(*) FILTER (WHERE status = 'pending' AND confidence = 'conflict') AS conflicts
             FROM submission_fields sf WHERE sf.tenant_id = s.tenant_id AND sf.submission_id = s.submission_id
         ) f ON true
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS documents FROM submission_documents sd WHERE sd.tenant_id = s.tenant_id AND sd.submission_id = s.submission_id
         ) d ON true
        WHERE s.tenant_id = $1 AND ($2::text IS NULL OR s.status = $2)
        ORDER BY s.received_at DESC
        LIMIT $3 OFFSET $4`,
      [tenantId, status, pageSize, (page - 1) * pageSize]
    )
    const counts = await q(`SELECT status, COUNT(*)::int AS count FROM submissions WHERE tenant_id = $1 GROUP BY status`, [tenantId])
    const items = (rows.rows || []).map((row: any) => ({
      ...mapSubmission(row),
      fieldTotal: row.field_total,
      fieldConfirmed: row.field_confirmed,
      fieldAttention: row.field_attention,
      fieldConflicts: row.field_conflicts,
      documentCount: row.document_count,
    }))
    const statusCounts: Record<string, number> = {}
    for (const row of counts.rows || []) statusCounts[row.status] = row.count
    return { items, total: rows.rows?.[0]?.total_count || 0, page, pageSize, statusCounts }
  })
}

export async function getSubmission(tenantId: string, submissionId: string) {
  requireUuid(submissionId)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadSubmissionRow(q, tenantId, submissionId)
    const documents = await q(
      `SELECT document_id, file_name, content_type, size_bytes, sha256, text_lines, readable_without_ai, created_at
         FROM submission_documents WHERE tenant_id = $1 AND submission_id = $2 ORDER BY created_at, file_name`,
      [tenantId, submissionId]
    )
    const fields = await q(
      `SELECT * FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 ORDER BY sort_order, field_key`,
      [tenantId, submissionId]
    )
    const events = await q(
      `SELECT actor_type, actor, action, detail, created_at FROM submission_events
        WHERE tenant_id = $1 AND submission_id = $2 ORDER BY created_at, event_id`,
      [tenantId, submissionId]
    )
    return {
      ...mapSubmission(row),
      documents: (documents.rows || []).map(mapDocument) as Array<ReturnType<typeof mapDocument>>,
      fields: (fields.rows || []).map(mapField) as SubmissionField[],
      events: (events.rows || []).map((event: any) => ({
        actorType: event.actor_type as 'ai' | 'user' | 'system',
        actor: event.actor as string | null,
        action: event.action as string,
        detail: (event.detail || {}) as Record<string, any>,
        createdAt: iso(event.created_at),
      })) as Array<{ actorType: 'ai' | 'user' | 'system'; actor: string | null; action: string; detail: Record<string, any>; createdAt: string | null }>,
    }
  })
}

export async function getSubmissionDocument(tenantId: string, submissionId: string, documentId: string) {
  requireUuid(submissionId)
  requireUuid(documentId, 'DOCUMENT_NOT_FOUND')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `SELECT file_name, content_type, content FROM submission_documents WHERE tenant_id = $1 AND submission_id = $2 AND document_id = $3`,
      [tenantId, submissionId, documentId]
    )
    const row = result.rows?.[0]
    if (!row) throw new NotFoundError('DOCUMENT_NOT_FOUND', 'Document not found')
    return { fileName: row.file_name as string, contentType: row.content_type as string, content: row.content as Buffer }
  })
}

// ── Reading (extraction) ──────────────────────────────────────────────────────

export type ExtractionScheduler = (job: { tenantId: string; submissionId: string; runToken: string; productHint: string | null }) => Promise<void>

/**
 * Marks the submission as being read and hands the work to `schedule`
 * (a job queue or an in-process runner). A read that is already running is
 * not started twice; one abandoned for 15 minutes can be restarted.
 */
export async function startReading(
  tenantId: string,
  submissionId: string,
  actor: string,
  options: { productHint?: string | null; schedule: ExtractionScheduler }
) {
  requireUuid(submissionId)
  const productHint = cleanText(options.productHint, 100)
  if (productHint && !listIntakeProducts().some((product) => product.code === productHint)) {
    throw new BadRequestError('UNKNOWN_PRODUCT', `Product ${productHint} is not installed.`)
  }
  const settings = readIntakeAiSettings()
  if (!settings.configured) throw new BadRequestError('AI_NOT_CONFIGURED', settings.problem || 'The AI model is not configured.')
  const runToken = uuidv4()
  await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadSubmissionRow(q, tenantId, submissionId, true)
    const startedAt = Date.parse(row.ai_run?.startedAt || '')
    const stale = row.status === 'READING' && (!Number.isFinite(startedAt) || Date.now() - startedAt > STALE_READ_MS)
    if (row.status === 'READING' && !stale) throw new ConflictError('ALREADY_READING', 'The documents are already being read.')
    if (!READABLE.includes(row.status) && !stale) throw new ConflictError('NOT_READABLE', `A ${row.status.toLowerCase().replace(/_/g, ' ')} submission cannot be read again.`)
    const confirmed = await q(`SELECT COUNT(*)::int AS count FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 AND status = 'accepted'`, [tenantId, submissionId])
    const aiRun = { runToken, provider: settings.provider, model: settings.model, label: settings.label, startedAt: new Date().toISOString(), productHint }
    await q(
      `UPDATE submissions SET status = 'READING', read_error = NULL, ai_run = $3::jsonb, updated_at = now() WHERE tenant_id = $1 AND submission_id = $2`,
      [tenantId, submissionId, JSON.stringify(aiRun)]
    )
    await recordEvent(q, tenantId, submissionId, 'user', actor, 'reading_requested', {
      reader: settings.label,
      productHint,
      discardsConfirmedValues: Number(confirmed.rows?.[0]?.count || 0),
    })
  })
  await options.schedule({ tenantId, submissionId, runToken, productHint })
  return { submissionId, status: 'READING' as const, runToken }
}

function fieldRowsFromResult(result: ExtractionResult, targets: IntakeTargetField[]) {
  const values = new Map(result.values.map((value) => [value.key, value]))
  const conflicts = new Map(result.conflicts.map((conflict) => [conflict.key, conflict]))
  return targets.map((field, index) => {
    if (field.key === PRODUCT_FIELD_KEY) {
      return {
        field, index,
        aiValue: result.productCode,
        confidence: result.productCode ? result.productConfidence : 'missing',
        score: result.productCode ? result.productScore : null,
        evidence: [] as Evidence[],
        alternatives: [] as any[],
        reason: result.productReason || null,
      }
    }
    const conflict = conflicts.get(field.key)
    if (conflict) {
      return {
        field, index,
        aiValue: null,
        confidence: 'conflict',
        score: null as number | null,
        evidence: conflict.options.map((option) => option.evidence),
        alternatives: conflict.options.map((option) => ({ value: option.value, ...option.evidence })),
        reason: conflict.reason,
      }
    }
    const value = values.get(field.key)
    if (value) {
      return { field, index, aiValue: value.value, confidence: value.confidence, score: value.score as number | null, evidence: value.evidence, alternatives: [], reason: value.reason }
    }
    return { field, index, aiValue: null, confidence: 'missing', score: null as number | null, evidence: [], alternatives: [], reason: 'Not found in the documents.' }
  })
}

async function writeFieldRows(q: Q, tenantId: string, submissionId: string, rows: ReturnType<typeof fieldRowsFromResult>) {
  for (const row of rows) {
    await q(
      `INSERT INTO submission_fields (tenant_id, submission_id, field_key, section, label, data_type, options, required, sort_order, ai_value, confidence, evidence, alternatives, reason, value, status, confidence_score)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$10,'pending',$15)`,
      [
        tenantId, submissionId, row.field.key, row.field.section, row.field.label, row.field.type,
        JSON.stringify(row.field.options), row.field.required, row.index, row.aiValue, row.confidence,
        JSON.stringify(row.evidence), JSON.stringify(row.alternatives), row.reason, row.score ?? null,
      ]
    )
  }
}

/**
 * Runs the extractor for one scheduled read. Called by the job worker or the
 * in-process runner. A run whose token no longer matches (a newer read was
 * started) is discarded without writing anything.
 */
export async function runExtraction(
  job: { tenantId: string; submissionId: string; runToken: string; productHint: string | null },
  extractor: IntakeExtractor = createIntakeExtractor()
): Promise<{ outcome: 'drafted' | 'failed' | 'superseded' }> {
  const { tenantId, submissionId, runToken } = job
  const loaded = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadSubmissionRow(q, tenantId, submissionId)
    if (row.status !== 'READING' || row.ai_run?.runToken !== runToken) return null
    const documents = await q(
      `SELECT document_id, file_name, content_type, content, text_lines FROM submission_documents WHERE tenant_id = $1 AND submission_id = $2 ORDER BY created_at, file_name`,
      [tenantId, submissionId]
    )
    return { row, documents: documents.rows || [] }
  })
  if (!loaded) return { outcome: 'superseded' }

  const documents: ExtractionDocument[] = loaded.documents.map((document: any) => ({
    documentId: document.document_id,
    fileName: document.file_name,
    contentType: document.content_type,
    kind: documentKind(document.file_name),
    lines: document.text_lines || [],
    content: document.content,
  }))
  const readable = documents.filter((document) => extractor.canRead(document.kind))
  const productHint = job.productHint || null

  let result: ExtractionResult | null = null
  let failure: string | null = null
  if (!readable.length) {
    failure = `${extractor.label} cannot read these documents (PDF or image). Turn on an AI model for intake, or enter the values by hand.`
  } else {
    try {
      result = await extractor.extract({ documents: readable, catalog: buildExtractionCatalog(tenantId), productHint, notes: loaded.row.notes })
    } catch (err: any) {
      failure = String(err?.message || err).slice(0, 1000)
      logger.warn({ tenantId, submissionId, err: failure }, '[intake] extraction failed')
    }
  }

  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadSubmissionRow(q, tenantId, submissionId, true)
    if (row.status !== 'READING' || row.ai_run?.runToken !== runToken) return { outcome: 'superseded' as const }
    const finishedAt = new Date().toISOString()
    if (!result) {
      await q(
        `UPDATE submissions SET status = 'READ_FAILED', read_error = $3, ai_run = ai_run || $4::jsonb, updated_at = now() WHERE tenant_id = $1 AND submission_id = $2`,
        [tenantId, submissionId, failure, JSON.stringify({ finishedAt })]
      )
      await recordEvent(q, tenantId, submissionId, 'ai', extractor.label, 'reading_failed', { error: failure })
      return { outcome: 'failed' as const }
    }
    const productCode = result.productCode
    const targets = buildTargetFields(productCode, tenantId)
    const rows = fieldRowsFromResult(result, targets)
    await q(`DELETE FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2`, [tenantId, submissionId])
    await writeFieldRows(q, tenantId, submissionId, rows)
    const counts = {
      fields: rows.length,
      drafted: rows.filter((item) => item.aiValue).length,
      high: rows.filter((item) => item.confidence === 'high').length,
      needsAttention: rows.filter((item) => item.confidence !== 'high').length,
      conflicts: rows.filter((item) => item.confidence === 'conflict').length,
      missing: rows.filter((item) => item.confidence === 'missing').length,
      averageScore: (() => {
        const scores = rows.map((item) => item.score).filter((score): score is number => typeof score === 'number')
        return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
      })(),
    }
    const unread = documents.filter((document) => !extractor.canRead(document.kind)).map((document) => document.fileName)
    const warnings = [...result.warnings]
    if (unread.length) warnings.push(`Not read (needs an AI model): ${unread.join(', ')}`)
    const insuredName = result.values.find((value) => value.key === 'insuredName')?.value || null
    await q(
      `UPDATE submissions
          SET status = 'READY_FOR_REVIEW', read_error = NULL, product_code = $3, insured_name = COALESCE($4, insured_name),
              ai_run = ai_run || $5::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND submission_id = $2`,
      [
        tenantId, submissionId, productCode, insuredName,
        JSON.stringify({ finishedAt, summary: result.summary, productReason: result.productReason, warnings, counts, documentsRead: readable.length, documentsTotal: documents.length }),
      ]
    )
    await recordEvent(q, tenantId, submissionId, 'ai', extractor.label, 'drafted', { ...counts, productCode, documentsRead: readable.length })
    return { outcome: 'drafted' as const }
  })
}

// ── Review ────────────────────────────────────────────────────────────────────

async function loadReviewable(q: Q, tenantId: string, submissionId: string) {
  const row = await loadSubmissionRow(q, tenantId, submissionId, true)
  if (!REVIEWABLE.includes(row.status)) {
    throw new ConflictError('NOT_IN_REVIEW', `This submission is ${row.status.toLowerCase().replace(/_/g, ' ')} and cannot be changed.`)
  }
  return row
}

async function markInReview(q: Q, tenantId: string, row: any, actor: string) {
  if (row.status === 'READY_FOR_REVIEW' || !row.assigned_to) {
    await q(
      `UPDATE submissions SET status = 'IN_REVIEW', assigned_to = COALESCE(assigned_to, $3), updated_at = now() WHERE tenant_id = $1 AND submission_id = $2`,
      [tenantId, row.submission_id, actor]
    )
  } else {
    await q(`UPDATE submissions SET updated_at = now() WHERE tenant_id = $1 AND submission_id = $2`, [tenantId, row.submission_id])
  }
}

export type FieldUpdate = { action: 'set' | 'accept' | 'undo'; value?: string | null }

/**
 * A reviewer changes one drafted value: edits it (`set`), confirms it
 * (`accept`, optionally with a final value), or takes a confirmation back
 * (`undo`). Values are checked against the field's type, so what is
 * approved is what the quote can store.
 */
export async function updateSubmissionField(tenantId: string, submissionId: string, fieldKey: string, actor: string, update: FieldUpdate) {
  requireUuid(submissionId)
  const action = update?.action
  if (action !== 'set' && action !== 'accept' && action !== 'undo') throw new BadRequestError('INVALID_ACTION', 'action must be set, accept, or undo')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadReviewable(q, tenantId, submissionId)
    const fieldResult = await q(`SELECT * FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 AND field_key = $3 FOR UPDATE`, [tenantId, submissionId, fieldKey])
    const field = fieldResult.rows?.[0]
    if (!field) throw new NotFoundError('FIELD_NOT_FOUND', 'Field not found')

    if (action === 'undo') {
      await q(`UPDATE submission_fields SET status = 'pending', decided_by = NULL, decided_at = NULL WHERE tenant_id = $1 AND submission_id = $2 AND field_key = $3`, [tenantId, submissionId, fieldKey])
      await recordEvent(q, tenantId, submissionId, 'user', actor, 'value_unconfirmed', { field: fieldKey })
      await markInReview(q, tenantId, row, actor)
      return getFieldAfterUpdate(q, tenantId, submissionId, fieldKey)
    }

    let value: string = field.value ?? ''
    if (update.value !== undefined) {
      const raw = String(update.value ?? '').trim()
      if (raw) {
        const normalized = normalizeFieldValue({ key: field.field_key, type: field.data_type, options: field.options || [] }, raw)
        if (!normalized.ok) {
          throw new ValidationError('INVALID_VALUE', { field: fieldKey, message: invalidValueMessage(field) })
        }
        value = normalized.value
      } else {
        value = ''
      }
    }
    if (action === 'accept' && field.required && !value) {
      throw new ValidationError('VALUE_REQUIRED', { field: fieldKey, message: `${field.label} is required. Enter a value before confirming.` })
    }
    if (action === 'accept' && field.confidence === 'conflict' && !value) {
      throw new ValidationError('CHOOSE_VALUE', { field: fieldKey, message: `The documents disagree on ${field.label}. Choose or enter a value first.` })
    }

    const productChanged = field.field_key === PRODUCT_FIELD_KEY && value !== (field.value ?? '')
    if (action === 'accept') {
      await q(
        `UPDATE submission_fields SET value = $4, status = 'accepted', decided_by = $5, decided_at = now() WHERE tenant_id = $1 AND submission_id = $2 AND field_key = $3`,
        [tenantId, submissionId, fieldKey, value || null, actor]
      )
    } else {
      // Editing a confirmed value takes the confirmation back: it must be confirmed again.
      await q(
        `UPDATE submission_fields SET value = $4, status = 'pending', decided_by = NULL, decided_at = NULL WHERE tenant_id = $1 AND submission_id = $2 AND field_key = $3`,
        [tenantId, submissionId, fieldKey, value || null]
      )
    }
    if (productChanged) await replaceProductFields(q, tenantId, submissionId, value)
    await recordEvent(q, tenantId, submissionId, 'user', actor, action === 'accept' ? 'value_confirmed' : 'value_edited', {
      field: fieldKey,
      aiValue: field.ai_value,
      value: value || null,
      changedFromAi: field.confidence !== 'conflict' && (value || '') !== (field.ai_value || ''),
    })
    await markInReview(q, tenantId, row, actor)
    return getFieldAfterUpdate(q, tenantId, submissionId, fieldKey)
  })
}

function invalidValueMessage(field: any): string {
  if (field.field_key === 'state' || field.field_key === 'addressState') return `${field.label} must be a US state, like OH or Ohio.`
  if (field.data_type === 'date') return `${field.label} must be a date, like 2026-12-01 or 12/01/2026.`
  if (field.data_type === 'number') return `${field.label} must be a number.`
  if (field.data_type === 'select') return `${field.label} must be one of: ${(field.options || []).join(', ')}.`
  return `${field.label} is not valid.`
}

async function getFieldAfterUpdate(q: Q, tenantId: string, submissionId: string, fieldKey: string) {
  const result = await q(`SELECT * FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 AND field_key = $3`, [tenantId, submissionId, fieldKey])
  return mapField(result.rows[0])
}

/**
 * The reviewer chose a different product: its risk and qualification fields replace the old
 * ones, empty and unconfirmed. The reviewer can then re-read the documents
 * for that product or fill them in.
 */
async function replaceProductFields(q: Q, tenantId: string, submissionId: string, productCode: string) {
  await q(
    `DELETE FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 AND (field_key LIKE $3 OR field_key LIKE $4)`,
    [tenantId, submissionId, `${RISK_FIELD_PREFIX}%`, `${QUALIFICATION_FIELD_PREFIX}%`]
  )
  const base = 1000
  const fields = buildTargetFields(productCode, tenantId)
    .filter(field => field.key.startsWith(RISK_FIELD_PREFIX) || field.key.startsWith(QUALIFICATION_FIELD_PREFIX))
  const rows = fields.map((field, index) => ({
    field, index: base + index, aiValue: null, confidence: 'missing', score: null as number | null, evidence: [] as Evidence[], alternatives: [] as any[],
    reason: 'Product changed by the reviewer; re-read the documents or enter this value.',
  }))
  await writeFieldRows(q, tenantId, submissionId, rows)
  await q(`UPDATE submissions SET product_code = $3 WHERE tenant_id = $1 AND submission_id = $2`, [tenantId, submissionId, productCode || null])
}

/** Confirms every pending high-confidence value that has a value. Returns how many. */
export async function acceptHighConfidence(tenantId: string, submissionId: string, actor: string) {
  requireUuid(submissionId)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadReviewable(q, tenantId, submissionId)
    const result = await q(
      `UPDATE submission_fields SET status = 'accepted', decided_by = $3, decided_at = now()
        WHERE tenant_id = $1 AND submission_id = $2 AND status = 'pending' AND confidence = 'high'
          AND value IS NOT NULL AND value <> '' AND value = ai_value
        RETURNING field_key`,
      [tenantId, submissionId, actor]
    )
    const keys = (result.rows || []).map((item: any) => item.field_key)
    if (keys.length) {
      await recordEvent(q, tenantId, submissionId, 'user', actor, 'high_confidence_confirmed', { count: keys.length, fields: keys })
      await markInReview(q, tenantId, row, actor)
    }
    return { accepted: keys.length }
  })
}

export async function setCustomerChoice(tenantId: string, submissionId: string, actor: string, choice: { mode: 'new' | 'existing'; customerId?: string | null }) {
  requireUuid(submissionId)
  const mode = choice?.mode
  if (mode !== 'new' && mode !== 'existing') throw new BadRequestError('INVALID_CHOICE', 'mode must be new or existing')
  const customerId = mode === 'existing' ? String(choice.customerId || '') : null
  if (mode === 'existing' && !isUuid(customerId || '')) throw new BadRequestError('INVALID_CHOICE', 'customerId is required to use an existing customer')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadReviewable(q, tenantId, submissionId)
    let customer: any = null
    if (customerId) {
      const found = await q(`SELECT customer_id, customer_key, display_name FROM customers WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, customerId])
      customer = found.rows?.[0]
      if (!customer) throw new NotFoundError('CUSTOMER_NOT_FOUND', 'Customer not found')
    }
    const value = customer ? { mode, customerId, customerKey: customer.customer_key, displayName: customer.display_name } : { mode: 'new' }
    await q(`UPDATE submissions SET customer_choice = $3::jsonb WHERE tenant_id = $1 AND submission_id = $2`, [tenantId, submissionId, JSON.stringify(value)])
    await recordEvent(q, tenantId, submissionId, 'user', actor, 'customer_choice', value)
    await markInReview(q, tenantId, row, actor)
    return value
  })
}

// ── Underwriting companies ────────────────────────────────────────────────────

export type UnderwritingCompanyOption = { companyId: string; name: string }

/** Active underwriting companies that write this product in this state, as the quote wizard offers them. */
async function underwritingCompaniesFor(q: Q, tenantId: string, productCode: string | undefined, state: string | undefined): Promise<UnderwritingCompanyOption[]> {
  if (!productCode || !state) return []
  const result = await q(
    `SELECT company_id, name FROM underwriting_companies
      WHERE tenant_id = $1 AND active = true AND product_code = $2 AND country_code = 'US' AND (state_code = $3 OR state_code = 'ALL')
      ORDER BY name`,
    [tenantId, productCode, state]
  )
  const seen = new Set<string>()
  return (result.rows || [])
    .filter((row: any) => (seen.has(row.company_id) ? false : (seen.add(row.company_id), true)))
    .map((row: any) => ({ companyId: String(row.company_id), name: String(row.name) }))
}

// ── Checks (carrier rules, not AI) ────────────────────────────────────────────

function fieldValues(fields: SubmissionField[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const field of fields) if (field.value) out[field.key] = field.value
  return out
}

function splitPersonName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] }
}

export function buildCustomerInput(values: Record<string, string>) {
  const isCompany = values.insuredType !== 'person'
  const name = values.insuredName || ''
  const contactPoints: any[] = []
  if (values.email) contactPoints.push({ contactType: 'EMAIL', value: values.email, preferred: true })
  if (values.phone) contactPoints.push({ contactType: 'PHONE', value: values.phone, preferred: !values.email })
  const addresses: any[] = []
  if (values.addressLine1) {
    addresses.push({
      addressType: 'MAILING',
      line1: values.addressLine1,
      city: values.city || '',
      state: values.addressState || values.state || '',
      postalCode: values.postalCode || '',
      country: 'US',
      primary: true,
    })
  }
  return normalizeCustomerInput({
    entityType: isCompany ? 'COMPANY' : 'INDIVIDUAL',
    status: 'ACTIVE',
    identity: isCompany
      ? { company: { legalName: name, fein: values.fein || '' } }
      : { person: { ...splitPersonName(name), dob: values.insuredDob || '' } },
    contactPoints,
    addresses,
  })
}

function coerceRiskValue(field: SubmissionField, value: string): unknown {
  if (field.type === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  return value
}

/** The draft quote payload the wizard opens, built only from confirmed values. */
export function buildQuotePayload(
  submission: { submissionId: string; submissionNumber: string },
  fields: SubmissionField[],
  customer: { customerId: string; customerKey: string | null } | null,
  approval: { approvedBy: string; approvedAt: string } | null,
  company: UnderwritingCompanyOption | null = null
) {
  const values = fieldValues(fields)
  const isCompany = values.insuredType !== 'person'
  const name = values.insuredName || ''
  const person = isCompany ? { firstName: name, lastName: '' } : splitPersonName(name)
  // Structural defaults the product needs on every risk (such as its risk
  // `type`), but never a default for a field the reviewer saw: those values
  // come only from the approved submission.
  const reviewedRiskKeys = new Set(fields.filter((field) => field.key.startsWith(RISK_FIELD_PREFIX)).map((field) => field.key.slice(RISK_FIELD_PREFIX.length)))
  const defaultRisk = (values.productCode ? getInstalledProductCapabilities(values.productCode)?.defaultRisk : null) || {}
  const risk: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(defaultRisk)) {
    if (!reviewedRiskKeys.has(key)) risk[key] = value
  }
  for (const field of fields) {
    if (field.key.startsWith(RISK_FIELD_PREFIX) && field.value) risk[field.key.slice(RISK_FIELD_PREFIX.length)] = coerceRiskValue(field, field.value)
  }
  if (isCompany && name && !('businessName' in risk) && fields.some((field) => field.key === `${RISK_FIELD_PREFIX}businessName`)) risk.businessName = name
  // Coverages the submission asked for; the wizard applies the product's
  // defaults to the rest.
  const coverageMap = new Map<string, Record<string, unknown>>()
  for (const field of fields) {
    if (!field.key.startsWith(COVERAGE_FIELD_PREFIX) || !field.value) continue
    const [code, attribute] = field.key.slice(COVERAGE_FIELD_PREFIX.length).split('.')
    if (!code || !attribute) continue
    const entry: Record<string, unknown> = coverageMap.get(code) || { code, selected: true }
    if (attribute === 'selected') {
      if (field.value === 'no') entry.selected = false
    } else {
      const number = Number(String(field.value).replace(/[$,%\s]/g, ''))
      entry[attribute] = /^\d[\d,]*(\.\d+)?$/.test(String(field.value).replace(/[$,%\s]/g, '')) && Number.isFinite(number) ? number : field.value
    }
    coverageMap.set(code, entry)
  }
  const coverages = Array.from(coverageMap.values()).filter((entry) => entry.selected !== false)
  const qualificationAnswers: Record<string, string> = {}
  for (const field of fields) {
    if (field.key.startsWith(QUALIFICATION_FIELD_PREFIX)) qualificationAnswers[field.key.slice(QUALIFICATION_FIELD_PREFIX.length)] = field.value === 'yes' || field.value === 'no' ? field.value : ''
  }
  return {
    productCode: values.productCode,
    effectiveDate: values.effectiveDate,
    termMonths: 12,
    country: 'US',
    state: values.state,
    priorCarrier: values.priorCarrier || '',
    priorPolicyNumber: values.priorPolicyNumber || '',
    priorExpirationDate: values.priorExpirationDate || '',
    yearsWithPriorCarrier: values.yearsWithPriorCarrier || '',
    billingMethod: values.billingMethod || '',
    paymentPlan: values.paymentPlan || '',
    mailingAddress: { street: values.addressLine1 || '', city: values.city || '', state: values.addressState || '', zip: values.postalCode || '' },
    additionalInterests: values.interestName
      ? [{ role: values.interestRole || (values.productCode === 'homeowners' ? 'MORTGAGEE' : values.productCode?.includes('auto') ? 'LOSS_PAYEE' : 'ADDITIONAL_INTEREST'), name: values.interestName, loanNumber: values.interestLoanNumber || '', street: values.interestAddress || '', city: '', state: '', zip: '' }]
      : [],
    underwritingCompanyId: company?.companyId || '',
    underwritingCompanyName: company?.name || '',
    qualificationAnswers,
    // The wizard reads qualification answers back from uwAnswers.
    uwAnswers: { ...qualificationAnswers },
    applicant: { firstName: person.firstName, lastName: person.lastName, email: values.email || '' },
    insureds: {
      primary: {
        firstName: person.firstName,
        lastName: person.lastName,
        dob: isCompany ? '' : values.insuredDob || '',
        prefix: '',
        displayName: name,
        email: values.email || '',
        phone: values.phone || '',
        customerId: customer?.customerId || '',
        customerKey: customer?.customerKey || '',
        address: { street: values.addressLine1 || '', city: values.city || '', state: values.addressState || '', zip: values.postalCode || '' },
      },
      secondary: { firstName: '', lastName: '', dob: '', prefix: '', displayName: '', email: '', phone: '', customerId: '', customerKey: '', address: { street: '', city: '', state: '', zip: '' } },
      additional: [],
    },
    risks: [risk],
    coverages,
    intake: {
      submissionId: submission.submissionId,
      submissionNumber: submission.submissionNumber,
      approvedBy: approval?.approvedBy || null,
      approvedAt: approval?.approvedAt || null,
    },
  }
}

/**
 * Checks shown beside the review. They use the carrier's own rules and data,
 * not the AI: duplicate customers and open submissions (clearance), the
 * product's underwriting rules on the current values (appetite), and which
 * required values are still missing.
 */
export async function getSubmissionChecks(tenantId: string, submissionId: string) {
  const submission = await getSubmission(tenantId, submissionId)
  const values = fieldValues(submission.fields)
  const missingRequired = submission.fields.filter((field) => field.required && !field.value).map((field) => ({ key: field.key, label: field.label }))
  const unconfirmed = submission.fields.filter((field) => field.status !== 'accepted').length

  let underwritingCompanies: UnderwritingCompanyOption[] = []
  const clearance = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    let customerMatches: any[] = []
    let newCustomerProblems: string[] = []
    if (values.insuredName) {
      const input = buildCustomerInput(values)
      customerMatches = await findPotentialMatches(q, tenantId, input, null)
      // What would stop a new customer being created from these values, so the
      // reviewer can fix it before approving rather than at approval.
      const validation = validateCustomerPayload(input, (await loadCustomerSettings(q, tenantId)).validation)
      newCustomerProblems = validation.valid ? [] : validation.errors
    }
    const openSubmissions = values.insuredName
      ? (await q(
        `SELECT submission_id, submission_number, status, received_at FROM submissions
          WHERE tenant_id = $1 AND submission_id <> $2 AND lower(insured_name) = lower($3) AND status = ANY($4::text[])
          ORDER BY received_at DESC LIMIT 5`,
        [tenantId, submissionId, values.insuredName, OPEN]
      )).rows || []
      : []
    underwritingCompanies = await underwritingCompaniesFor(q, tenantId, values.productCode, values.state)
    return {
      customerMatches: customerMatches.slice(0, 5).map((match: any) => ({
        customerId: match.customerId,
        customerKey: match.customerKey,
        displayName: match.displayName,
        status: match.status,
        matchScore: match.matchScore,
        reasons: match.reasons,
      })),
      openSubmissions: openSubmissions.map((item: any) => ({ submissionId: item.submission_id, submissionNumber: item.submission_number, status: item.status, receivedAt: iso(item.received_at) })),
      newCustomerProblems,
    }
  })

  let appetite: { decision: string; reasons: string[]; evaluated: boolean; note?: string } = { decision: 'Unknown', reasons: [], evaluated: false }
  if (values.productCode && values.state && values.effectiveDate) {
    try {
      const payload = buildQuotePayload(submission, submission.fields, null, null)
      const decision = await evaluateUW(tenantId, payload)
      appetite = { decision: decision.decision, reasons: decision.reasons, evaluated: true }
    } catch (err: any) {
      appetite = { decision: 'Unknown', reasons: [], evaluated: false, note: `Rules could not run on the current values: ${String(err?.message || err).slice(0, 200)}` }
    }
  } else {
    appetite.note = 'Runs once product, state, and effective date have values.'
  }

  const usesNewCustomer = submission.customerChoice?.mode !== 'existing'
  return {
    clearance,
    appetite,
    missingRequired,
    unconfirmed,
    underwritingCompanies,
    readyToApprove: REVIEWABLE.includes(submission.status) && unconfirmed === 0 && missingRequired.length === 0
      && !(usesNewCustomer && clearance.newCustomerProblems.length) && underwritingCompanies.length > 0,
  }
}

// ── Approve and decline ───────────────────────────────────────────────────────

/**
 * The human approval gate. Everything after it runs in one transaction:
 * link or create the customer, create the draft quote from the confirmed
 * values, and close the submission. Any failure rolls all of it back.
 */
export async function approveSubmission(tenantId: string, submissionId: string, actor: string, input: { attestation?: boolean; underwritingCompanyId?: string }) {
  requireUuid(submissionId)
  if (input?.attestation !== true) {
    throw new ValidationError('ATTESTATION_REQUIRED', { message: 'Confirm that you checked the values against the documents.' })
  }
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadReviewable(q, tenantId, submissionId)
    const fieldResult = await q(`SELECT * FROM submission_fields WHERE tenant_id = $1 AND submission_id = $2 ORDER BY sort_order, field_key`, [tenantId, submissionId])
    const fields = (fieldResult.rows || []).map(mapField)
    if (!fields.length) throw new ValidationError('NOTHING_TO_APPROVE', { message: 'There are no values to approve. Read the documents first.' })
    const pending = fields.filter((field: SubmissionField) => field.status !== 'accepted')
    if (pending.length) {
      throw new ValidationError('UNCONFIRMED_VALUES', { message: `${pending.length} value(s) are not confirmed yet.`, fields: pending.map((field: SubmissionField) => field.key) })
    }
    const missing = fields.filter((field: SubmissionField) => field.required && !field.value)
    if (missing.length) {
      throw new ValidationError('REQUIRED_VALUES_MISSING', { message: `Required values are missing: ${missing.map((field: SubmissionField) => field.label).join(', ')}.`, fields: missing.map((field: SubmissionField) => field.key) })
    }
    const values = fieldValues(fields)
    if (!listIntakeProducts().some((product) => product.code === values.productCode)) {
      throw new ValidationError('UNKNOWN_PRODUCT', { message: `Product ${values.productCode} is not installed.` })
    }

    // The quote needs the company that will write it, chosen from those that
    // write this product in this state; with only one, it is used.
    const companies = await underwritingCompaniesFor(q, tenantId, values.productCode, values.state)
    if (!companies.length) {
      throw new ValidationError('NO_UNDERWRITING_COMPANY', { message: `No active underwriting company writes ${values.productCode} in ${values.state}. An administrator must set one up first.` })
    }
    const requestedCompany = String(input?.underwritingCompanyId || '').trim()
    const company = requestedCompany ? companies.find((item) => item.companyId === requestedCompany) : companies.length === 1 ? companies[0] : null
    if (!company) {
      throw new ValidationError(requestedCompany ? 'UNKNOWN_UNDERWRITING_COMPANY' : 'UNDERWRITING_COMPANY_REQUIRED', {
        message: requestedCompany ? 'That underwriting company does not write this product in this state.' : 'Choose the underwriting company.',
      })
    }

    const choice = row.customer_choice || {}
    let customer: { customerId: string; customerKey: string | null }
    let customerAction: 'customer_linked' | 'customer_created'
    if (choice.mode === 'existing' && choice.customerId) {
      const found = await q(`SELECT customer_id, customer_key FROM customers WHERE tenant_id = $1 AND customer_id = $2`, [tenantId, choice.customerId])
      if (!found.rows?.[0]) throw new ValidationError('CUSTOMER_NOT_FOUND', { message: 'The chosen existing customer no longer exists.' })
      customer = { customerId: found.rows[0].customer_id, customerKey: found.rows[0].customer_key }
      customerAction = 'customer_linked'
    } else {
      let created: { customer: any; potentialMatches: any[] }
      try {
        created = await createCustomerRecord(q, { tenantId, payload: buildCustomerInput(values), actor, reason: 'SUBMISSION_INTAKE', createAnyway: false })
      } catch (err: any) {
        throw new ValidationError('CUSTOMER_INVALID', { message: `The customer could not be created: ${String(err?.message || err)}` })
      }
      if (created.potentialMatches.length) {
        throw new ConflictError('POTENTIAL_DUPLICATE', 'This insured may already be a customer. Choose the existing customer, or ask an administrator to create a new one.', {
          potentialMatches: created.potentialMatches.slice(0, 5),
        })
      }
      customer = { customerId: created.customer.customerId, customerKey: created.customer.customerKey || null }
      customerAction = 'customer_created'
    }

    const approvedAt = new Date().toISOString()
    const payload = buildQuotePayload(mapSubmission(row), fields, customer, { approvedBy: actor, approvedAt }, company)
    // Step 4 of the wizard (risk details) so the user continues with coverages and rating.
    const quote = await insertDraftQuote(q, tenantId, { payload, status: 'Draft', progressStep: 4 }, actor)

    await q(
      `UPDATE submissions
          SET status = 'COMPLETED', approved_by = $3, approved_at = $4, attestation = $5,
              customer_id = $6, quote_id = $7, quote_number = $8, insured_name = $9, product_code = $10, updated_at = now()
        WHERE tenant_id = $1 AND submission_id = $2`,
      [tenantId, submissionId, actor, approvedAt, APPROVAL_ATTESTATION, customer.customerId, quote.quoteId, quote.quoteNumber, values.insuredName, values.productCode]
    )
    const edited = fields.filter((field: SubmissionField) => field.edited).map((field: SubmissionField) => field.key)
    await recordEvent(q, tenantId, submissionId, 'user', actor, 'approved', { attestation: APPROVAL_ATTESTATION, values: fields.length, changedFromAi: edited })
    await recordEvent(q, tenantId, submissionId, 'system', 'LatticePolicy', customerAction, customer)
    await recordEvent(q, tenantId, submissionId, 'system', 'LatticePolicy', 'quote_created', { quoteId: quote.quoteId, quoteNumber: quote.quoteNumber, productCode: values.productCode, underwritingCompany: company.name })
    return { submissionId, status: 'COMPLETED' as const, customerId: customer.customerId, customerAction, quoteId: quote.quoteId, quoteNumber: quote.quoteNumber }
  })
}

export async function declineSubmission(tenantId: string, submissionId: string, actor: string, input: { reason?: string }) {
  requireUuid(submissionId)
  const reason = cleanText(input?.reason, 1000)
  if (!reason) throw new ValidationError('REASON_REQUIRED', { message: 'Give a reason for declining.' })
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const row = await loadSubmissionRow(q, tenantId, submissionId, true)
    if (!OPEN.includes(row.status)) throw new ConflictError('NOT_OPEN', 'Only an open submission can be declined.')
    await q(
      `UPDATE submissions SET status = 'DECLINED', declined_by = $3, declined_at = now(), decline_reason = $4, updated_at = now() WHERE tenant_id = $1 AND submission_id = $2`,
      [tenantId, submissionId, actor, reason]
    )
    await recordEvent(q, tenantId, submissionId, 'user', actor, 'declined', { reason })
    return { submissionId, status: 'DECLINED' as const }
  })
}
