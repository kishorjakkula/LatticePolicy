import crypto from 'crypto'
import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { renderAndStoreDocument } from './document-storage.service.js'

export type PolicyDocumentTransactionType =
  | 'NB'
  | 'Issue'
  | 'Endorse'
  | 'Cancel'
  | 'Reinstate'
  | 'Rewrite'
  | 'Renew'
  | 'NonRenewal'

export type PolicyDocumentContext = {
  tenantId: string
  policyId: string
  policyNumber?: string | null
  transactionId: string
  transactionType: PolicyDocumentTransactionType
  transactionNumber?: string | null
  productCode: string
  state?: string | null
  effectiveDate: string
  generatedBy?: string | null
  correlationId?: string | null
}

export type SelectedPolicyForm = {
  policyFormId: string
  formId: string | null
  code: string
  title: string
  edition: string | null
  formType: string | null
  source: 'forms_admin' | 'forms_catalog'
  visibility: string[]
  customerSafe: boolean
  sortOrder: number
  metadata: Record<string, unknown>
}

export type GeneratedPolicyDocument = {
  documentId: string
  type: 'POLICY_PACKET'
  uri: string
  hash: string
  metadata: Record<string, unknown>
}

export type PolicyDocumentPacket = {
  forms: SelectedPolicyForm[]
  documents: GeneratedPolicyDocument[]
}

type QueryFn = ReturnType<typeof toRawQuery>

const CUSTOMER_VISIBILITY = new Set(['customer', 'insured', 'portal'])

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeTransactionType(type: string): string {
  const normalized = normalizeText(type).toLowerCase()
  if (normalized === 'issue' || normalized === 'newbusiness' || normalized === 'new_business') return 'nb'
  if (normalized === 'nonrenewal' || normalized === 'non-renewal' || normalized === 'non_renewal') return 'nonrenewal'
  return normalized
}

function matchesTransactionType(transactionTypes: unknown, transactionType: string): boolean {
  const normalized = normalizeTransactionType(transactionType)
  const values = Array.isArray(transactionTypes) ? transactionTypes : []
  if (!values.length) return true
  return values.some((value) => normalizeTransactionType(String(value)) === normalized)
}

function isCustomerSafe(visibility: string[]): boolean {
  return visibility.map((item) => item.toLowerCase()).some((item) => CUSTOMER_VISIBILITY.has(item))
}

function editionToString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function buildPacketDocument(context: PolicyDocumentContext, forms: SelectedPolicyForm[]): GeneratedPolicyDocument[] {
  if (!forms.length) return []
  const generatedAt = new Date().toISOString()
  const visibility = forms.every((form) => form.customerSafe) ? ['internal', 'customer'] : ['internal']
  const metadata = {
    policyId: context.policyId,
    policyNumber: context.policyNumber || null,
    transactionId: context.transactionId,
    transactionType: context.transactionType,
    transactionNumber: context.transactionNumber || null,
    productCode: context.productCode,
    state: context.state || null,
    effectiveDate: context.effectiveDate,
    generatedAt,
    generatedBy: context.generatedBy || null,
    correlationId: context.correlationId || null,
    visibility,
    customerSafe: visibility.includes('customer'),
    forms: forms.map((form) => ({
      formId: form.formId,
      code: form.code,
      title: form.title,
      edition: form.edition,
      source: form.source,
      customerSafe: form.customerSafe,
    })),
  }
  return [
    {
      documentId: uuidv4(),
      type: 'POLICY_PACKET',
      uri: `generated://policy-packet/${context.policyId}/${context.transactionId}`,
      hash: sha256(metadata),
      metadata,
    },
  ]
}

async function attachRenderedArtifact(
  context: PolicyDocumentContext,
  forms: SelectedPolicyForm[],
  document: GeneratedPolicyDocument
): Promise<GeneratedPolicyDocument> {
  const artifact = await renderAndStoreDocument({
    tenantId: context.tenantId,
    documentId: document.documentId,
    metadata: {
      policyId: context.policyId,
      policyNumber: context.policyNumber,
      transactionId: context.transactionId,
      transactionType: context.transactionType,
      transactionNumber: context.transactionNumber,
      productCode: context.productCode,
      state: context.state,
      effectiveDate: context.effectiveDate,
      generatedAt: String((document.metadata as any).generatedAt || new Date().toISOString()),
      forms: forms.map((form) => ({
        code: form.code,
        title: form.title,
        edition: form.edition,
        source: form.source,
        customerSafe: form.customerSafe,
      })),
    },
  })
  return {
    ...document,
    hash: artifact.contentHash,
    metadata: {
      ...document.metadata,
      artifact: {
        storageUri: artifact.storageUri,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        storageAdapter: artifact.storageAdapter,
        renderedAt: artifact.renderedAt,
      },
    },
  }
}

