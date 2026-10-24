import fs from 'node:fs'
import path from 'node:path'
import { resolveProductPackDir } from '../lib/product-registry.js'
import { ensureDefaultFormRows } from '../routes/forms-admin.routes.js'
import { extractDocxPlaceholderTokens, validateDocxPlaceholderTokens } from './document-template-variables.js'

type QueryFn = (text: string, params?: any[]) => Promise<any>

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type ProductDocumentTemplate = {
  productCode: string; formNumber: string; formTitle: string; file: string; transactionTypes: string[]
  endorsementChangeCriteria?: { alwaysAttachOnEndorsement: boolean }
}

/**
 * Word templates a product ships in products/<code>/documents/, and the form
 * each one fills. Seeding creates the form when missing and attaches the
 * template when the form has none, so a carrier's own uploaded template is
 * never replaced. Generated at bind with the rest of the policy packet.
 */
export const PRODUCT_DOCUMENT_TEMPLATES: ProductDocumentTemplate[] = [
  // Declarations print on every transaction that changes the policy.
  { productCode: 'homeowners', formNumber: 'HO-DEC', formTitle: 'Homeowners Declarations', file: 'HO-DEC.docx', transactionTypes: [] as string[] },
  // A binder confirms new business; the lender needs evidence at new business and renewal.
  { productCode: 'homeowners', formNumber: 'HO-BINDER', formTitle: 'Homeowners Binder', file: 'HO-BINDER.docx', transactionTypes: ['NB'] },
  { productCode: 'homeowners', formNumber: 'HO-EOI', formTitle: 'Evidence of Property Insurance for the Mortgagee', file: 'HO-EOI.docx', transactionTypes: ['NB', 'Renew'] },
  // Demo products are opt-in, including through normal admin reference seeding.
  { productCode: 'businessowners', formNumber: 'BOP-QUOTE', formTitle: 'Businessowners Demo Quote', file: 'BOP-QUOTE.docx', transactionTypes: ['Quote'] },
  { productCode: 'businessowners', formNumber: 'BOP-BINDER', formTitle: 'Businessowners Demo Binder', file: 'BOP-BINDER.docx', transactionTypes: ['Bind'] },
  { productCode: 'businessowners', formNumber: 'BOP-DEC', formTitle: 'Businessowners Demo Declarations', file: 'BOP-DEC.docx', transactionTypes: ['Issue', 'Endorse', 'Renew', 'Rewrite'], endorsementChangeCriteria: { alwaysAttachOnEndorsement: true } },
]

export type ProductDocumentTemplateSeedOptions = {
  carrierCode: string
  authority: string
  editionDate: string
  /** Explicit selection replaces the homeowners-only default; [] seeds nothing. */
  productCodes?: string[]
}

export function productDocumentTemplatePath(productCode: string, file: string): string | null {
  const dir = resolveProductPackDir(productCode)
  if (!dir) return null
  const candidate = path.join(dir, 'documents', path.basename(file))
  return fs.existsSync(candidate) ? candidate : null
}

