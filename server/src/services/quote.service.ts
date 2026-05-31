import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { NotFoundError, BadRequestError, ValidationError } from '../errors/domain.errors.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { loadTenantAiMlConfig } from '../tenantAi.js'
import { inferQuoteAiInsights } from '../aiMl.js'
import { validateQuote } from '../contracts.js'
import { checkStateEligibility } from '../policyCompliance.js'
import { today, coerceDateOnly } from '../lib/date.utils.js'
import { csvEscape } from '../lib/utils.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuoteAuditValue = string | number
export type QuoteAuditEntry = {
  value: QuoteAuditValue
  updatedAt: string
  updatedBy: string
}

// ── Pure helpers (no Express, no store) ──────────────────────────────────────

export function generateQuoteNumber(): string {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `Q${stamp}-${rand}`
}

export function normalizeQuoteAuditHistory(raw: any): QuoteAuditEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((entry: any) => entry && entry.value != null)
    .map((entry: any) => ({
      value: typeof entry.value === 'number' ? entry.value : String(entry.value),
      updatedAt:
        typeof entry.updatedAt === 'string' && entry.updatedAt
          ? entry.updatedAt
          : new Date().toISOString(),
      updatedBy:
        typeof entry.updatedBy === 'string' && entry.updatedBy ? entry.updatedBy : 'system',
    }))
}

export function upsertQuoteAuditHistory(
  raw: any,
  value: QuoteAuditValue,
  updatedAt: string,
  updatedBy: string
): QuoteAuditEntry[] {
  const history = normalizeQuoteAuditHistory(raw)
  const key = typeof value === 'number' ? String(value) : String(value || '')
  const nextEntry: QuoteAuditEntry = { value, updatedAt, updatedBy }
  const index = history.findIndex((entry) => {
    if (typeof entry.value === 'number') return String(entry.value) === key
    return String(entry.value || '') === key
  })
  if (index >= 0) {
    history[index] = nextEntry
  } else {
    history.push(nextEntry)
  }
  return history
}

export { coerceDateOnly }

export function normalizeQuotePayload(rawPayload: any, fallbackEffectiveDate?: string): any {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {}
  const effectiveDate = coerceDateOnly(
    payload.effectiveDate || payload.transactionEffectiveDate || fallbackEffectiveDate,
    today()
  )
  payload.effectiveDate = effectiveDate
  payload.transactionEffectiveDate = effectiveDate
  return payload
}

export function clampStep(step: any): number {
  const n = Number(step)
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(7, Math.round(n)))
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Rate and create (or re-rate) a quote in the database.
 *
 * Returns the data needed to build the route response.
 */
