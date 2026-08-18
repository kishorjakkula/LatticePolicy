import { toRawQuery, type DrizzleDB } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { asDateOnly } from '../lib/date.utils.js'
import { renderNotificationTemplate } from './notification.service.js'

export const ALLOWED_NOTIFICATION_CHANNELS = ['EMAIL'] as const
export const ALLOWED_NOTIFICATION_VISIBILITY = ['customer', 'internal'] as const

export type NotificationTemplateRow = {
  templateId: string
  templateCode: string
  eventType: string
  channel: string
  productCode: string | null
  transactionType: string | null
  locale: string
  subjectTemplate: string
  bodyTemplate: string
  visibility: string[]
  active: boolean
  effectiveDate: string | null
  expirationDate: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type NotificationTemplateInput = {
  templateCode?: string
  eventType?: string
  channel?: string
  productCode?: string | null
  transactionType?: string | null
  locale?: string
  subjectTemplate?: string
  bodyTemplate?: string
  visibility?: string[]
  effectiveDate?: string | null
  expirationDate?: string | null
  active?: boolean
  metadata?: Record<string, unknown>
}

export type NotificationTemplateListFilters = {
  eventType?: string
  channel?: string
  productCode?: string
  transactionType?: string
  active?: boolean
}

function mapRow(row: any): NotificationTemplateRow {
  return {
    templateId: row.template_id,
    templateCode: row.template_code,
    eventType: row.event_type,
    channel: row.channel,
    productCode: row.product_code ?? null,
    transactionType: row.transaction_type ?? null,
    locale: row.locale,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    visibility: Array.isArray(row.visibility) ? row.visibility : ['customer'],
    active: !!row.active,
    effectiveDate: row.effective_date ?? null,
    expirationDate: row.expiration_date ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeVisibility(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length) return ['customer']
  const filtered = Array.from(new Set(value.map((x) => String(x)).filter((x) => (ALLOWED_NOTIFICATION_VISIBILITY as readonly string[]).includes(x))))
  return filtered.length ? filtered : ['customer']
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

/**
 * Validates a template create/update payload. Pass `partial: true` for PATCH
 * requests where only the supplied fields must be valid.
 */
export function validateNotificationTemplateInput(
  input: NotificationTemplateInput,
  opts: { partial?: boolean } = {}
): string | null {
  const partial = !!opts.partial

  if (!partial || input.templateCode !== undefined) {
    if (!String(input.templateCode || '').trim()) return 'templateCode is required'
  }
  if (!partial || input.eventType !== undefined) {
    if (!String(input.eventType || '').trim()) return 'eventType is required'
  }
  if (input.channel != null && !(ALLOWED_NOTIFICATION_CHANNELS as readonly string[]).includes(input.channel)) {
    return `channel must be one of ${ALLOWED_NOTIFICATION_CHANNELS.join(', ')}`
  }
  if (!partial || input.subjectTemplate !== undefined) {
    if (!String(input.subjectTemplate || '').trim()) return 'subjectTemplate is required'
  }
  if (!partial || input.bodyTemplate !== undefined) {
    if (!String(input.bodyTemplate || '').trim()) return 'bodyTemplate is required'
  }
  if (input.visibility != null) {
    if (!Array.isArray(input.visibility) || input.visibility.length === 0) {
      return 'visibility must be a non-empty array'
    }
    const invalid = input.visibility.filter((x) => !(ALLOWED_NOTIFICATION_VISIBILITY as readonly string[]).includes(x))
    if (invalid.length) {
      return `visibility values must be one of ${ALLOWED_NOTIFICATION_VISIBILITY.join(', ')}`
    }
  }
  if (input.effectiveDate != null && input.effectiveDate !== '' && !asDateOnly(input.effectiveDate)) {
    return 'effectiveDate must be a valid date'
  }
  if (input.expirationDate != null && input.expirationDate !== '' && !asDateOnly(input.expirationDate)) {
    return 'expirationDate must be a valid date'
  }
  return null
}

export async function listNotificationTemplates(
  db: DrizzleDB,
  tenantId: string,
  filters: NotificationTemplateListFilters = {}
): Promise<NotificationTemplateRow[]> {
  const q = toRawQuery(db)
  const clauses = ['tenant_id = $1']
  const params: any[] = [tenantId]
  let idx = 2

  if (filters.eventType) {
    clauses.push(`event_type = $${idx}`)
    params.push(filters.eventType)
    idx += 1
  }
  if (filters.channel) {
    clauses.push(`channel = $${idx}`)
    params.push(filters.channel)
    idx += 1
  }
  if (filters.productCode) {
    clauses.push(`product_code = $${idx}`)
    params.push(filters.productCode)
    idx += 1
  }
  if (filters.transactionType) {
    clauses.push(`transaction_type = $${idx}`)
    params.push(filters.transactionType)
    idx += 1
  }
  if (filters.active != null) {
    clauses.push(`active = $${idx}`)
    params.push(filters.active)
    idx += 1
  }

  const result = await q(
    `SELECT * FROM notification_templates
      WHERE ${clauses.join(' AND ')}
      ORDER BY event_type, template_code`,
    params
  )
  return result.rows.map(mapRow)
}

export async function getNotificationTemplate(
  db: DrizzleDB,
  tenantId: string,
  templateId: string
): Promise<NotificationTemplateRow | null> {
  const q = toRawQuery(db)
  const result = await q(
    `SELECT * FROM notification_templates WHERE tenant_id = $1 AND template_id = $2`,
    [tenantId, templateId]
  )
  if (!result.rowCount) return null
  return mapRow(result.rows[0])
}

function isUniqueViolation(e: any): boolean {
  return e?.code === '23505' || e?.cause?.code === '23505'
}

export async function createNotificationTemplate(
  db: DrizzleDB,
  tenantId: string,
  input: NotificationTemplateInput,
  actor: string
): Promise<NotificationTemplateRow> {
  const q = toRawQuery(db)
  const templateId = uuidv4()
  try {
    const result = await q(
      `INSERT INTO notification_templates (
          template_id, tenant_id, template_code, event_type, channel, product_code, transaction_type,
          locale, subject_template, body_template, visibility, active, effective_date, expiration_date, metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::text[],$12,$13,$14,$15::jsonb)
        RETURNING *`,
      [
        templateId,
        tenantId,
        String(input.templateCode).trim(),
        String(input.eventType).trim(),
        input.channel || 'EMAIL',
        normalizeOptionalText(input.productCode),
        normalizeOptionalText(input.transactionType),
        input.locale?.trim() || 'en-US',
        String(input.subjectTemplate),
        String(input.bodyTemplate),
        normalizeVisibility(input.visibility),
        input.active !== false,
        asDateOnly(input.effectiveDate ?? undefined) || null,
        asDateOnly(input.expirationDate ?? undefined) || null,
        JSON.stringify(input.metadata || { createdBy: actor }),
      ]
    )
    return mapRow(result.rows[0])
  } catch (e: any) {
    if (isUniqueViolation(e)) throw new Error('TEMPLATE_CODE_EXISTS')
    throw e
  }
}

export async function updateNotificationTemplate(
  db: DrizzleDB,
  tenantId: string,
  templateId: string,
  patch: NotificationTemplateInput,
  actor: string
): Promise<NotificationTemplateRow | null> {
  const q = toRawQuery(db)
  const current = await getNotificationTemplate(db, tenantId, templateId)
  if (!current) return null

  const next = {
    templateCode: patch.templateCode !== undefined ? String(patch.templateCode).trim() : current.templateCode,
    eventType: patch.eventType !== undefined ? String(patch.eventType).trim() : current.eventType,
    channel: patch.channel !== undefined ? patch.channel : current.channel,
    productCode: patch.productCode !== undefined ? normalizeOptionalText(patch.productCode) : current.productCode,
    transactionType:
      patch.transactionType !== undefined ? normalizeOptionalText(patch.transactionType) : current.transactionType,
    locale: patch.locale !== undefined ? patch.locale.trim() || 'en-US' : current.locale,
    subjectTemplate: patch.subjectTemplate !== undefined ? String(patch.subjectTemplate) : current.subjectTemplate,
    bodyTemplate: patch.bodyTemplate !== undefined ? String(patch.bodyTemplate) : current.bodyTemplate,
    visibility: patch.visibility !== undefined ? normalizeVisibility(patch.visibility) : current.visibility,
    effectiveDate:
      patch.effectiveDate !== undefined ? asDateOnly(patch.effectiveDate ?? undefined) || null : current.effectiveDate,
    expirationDate:
      patch.expirationDate !== undefined
        ? asDateOnly(patch.expirationDate ?? undefined) || null
        : current.expirationDate,
    metadata: patch.metadata !== undefined ? { ...current.metadata, ...patch.metadata } : current.metadata,
  }

  try {
    const result = await q(
      `UPDATE notification_templates
          SET template_code = $3,
              event_type = $4,
              channel = $5,
              product_code = $6,
              transaction_type = $7,
              locale = $8,
              subject_template = $9,
              body_template = $10,
              visibility = $11::text[],
              effective_date = $12,
              expiration_date = $13,
              metadata = $14::jsonb,
              updated_at = now()
        WHERE tenant_id = $1 AND template_id = $2
        RETURNING *`,
      [
        tenantId,
        templateId,
        next.templateCode,
        next.eventType,
        next.channel,
        next.productCode,
        next.transactionType,
        next.locale,
        next.subjectTemplate,
        next.bodyTemplate,
        next.visibility,
        next.effectiveDate,
        next.expirationDate,
        JSON.stringify({ ...next.metadata, updatedBy: actor }),
      ]
    )
    if (!result.rowCount) return null
    return mapRow(result.rows[0])
  } catch (e: any) {
    if (isUniqueViolation(e)) throw new Error('TEMPLATE_CODE_EXISTS')
    throw e
  }
}

export async function setNotificationTemplateActive(
  db: DrizzleDB,
  tenantId: string,
  templateId: string,
  active: boolean,
  actor: string
): Promise<NotificationTemplateRow | null> {
  const q = toRawQuery(db)
  const current = await getNotificationTemplate(db, tenantId, templateId)
  if (!current) return null
  const result = await q(
    `UPDATE notification_templates
        SET active = $3,
            metadata = $4::jsonb,
            updated_at = now()
      WHERE tenant_id = $1 AND template_id = $2
      RETURNING *`,
    [tenantId, templateId, active, JSON.stringify({ ...current.metadata, updatedBy: actor })]
  )
  if (!result.rowCount) return null
  return mapRow(result.rows[0])
}

export type NotificationTemplatePreviewResult = {
  subject: string
  body: string
}

/**
 * Renders subject/body for arbitrary (possibly unsaved) template text against
 * sample merge fields, using the same renderer the runtime notification
 * service uses so previews match production rendering exactly.
 */
export function previewNotificationTemplate(input: {
  subjectTemplate: string
  bodyTemplate: string
  sampleFields?: Record<string, unknown>
}): NotificationTemplatePreviewResult {
  const fields = input.sampleFields || {}
  return {
    subject: renderNotificationTemplate(input.subjectTemplate, fields),
    body: renderNotificationTemplate(input.bodyTemplate, fields),
  }
}
