import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { csvEscape } from '../lib/utils.js'
import { BadRequestError, NotFoundError } from '../errors/domain.errors.js'

export const BORDEREAU_TYPES = ['RISK', 'PREMIUM', 'TRANSACTION', 'CANCELLATION', 'CORRECTION', 'CLAIMS_REFERENCE_HANDOFF'] as const
export type BordereauType = (typeof BORDEREAU_TYPES)[number]

export function assertValidBordereauType(value: string) {
  if (!BORDEREAU_TYPES.includes(value as BordereauType)) {
    throw new BadRequestError('BORDEREAUX_INVALID_TYPE', `bordereauType must be one of ${BORDEREAU_TYPES.join(', ')}`)
  }
}

export interface BordereauRowCandidate {
  policyId: string | null
  transactionId: string | null
  policyNumber: string | null
  data: Record<string, unknown>
}

export interface RowValidationResult {
  isValid: boolean
  errors: string[]
}

/**
 * Required-field/data-quality validation for a single bordereau row, shared
 * across bordereau types. Pure function — no DB access — so it is unit
 * testable and reusable by a future generation path (e.g. a scheduled job)
 * without re-deriving the rule set.
 */
export function validateBordereauRow(type: BordereauType, row: BordereauRowCandidate): RowValidationResult {
  const errors: string[] = []
  if (!row.policyId) errors.push('policyId is required')
  if (!row.policyNumber) errors.push('policyNumber is required')
  const d = row.data

  if (type === 'RISK') {
    if (!d.riskUnitId) errors.push('riskUnitId is required')
    if (!d.riskKind) errors.push('riskKind is required')
    if (!d.effectiveDate) errors.push('effectiveDate is required')
  } else {
    // PREMIUM, TRANSACTION, CANCELLATION, CORRECTION, CLAIMS_REFERENCE_HANDOFF
    // all key off a policy transaction/version.
    if (!row.transactionId) errors.push('transactionId is required')
    if (!d.transactionType) errors.push('transactionType is required')
    if (!d.effectiveDate) errors.push('effectiveDate is required')
    if (type === 'PREMIUM' || type === 'TRANSACTION') {
      if (d.premiumTotal === null || d.premiumTotal === undefined) errors.push('premiumTotal is required')
    }
    if (type === 'CANCELLATION' && !d.cancellationReasonCode) {
      errors.push('cancellationReasonCode is required for a cancellation bordereau row')
    }
    if (type === 'CLAIMS_REFERENCE_HANDOFF' && !d.claimReference) {
      errors.push('claimReference is required for a claims-reference-handoff bordereau row')
    }
  }

  return { isValid: errors.length === 0, errors }
}

export interface GenerateBordereauInput {
  bordereauType: BordereauType
  periodStart: string
  periodEnd: string
  productCode?: string | null
  programName?: string | null
  recipientName?: string | null
  treatyId?: string | null
  generatedBy?: string | null
  correctsBatchId?: string | null
}

export interface GeneratedBatchSummary {
  batchId: string
  bordereauType: BordereauType
  status: string
  rowCount: number
  validRowCount: number
  invalidRowCount: number
  version: number
  correctsBatchId: string | null
}

async function loadReinsurancePlacement(
  q: ReturnType<typeof toRawQuery>,
  tenantId: string,
  policyId: string,
  transactionId: string | null
): Promise<{ treatyId: string | null; cededPercent: number | null; retainedPercent: number | null } | null> {
  if (!transactionId) return null
  const result = await q(
    `SELECT treaty_id, ceded_percent, retained_percent FROM policy_reinsurance_placements
      WHERE tenant_id = $1 AND policy_id = $2 AND transaction_id = $3
      ORDER BY computed_at DESC LIMIT 1`,
    [tenantId, policyId, transactionId]
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    treatyId: row.treaty_id ?? null,
    cededPercent: row.ceded_percent != null ? Number(row.ceded_percent) : null,
    retainedPercent: row.retained_percent != null ? Number(row.retained_percent) : null
  }
}

/**
 * Generates a RISK bordereau: one row per risk unit on a policy whose
 * effective date falls within the reporting period.
 */