export async function createOrRateQuote(
  db: DrizzleDB,
  tenantId: string,
  body: any,
  requestedQuoteId: string | null,
  updatedBy: string
): Promise<{
  quoteId: string
  quoteNumber: string | null
  premium: any
  aiInsights: any
  underwriting: any
  status: string
  progressStep: number
  updatedAt: string
  updatedBy: string
  statusHistory: QuoteAuditEntry[]
  stepHistory: QuoteAuditEntry[]
}> {
  // Validate
  const valid = validateQuote(body)
  if (!valid) {
    throw new ValidationError('INVALID_QUOTE', { message: 'Missing required fields' })
  }

  // State eligibility check (non-fatal — ignore if table not seeded)
  const productCode = body.productCode || ''
  const stateCode = body.state || ''
  if (productCode && stateCode) {
    try {
      const eligibility = await withTenantTx(tenantId, (innerDb) =>
        checkStateEligibility(toRawQuery(innerDb), tenantId, productCode, stateCode)
      )
      if (!eligibility.eligible) {
        throw new BadRequestError(
          'STATE_NOT_ELIGIBLE',
          eligibility.reason ||
            `Product '${productCode}' is not available in state '${stateCode}'.`
        )
      }
    } catch (err: any) {
      // Re-throw domain errors; swallow eligibility-table-not-found errors
      if (err?.code && typeof err.statusCode === 'number') throw err
    }
  }

  const premium = rate(tenantId, body)
  const uw = evaluateUW(tenantId, body)
  const aiMlConfig = await loadTenantAiMlConfig(tenantId)
  const aiInsights = inferQuoteAiInsights(aiMlConfig, {
    payload: body,
    premium,
    underwriting: uw,
  })

  let quoteId = requestedQuoteId || uuidv4()
  let quoteNumber: string | null = null
  const nowIso = new Date().toISOString()
  let stepHistory = upsertQuoteAuditHistory([], 5, nowIso, updatedBy)
  let statusHistory = upsertQuoteAuditHistory([], 'Rated', nowIso, updatedBy)

  await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)

    if (requestedQuoteId) {
      const existing = await q(
        'SELECT quote_number, status_history, step_history FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
        [tenantId, requestedQuoteId]
      )
      if (!(existing.rowCount ?? 0)) {
        throw new NotFoundError('QUOTE_NOT_FOUND')
      }
      quoteNumber = existing.rows[0].quote_number || generateQuoteNumber()
      statusHistory = upsertQuoteAuditHistory(existing.rows[0].status_history, 'Rated', nowIso, updatedBy)
      stepHistory = upsertQuoteAuditHistory(existing.rows[0].step_history, 5, nowIso, updatedBy)
      await q(
        'UPDATE quotes SET product_code=$1, effective_date=$2, term_months=$3, state=$4, payload=$5, underwriting=$6, premium=$7, ai_insights=$8, status=$9, progress_step=$10, quote_number=COALESCE(quote_number, $11), updated_at=$12, updated_by=$13, status_history=$14, step_history=$15 WHERE tenant_id=$16 AND quote_id=$17',
        [
          body.productCode,
          body.effectiveDate,
          body.termMonths,
          body.state || null,
          body,
          uw,
          premium,
          aiInsights,
          'Rated',
          5,
          quoteNumber,
          nowIso,
          updatedBy,
          JSON.stringify(statusHistory),
          JSON.stringify(stepHistory),
          tenantId,
          requestedQuoteId,
        ]
      )
      // Non-blocking AI event audit
      try {
        await q(
          'INSERT INTO ai_inference_events (tenant_id, quote_id, request_payload, response_payload, provider, model_version, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [
            tenantId,
            requestedQuoteId,
            JSON.stringify({ payload: body, premium, underwriting: uw }),
            JSON.stringify(aiInsights),
            aiInsights.provider,
            aiInsights.modelVersion,
            updatedBy,
          ]
        )
      } catch {
        // Non-blocking
      }
    } else {
      let attempts = 0
      while (attempts < 5) {
        quoteNumber = quoteNumber || generateQuoteNumber()
        try {
          await q(
            'INSERT INTO quotes (tenant_id, quote_id, quote_number, product_code, effective_date, term_months, state, payload, underwriting, premium, ai_insights, status, progress_step, updated_at, updated_by, status_history, step_history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
            [
              tenantId,
              quoteId,
              quoteNumber,
              body.productCode,
              body.effectiveDate,
              body.termMonths,
              body.state || null,
              body,
              uw,
              premium,
              aiInsights,
              'Rated',
              5,
              nowIso,
              updatedBy,
              JSON.stringify(statusHistory),
              JSON.stringify(stepHistory),
            ]
          )
          // Non-blocking AI event audit
          try {
            await q(
              'INSERT INTO ai_inference_events (tenant_id, quote_id, request_payload, response_payload, provider, model_version, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [
                tenantId,
                quoteId,
                JSON.stringify({ payload: body, premium, underwriting: uw }),
                JSON.stringify(aiInsights),
                aiInsights.provider,
                aiInsights.modelVersion,
                updatedBy,
              ]
            )
          } catch {
            // Non-blocking
          }
          break
        } catch (err: any) {
          if (err?.code === '23505') {
            quoteNumber = null
            attempts++
            continue
          }
          throw err
        }
      }
    }
  })

  return {
    quoteId,
    quoteNumber,
    premium,
    aiInsights,
    underwriting: uw,
    status: 'Rated',
    progressStep: 5,
    updatedAt: nowIso,
    updatedBy,
    statusHistory,
    stepHistory,
  }
}

/**
 * Retrieve a quote by ID from the database.
 *
 * Throws NotFoundError if the quote does not exist.
 */
export async function getQuote(
  db: DrizzleDB,
  tenantId: string,
  quoteId: string
): Promise<any> {
  const result = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      'SELECT * FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [tenantId, quoteId]
    )
  )
  const r: any = result
  if ((r.rowCount ?? 0) === 0) throw new NotFoundError('QUOTE_NOT_FOUND')
  const row = r.rows[0]
  return {
    quoteId: row.quote_id,
    quoteNumber: row.quote_number,
    productCode: row.product_code,
    effectiveDate: row.effective_date,
    termMonths: row.term_months,
    state: row.state,
    payload: row.payload,
    underwriting: row.underwriting,
    premium: row.premium,
    aiInsights: row.ai_insights || null,
    status: row.status,
    progressStep: row.progress_step,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || 'system',
    statusHistory: normalizeQuoteAuditHistory(row.status_history),
    stepHistory: normalizeQuoteAuditHistory(row.step_history),
    createdAt: row.created_at,
    convertedPolicyId: row.converted_policy_id,
  }
}

