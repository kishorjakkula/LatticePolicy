import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'

export type NotificationEventType =
  | 'POLICY_ISSUED'
  | 'POLICY_CANCELLED'
  | 'POLICY_NON_RENEWAL'

export type NotificationRecipient = {
  type: 'customer' | 'internal'
  name?: string | null
  email?: string | null
  visibility: 'customer' | 'internal'
}

export type PolicyNotificationContext = {
  tenantId: string
  policyId: string
  policyNumber?: string | null
  productCode?: string | null
  transactionId: string | null
  transactionType: string
  transactionNumber?: string | null
  eventType: NotificationEventType
  effectiveDate?: string | null
  expirationDate?: string | null
  noticeDate?: string | null
  reason?: string | null
  premiumImpact?: number | null
  payload?: any
  actorId?: string | null
  correlationId?: string | null
}

export type NotificationIntentResult = {
  notificationId: string
  eventType: NotificationEventType
  templateCode: string
  status: 'Queued' | 'Suppressed'
  channel: 'EMAIL'
  recipient: NotificationRecipient
  subject: string
  body: string
}

type TemplateDefinition = {
  templateCode: string
  subjectTemplate: string
  bodyTemplate: string
  visibility: string[]
}

const DEFAULT_TEMPLATES: Record<NotificationEventType, TemplateDefinition> = {
  POLICY_ISSUED: {
    templateCode: 'policy-issued-default',
    subjectTemplate: 'Policy {{policyNumber}} issued',
    bodyTemplate:
      'Policy {{policyNumber}} was issued effective {{effectiveDate}}. Transaction {{transactionNumber}} is complete.',
    visibility: ['customer'],
  },
  POLICY_CANCELLED: {
    templateCode: 'policy-cancelled-default',
    subjectTemplate: 'Policy {{policyNumber}} cancellation notice',
    bodyTemplate:
      'Policy {{policyNumber}} is cancelled effective {{effectiveDate}}. Reason: {{reason}}. Transaction {{transactionNumber}}.',
    visibility: ['customer'],
  },
  POLICY_NON_RENEWAL: {
    templateCode: 'policy-non-renewal-default',
    subjectTemplate: 'Policy {{policyNumber}} non-renewal notice',
    bodyTemplate:
      'Policy {{policyNumber}} will not renew at expiration on {{expirationDate}}. Notice date: {{noticeDate}}. Reason: {{reason}}.',
    visibility: ['customer'],
  },
}

function valueAtPath(source: any, path: string): unknown {
  return path.split('.').reduce((current, segment) => {
    if (current == null || typeof current !== 'object') return undefined
    return current[segment]
  }, source)
}

export function renderNotificationTemplate(template: string, fields: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const value = valueAtPath(fields, key)
    if (value === null || value === undefined || value === '') return ''
    return String(value)
  })
}

function normalizeEmail(value: unknown): string | null {
  const email = String(value || '').trim()
  if (!email || !email.includes('@')) return null
  return email.toLowerCase()
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return null
}

export function resolvePolicyNotificationRecipient(payload: any): NotificationRecipient {
  const applicant = payload?.applicant || {}
  const primaryInsured = payload?.insureds?.primary || payload?.insured || {}
  const email = normalizeEmail(
    applicant.email ||
      primaryInsured.email ||
      payload?.customer?.email ||
      payload?.contact?.email
  )
  const name = firstText(
    applicant.displayName,
    [applicant.firstName, applicant.lastName].filter(Boolean).join(' '),
    primaryInsured.displayName,
    [primaryInsured.firstName, primaryInsured.lastName].filter(Boolean).join(' '),
    payload?.customer?.name
  )
  return {
    type: 'customer',
    name,
    email,
    visibility: 'customer',
  }
}

function mergeFields(context: PolicyNotificationContext, recipient: NotificationRecipient): Record<string, unknown> {
  return {
    tenantId: context.tenantId,
    policyId: context.policyId,
    policyNumber: context.policyNumber || '',
    productCode: context.productCode || '',
    transactionId: context.transactionId || '',
    transactionType: context.transactionType,
    transactionNumber: context.transactionNumber || '',
    effectiveDate: context.effectiveDate || '',
    expirationDate: context.expirationDate || '',
    noticeDate: context.noticeDate || '',
    reason: context.reason || '',
    premiumImpact: context.premiumImpact ?? '',
    recipient,
    payload: context.payload || {},
  }
}