export async function seedProductDocumentTemplates(
  q: QueryFn,
  tenantId: string,
  actor: string,
  options: ProductDocumentTemplateSeedOptions
): Promise<{ created: string[]; attached: string[]; skipped: string[] }> {
  const summary = { created: [] as string[], attached: [] as string[], skipped: [] as string[] }
  const selected = new Set(options.productCodes ?? ['homeowners'])
  for (const entry of PRODUCT_DOCUMENT_TEMPLATES.filter(entry => selected.has(entry.productCode))) {
    const demo = entry.productCode === 'businessowners'
    const templatePath = productDocumentTemplatePath(entry.productCode, entry.file)
    if (!templatePath) {
      summary.skipped.push(entry.formNumber)
      continue
    }
    const content = fs.readFileSync(templatePath)
    // Never seed a template the token catalog would reject on upload.
    if (validateDocxPlaceholderTokens(extractDocxPlaceholderTokens(content)).unrecognized.length) {
      summary.skipped.push(entry.formNumber)
      continue
    }
    const existing = await q(
      `SELECT form_id, metadata FROM forms_admin_forms WHERE tenant_id=$1 AND carrier_code=$2 AND authority=$3 AND form_number=$4 AND edition_date=$5::date LIMIT 1`,
      [tenantId, options.carrierCode, options.authority, entry.formNumber, options.editionDate]
    )
    let formId: string = existing.rows?.[0]?.form_id
    // Never adopt a carrier-owned form merely because it shares a demo number.
    if (demo && formId && existing.rows[0].metadata?.seedCode !== 'businessowners-demo') {
      summary.skipped.push(entry.formNumber)
      continue
    }
    if (!formId) {
      const inserted = await q(
        `INSERT INTO forms_admin_forms (
            tenant_id, carrier_code, authority, form_number, form_title, edition_date,
            form_type, line_of_business, workflow_status, active, edit_lock, require_approved_jurisdiction,
            metadata, created_by, updated_by, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::date,'Policy',$7,'Approved',true,true,false,$8::jsonb,$9,$9,now())
         RETURNING form_id`,
        [tenantId, options.carrierCode, options.authority, entry.formNumber, entry.formTitle, options.editionDate, entry.productCode,
          JSON.stringify({ seedCode: demo ? 'businessowners-demo' : 'seed-reference-data',
            template: `products/${entry.productCode}/documents/${entry.file}`,
            ...(demo ? { demo: true, nonContractual: true, regulatoryApprovalClaimed: false, workPackage: 'WP-0010' } : {}) }), actor]
      )
      formId = inserted.rows[0].form_id
      await ensureDefaultFormRows(q, tenantId, formId, actor)
      summary.created.push(entry.formNumber)
    }
    // Which product and transactions the form attaches to; never changes rules a carrier has set.
    if (entry.transactionTypes.length) {
      const rules = await q(`SELECT 1 FROM forms_admin_applicability WHERE tenant_id=$1 AND form_id=$2 LIMIT 1`, [tenantId, formId])
      if (!rules.rowCount) {
        await q(
          `INSERT INTO forms_admin_applicability (tenant_id, form_id, line_of_business, product_code, transaction_types, endorsement_change_criteria, active, created_by, updated_by)
           VALUES ($1,$2,$3,$3,$4::text[],$5::jsonb,true,$6,$6)`,
          [tenantId, formId, entry.productCode, entry.transactionTypes, JSON.stringify(entry.endorsementChangeCriteria || {}), actor]
        )
      }
    }
    const asset = await q(`SELECT 1 FROM forms_admin_template_assets WHERE tenant_id=$1 AND form_id=$2 LIMIT 1`, [tenantId, formId])
    if (asset.rowCount) {
      summary.skipped.push(`${entry.formNumber} template`)
      continue
    }
    const stored = await q(
      `INSERT INTO forms_admin_template_assets (tenant_id, form_id, file_name, mime_type, size_bytes, content, created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,now()) RETURNING asset_id`,
      [tenantId, formId, entry.file, DOCX_MIME, content.length, content, actor]
    )
    await q(
      `INSERT INTO forms_admin_output (tenant_id, form_id, template_source, template_uri, output_format, merge_scope, packet_placement, sort_order, active, created_by, updated_by, updated_at)
       VALUES ($1,$2,'Uploaded DOCX',$3,'DOCX','policy','End',100,true,$4,$4,now())
       ON CONFLICT (tenant_id, form_id)
       DO UPDATE SET template_source = EXCLUDED.template_source, template_uri = EXCLUDED.template_uri, output_format = EXCLUDED.output_format, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [tenantId, formId, `asset://${stored.rows[0].asset_id}`, actor]
    )
    summary.attached.push(entry.formNumber)
  }
  return summary
}