/**
 * Create a new draft quote in the database.
 *
 * Returns the data needed to build the route response.
 */
export async function createDraftQuote(
  db: DrizzleDB,
  tenantId: string,
  body: any,
  updatedBy: string
): Promise<{
  quoteId: string
  quoteNumber: string | null
  status: string
  progressStep: number
  updatedAt: string
  updatedBy: string
  statusHistory: QuoteAuditEntry[]
  stepHistory: QuoteAuditEntry[]
}> {
  const quoteId = uuidv4()
  const progressStep = clampStep(body.progressStep)
  const status = typeof body.status === 'string' ? body.status : 'Draft'
  const payload = normalizeQuotePayload(body.payload || {}, body.effectiveDate)
  const nowIso = new Date().toISOString()
  const stepHistory = upsertQuoteAuditHistory([], progressStep, nowIso, updatedBy)
  const statusHistory = upsertQuoteAuditHistory([], status, nowIso, updatedBy)
  let quoteNumber: string | null = null

  await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    let attempts = 0
    while (attempts < 5) {
      quoteNumber = generateQuoteNumber()
      try {
        await q(
          'INSERT INTO quotes (tenant_id, quote_id, quote_number, product_code, effective_date, term_months, state, payload, status, progress_step, created_at, updated_at, updated_by, status_history, step_history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14)',
          [
            tenantId,
            quoteId,
            quoteNumber,
            payload.productCode || body.productCode || null,
            payload.effectiveDate || body.effectiveDate || new Date().toISOString().slice(0, 10),
            payload.termMonths || body.termMonths || 12,
            payload.state || body.state || null,
            payload,
            status,
            progressStep,
            nowIso,
            updatedBy,
            JSON.stringify(statusHistory),
            JSON.stringify(stepHistory),
          ]
        )
        break
      } catch (err: any) {
        if (err?.code === '23505') {
          attempts++
          continue
        }
        throw err
      }
    }
    if (!quoteNumber) quoteNumber = generateQuoteNumber()
  })

  return { quoteId, quoteNumber, status, progressStep, updatedAt: nowIso, updatedBy, statusHistory, stepHistory }
}

/**
 * Update an existing draft quote in the database.
 *
 * Throws NotFoundError if the quote does not exist.
 * Returns the updated data needed to build the route response.
 */
export async function updateDraftQuote(
  db: DrizzleDB,
  tenantId: string,
  quoteId: string,
  body: any,
  updatedBy: string
): Promise<{
  quoteId: string
  quoteNumber: string | null
  status: string
  progressStep: number
  updatedAt: string
  updatedBy: string
  statusHistory: QuoteAuditEntry[]
  stepHistory: QuoteAuditEntry[]
  normalizedPayload: any | null
}> {
  const payload = body.payload || {}
  const hasPayload = Object.keys(payload).length > 0
  const normalizedPayload = hasPayload ? normalizeQuotePayload(payload, body.effectiveDate) : null
  const status = typeof body.status === 'string' ? body.status : undefined
  const progressStep = body.progressStep != null ? clampStep(body.progressStep) : undefined
  const nowIso = new Date().toISOString()

  const result: any = await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    const current: any = await q(
      'SELECT quote_number, payload, status, progress_step, status_history, step_history FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [tenantId, quoteId]
    )
    if (!current.rowCount) return null
    const row = current.rows[0]
    const nextStatus = status || row.status || 'Draft'
    const nextStep = progressStep != null ? progressStep : row.progress_step || 1
    const nextStatusHistory = upsertQuoteAuditHistory(row.status_history, nextStatus, nowIso, updatedBy)
    const nextStepHistory = upsertQuoteAuditHistory(row.step_history, nextStep, nowIso, updatedBy)
    const update: any = await q(
      'UPDATE quotes SET payload = COALESCE($3, payload), status = $4, progress_step = $5, updated_at=$6, updated_by=$7, status_history=$8, step_history=$9 WHERE tenant_id=$1 AND quote_id=$2 RETURNING quote_number, status, progress_step, status_history, step_history',
      [
        tenantId,
        quoteId,
        normalizedPayload,
        nextStatus,
        nextStep,
        nowIso,
        updatedBy,
        JSON.stringify(nextStatusHistory),
        JSON.stringify(nextStepHistory),
      ]
    )
    return update.rows[0]
  })

  if (!result) throw new NotFoundError('QUOTE_NOT_FOUND')

  return {
    quoteId,
    quoteNumber: result.quote_number,
    status: result.status,
    progressStep: result.progress_step,
    updatedAt: nowIso,
    updatedBy,
    statusHistory: normalizeQuoteAuditHistory(result.status_history),
    stepHistory: normalizeQuoteAuditHistory(result.step_history),
    normalizedPayload,
  }
}

