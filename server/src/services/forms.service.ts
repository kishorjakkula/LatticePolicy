import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { today, coerceDateOnly, asDateOnly } from '../lib/date.utils.js'
import { sanitizeInlineFileName } from '../lib/utils.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FormsPreviewBody = {
  lineOfBusiness?: string
  productCode?: string
  transactionType?: string
  state?: string
  effectiveDate?: string
  [key: string]: unknown
}

export type FormPreviewItem = {
  formId: string
  formNumber: string
  formTitle: string
  editionDate: string | undefined
  authority: string
  lineOfBusiness: string
  carrierCode: string
  packetPlacement: string
  sortOrder: number
  reasons: string[]
}

export type FormDocumentData = {
  form: any
  output: any | null
  jurisdictions: any[]
  templateAsset: any | null
} | null

// ── Helpers ───────────────────────────────────────────────────────────────────

const FORMS_PREVIEW_DEFAULT_FUTURE_DATE = '9999-12-31'
const FORMS_PREVIEW_TRANSACTION_TYPES = new Set([
  'Quote',
  'Bind',
  'Issue',
  'Endorsement',
  'Renewal',
  'Cancellation',
  'Reinstatement',
  'Rewrite'
])

function normalizeFormsPreviewLabel(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeFormsPreviewProductCode(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeFormsPreviewTransactionType(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw === 'quote') return 'Quote'
  if (raw === 'bind') return 'Bind'
  if (raw === 'issue') return 'Issue'
  if (raw === 'endorsement' || raw === 'endorse') return 'Endorsement'
  if (raw === 'renewal' || raw === 'renew') return 'Renewal'
  if (raw === 'cancellation' || raw === 'cancel') return 'Cancellation'
  if (raw === 'reinstatement' || raw === 'reinstate') return 'Reinstatement'
  if (raw === 'rewrite') return 'Rewrite'
  return ''
}

function normalizeStateCode(value: unknown): string {
  return String(value || '').trim().toUpperCase()
}

function mapRowsByFormId(rows: any[]): Record<string, any[]> {
  const out: Record<string, any[]> = {}
  for (const row of rows || []) {
    const key = String(row.form_id || '')
    if (!key) continue
    if (!out[key]) out[key] = []
    out[key].push(row)
  }
  return out
}

function pickMatchingPreviewJurisdiction(
  rows: any[],
  stateCode: string,
  effectiveDate: string
): any | null {
  if (!rows?.length) return null
  const sorted = [...rows].sort((a, b) => {
    const aState = String(a.state_code || '').toUpperCase()
    const bState = String(b.state_code || '').toUpperCase()
    const aExact = stateCode && aState === stateCode ? 1 : 0
    const bExact = stateCode && bState === stateCode ? 1 : 0
    if (aExact !== bExact) return bExact - aExact
    return String(a.effective_date || '').localeCompare(String(b.effective_date || ''))
  })
  for (const row of sorted) {
    if (String(row.regulatory_status || '') !== 'Approved') continue
    const rowState = String(row.state_code || '').toUpperCase()
    if (stateCode && rowState !== stateCode && rowState !== 'ALL') continue
    const start = asDateOnly(row.effective_date)
    const end = asDateOnly(row.sunset_date) || FORMS_PREVIEW_DEFAULT_FUTURE_DATE
    if (!start) continue
    if (start <= effectiveDate && effectiveDate <= end) return row
  }
  return null
}

function isPreviewApplicabilityMatch(
  rows: any[],
  input: { lineOfBusiness: string; productCode: string; transactionType: string }
): boolean {
  if (!rows?.length) return true
  return rows.some((row) => {
    const lob = String(row.line_of_business || '').trim().toLowerCase()
    const product = String(row.product_code || '').trim().toLowerCase()
    const txValues = Array.isArray(row.transaction_types)
      ? row.transaction_types.filter(Boolean)
      : []
    const normalizedTxValues = txValues
      .map((item: any) => String(item || '').trim())
      .filter((item: string) => FORMS_PREVIEW_TRANSACTION_TYPES.has(item))
    const lobOk = !input.lineOfBusiness || !lob || lob === input.lineOfBusiness
    const productOk = !input.productCode || !product || product === input.productCode
    const txOk =
      !input.transactionType ||
      normalizedTxValues.length === 0 ||
      normalizedTxValues.includes(input.transactionType)
    return row.active !== false && lobOk && productOk && txOk
  })
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatEditionDateForDocument(value: string): string {
  const raw = String(value || '').trim()
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(raw)
  if (!match) return raw || '-'
  return `${match[2]}/${match[1]}`
}

export function buildWizardFormDocumentHtml(
  form: any,
  output: any,
  jurisdictions: any[]
): string {
  const formNumber = escapeHtml(String(form?.form_number || '-'))
  const formTitle = escapeHtml(String(form?.form_title || '-'))
  const editionDate = escapeHtml(formatEditionDateForDocument(String(form?.edition_date || '')))
  const authority = escapeHtml(String(form?.authority || '-'))
  const formType = escapeHtml(String(form?.form_type || '-'))
  const lineOfBusiness = escapeHtml(String(form?.line_of_business || '-'))
  const workflowStatus = escapeHtml(String(form?.workflow_status || '-'))
  const active = form?.active ? 'Yes' : 'No'
  const templateSource = escapeHtml(String(output?.template_source || 'Static PDF'))
  const outputFormat = escapeHtml(String(output?.output_format || 'PDF'))
  const placement = escapeHtml(String(output?.packet_placement || 'End'))

  const rows = (Array.isArray(jurisdictions) ? jurisdictions : [])
    .map((row) => {
      const state = escapeHtml(String(row.state_code || '-'))
      const status = escapeHtml(String(row.regulatory_status || '-'))
      const effective = escapeHtml(asDateOnly(row.effective_date) || '-')
      const sunset = escapeHtml(asDateOnly(row.sunset_date) || '-')
      const trackingId = escapeHtml(String(row.approval_tracking_id || '-'))
      return `<tr><td>${state}</td><td>${status}</td><td>${effective}</td><td>${sunset}</td><td>${trackingId}</td></tr>`
    })
    .join('')

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Form ${formNumber}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1f2a44; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      h2 { margin: 20px 0 8px; font-size: 18px; }
      .muted { color: #55627f; }
      .grid { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 8px 16px; }
      .item strong { display: block; font-size: 12px; color: #5d6a86; margin-bottom: 2px; text-transform: uppercase; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #d6dfef; padding: 8px; font-size: 13px; text-align: left; }
      th { background: #f1f4fb; }
    </style>
  </head>
  <body>
    <h1>${formNumber}</h1>
    <div class="muted">${formTitle}</div>

    <h2>Form Metadata</h2>
    <div class="grid">
      <div class="item"><strong>Edition Date</strong>${editionDate}</div>
      <div class="item"><strong>Authority</strong>${authority}</div>
      <div class="item"><strong>Type</strong>${formType}</div>
      <div class="item"><strong>Line of Business</strong>${lineOfBusiness}</div>
      <div class="item"><strong>Workflow Status</strong>${workflowStatus}</div>
      <div class="item"><strong>Active</strong>${active}</div>
      <div class="item"><strong>Template Source</strong>${templateSource}</div>
      <div class="item"><strong>Output Format</strong>${outputFormat}</div>
      <div class="item"><strong>Packet Placement</strong>${placement}</div>
    </div>

    <h2>Jurisdictions</h2>
    <table>
      <thead>
        <tr><th>State</th><th>Status</th><th>Effective</th><th>Sunset</th><th>Tracking ID</th></tr>
      </thead>
      <tbody>
        ${rows || '<tr><td colspan="5">No jurisdiction rows configured.</td></tr>'}
      </tbody>
    </table>
  </body>
</html>`
}

export { sanitizeInlineFileName }

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Preview which forms are applicable for a given submission context.
 *
 * Queries forms_admin_forms, forms_admin_jurisdictions, forms_admin_applicability,
 * and forms_admin_output tables, then filters and sorts forms based on
 * jurisdiction approval, applicability rules, and output sort order.
 *
 * Returns an empty array if no forms match.
 */
export async function previewForm(
  db: DrizzleDB,
  tenantId: string,
  body: FormsPreviewBody
): Promise<FormPreviewItem[]> {
  const lineOfBusiness = normalizeFormsPreviewLabel(body.lineOfBusiness)
  const productCode = normalizeFormsPreviewProductCode(body.productCode)
  const transactionType = normalizeFormsPreviewTransactionType(body.transactionType)
  const stateCode = normalizeStateCode(body.state)
  const effectiveDate = coerceDateOnly(body.effectiveDate, today())

  const result = await withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    const formsRes = await q(
      `SELECT form_id, carrier_code, authority, form_number, form_title, edition_date,
              line_of_business, require_approved_jurisdiction
         FROM forms_admin_forms
        WHERE tenant_id = $1
          AND active = true
          AND workflow_status = 'Approved'
        ORDER BY updated_at DESC`,
      [tenantId]
    )
    const forms = formsRes.rows || []
    if (!forms.length) return []

    const formIds = forms.map((row: any) => row.form_id)
    const [jurisdictionsRes, applicabilityRes, outputRes] = await Promise.all([
      q(
        `SELECT form_id, state_code, regulatory_status, effective_date, sunset_date
           FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[])`,
        [tenantId, formIds]
      ),
      q(
        `SELECT form_id, line_of_business, product_code, transaction_types, active
           FROM forms_admin_applicability
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[]) AND active = true`,
        [tenantId, formIds]
      ),
      q(
        `SELECT form_id, packet_placement, sort_order
           FROM forms_admin_output
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[])`,
        [tenantId, formIds]
      )
    ])

    const jurisdictionsByForm = mapRowsByFormId(jurisdictionsRes.rows || [])
    const applicabilityByForm = mapRowsByFormId(applicabilityRes.rows || [])
    const outputByForm = mapRowsByFormId(outputRes.rows || [])

    const attached: FormPreviewItem[] = []
    for (const form of forms) {
      const reasons: string[] = []
      if (lineOfBusiness && String(form.line_of_business || '') !== lineOfBusiness) continue

      const jurisdictionRows = jurisdictionsByForm[String(form.form_id)] || []
      const matchedJurisdiction = pickMatchingPreviewJurisdiction(
        jurisdictionRows,
        stateCode,
        effectiveDate
      )
      if (form.require_approved_jurisdiction && !matchedJurisdiction) continue
      if (matchedJurisdiction) {
        reasons.push(`Jurisdiction ${matchedJurisdiction.state_code} approved`)
      }

      const applicabilityRows = applicabilityByForm[String(form.form_id)] || []
      if (
        !isPreviewApplicabilityMatch(applicabilityRows, {
          lineOfBusiness,
          productCode,
          transactionType
        })
      )
        continue
      if (applicabilityRows.length > 0) reasons.push('Applicability matched')

      const outputRow = (outputByForm[String(form.form_id)] || [])[0]
      attached.push({
        formId: form.form_id,
        formNumber: form.form_number,
        formTitle: form.form_title,
        editionDate: asDateOnly(form.edition_date),
        authority: form.authority,
        lineOfBusiness: form.line_of_business,
        carrierCode: form.carrier_code,
        packetPlacement: outputRow?.packet_placement || 'End',
        sortOrder: Number(outputRow?.sort_order || 100),
        reasons
      })
    }

    attached.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return String(a.formNumber || '').localeCompare(String(b.formNumber || ''))
    })
    return attached
  })

  return result as FormPreviewItem[]
}

/**
 * Retrieve full document data for a form by ID.
 *
 * Queries forms_admin_forms, forms_admin_output, forms_admin_jurisdictions,
 * and forms_admin_template_assets in parallel. Returns null if the form is
 * not found, otherwise returns the raw DB rows for the route handler to render.
 */
export async function getFormDocument(
  db: DrizzleDB,
  tenantId: string,
  formId: string,
  _body?: unknown
): Promise<FormDocumentData> {
  return withTenantTx(tenantId, async (innerDb) => {
    const q = toRawQuery(innerDb)
    const [formRes, outputRes, jurisdictionsRes, assetRes] = await Promise.all([
      q(
        `SELECT form_id, carrier_code, authority, form_number, form_title, edition_date,
                form_type, line_of_business, workflow_status, active
           FROM forms_admin_forms
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      ),
      q(
        `SELECT template_source, template_uri, output_format, merge_scope, packet_placement
           FROM forms_admin_output
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      ),
      q(
        `SELECT state_code, regulatory_status, effective_date, sunset_date, approval_tracking_id
           FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY state_code ASC, effective_date ASC`,
        [tenantId, formId]
      ),
      q(
        `SELECT file_name, mime_type, content
           FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      )
    ])

    if (!formRes.rowCount) return null

    return {
      form: formRes.rows[0],
      output: outputRes.rowCount ? outputRes.rows[0] : null,
      jurisdictions: jurisdictionsRes.rows || [],
      templateAsset: assetRes.rowCount ? assetRes.rows[0] : null
    }
  })
}
