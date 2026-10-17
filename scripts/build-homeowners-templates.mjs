#!/usr/bin/env node
// Builds the homeowners Word templates in products/homeowners/documents/.
//
//   node scripts/build-homeowners-templates.mjs
//
// The templates use LatticePolicy merge tokens ({{token}}, see
// server/src/services/document-template-variables.ts) and LatticePolicy's own
// wording. They are illustrative starting points for a carrier's documents,
// not filed forms: a carrier replaces the wording with its approved text.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'products/homeowners/documents')

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const run = (text, { bold = false, size = null, color = null } = {}) =>
  `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`
const para = (runs, { align = null, spaceAfter = 120 } = {}) =>
  `<w:p><w:pPr>${align ? `<w:jc w:val="${align}"/>` : ''}<w:spacing w:after="${spaceAfter}"/></w:pPr>${[].concat(runs).join('')}</w:p>`
const title = (text) => para(run(text, { bold: true, size: 32 }), { spaceAfter: 60 })
const heading = (text) => para(run(text, { bold: true, size: 24, color: '1F3A68' }), { spaceAfter: 80 })
const text = (value) => para(run(value))
const notice = (value) => para(run(value, { size: 18, color: '555555' }))
const cell = (content, width, { bold = false, shade = false } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:fill="E8EEF7"/>' : ''}</w:tcPr>${para(run(content, { bold }), { spaceAfter: 40 })}</w:tc>`
const table = (rows, widths) => {
  const border = '<w:top w:val="single" w:sz="4" w:color="BFC8D6"/><w:bottom w:val="single" w:sz="4" w:color="BFC8D6"/><w:insideH w:val="single" w:sz="4" w:color="BFC8D6"/>'
  const body = rows.map((row, index) => `<w:tr>${row.map((value, col) => cell(value, widths[col], { bold: index === 0, shade: index === 0 })).join('')}</w:tr>`).join('')
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${body}</w:tbl>${para('', { spaceAfter: 60 })}`
}
const pairs = (items) => table([['Item', 'Details'], ...items], [3200, 6200])

const ILLUSTRATIVE = 'Illustrative LatticePolicy template. Replace the wording with your approved, filed text before use.'

function documentXml(blocks) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
}

function docx(blocks) {
  const zip = new PizZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', documentXml(blocks))
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const coverageTable = table([
  ['Section I - Property', 'Limit'],
  ['Coverage A - Dwelling', '{{coverageALimit}}'],
  ['Coverage B - Other Structures', '{{coverageBLimit}}'],
  ['Coverage C - Personal Property', '{{coverageCLimit}}'],
  ['Coverage D - Loss of Use', '{{coverageDLimit}}'],
  ['Section II - Liability', 'Limit'],
  ['Coverage E - Personal Liability (each occurrence)', '{{coverageELimit}}'],
  ['Coverage F - Medical Payments to Others (each person)', '{{coverageFLimit}}'],
], [6400, 3000])

const policyFacts = pairs([
  ['Insurer', '{{underwritingCompany}}'],
  ['Policy number', '{{policyNumber}}'],
  ['Policy period', '{{effectiveDate}} to {{expirationDate}}, 12:01 a.m. at the residence premises'],
  ['Named insured', '{{insuredName}}'],
  ['Mailing address', '{{mailingAddress}}'],
  ['Residence premises', '{{premisesAddress}}'],
  ['Policy form', '{{policyFormName}}'],
])

const templates = {
  'HO-DEC.docx': [
    title('Homeowners Policy Declarations'),
    notice(ILLUSTRATIVE),
    policyFacts,
    heading('Coverages and limits'),
    text('Coverage is provided only where a limit is shown.'),
    coverageTable,
    heading('Deductibles'),
    pairs([
      ['All peril deductible', '{{allPerilDeductible}}'],
      ['Windstorm or hail deductible', '{{windHailDeductible}}'],
    ]),
    heading('Endorsements'),
    text('{{endorsementsList}}'),
    heading('Mortgagees and other interests'),
    text('{{additionalInterests}}'),
    heading('Dwelling'),
    pairs([['Construction', '{{dwellingConstruction}}'], ['Year built', '{{dwellingYearBuilt}}']]),
    heading('Premium'),
    pairs([
      ['Premium', '{{premiumTotal}} {{premiumCurrency}}'],
      ['Fees', '{{premiumFees}}'],
      ['Taxes', '{{premiumTaxes}}'],
      ['Billing', '{{billingMethod}}, {{paymentPlan}}'],
    ]),
    heading('Prior insurance'),
    pairs([['Prior carrier', '{{priorCarrier}}'], ['Prior policy number', '{{priorPolicyNumber}}']]),
    heading('Producer'),
    pairs([['Agency', '{{agencyName}}'], ['Agent', '{{agentName}}']]),
    notice('This policy does not cover flood or earthquake unless an endorsement listed above adds it. Read your policy for the full terms.'),
  ],
  'HO-BINDER.docx': [
    title('Homeowners Binder'),
    notice(ILLUSTRATIVE),
    text('This binder confirms that the insurance described below is in force from the effective date shown, subject to the terms of the policy form named, until the policy is issued or the binder is cancelled.'),
    pairs([
      ['Insurer', '{{underwritingCompany}}'],
      ['Policy number', '{{policyNumber}}'],
      ['Effective', '{{effectiveDate}}, 12:01 a.m. at the residence premises'],
      ['Named insured', '{{insuredName}}'],
      ['Residence premises', '{{premisesAddress}}'],
      ['Policy form', '{{policyFormName}}'],
    ]),
    coverageTable,
    pairs([
      ['All peril deductible', '{{allPerilDeductible}}'],
      ['Windstorm or hail deductible', '{{windHailDeductible}}'],
      ['Endorsements', '{{endorsementsList}}'],
      ['Mortgagee', '{{mortgageeName}}, loan {{mortgageeLoanNumber}}'],
      ['Premium', '{{premiumTotal}} {{premiumCurrency}}'],
    ]),
    heading('Issued by'),
    pairs([['Agency', '{{agencyName}}'], ['Agent', '{{agentName}}'], ['Transaction', '{{transactionNumber}}']]),
  ],
  'HO-EOI.docx': [
    title('Evidence of Property Insurance for the Mortgagee'),
    notice(ILLUSTRATIVE),
    pairs([
      ['Mortgagee', '{{mortgageeName}}'],
      ['Mortgagee address', '{{mortgageeAddress}}'],
      ['Loan number', '{{mortgageeLoanNumber}}'],
      ['Borrower (named insured)', '{{insuredName}}'],
      ['Property', '{{premisesAddress}}'],
      ['Insurer', '{{underwritingCompany}}'],
      ['Policy number', '{{policyNumber}}'],
      ['Policy period', '{{effectiveDate}} to {{expirationDate}}'],
    ]),
    pairs([
      ['Dwelling (Coverage A)', '{{coverageALimit}}, settled at replacement cost'],
      ['All peril deductible', '{{allPerilDeductible}}'],
      ['Windstorm or hail deductible', '{{windHailDeductible}}'],
      ['Endorsements', '{{endorsementsList}}'],
    ]),
    text('The mortgagee named above is included in the policy as its interest may appear and will be notified as the policy provides if it is cancelled or not renewed.'),
  ],
  'HO-QUOTE.docx': [
    title('Homeowners Quote Proposal'),
    notice(ILLUSTRATIVE),
    pairs([
      ['Prepared for', '{{insuredName}}'],
      ['Property', '{{premisesAddress}}'],
      ['Proposed effective date', '{{effectiveDate}}'],
      ['Insurer', '{{underwritingCompany}}'],
      ['Policy form', '{{policyFormName}}'],
    ]),
    coverageTable,
    pairs([
      ['All peril deductible', '{{allPerilDeductible}}'],
      ['Windstorm or hail deductible', '{{windHailDeductible}}'],
      ['Optional endorsements', '{{endorsementsList}}'],
      ['Estimated annual premium', '{{premiumTotal}} {{premiumCurrency}}'],
      ['Payment plan', '{{paymentPlan}}'],
    ]),
    text('This is a proposal, not a binder: coverage starts only when the insurer confirms it in writing. The premium may change if the information used to prepare it changes.'),
    pairs([['Agency', '{{agencyName}}'], ['Agent', '{{agentName}}']]),
  ],
}

mkdirSync(outDir, { recursive: true })
for (const [fileName, blocks] of Object.entries(templates)) {
  writeFileSync(resolve(outDir, fileName), docx(blocks))
  console.log(`wrote products/homeowners/documents/${fileName}`)
}