// ── copyQuote ─────────────────────────────────────────────────────────────────

/**
 * Copy an existing quote, creating a new Draft at step 1.
 *
 * Fetches the source quote by ID, duplicates its core fields into a new row
 * with a fresh quoteId / quoteNumber, and resets status to Draft.
 */
export async function copyQuote(
  db: DrizzleDB,
  tenantId: string,
  quoteId: string,
  updatedBy: string
): Promise<{
  quoteId: string
  quoteNumber: string
}> {
  const nowIso = new Date().toISOString()
  const statusHistory = upsertQuoteAuditHistory([], 'Draft', nowIso, updatedBy)
  const stepHistory = upsertQuoteAuditHistory([], 1, nowIso, updatedBy)

  const result: any = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      'SELECT product_code, effective_date, term_months, state, payload FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [tenantId, quoteId]
    )
  )
  if (!result.rowCount) {
    throw new NotFoundError('QUOTE_NOT_FOUND')
  }

  const row = result.rows[0]
  const newId = uuidv4()
  const quoteNumber = generateQuoteNumber()
  const copyPayload = normalizeQuotePayload(row.payload, row.effective_date)

  await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      'INSERT INTO quotes (tenant_id, quote_id, quote_number, product_code, effective_date, term_months, state, payload, status, progress_step, created_at, updated_at, updated_by, status_history, step_history) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
      [
        tenantId,
        newId,
        quoteNumber,
        row.product_code,
        row.effective_date,
        row.term_months,
        row.state,
        copyPayload,
        'Draft',
        1,
        nowIso,
        nowIso,
        updatedBy,
        JSON.stringify(statusHistory),
        JSON.stringify(stepHistory),
      ]
    )
  )

  return { quoteId: newId, quoteNumber }
}

// ── listQuotes ────────────────────────────────────────────────────────────────