async function buildRiskRows(
  q: ReturnType<typeof toRawQuery>,
  tenantId: string,
  input: GenerateBordereauInput
): Promise<BordereauRowCandidate[]> {
  const clauses = ['ru.tenant_id = $1', 'p.tenant_id = $1', 'ru.effective_date >= $2', 'ru.effective_date <= $3']
  const params: any[] = [tenantId, input.periodStart, input.periodEnd]
  if (input.productCode) {
    clauses.push(`p.product_code = $${params.length + 1}`)
    params.push(input.productCode)
  }
  const result = await q(
    `SELECT ru.risk_unit_id, ru.policy_id, ru.transaction_id, ru.kind, ru.attributes, ru.effective_date, ru.expiration_date,
            p.policy_number, p.product_code, p.jurisdiction_code
       FROM risk_units ru
       JOIN policies p ON p.policy_id = ru.policy_id AND p.tenant_id = ru.tenant_id
      WHERE ${clauses.join(' AND ')} AND ru.voided_at IS NULL
      ORDER BY p.policy_number, ru.effective_date`,
    params
  )
  const rows: BordereauRowCandidate[] = []
  for (const r of result.rows) {
    const placement = await loadReinsurancePlacement(q, tenantId, r.policy_id, r.transaction_id)
    rows.push({
      policyId: r.policy_id,
      transactionId: r.transaction_id,
      policyNumber: r.policy_number,
      data: {
        riskUnitId: r.risk_unit_id,
        riskKind: r.kind,
        attributes: r.attributes,
        effectiveDate: r.effective_date,
        expirationDate: r.expiration_date,
        productCode: r.product_code,
        stateCode: r.jurisdiction_code,
        treatyId: placement?.treatyId ?? null,
        cededPercent: placement?.cededPercent ?? null,
        retainedPercent: placement?.retainedPercent ?? null
      }
    })
  }
  return rows
}

/**
 * Generates a PREMIUM, TRANSACTION, CANCELLATION, or CLAIMS_REFERENCE_HANDOFF
 * bordereau: one row per policy_versions record (a processed transaction)
 * whose effective date falls within the reporting period.
 */
async function buildTransactionRows(
  q: ReturnType<typeof toRawQuery>,
  tenantId: string,
  input: GenerateBordereauInput
): Promise<BordereauRowCandidate[]> {
  const clauses = ['pv.tenant_id = $1', 'p.tenant_id = $1', 'pv.effective_date >= $2', 'pv.effective_date <= $3']
  const params: any[] = [tenantId, input.periodStart, input.periodEnd]
  if (input.productCode) {
    clauses.push(`p.product_code = $${params.length + 1}`)
    params.push(input.productCode)
  }
  if (input.bordereauType === 'CANCELLATION') {
    clauses.push(`pv.transaction_type = 'Cancel'`)
  }
  if (input.bordereauType === 'CLAIMS_REFERENCE_HANDOFF') {
    clauses.push(`pv.claim_reference IS NOT NULL`)
  }
  const result = await q(
    `SELECT pv.version_id, pv.policy_id, pv.transaction_id, pv.transaction_type, pv.effective_date,
            pv.premium_total, pv.premium_fees, pv.premium_taxes, pv.currency,
            pv.cancellation_reason_code, pv.return_premium_amount, pv.claim_reference,
            p.policy_number, p.product_code, p.jurisdiction_code
       FROM policy_versions pv
       JOIN policies p ON p.policy_id = pv.policy_id AND p.tenant_id = pv.tenant_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.policy_number, pv.effective_date`,
    params
  )
  const rows: BordereauRowCandidate[] = []
  for (const r of result.rows) {
    const placement = await loadReinsurancePlacement(q, tenantId, r.policy_id, r.transaction_id)
    const data = input.bordereauType === 'CLAIMS_REFERENCE_HANDOFF'
      ? {
          // Distinct, minimal shape for a claims-reference handoff row: this
          // is a pointer to an external claim, not a premium/cancellation
          // report, so premium and cancellation fields are intentionally
          // omitted rather than reused from the generic TRANSACTION shape.
          transactionType: r.transaction_type,
          effectiveDate: r.effective_date,
          claimReference: r.claim_reference,
          productCode: r.product_code,
          stateCode: r.jurisdiction_code,
          treatyId: placement?.treatyId ?? null
        }
      : {
          transactionType: r.transaction_type,
          effectiveDate: r.effective_date,
          premiumTotal: r.premium_total != null ? Number(r.premium_total) : null,
          premiumFees: r.premium_fees != null ? Number(r.premium_fees) : null,
          premiumTaxes: r.premium_taxes != null ? Number(r.premium_taxes) : null,
          returnPremiumAmount: r.return_premium_amount != null ? Number(r.return_premium_amount) : null,
          currency: r.currency,
          cancellationReasonCode: r.cancellation_reason_code,
          productCode: r.product_code,
          stateCode: r.jurisdiction_code,
          treatyId: placement?.treatyId ?? null,
          cededPercent: placement?.cededPercent ?? null,
          retainedPercent: placement?.retainedPercent ?? null,
          cededPremium:
            placement?.cededPercent != null && r.premium_total != null
              ? Math.round(Number(r.premium_total) * (placement.cededPercent / 100) * 100) / 100
              : null
        }
    rows.push({
      policyId: r.policy_id,
      transactionId: r.transaction_id,
      policyNumber: r.policy_number,
      data
    })
  }
  return rows
}

/**
 * Generates and persists a bordereau batch. Every row is validated and
 * persisted regardless of validity (invalid rows are flagged, not dropped),
 * so operators can review and correct source data rather than silently
 * losing rows.
 */
