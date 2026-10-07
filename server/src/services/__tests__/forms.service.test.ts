import { describe, expect, it } from 'vitest'
import { buildWizardFormDocumentHtml, isPreviewApplicabilityMatch } from '../forms.service.js'

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

  it('matches when a row leaves product_code/line_of_business blank (unscoped row, still applicability-declared)', () => {
    const rows = [{ line_of_business: '', product_code: '', transaction_types: ['NB'], active: true }]
    expect(isPreviewApplicabilityMatch(rows, baseInput)).toBe(true)
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