export interface ListQuotesFilters {
  q?: string
  product?: string
  status?: string
  dateFrom?: string
  dateTo?: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface ListQuotesResult {
  items: {
    quoteId: string
    quoteNumber: string | null
    productCode: string | null
    effectiveDate: string | null
    status: string
    progressStep: number
    updatedAt: string | null
    updatedBy: string
  }[]
  total: number
  page: number
  pageSize: number
}

/**
 * Paginated, filterable quote listing from the database.
 *
 * Builds dynamic WHERE clauses from the supplied filters, applies sorting
 * and pagination, and returns items together with the total count.
 */
export async function listQuotes(
  db: DrizzleDB,
  tenantId: string,
  filters: ListQuotesFilters
): Promise<ListQuotesResult> {
  const q = (filters.q || '').toLowerCase()
  const product = (filters.product || '').toLowerCase()
  const statusFilter = filters.status || ''
  const effFrom = filters.dateFrom || ''
  const effTo = filters.dateTo || ''
  const page = Math.max(1, filters.page || 1)
  const pageSize = Math.max(1, Math.min(100, filters.pageSize || 20))
  const sortBy = filters.sortBy || 'effectiveDate'
  const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'
  const hiddenQuoteStatuses = ['Converted', 'Issued']

  const clauses = ['tenant_id = $1']
  const params: any[] = [tenantId]
  let idx = 2

  clauses.push(`COALESCE(status, 'Draft') <> ALL($${idx}::text[])`)
  params.push(hiddenQuoteStatuses)
  idx++

  if (q) {
    clauses.push(
      '(LOWER(quote_number) LIKE $' + idx + ' OR CAST(quote_id AS text) LIKE $' + idx + ')'
    )
    params.push('%' + q + '%')
    idx++
  }
  if (product) {
    clauses.push('LOWER(product_code) = $' + idx)
    params.push(product)
    idx++
  }
  if (statusFilter) {
    clauses.push('status = $' + idx)
    params.push(statusFilter)
    idx++
  }
  if (effFrom) {
    clauses.push('effective_date >= $' + idx)
    params.push(effFrom)
    idx++
  }
  if (effTo) {
    clauses.push('effective_date <= $' + idx)
    params.push(effTo)
    idx++
  }

  const orderColumn =
    (
      {
        effectiveDate: 'effective_date',
        quoteNumber: 'quote_number',
        updatedAt: 'updated_at',
        productCode: 'product_code',
        status: 'status',
      } as Record<string, string>
    )[sortBy] || 'effective_date'
  const dir = sortDir === 'asc' ? 'asc' : 'desc'
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const offset = (page - 1) * pageSize

  const sql = `SELECT quote_id, quote_number, product_code, effective_date, status, progress_step, updated_at, updated_by FROM quotes ${where} ORDER BY ${orderColumn} ${dir} LIMIT ${pageSize} OFFSET ${offset}`
  const countSql = `SELECT COUNT(*) FROM quotes ${where}`

  const [rows, total] = await Promise.all([
    withTenantTx(tenantId, (innerDb) => toRawQuery(innerDb)(sql, params)),
    withTenantTx(tenantId, (innerDb) => toRawQuery(innerDb)(countSql, params)),
  ])

  const items = (rows as any).rows.map((row: any) => ({
    quoteId: row.quote_id,
    quoteNumber: row.quote_number,
    productCode: row.product_code,
    effectiveDate: row.effective_date,
    status: row.status,
    progressStep: row.progress_step,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || 'system',
  }))

  return { items, total: Number((total as any).rows[0].count), page, pageSize }
}

// ── exportQuotesCsv ───────────────────────────────────────────────────────────

/**
 * Export quotes as a CSV string from the database.
 *
 * Accepts the same filter shape as listQuotes (minus pagination) and returns
 * the full CSV content as a string so the route can set headers and send it.
 */
export async function exportQuotesCsv(
  db: DrizzleDB,
  tenantId: string,
  filters: Omit<ListQuotesFilters, 'page' | 'pageSize'>
): Promise<string> {
  const q = (filters.q || '').toLowerCase()
  const product = (filters.product || '').toLowerCase()
  const statusFilter = filters.status || ''
  const effFrom = filters.dateFrom || ''
  const effTo = filters.dateTo || ''
  const sortBy = filters.sortBy || 'effectiveDate'
  const sortDir = filters.sortDir === 'asc' ? 'asc' : 'desc'
  const hiddenQuoteStatuses = ['Converted', 'Issued']

  const clauses = ['tenant_id = $1']
  const params: any[] = [tenantId]
  let idx = 2

  clauses.push(`COALESCE(status, 'Draft') <> ALL($${idx}::text[])`)
  params.push(hiddenQuoteStatuses)
  idx++

  if (q) {
    clauses.push(
      '(LOWER(quote_number) LIKE $' + idx + ' OR CAST(quote_id AS text) LIKE $' + idx + ')'
    )
    params.push('%' + q + '%')
    idx++
  }
  if (product) {
    clauses.push('LOWER(product_code) = $' + idx)
    params.push(product)
    idx++
  }
  if (statusFilter) {
    clauses.push('status = $' + idx)
    params.push(statusFilter)
    idx++
  }
  if (effFrom) {
    clauses.push('effective_date >= $' + idx)
    params.push(effFrom)
    idx++
  }
  if (effTo) {
    clauses.push('effective_date <= $' + idx)
    params.push(effTo)
    idx++
  }

  const orderColumn =
    (
      {
        effectiveDate: 'effective_date',
        quoteNumber: 'quote_number',
        updatedAt: 'updated_at',
        productCode: 'product_code',
        status: 'status',
      } as Record<string, string>
    )[sortBy] || 'effective_date'
  const dir = sortDir === 'asc' ? 'asc' : 'desc'
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''

  const sql = `SELECT quote_id, product_code, effective_date FROM quotes ${where} ORDER BY ${orderColumn} ${dir}`

  const result: any = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(sql, params)
  )

  const header = ['id', 'productCode', 'effectiveDate']
  const rows = (result.rows as any[]).map((row: any) => [
    row.quote_id,
    row.product_code,
    row.effective_date,
  ])
  const csv = [header.join(','), ...rows.map((r: any[]) => r.map(csvEscape).join(','))].join('\n')
  return csv
}