export async function selectPolicyForms(
  q: QueryFn,
  context: PolicyDocumentContext
): Promise<SelectedPolicyForm[]> {
  const productCode = normalizeText(context.productCode)
  const state = normalizeText(context.state).toUpperCase()
  const effectiveDate = context.effectiveDate

  const adminRows = await q(
    `SELECT f.form_id, f.form_number, f.form_title, f.edition_date, f.form_type,
            a.transaction_types, o.output_format, o.packet_placement, o.sort_order,
            d.visibility, j.state_code, j.regulatory_status, f.metadata
       FROM forms_admin_forms f
       JOIN forms_admin_applicability a
         ON a.tenant_id = f.tenant_id AND a.form_id = f.form_id AND a.active = true
       LEFT JOIN forms_admin_output o
         ON o.tenant_id = f.tenant_id AND o.form_id = f.form_id AND o.active = true
       LEFT JOIN forms_admin_delivery d
         ON d.tenant_id = f.tenant_id AND d.form_id = f.form_id AND d.active = true
       LEFT JOIN forms_admin_jurisdictions j
         ON j.tenant_id = f.tenant_id
        AND j.form_id = f.form_id
        AND ($3::text = '' OR upper(j.state_code) = $3)
        AND j.effective_date <= $4::date
        AND (j.sunset_date IS NULL OR j.sunset_date >= $4::date)
      WHERE f.tenant_id = $1
        AND f.active = true
        AND lower(f.workflow_status) IN ('approved', 'active', 'filed')
        AND lower(a.product_code) = lower($2)
      ORDER BY COALESCE(o.sort_order, 100), f.form_number`,
    [context.tenantId, productCode, state, effectiveDate]
  )

  const forms: SelectedPolicyForm[] = []
  const seen = new Set<string>()
  for (const row of adminRows.rows as any[]) {
    if (!matchesTransactionType(row.transaction_types, context.transactionType)) continue
    if (state && row.state_code && !['approved', 'active', 'filed'].includes(String(row.regulatory_status || '').toLowerCase())) continue
    const code = normalizeText(row.form_number)
    if (!code || seen.has(`admin:${row.form_id}`)) continue
    const visibility = Array.isArray(row.visibility) && row.visibility.length ? row.visibility.map(String) : ['internal']
    seen.add(`admin:${row.form_id}`)
    forms.push({
      policyFormId: uuidv4(),
      formId: null,
      code,
      title: normalizeText(row.form_title),
      edition: editionToString(row.edition_date),
      formType: row.form_type || null,
      source: 'forms_admin',
      visibility,
      customerSafe: isCustomerSafe(visibility),
      sortOrder: Number(row.sort_order || 100),
      metadata: {
        source: 'forms_admin',
        sourceFormId: row.form_id || null,
        packetPlacement: row.packet_placement || 'End',
        outputFormat: row.output_format || 'PDF',
        formMetadata: row.metadata || {},
      },
    })
  }

  const catalogRows = await q(
    `SELECT form_id, code, edition, name, jurisdiction, applicability, render
       FROM forms_catalog
      WHERE tenant_id = $1
        AND active = true
        AND lower(COALESCE(applicability->>'productCode', applicability->>'product', '')) = lower($2)
      ORDER BY code`,
    [context.tenantId, productCode]
  )

  for (const row of catalogRows.rows as any[]) {
    const applicability = row.applicability || {}
    if (!matchesTransactionType(applicability.transactionTypes || applicability.transactions, context.transactionType)) continue
    const formState = normalizeText(row.jurisdiction?.state || row.jurisdiction?.region || applicability.state).toUpperCase()
    if (state && formState && formState !== state) continue
    const code = normalizeText(row.code)
    if (!code || seen.has(`catalog:${row.form_id}`)) continue
    const visibility = Array.isArray(applicability.visibility) && applicability.visibility.length
      ? applicability.visibility.map(String)
      : ['internal']
    seen.add(`catalog:${row.form_id}`)
    forms.push({
      policyFormId: uuidv4(),
      formId: row.form_id || null,
      code,
      title: normalizeText(row.name),
      edition: editionToString(row.edition),
      formType: normalizeText(applicability.formType) || null,
      source: 'forms_catalog',
      visibility,
      customerSafe: isCustomerSafe(visibility),
      sortOrder: Number(applicability.sortOrder || 100),
      metadata: {
        source: 'forms_catalog',
        render: row.render || {},
      },
    })
  }

  return forms.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
}

export async function buildPolicyDocumentPacket(
  q: QueryFn,
  context: PolicyDocumentContext
): Promise<PolicyDocumentPacket> {
  const forms = await selectPolicyForms(q, context)
  const documents = await Promise.all(
    buildPacketDocument(context, forms).map((document) => attachRenderedArtifact(context, forms, document))
  )
  return { forms, documents }
}

export async function persistPolicyDocumentPacket(
  db: DrizzleDB,
  context: PolicyDocumentContext,
  packet: PolicyDocumentPacket
): Promise<void> {
  if (!packet.forms.length && !packet.documents.length) return
  const q = toRawQuery(db)

  for (const form of packet.forms) {
    await q(
      `INSERT INTO policy_forms
        (policy_form_id, tenant_id, policy_id, transaction_id, form_id, code, data, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        form.policyFormId,
        context.tenantId,
        context.policyId,
        context.transactionId,
        form.formId,
        form.code,
        JSON.stringify({
          title: form.title,
          edition: form.edition,
          formType: form.formType,
          visibility: form.visibility,
          customerSafe: form.customerSafe,
        }),
        JSON.stringify(form.metadata),
      ]
    )
  }

  for (const doc of packet.documents) {
    await q(
      `INSERT INTO documents
        (document_id, tenant_id, policy_id, transaction_id, type, uri, hash, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
      [
        doc.documentId,
        context.tenantId,
        context.policyId,
        context.transactionId,
        doc.type,
        doc.uri,
        doc.hash,
        JSON.stringify(doc.metadata),
        context.generatedBy || null,
      ]
    )
  }
}
