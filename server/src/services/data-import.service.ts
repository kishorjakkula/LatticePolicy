import { v4 as uuidv4 } from '../uuid.js'
import { sanitizeText } from '../lib/utils.js'
import {
  createCustomerRecord,
  updateCustomerRecord,
  findExistingCustomerByExternalIdentifiers,
  loadCustomerRecordById,
  loadCustomerSettings,
  normalizeCustomerInput,
  validateCustomerPayload
} from '../routes/customers.routes.js'
import type { QueryFn, CustomerValidationConfig } from '../routes/customers.routes.js'

export const SUPPORTED_ENTITY_TYPES = ['customer'] as const
export type ImportEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number]

export const IMPORTABLE_ENTITY_TYPES_FRAMEWORK_ONLY = [
  'agency',
  'producer',
  'policy',
  'policy_term',
  'risk',
  'coverage',
  'document',
  'transaction_history'
] as const

export type ImportBatch = {
  batchId: string
  tenantId: string
  entityType: string
  sourceSystem: string
  status: string
  rowCount: number
  validCount: number
  invalidCount: number
  committedCount: number
  failedCount: number
  notes: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export type ImportRow = {
  rowId: string
  batchId: string
  rowNumber: number
  externalId: string | null
  rawPayload: any
  status: string
  validationErrors: string[]
  committedEntityType: string | null
  committedEntityId: string | null
  commitMode: string | null
  errorMessage: string | null
  attempts: number
}

function mapBatch(row: any): ImportBatch {
  return {
    batchId: row.batch_id,
    tenantId: row.tenant_id,
    entityType: row.entity_type,
    sourceSystem: row.source_system,
    status: row.status,
    rowCount: row.row_count,
    validCount: row.valid_count,
    invalidCount: row.invalid_count,
    committedCount: row.committed_count,
    failedCount: row.failed_count,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapRow(row: any): ImportRow {
  return {
    rowId: row.row_id,
    batchId: row.batch_id,
    rowNumber: row.row_number,
    externalId: row.external_id,
    rawPayload: row.raw_payload,
    status: row.status,
    validationErrors: Array.isArray(row.validation_errors) ? row.validation_errors : [],
    committedEntityType: row.committed_entity_type,
    committedEntityId: row.committed_entity_id,
    commitMode: row.commit_mode,
    errorMessage: row.error_message,
    attempts: row.attempts
  }
}

function externalIdFor(entityType: string, rawPayload: any): string | null {
  if (entityType === 'customer') {
    // externalIdentifiers must live inside `payload` (same shape normalizeCustomerInput
    // expects), not as a sibling of it — see validateCustomerRow/commitCustomerRow.
    const identifiers = rawPayload?.payload?.externalIdentifiers
    const first = Array.isArray(identifiers) ? identifiers[0] : null
    return first ? sanitizeText(first.externalId) || null : null
  }
  return sanitizeText(rawPayload?.externalId) || null
}

export async function stageImportBatch(
  q: QueryFn,
  input: {
    tenantId: string
    entityType: string
    sourceSystem: string
    rows: any[]
    actor: string
    notes?: string
  }
): Promise<ImportBatch> {
  const sourceSystem = sanitizeText(input.sourceSystem)
  if (!sourceSystem) throw new Error('SOURCE_SYSTEM_REQUIRED')
  if (!Array.isArray(input.rows) || input.rows.length === 0) throw new Error('ROWS_REQUIRED')
  if (input.rows.length > 5000) throw new Error('BATCH_TOO_LARGE')

  const batchId = uuidv4()
  await q(
    `INSERT INTO import_batches (
      batch_id, tenant_id, entity_type, source_system, status, row_count, notes, created_by
    ) VALUES ($1,$2,$3,$4,'Staged',$5,$6,$7)`,
    [batchId, input.tenantId, input.entityType, sourceSystem, input.rows.length, input.notes || null, input.actor]
  )

  for (let i = 0; i < input.rows.length; i += 1) {
    const raw = input.rows[i]
    await q(
      `INSERT INTO import_rows (
        row_id, tenant_id, batch_id, row_number, external_id, raw_payload, status
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,'Pending')`,
      [uuidv4(), input.tenantId, batchId, i + 1, externalIdFor(input.entityType, raw), JSON.stringify(raw || {})]
    )
  }

  const batch = await q(`SELECT * FROM import_batches WHERE tenant_id = $1 AND batch_id = $2`, [
    input.tenantId,
    batchId
  ])
  return mapBatch(batch.rows[0])
}

export async function listImportBatches(q: QueryFn, tenantId: string): Promise<ImportBatch[]> {
  const result = await q(
    `SELECT * FROM import_batches WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [tenantId]
  )
  return (result.rows || []).map(mapBatch)
}

export async function getImportBatch(q: QueryFn, tenantId: string, batchId: string): Promise<ImportBatch | null> {
  const result = await q(`SELECT * FROM import_batches WHERE tenant_id = $1 AND batch_id = $2`, [tenantId, batchId])
  return result.rows[0] ? mapBatch(result.rows[0]) : null
}

export async function listImportRows(
  q: QueryFn,
  tenantId: string,
  batchId: string,
  status?: string
): Promise<ImportRow[]> {
  const params: any[] = [tenantId, batchId]
  let clause = ''
  if (status) {
    clause = ' AND status = $3'
    params.push(status)
  }
  const result = await q(
    `SELECT * FROM import_rows WHERE tenant_id = $1 AND batch_id = $2${clause} ORDER BY row_number ASC`,
    params
  )
  return (result.rows || []).map(mapRow)
}

function validateCustomerRow(
  rawPayload: any,
  validationConfig: CustomerValidationConfig
): { valid: boolean; errors: string[] } {
  try {
    const payload = normalizeCustomerInput(rawPayload?.payload || rawPayload || {})
    const errors: string[] = []
    if (!payload.externalIdentifiers || payload.externalIdentifiers.length === 0) {
      errors.push('payload.externalIdentifiers must include at least one entry (sourceSystem + externalId) for import reconciliation')
    }
    // Reuse the same validator createCustomerRecord/updateCustomerRecord enforce at commit
    // time, so a row marked Valid here is guaranteed to actually commit.
    const result = validateCustomerPayload(payload, validationConfig)
    errors.push(...result.errors)
    return { valid: errors.length === 0, errors }
  } catch (e: any) {
    return { valid: false, errors: [String(e?.message || e)] }
  }
}

async function validateRow(
  q: QueryFn,
  tenantId: string,
  entityType: string,
  rawPayload: any
): Promise<{ valid: boolean; errors: string[] }> {
  if (entityType === 'customer') {
    const settings = await loadCustomerSettings(q, tenantId)
    return validateCustomerRow(rawPayload, settings.validation)
  }
  return {
    valid: false,
    errors: [`entity type '${entityType}' does not have a validator/commit handler in this framework slice yet`]
  }
}

export async function validateImportBatch(
  q: QueryFn,
  tenantId: string,
  batchId: string
): Promise<ImportBatch> {
  const batch = await getImportBatch(q, tenantId, batchId)
  if (!batch) throw new Error('NOT_FOUND')
  const rows = await listImportRows(q, tenantId, batchId)

  let validCount = 0
  let invalidCount = 0
  for (const row of rows) {
    const { valid, errors } = await validateRow(q, tenantId, batch.entityType, row.rawPayload)
    if (valid) validCount += 1
    else invalidCount += 1
    await q(
      `UPDATE import_rows
          SET status = $3, validation_errors = $4::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND row_id = $2`,
      [tenantId, row.rowId, valid ? 'Valid' : 'Invalid', JSON.stringify(errors)]
    )
  }

  const status = invalidCount === 0 ? 'Validated' : rows.length === invalidCount ? 'Failed' : 'Validated'
  await q(
    `UPDATE import_batches
        SET status = $3, valid_count = $4, invalid_count = $5, updated_at = now()
      WHERE tenant_id = $1 AND batch_id = $2`,
    [tenantId, batchId, status, validCount, invalidCount]
  )
  return (await getImportBatch(q, tenantId, batchId))!
}

async function commitCustomerRow(
  q: QueryFn,
  tenantId: string,
  actor: string,
  batchId: string,
  row: ImportRow
): Promise<{ entityId: string; mode: 'created' | 'updated' }> {
  const payload = normalizeCustomerInput(row.rawPayload?.payload || row.rawPayload || {})
  const existingId = await findExistingCustomerByExternalIdentifiers(q, tenantId, payload.externalIdentifiers)
  if (existingId) {
    const current = await loadCustomerRecordById(q, tenantId, existingId, true)
    if (!current) throw new Error('NOT_FOUND')
    const updated = await updateCustomerRecord(q, {
      tenantId,
      customerId: current.customerId,
      expectedVersion: Number(current.version),
      payload,
      actor,
      reason: 'DATA_IMPORT_UPDATE',
      allowIdentityUpdate: true
    })
    return { entityId: updated.customerId, mode: 'updated' }
  }
  const created = await createCustomerRecord(q, {
    tenantId,
    payload,
    actor,
    reason: 'DATA_IMPORT_CREATE',
    createAnyway: true
  })
  return { entityId: created.customer.customerId, mode: 'created' }
}

async function recordExternalRef(
  q: QueryFn,
  tenantId: string,
  entityType: string,
  sourceSystem: string,
  externalId: string | null,
  committedEntityType: string,
  committedEntityId: string,
  batchId: string,
  rowId: string
): Promise<void> {
  if (!externalId) return
  await q(
    `INSERT INTO import_external_refs (
      tenant_id, entity_type, source_system, external_id, committed_entity_type, committed_entity_id, batch_id, row_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (tenant_id, entity_type, source_system, external_id)
    DO UPDATE SET committed_entity_id = EXCLUDED.committed_entity_id,
                  committed_entity_type = EXCLUDED.committed_entity_type,
                  batch_id = EXCLUDED.batch_id,
                  row_id = EXCLUDED.row_id,
                  committed_at = now()`,
    [tenantId, entityType, sourceSystem, externalId, committedEntityType, committedEntityId, batchId, rowId]
  )
}

export async function commitImportBatch(
  q: QueryFn,
  tenantId: string,
  batchId: string,
  actor: string
): Promise<ImportBatch> {
  const batch = await getImportBatch(q, tenantId, batchId)
  if (!batch) throw new Error('NOT_FOUND')
  if (!['Validated', 'PartiallyCommitted'].includes(batch.status)) {
    throw new Error('BATCH_NOT_VALIDATED')
  }
  const rows = await listImportRows(q, tenantId, batchId, 'Valid')

  let committedCount = batch.committedCount
  let failedCount = batch.failedCount
  for (const row of rows) {
    try {
      let result: { entityId: string; mode: 'created' | 'updated' }
      if (batch.entityType === 'customer') {
        result = await commitCustomerRow(q, tenantId, actor, batchId, row)
      } else {
        throw new Error(`no commit handler for entity type '${batch.entityType}'`)
      }
      await recordExternalRef(
        q,
        tenantId,
        batch.entityType,
        batch.sourceSystem,
        row.externalId,
        batch.entityType,
        result.entityId,
        batchId,
        row.rowId
      )
      await q(
        `UPDATE import_rows
            SET status = 'Committed', committed_entity_type = $3, committed_entity_id = $4, commit_mode = $5,
                error_message = NULL, attempts = attempts + 1, updated_at = now()
          WHERE tenant_id = $1 AND row_id = $2`,
        [tenantId, row.rowId, batch.entityType, result.entityId, result.mode]
      )
      committedCount += 1
    } catch (e: any) {
      await q(
        `UPDATE import_rows
            SET status = 'Failed', error_message = $3, attempts = attempts + 1, updated_at = now()
          WHERE tenant_id = $1 AND row_id = $2`,
        [tenantId, row.rowId, String(e?.message || e)]
      )
      failedCount += 1
    }
  }

  const remainingValid = await listImportRows(q, tenantId, batchId, 'Valid')
  const status = remainingValid.length === 0 ? (failedCount > 0 ? 'PartiallyCommitted' : 'Committed') : 'PartiallyCommitted'
  await q(
    `UPDATE import_batches
        SET status = $3, committed_count = $4, failed_count = $5, updated_at = now()
      WHERE tenant_id = $1 AND batch_id = $2`,
    [tenantId, batchId, status, committedCount, failedCount]
  )
  return (await getImportBatch(q, tenantId, batchId))!
}

export async function retryImportRow(
  q: QueryFn,
  tenantId: string,
  batchId: string,
  rowId: string,
  actor: string
): Promise<ImportRow> {
  const rows = await listImportRows(q, tenantId, batchId)
  const row = rows.find((r) => r.rowId === rowId)
  if (!row) throw new Error('NOT_FOUND')
  if (row.status !== 'Failed') throw new Error('ROW_NOT_FAILED')

  const batch = await getImportBatch(q, tenantId, batchId)
  if (!batch) throw new Error('NOT_FOUND')

  const { valid, errors } = await validateRow(q, tenantId, batch.entityType, row.rawPayload)
  if (!valid) {
    await q(
      `UPDATE import_rows SET status = 'Invalid', validation_errors = $3::jsonb, updated_at = now()
        WHERE tenant_id = $1 AND row_id = $2`,
      [tenantId, rowId, JSON.stringify(errors)]
    )
    const refreshed = await listImportRows(q, tenantId, batchId)
    return refreshed.find((r) => r.rowId === rowId)!
  }

  try {
    let result: { entityId: string; mode: 'created' | 'updated' }
    if (batch.entityType === 'customer') {
      result = await commitCustomerRow(q, tenantId, actor, batchId, row)
    } else {
      throw new Error(`no commit handler for entity type '${batch.entityType}'`)
    }
    await recordExternalRef(
      q,
      tenantId,
      batch.entityType,
      batch.sourceSystem,
      row.externalId,
      batch.entityType,
      result.entityId,
      batchId,
      rowId
    )
    await q(
      `UPDATE import_rows
          SET status = 'Committed', committed_entity_type = $3, committed_entity_id = $4, commit_mode = $5,
              error_message = NULL, attempts = attempts + 1, updated_at = now()
        WHERE tenant_id = $1 AND row_id = $2`,
      [tenantId, rowId, batch.entityType, result.entityId, result.mode]
    )
    await q(
      `UPDATE import_batches SET committed_count = committed_count + 1, failed_count = GREATEST(failed_count - 1, 0), updated_at = now()
        WHERE tenant_id = $1 AND batch_id = $2`,
      [tenantId, batchId]
    )
  } catch (e: any) {
    await q(
      `UPDATE import_rows SET status = 'Failed', error_message = $3, attempts = attempts + 1, updated_at = now()
        WHERE tenant_id = $1 AND row_id = $2`,
      [tenantId, rowId, String(e?.message || e)]
    )
  }

  const refreshed = await listImportRows(q, tenantId, batchId)
  return refreshed.find((r) => r.rowId === rowId)!
}