export async function generateBordereau(db: DrizzleDB, tenantId: string, input: GenerateBordereauInput): Promise<GeneratedBatchSummary> {
  assertValidBordereauType(input.bordereauType)
  if (!input.periodStart || !input.periodEnd) {
    throw new BadRequestError('BORDEREAUX_INVALID_INPUT', 'periodStart and periodEnd are required')
  }
  if (input.periodEnd < input.periodStart) {
    throw new BadRequestError('BORDEREAUX_INVALID_INPUT', 'periodEnd must not be before periodStart')
  }

  const q = toRawQuery(db)

  let correctsBatch: { row_count: number } | null = null
  if (input.correctsBatchId) {
    const prior = await q(`SELECT batch_id, row_count FROM bordereaux_batches WHERE tenant_id = $1 AND batch_id = $2`, [
      tenantId,
      input.correctsBatchId
    ])
    if (!prior.rows[0]) throw new NotFoundError('BORDEREAUX_NOT_FOUND', 'corrects batch not found')
    correctsBatch = prior.rows[0]
  }

  const candidates: BordereauRowCandidate[] = input.bordereauType === 'RISK'
    ? await buildRiskRows(q, tenantId, input)
    : await buildTransactionRows(q, tenantId, input)

  const batchId = uuidv4()
  let validCount = 0
  let invalidCount = 0

  await q(
    `INSERT INTO bordereaux_batches
       (batch_id, tenant_id, bordereau_type, status, period_start, period_end, product_code, program_name,
        recipient_name, treaty_id, corrects_batch_id, row_count, valid_row_count, invalid_row_count, generated_by)
     VALUES ($1,$2,$3,'Generated',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      batchId,
      tenantId,
      input.bordereauType,
      input.periodStart,
      input.periodEnd,
      input.productCode || null,
      input.programName || null,
      input.recipientName || null,
      input.treatyId || null,
      input.correctsBatchId || null,
      candidates.length,
      0,
      0,
      input.generatedBy || null
    ]
  )

  let rowNumber = 1
  for (const candidate of candidates) {
    const validation = validateBordereauRow(input.bordereauType, candidate)
    if (validation.isValid) validCount += 1
    else invalidCount += 1
    await q(
      `INSERT INTO bordereaux_rows
         (row_id, tenant_id, batch_id, row_number, policy_id, transaction_id, policy_number, row_data, is_valid, validation_errors)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
      [
        uuidv4(),
        tenantId,
        batchId,
        rowNumber,
        candidate.policyId,
        candidate.transactionId,
        candidate.policyNumber,
        JSON.stringify(candidate.data),
        validation.isValid,
        JSON.stringify(validation.errors)
      ]
    )
    rowNumber += 1
  }

  await q(`UPDATE bordereaux_batches SET valid_row_count = $1, invalid_row_count = $2 WHERE tenant_id = $3 AND batch_id = $4`, [
    validCount,
    invalidCount,
    tenantId,
    batchId
  ])

  if (correctsBatch) {
    await q(`UPDATE bordereaux_batches SET status = 'Corrected' WHERE tenant_id = $1 AND batch_id = $2`, [
      tenantId,
      input.correctsBatchId
    ])
  }

  return {
    batchId,
    bordereauType: input.bordereauType,
    status: 'Generated',
    rowCount: candidates.length,
    validRowCount: validCount,
    invalidRowCount: invalidCount,
    version: 1,
    correctsBatchId: input.correctsBatchId || null
  }
}

export interface BordereauExportRow {
  rowNumber: number
  policyNumber: string | null
  isValid: boolean
  validationErrors: string[]
  data: Record<string, unknown>
}

export async function loadBordereauRows(db: DrizzleDB, tenantId: string, batchId: string): Promise<BordereauExportRow[]> {
  const q = toRawQuery(db)
  const result = await q(
    `SELECT row_number, policy_number, is_valid, validation_errors, row_data
       FROM bordereaux_rows WHERE tenant_id = $1 AND batch_id = $2 ORDER BY row_number`,
    [tenantId, batchId]
  )
  return result.rows.map((r: any) => ({
    rowNumber: r.row_number,
    policyNumber: r.policy_number,
    isValid: r.is_valid,
    validationErrors: Array.isArray(r.validation_errors) ? r.validation_errors : [],
    data: r.row_data || {}
  }))
}

/**
 * Serializes bordereau rows to CSV. Column set is the union of keys present
 * across all rows' `data`, so different bordereau types get an appropriate
 * column set without a hardcoded per-type schema.
 */
export function toCsv(rows: BordereauExportRow[]): string {
  const dataKeys = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row.data)) dataKeys.add(key)
  }
  const columns = ['rowNumber', 'policyNumber', 'isValid', 'validationErrors', ...Array.from(dataKeys)]
  const lines = [columns.map(csvEscape).join(',')]
  for (const row of rows) {
    const values = columns.map((col) => {
      if (col === 'rowNumber') return row.rowNumber
      if (col === 'policyNumber') return row.policyNumber
      if (col === 'isValid') return row.isValid
      if (col === 'validationErrors') return row.validationErrors.join('; ')
      const v = row.data[col]
      return v != null && typeof v === 'object' ? JSON.stringify(v) : v
    })
    lines.push(values.map(csvEscape).join(','))
  }
  return lines.join('\n')
}
