import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { seedProductDocumentTemplates } from '../services/product-document-templates.service.js'

const TENANT_ID = 'sample-carrier'
const OPTIONS = { carrierCode: 'SAMPLE', authority: 'ISO', editionDate: '2026-01-01' }

describe('product document template seeding', () => {
  beforeAll(async () => {
    await initDb()
    await getDb()!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,'Sample Carrier','en-US','USD') ON CONFLICT (tenant_id) DO NOTHING`,
      [TENANT_ID]
    )
  })
  afterAll(async () => { await closeDb() })

  it('creates the homeowners document forms with their Word templates, once', async () => {
    const first = await withTenantTx(TENANT_ID, (db) => seedProductDocumentTemplates(toRawQuery(db), TENANT_ID, 'test', OPTIONS))
    expect(first.attached.sort()).toEqual(['HO-BINDER', 'HO-DEC', 'HO-EOI'])

    const rows = await withTenantTx(TENANT_ID, async (db) => (await toRawQuery(db)(
      `SELECT f.form_number, f.line_of_business, f.workflow_status, o.template_source, o.output_format, a.mime_type, a.size_bytes
         FROM forms_admin_forms f
         JOIN forms_admin_output o ON o.tenant_id = f.tenant_id AND o.form_id = f.form_id
         JOIN forms_admin_template_assets a ON a.tenant_id = f.tenant_id AND a.form_id = f.form_id
        WHERE f.tenant_id = $1 AND f.form_number LIKE 'HO-%' ORDER BY f.form_number`,
      [TENANT_ID]
    )).rows)
    expect(rows.map((row: any) => row.form_number)).toEqual(['HO-BINDER', 'HO-DEC', 'HO-EOI'])
    for (const row of rows) {
      expect(row).toMatchObject({ line_of_business: 'homeowners', workflow_status: 'Approved', template_source: 'Uploaded DOCX', output_format: 'DOCX' })
      expect(row.size_bytes).toBeGreaterThan(1000)
    }

    const rules = await withTenantTx(TENANT_ID, async (db) => (await toRawQuery(db)(
      `SELECT f.form_number, a.transaction_types FROM forms_admin_forms f
         LEFT JOIN forms_admin_applicability a ON a.tenant_id = f.tenant_id AND a.form_id = f.form_id
        WHERE f.tenant_id = $1 AND f.form_number LIKE 'HO-%' ORDER BY f.form_number`,
      [TENANT_ID]
    )).rows)
    expect(rules).toEqual([
      { form_number: 'HO-BINDER', transaction_types: ['NB'] },
      { form_number: 'HO-DEC', transaction_types: null },
      { form_number: 'HO-EOI', transaction_types: ['NB', 'Renew'] },
    ])

    const second = await withTenantTx(TENANT_ID, (db) => seedProductDocumentTemplates(toRawQuery(db), TENANT_ID, 'test', OPTIONS))
    expect(second.attached).toEqual([])
    expect(second.created).toEqual([])
  })
})
