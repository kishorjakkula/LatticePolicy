import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_TEMPLATE_VARIABLES,
  DOCUMENT_TEMPLATE_VARIABLE_TOKENS,
  describeDocxTemplateError,
  extractDocxPlaceholderTokens,
  renderDocxTemplate,
  resolveDocumentTemplateVariables,
  validateDocxPlaceholderTokens,
} from '../document-template-variables.js'

// Builds a small, genuinely valid .docx file (a real OOXML zip package, not a
// mock) containing one paragraph per string given. Each string becomes the
// text of a `<w:t>` run, so `{{token}}` placeholders inside it are real
// docx template tags docxtemplater will discover/substitute, proving the
// parse -> validate -> substitute -> output round-trip actually works
// end-to-end rather than against a mocked template.
function buildFixtureDocx(paragraphs: string[]): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

  const escapeXml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const bodyParagraphs = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('')

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParagraphs}
    <w:sectPr/>
  </w:body>
</w:document>`

  const zip = new PizZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelsXml)
  zip.file('word/document.xml', documentXml)
  return zip.generate({ type: 'nodebuffer' })
}

describe('document template variable catalog', () => {
  it('has a unique, non-empty token for every entry with a label/description/group', () => {
    expect(DOCUMENT_TEMPLATE_VARIABLES.length).toBeGreaterThan(0)
    const seen = new Set<string>()
    for (const variable of DOCUMENT_TEMPLATE_VARIABLES) {
      expect(variable.token).toMatch(/^[a-zA-Z][a-zA-Z0-9]*$/)
      expect(seen.has(variable.token)).toBe(false)
      seen.add(variable.token)
      expect(variable.label.length).toBeGreaterThan(0)
      expect(variable.description.length).toBeGreaterThan(0)
      expect(['Insured', 'Policy', 'Coverage', 'Premium', 'Agent']).toContain(variable.group)
    }
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.size).toBe(seen.size)
  })

  it('includes the documented coverage slot convention and core groups', () => {
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('coverage1Code')).toBe(true)
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('coverage1Limit')).toBe(true)
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('coverage1Deductible')).toBe(true)
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('insuredName')).toBe(true)
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('premiumTotal')).toBe(true)
    expect(DOCUMENT_TEMPLATE_VARIABLE_TOKENS.has('agentCommissionPercent')).toBe(true)
  })
})

describe('docx placeholder extraction + validation (real .docx fixture)', () => {
  it('discovers every {{token}} placeholder in a real docx file', () => {
    const docx = buildFixtureDocx([
      'Insured: {{insuredName}}',
      'Policy Number: {{policyNumber}}',
      'Premium Total: {{premiumTotal}}',
    ])
    const tokens = extractDocxPlaceholderTokens(docx)
    expect(tokens).toEqual(['insuredName', 'policyNumber', 'premiumTotal'])
  })

  it('flags a token not present in the fixed catalog as unrecognized', () => {
    const docx = buildFixtureDocx(['Insured: {{insuredName}}', 'Typo: {{polciyNumber}}'])
    const tokens = extractDocxPlaceholderTokens(docx)
    const { recognized, unrecognized } = validateDocxPlaceholderTokens(tokens)
    expect(recognized).toEqual(['insuredName'])
    expect(unrecognized).toEqual(['polciyNumber'])
  })

  it('accepts a template with zero placeholders', () => {
    const docx = buildFixtureDocx(['No placeholders here.'])
    const tokens = extractDocxPlaceholderTokens(docx)
    expect(tokens).toEqual([])
    expect(validateDocxPlaceholderTokens(tokens)).toEqual({ recognized: [], unrecognized: [] })
  })

  it('throws a describable error for an unparseable file', () => {
    const notADocx = Buffer.from('this is not a zip file')
    expect(() => extractDocxPlaceholderTokens(notADocx)).toThrow()
    try {
      extractDocxPlaceholderTokens(notADocx)
    } catch (err) {
      expect(describeDocxTemplateError(err).length).toBeGreaterThan(0)
    }
  })
})

describe('renderDocxTemplate (real .docx fixture round-trip)', () => {
  it('substitutes recognized tokens with resolved values end-to-end', () => {
    const docx = buildFixtureDocx([
      'Dear {{insuredName}},',
      'Your policy {{policyNumber}} is effective {{effectiveDate}}.',
      'Total premium: {{premiumTotal}} {{premiumCurrency}}',
    ])
    const filled = renderDocxTemplate(docx, {
      insuredName: 'Ada Lovelace',
      policyNumber: 'PA-2026-000001',
      effectiveDate: '2026-08-01',
      premiumTotal: '1,234.56',
      premiumCurrency: 'USD',
    })

    // Unzip the real output and confirm the actual OOXML text was substituted
    // (not mocked) — this is the full parse -> validate -> substitute ->
    // output round trip the task requires.
    const outZip = new PizZip(filled)
    const documentXml = outZip.file('word/document.xml')!.asText()
    expect(documentXml).toContain('Dear Ada Lovelace,')
    expect(documentXml).toContain('Your policy PA-2026-000001 is effective 2026-08-01.')
    expect(documentXml).toContain('Total premium: 1,234.56 USD')
    expect(documentXml).not.toContain('{{')
  })

  it('renders an empty string for a recognized token with no resolved value', () => {
    const docx = buildFixtureDocx(['Phone: {{insuredPhone}}end'])
    const filled = renderDocxTemplate(docx, { insuredPhone: '' })
    const outZip = new PizZip(filled)
    const documentXml = outZip.file('word/document.xml')!.asText()
    expect(documentXml).toContain('Phone: end')
  })
})

describe('resolveDocumentTemplateVariables', () => {
  function createQuery(rows: Record<string, any[]>) {
    return async (text: string) => {
      if (text.includes('FROM policies')) return { rows: rows.policies || [], rowCount: rows.policies?.length || 0 }
      if (text.includes('FROM policy_versions')) return { rows: rows.policy_versions || [], rowCount: rows.policy_versions?.length || 0 }
      if (text.includes('FROM policy_customer_links')) return { rows: rows.insured || [], rowCount: rows.insured?.length || 0 }
      if (text.includes('FROM producers')) return { rows: rows.producers || [], rowCount: rows.producers?.length || 0 }
      if (text.includes('FROM agencies')) return { rows: rows.agencies || [], rowCount: rows.agencies?.length || 0 }
      if (text.includes('FROM onboarding_commission_plans')) return { rows: rows.commission || [], rowCount: rows.commission?.length || 0 }
      return { rows: [], rowCount: 0 }
    }
  }

  it('resolves every catalog token to a string, defaulting missing data to empty string', async () => {
    const q = createQuery({})
    const result = await resolveDocumentTemplateVariables(q, {
      tenantId: 'tenant-1',
      policyId: 'policy-1',
      policyNumber: 'PA-2026-000001',
      productCode: 'personal-auto',
      state: 'CA',
      effectiveDate: '2026-08-01',
      transactionType: 'NB',
      transactionNumber: 'NB-20260801-ABCD',
      payload: { coverages: [{ code: 'BI', limit: 100000, deductible: 500 }] },
    })

    for (const variable of DOCUMENT_TEMPLATE_VARIABLES) {
      expect(typeof result[variable.token]).toBe('string')
    }
    expect(result.policyNumber).toBe('PA-2026-000001')
    expect(result.productCode).toBe('personal-auto')
    expect(result.state).toBe('CA')
    expect(result.effectiveDate).toBe('2026-08-01')
    expect(result.transactionNumber).toBe('NB-20260801-ABCD')
    expect(result.coverage1Code).toBe('BI')
    expect(result.coverage1Limit).toBe('100,000')
    expect(result.coverage1Deductible).toBe('500')
    expect(result.coverage2Code).toBe('')
    expect(result.insuredName).toBe('')
    expect(result.agentCommissionPercent).toBe('')
  })

  it('prefers the linked customer master record for insured name/address over the raw payload', async () => {
    const q = createQuery({
      insured: [
        {
          display_name: 'Fallback Name',
          first_name: 'Ada',
          last_name: 'Lovelace',
          legal_name: null,
          line1: '1 Analytical Engine Way',
          line2: null,
          city: 'London',
          state: 'CA',
          postal_code: '94105',
          email: 'ada@example.com',
          phone: '555-0100',
        },
      ],
    })
    const result = await resolveDocumentTemplateVariables(q, {
      tenantId: 'tenant-1',
      policyId: 'policy-1',
      productCode: 'personal-auto',
      state: 'CA',
      effectiveDate: '2026-08-01',
      payload: { applicant: { firstName: 'Should', lastName: 'NotWin' } },
    })

    expect(result.insuredName).toBe('Ada Lovelace')
    expect(result.insuredFirstName).toBe('Ada')
    expect(result.insuredAddressLine1).toBe('1 Analytical Engine Way')
    expect(result.insuredCity).toBe('London')
    expect(result.insuredEmail).toBe('ada@example.com')
    expect(result.insuredPhone).toBe('555-0100')
  })

  it('resolves premium fields from the policy_versions row', async () => {
    const q = createQuery({
      policy_versions: [
        { premium_total: '1234.56', premium_fees: '25.00', premium_taxes: '10.50', currency: 'USD', transaction_type: 'NB', payload: {} },
      ],
    })
    const result = await resolveDocumentTemplateVariables(q, {
      tenantId: 'tenant-1',
      policyId: 'policy-1',
      productCode: 'personal-auto',
      state: 'CA',
      effectiveDate: '2026-08-01',
    })
    expect(result.premiumTotal).toBe('1,234.56')
    expect(result.premiumFees).toBe('25')
    expect(result.premiumTaxes).toBe('10.5')
    expect(result.premiumCurrency).toBe('USD')
  })

  it('falls back to payload-embedded producer/agency fields when no onboarding record resolves', async () => {
    const q = createQuery({})
    const result = await resolveDocumentTemplateVariables(q, {
      tenantId: 'tenant-1',
      policyId: 'policy-1',
      productCode: 'personal-auto',
      state: 'CA',
      effectiveDate: '2026-08-01',
      payload: {
        producer: { name: 'Jane Producer', npn: '1234567' },
        agency: { legalName: 'Acme Insurance Agency', agencyCode: 'ACME-01' },
      },
    })
    expect(result.agentName).toBe('Jane Producer')
    expect(result.agentNpn).toBe('1234567')
    expect(result.agencyName).toBe('Acme Insurance Agency')
    expect(result.agencyCode).toBe('ACME-01')
  })

  it('resolves agentCommissionPercent from onboarding_commission_plans when the agency id is a real uuid', async () => {
    const agencyId = '11111111-1111-4111-8111-111111111111'
    const q = createQuery({
      agencies: [{ legal_name: 'Acme Insurance Agency', dba_name: null, agency_np_number: '9988776' }],
      commission: [{ rate: '12.5' }],
    })
    const result = await resolveDocumentTemplateVariables(q, {
      tenantId: 'tenant-1',
      policyId: 'policy-1',
      productCode: 'personal-auto',
      state: 'CA',
      effectiveDate: '2026-08-01',
      transactionType: 'NB',
      payload: { agency: { agencyId } },
    })
    expect(result.agencyName).toBe('Acme Insurance Agency')
    expect(result.agencyNpn).toBe('9988776')
    expect(result.agentCommissionPercent).toBe('12.50%')
  })
})
