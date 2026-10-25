import fs from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { PRODUCT_DOCUMENT_TEMPLATES } from '../product-document-templates.service.js'
import { selectPolicyForms } from '../document-generation.service.js'
import {
  DOCUMENT_TEMPLATE_VARIABLES, extractDocxPlaceholderTokens, renderDocxTemplate,
  resolvePolicyDetailTokens, validateDocxPlaceholderTokens,
} from '../document-template-variables.js'

const entries = PRODUCT_DOCUMENT_TEMPLATES.filter(entry => entry.productCode === 'businessowners')
const directory = path.resolve(__dirname, '../../../../products/businessowners/documents')
const read = (file: string) => fs.readFileSync(path.join(directory, file))
const xml = (content: Buffer) => new PizZip(content).file('word/document.xml')!.asText()

function payload() {
  return {
    productCode: 'businessowners', state: 'OH',
    risks: [{ type: 'businessownersLocation', businessName: 'Synthetic Office LLC', businessClass: 'office',
      occupancy: 'tenant', locationAddress: { line1: '10 Example Street', line2: 'STE 2', city: 'Columbus', state: 'OH', postalCode: '43215', country: 'US' } }],
    coverages: [
      { code: 'BOP_BPP', selected: true, limit: 100000, deductible: 1000, packageTerms: { valuation: 'replacement-cost' } },
      { code: 'BOP_BI_EE', selected: true, limit: 100000, packageTerms: {
        basis: 'limited-dollar', restorationMonths: 12, waitingPeriodHours: 72,
        extraExpenseIncluded: true, sharedLimit: true,
      } },
      { code: 'BOP_LIAB', selected: true, limit: 1000000, packageTerms: {
        basis: 'occurrence', generalAggregate: 2000000, productsCompletedOperationsAggregate: 2000000,
        personalAdvertisingInjuryLimit: 1000000, damageToRentedPremisesLimit: 100000, medicalExpensesPerPerson: 5000,
      } },
      { code: 'BOP_MED', selected: true, limit: 5000, packageTerms: { medicalExpensesPerPerson: 5000 } },
      { code: 'BOP_EQUIP', selected: true, limit: 50000, deductible: 1000 },
      { code: 'BOP_WATER', selected: false, limit: 25000, deductible: 1000 },
    ],
  }
}

describe('original businessowners demo documents', () => {
  it.each(entries)('$file contains only allowed tokens and visible non-contract wording', entry => {
    const content = read(entry.file)
    const tokens = extractDocxPlaceholderTokens(content)
    expect(tokens).toContain('businessownersCoverageSummary')
    expect(tokens).toContain('businessownersRiskSummary')
    expect(validateDocxPlaceholderTokens(tokens).unrecognized).toEqual([])
    expect(xml(content)).toContain('DEMO - NOT A CONTRACT OF INSURANCE')
    expect(xml(content)).toContain('No representation of admission, regulatory approval or licensed distribution is made.')
  })

  it.each(entries)('$file displays saved package terms and premises rather than fixed current terms', entry => {
    const input = payload()
    const values = Object.fromEntries(DOCUMENT_TEMPLATE_VARIABLES.map(item => [item.token, '']))
    Object.assign(values, { insuredName: 'Synthetic Office LLC', policyNumber: 'DEMO-BOP-1',
      effectiveDate: '2026-11-01', expirationDate: '2027-11-01', premiumTotal: '800.00', premiumCurrency: 'USD' },
    resolvePolicyDetailTokens(input))
    const output = xml(renderDocxTemplate(read(entry.file), values))
    expect(output).toContain('Synthetic Office LLC')
    expect(output).toContain('STE 2')
    expect(output).toContain('72')
    expect(output).toContain('12')
    expect(output).toContain('2,000,000')
    expect(output).toContain('5,000')
    expect(output).toContain('50,000')
    expect(output).not.toContain('25,000')
    expect(output).not.toContain('{{')
    // Historical terms are read from the snapshot, not rebuilt from today's pack.
    const historical = payload()
    historical.coverages[1].packageTerms!.waitingPeriodHours = 48
    const historicalValues = { ...values, ...resolvePolicyDetailTokens(historical) }
    const archived = renderDocxTemplate(read(entry.file), historicalValues)
    expect(xml(archived)).toContain('48')
    historical.coverages[1].packageTerms!.waitingPeriodHours = 96
    expect(xml(archived)).not.toContain('96')
  })

  it.each([
    ['NB', ['BOP-BINDER']], ['Issue', ['BOP-DEC']], ['Endorse', ['BOP-DEC']],
    ['Renew', ['BOP-DEC']], ['Rewrite', ['BOP-DEC']], ['Cancel', []], ['Reinstate', []], ['NonRenewal', []],
  ] as const)('selects only stage-appropriate forms for %s through the existing pipeline', async (transactionType, expected) => {
    const rows = entries.map(entry => ({ form_id: entry.formNumber, form_number: entry.formNumber,
      form_title: entry.formTitle, transaction_types: entry.transactionTypes, edition_date: '2026-11-01',
      endorsement_change_criteria: entry.endorsementChangeCriteria,
      metadata: { demo: true }, output_format: 'DOCX', visibility: ['Insured', 'Agent', 'Internal'] }))
    const q = async (sql: string) => ({ rows: sql.includes('FROM forms_admin_forms') ? rows : [], rowCount: 0 })
    const forms = await selectPolicyForms(q, { tenantId: 'synthetic', policyId: 'policy-1',
      transactionId: 'transaction-1', transactionType, productCode: 'businessowners', state: 'OH',
      effectiveDate: '2026-11-01', inputSnapshot: payload() })
    expect(forms.map(form => form.code).sort()).toEqual([...expected].sort())
    expect(forms.every(form => form.metadata.sourceFormId === form.code)).toBe(true)
  })
})
