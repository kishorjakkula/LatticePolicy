import { describe, expect, it, vi } from 'vitest'

const previewTables = vi.hoisted(() => ({ forms: [] as any[], applicability: [] as any[] }))
vi.mock('../../db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db.js')>()),
  withTenantTx: async (_tenantId: string, fn: (db: unknown) => unknown) => fn({}),
  toRawQuery: () => async (text: string) => {
    if (text.includes('FROM forms_admin_forms')) return { rows: previewTables.forms, rowCount: previewTables.forms.length }
    if (text.includes('FROM forms_admin_applicability')) return { rows: previewTables.applicability, rowCount: previewTables.applicability.length }
    return { rows: [], rowCount: 0 }
  },
}))

import { buildWizardFormDocumentHtml, isPreviewApplicabilityMatch, previewForm } from '../forms.service.js'

const baseInput = { lineOfBusiness: 'personal-auto', productCode: 'personal-auto', transactionType: 'NB' }

describe('forms service — applicability preview matching', () => {
  it('treats a form with zero applicability rows as matching every submission', () => {
    expect(isPreviewApplicabilityMatch([], baseInput)).toBe(true)
    expect(isPreviewApplicabilityMatch(undefined as any, baseInput)).toBe(true)
  })

  it('matches when a row is scoped to the same line of business, product, and transaction type', () => {
    const rows = [{ line_of_business: 'personal-auto', product_code: 'personal-auto', transaction_types: ['NB'], active: true }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(true)
  })

  it('excludes when every row is scoped to a different product', () => {
    const rows = [{ line_of_business: 'personal-auto', product_code: 'commercial-auto', transaction_types: ['NB'], active: true }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(false)
  })

  it('excludes when every row is scoped to a different transaction type', () => {
    const rows = [{ line_of_business: 'personal-auto', product_code: 'personal-auto', transaction_types: ['Endorsement'], active: true }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(false)
  })

  it('ignores inactive rows', () => {
    const rows = [{ line_of_business: 'personal-auto', product_code: 'personal-auto', transaction_types: ['NB'], active: false }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(false)
  })

  it('does not match a row with a blank product_code, as generation never attaches through one', () => {
    const rows = [{ line_of_business: '', product_code: '', transaction_types: ['NB'], active: true }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(false)
  })
})

describe('forms service — endorsement preview', () => {
  const formId = '11111111-1111-4111-8111-111111111111'
  const emailOnly = { changedPaths: ['/applicant/email'], addedCoverageCodes: [], removedCoverageCodes: [], modifiedCoverageCodes: [] }
  const collAdded = { changedPaths: ['/coverages/2'], addedCoverageCodes: ['COLL'], removedCoverageCodes: [], modifiedCoverageCodes: [] }
  const collRow = {
    form_id: formId, line_of_business: 'personal-auto', product_code: 'personal-auto', transaction_types: ['Endorsement'],
    endorsement_change_criteria: { coverageCodes: ['COLL'], changeTypes: ['added'], match: 'all' }, active: true,
  }
  const preview = (body: Record<string, unknown>) => previewForm({} as any, 'tenant-a', {
    lineOfBusiness: 'personal-auto', productCode: 'personal-auto', transactionType: 'Endorsement',
    state: 'CA', effectiveDate: '2026-08-01', ...body,
  })

  function useTables(applicability: any[]) {
    previewTables.forms = [{
      form_id: formId, carrier_code: 'C', authority: 'Carrier', form_number: 'PA-COLL-END', form_title: 'Collision Added',
      edition_date: '2026-01-01', line_of_business: 'personal-auto', require_approved_jurisdiction: false, metadata: {},
    }]
    previewTables.applicability = applicability
  }

  it('excludes a form whose endorsement criteria the change does not meet', async () => {
    useTables([collRow])
    expect(await preview({ endorsementChanges: emailOnly })).toEqual([])
  })

  it('includes the form when the change meets its criteria', async () => {
    useTables([collRow])
    const rows = await preview({ endorsementChanges: collAdded })
    expect(rows.map((row) => row.formNumber)).toEqual(['PA-COLL-END'])
    expect(rows[0].reasons).toContain('Endorsement change criteria matched')
  })

  it('lists only always-attach forms when no change set is supplied, as generation would', async () => {
    useTables([collRow])
    expect(await preview({})).toEqual([])
    expect(await preview({ endorsementChanges: 'COLL' })).toEqual([])
    useTables([{ ...collRow, endorsement_change_criteria: { alwaysAttachOnEndorsement: true } }])
    expect((await preview({})).map((row) => row.formNumber)).toEqual(['PA-COLL-END'])
  })

  it('excludes a form with no endorsement criteria or no applicability rows on an endorsement', async () => {
    useTables([{ ...collRow, endorsement_change_criteria: null }])
    expect(await preview({ endorsementChanges: collAdded })).toEqual([])
    useTables([])
    expect(await preview({ endorsementChanges: collAdded })).toEqual([])
  })

  it('ignores endorsement criteria and changes outside an endorsement', async () => {
    useTables([{ ...collRow, transaction_types: ['Renewal'] }])
    expect((await preview({ transactionType: 'Renewal', endorsementChanges: emailOnly })).map((row) => row.formNumber)).toEqual(['PA-COLL-END'])
  })
})

describe('forms service — buildWizardFormDocumentHtml', () => {
  it('renders the form number, title, and escapes untrusted text', () => {
    const html = buildWizardFormDocumentHtml(
      { form_number: 'PA-DEC', form_title: '<script>alert(1)</script>', edition_date: '2026-01-01', active: true },
      { template_source: 'Static PDF', output_format: 'PDF', packet_placement: 'Front' },
      [{ state_code: 'CA', regulatory_status: 'Approved', effective_date: '2026-01-01', sunset_date: null, approval_tracking_id: 'TRK-1' }]
    )
    expect(html).toContain('PA-DEC')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('TRK-1')
  })
})