async function loadTemplate(db: DrizzleDB, context: PolicyNotificationContext): Promise<TemplateDefinition> {
  const q = toRawQuery(db)
  const fallback = DEFAULT_TEMPLATES[context.eventType]
  const res = await q(
    `SELECT template_code, subject_template, body_template, visibility
       FROM notification_templates
      WHERE tenant_id = $1
        AND active = true
        AND event_type = $2
        AND channel = 'EMAIL'
        AND (product_code IS NULL OR lower(product_code) = lower($3))
        AND (transaction_type IS NULL OR lower(transaction_type) = lower($4))
        AND (effective_date IS NULL OR effective_date <= COALESCE($5::date, CURRENT_DATE))
        AND (expiration_date IS NULL OR expiration_date >= COALESCE($5::date, CURRENT_DATE))
      ORDER BY
        CASE WHEN product_code IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN transaction_type IS NOT NULL THEN 0 ELSE 1 END,
        effective_date DESC NULLS LAST,
        created_at DESC
      LIMIT 1`,
    [
      context.tenantId,
      context.eventType,
      context.productCode || '',
      context.transactionType,
      context.effectiveDate || context.noticeDate || null,
    ]
  )
  if (!res.rowCount) return fallback
  const row = res.rows[0]
  return {
    templateCode: row.template_code,
    subjectTemplate: row.subject_template,
    bodyTemplate: row.body_template,
    visibility: Array.isArray(row.visibility) ? row.visibility : ['customer'],
  }
}

export async function createPolicyNotificationIntent(
  db: DrizzleDB,
  context: PolicyNotificationContext
): Promise<NotificationIntentResult> {
  const q = toRawQuery(db)
  const template = await loadTemplate(db, context)
  const recipient = resolvePolicyNotificationRecipient(context.payload)
  const fields = mergeFields(context, recipient)
  const subject = renderNotificationTemplate(template.subjectTemplate, fields)
  const body = renderNotificationTemplate(template.bodyTemplate, fields)
  const notificationId = uuidv4()
  const status = recipient.email ? 'Queued' : 'Suppressed'
  const notificationPayload = {
    tenantId: context.tenantId,
    policyId: context.policyId,
    policyNumber: context.policyNumber || null,
    transactionId: context.transactionId,
    transactionType: context.transactionType,
    transactionNumber: context.transactionNumber || null,
    eventType: context.eventType,
    templateCode: template.templateCode,
    channel: 'EMAIL',
    recipient,
    subject,
    body,
    visibility: template.visibility,
    correlationId: context.correlationId || context.transactionNumber || context.transactionId || notificationId,
  }

  await q(
    `INSERT INTO notification_intents (
        notification_id, tenant_id, policy_id, transaction_id, event_type, channel,
        recipient, template_code, subject, body, payload, status, correlation_id, created_by
      )
     VALUES ($1, $2, $3, $4, $5, 'EMAIL', $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
    [
      notificationId,
      context.tenantId,
      context.policyId,
      context.transactionId,
      context.eventType,
      JSON.stringify(recipient),
      template.templateCode,
      subject,
      body,
      JSON.stringify(notificationPayload),
      status,
      context.correlationId || context.transactionNumber || context.transactionId || notificationId,
      context.actorId || null,
    ]
  )

  if (status === 'Queued') {
    await q(
      `INSERT INTO async_message_outbox (
          tenant_id, source_table, source_id, topic, payload
        )
       VALUES ($1, 'notification_intents', $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, source_table, source_id, topic) DO NOTHING`,
      [
        context.tenantId,
        notificationId,
        `notification.${context.eventType.toLowerCase()}`,
        JSON.stringify(notificationPayload),
      ]
    )
  }

  return {
    notificationId,
    eventType: context.eventType,
    templateCode: template.templateCode,
    status,
    channel: 'EMAIL',
    recipient,
    subject,
    body,
  }
}
