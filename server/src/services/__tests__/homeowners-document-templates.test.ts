import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import {
  DOCUMENT_TEMPLATE_VARIABLES,
  extractDocxPlaceholderTokens,
  renderDocxTemplate,
  resolvePolicyDetailTokens,
  validateDocxPlaceholderTokens,
} from '../document-template-variables.js'
import { loadProductConfig } from '../../lib/products.js'

const DIR = path.resolve(__dirname, '../../../../products/homeowners/documents')
const TEMPLATES = ['HO-DEC.docx', 'HO-BINDER.docx', 'HO-EOI.docx', 'HO-QUOTE.docx']

/** Paragraph text of a Word document: the w:t runs of each paragraph, one paragraph per line. */
function documentText(buffer: Buffer): string {
  const xml = new PizZip(buffer).file('word/document.xml')!.asText()
  return xml
    .split('</w:p>')
    .map((paragraph) => Array.from(paragraph.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g), (match) => match[1]).join(''))
    .join('\n')
    .split('&amp;').join('&')
}

describe('homeowners document templates', () => {
  it.each(TEMPLATES)('%s uses only recognised merge tokens', (file) => {
    const tokens = extractDocxPlaceholderTokens(fs.readFileSync(path.join(DIR, file)))
    expect(tokens.length).toBeGreaterThan(5)
    expect(validateDocxPlaceholderTokens(tokens).unrecognized).toEqual([])
  })

  it('fills the declarations with the policy values', () => {
    const data: Record<string, string> = Object.fromEntries(DOCUMENT_TEMPLATE_VARIABLES.map((variable) => [variable.token, '']))
    Object.assign(data, { policyNumber: 'HO-2026-000123', insuredName: 'Maria Gonzalez', effectiveDate: '2026-11-15', expirationDate: '2027-11-15', premiumTotal: '1,842.10', premiumCurrency: 'USD' })
    Object.assign(data, resolvePolicyDetailTokens({
      productCode: 'homeowners',
      underwritingCompanyName: 'Sample Carrier Property',
      risks: [{ address: '2214 Live Oak Dr, Austin TX 78704' }],
      additionalInterests: [{ role: 'MORTGAGEE', name: 'Capital City Mortgage Corp', loanNumber: 'CCM-1' }],
      coverages: [{ code: 'A', limit: 385000, deductible: 1000, windHailPercent: 2 }, { code: 'E', limit: 300000 }, { code: 'END_WB', limit: 10000 }],
    }, loadProductConfig('homeowners')))
    const output = documentText(renderDocxTemplate(fs.readFileSync(path.join(DIR, 'HO-DEC.docx')), data))
    expect(output).toContain('HO-2026-000123')
    expect(output).toContain('Coverage A - Dwelling\n$385,000')
    expect(output).toContain('2% of Coverage A ($7,700)')
    expect(output).toContain('Water Back-Up and Sump Overflow: $10,000')
    expect(output).toContain('Mortgagee, Capital City Mortgage Corp, loan CCM-1')
    expect(output).toContain('Illustrative LatticePolicy template')
    expect(output).not.toContain('{{')
  })
})
