import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import {
  buildEndorsementChangeSet,
  buildPolicyDocumentPacket,
  matchesEndorsementChanges,
  selectPolicyForms,
} from '../document-generation.service.js'
import { isPreviewApplicabilityMatch } from '../forms.service.js'
import { retrieveStoredDocument } from '../document-storage.service.js'
import { DOCX_TEMPLATE_MIME_TYPE } from '../document-template-variables.js'

// A real, minimal OOXML .docx package (not a mock) containing one paragraph
// per string given, used to prove the actual parse -> validate -> resolve ->
// substitute -> store -> verify pipeline in buildPolicyDocumentPacket, not
// just a mocked artifact.
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
  const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const bodyParagraphs = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyParagraphs}<w:sectPr/></w:body>
</w:document>`
  const zip = new PizZip()
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelsXml)
  zip.file('word/document.xml', documentXml)
  return zip.generate({ type: 'nodebuffer' })
}

// Extends the base createQuery with a mocked forms_admin_template_assets
// lookup, so tests can exercise the Task C docx-substitution path.
function createQueryWithTemplateAsset(
  rowsByTable: Record<string, any[]>,
  templateAsset: { mime_type: string; content: Buffer } | null
) {
  return async (text: string) => {
    if (text.includes('FROM forms_admin_template_assets')) {
      return templateAsset ? { rows: [templateAsset], rowCount: 1 } : { rows: [], rowCount: 0 }
    }
    if (text.includes('FROM forms_admin_forms')) return { rows: rowsByTable.forms_admin_forms || [], rowCount: rowsByTable.forms_admin_forms?.length || 0 }
    if (text.includes('FROM forms_catalog')) return { rows: rowsByTable.forms_catalog || [], rowCount: rowsByTable.forms_catalog?.length || 0 }
    return { rows: [], rowCount: 0 }
  }
}

function createQuery(rowsByTable: Record<string, any[]>) {
  return async (text: string) => {
    if (text.includes('FROM forms_admin_forms')) return { rows: rowsByTable.forms_admin_forms || [], rowCount: rowsByTable.forms_admin_forms?.length || 0 }
    if (text.includes('FROM forms_catalog')) return { rows: rowsByTable.forms_catalog || [], rowCount: rowsByTable.forms_catalog?.length || 0 }
    return { rows: [], rowCount: 0 }
  }
}

// Captures the exact SQL text sent for each query so tests can assert on the
// shape of the admin-forms query itself (not just its mocked results).
function createCapturingQuery(rowsByTable: Record<string, any[]>) {
  const calls: string[] = []
  const query = async (text: string) => {
    calls.push(text)
    if (text.includes('FROM forms_admin_forms')) return { rows: rowsByTable.forms_admin_forms || [], rowCount: rowsByTable.forms_admin_forms?.length || 0 }
    if (text.includes('FROM forms_catalog')) return { rows: rowsByTable.forms_catalog || [], rowCount: rowsByTable.forms_catalog?.length || 0 }
    return { rows: [], rowCount: 0 }
  }
  return { query, calls }
}

const context = {
  tenantId: 'sample-carrier',
  policyId: 'policy-1',
  policyNumber: 'PA-2026-000001',
  transactionId: 'transaction-1',
  transactionType: 'NB' as const,
  transactionNumber: 'NB-20260801-ABCD',
  productCode: 'personal-auto',
  state: 'CA',
  effectiveDate: '2026-08-01',
  generatedBy: 'user-1',
  correlationId: 'trace-1',
  versionId: 'version-1',
  generatedAt: '2026-08-01T12:00:00.000Z',
  inputSnapshot: { applicant: { firstName: 'Ada' }, coverages: [{ code: 'BI', limit: 100000 }] },
}

describe('document generation service', () => {
  it('selects active matching admin forms and creates customer-safe packet metadata', async () => {
    const packet = await buildPolicyDocumentPacket(createQuery({
      forms_admin_forms: [
        {
          form_id: '11111111-1111-1111-1111-111111111111',
          form_number: 'PA-DEC',
          form_title: 'Personal Auto Declarations',
          edition_date: '2026-01-01',
          form_type: 'Declarations',
          transaction_types: ['NB', 'Renew'],
          output_format: 'PDF',
          packet_placement: 'Front',
          sort_order: 10,
          visibility: ['internal', 'customer'],
          state_code: 'CA',
          regulatory_status: 'Approved',
          metadata: { filed: true },
        },
        {
          form_id: '22222222-2222-2222-2222-222222222222',
          form_number: 'PA-END',
          form_title: 'Endorsement Only',
          edition_date: '2026-01-01',
          form_type: 'Endorsement',
          transaction_types: ['Endorse'],
          output_format: 'PDF',
          packet_placement: 'End',
          sort_order: 20,
          visibility: ['internal', 'customer'],
          state_code: 'CA',
          regulatory_status: 'Approved',
        },
      ],
    }), context)

    expect(packet.forms).toHaveLength(1)
    expect(packet.forms[0]).toMatchObject({
      code: 'PA-DEC',
      title: 'Personal Auto Declarations',
      source: 'forms_admin',
      customerSafe: true,
    })
    expect(packet.forms[0].formId).toBeNull()
    expect(packet.forms[0].metadata.sourceFormId).toBe('11111111-1111-1111-1111-111111111111')

    expect(packet.documents).toHaveLength(1)
    expect(packet.documents[0]).toMatchObject({
      type: 'POLICY_PACKET',
      uri: 'generated://policy-packet/policy-1/transaction-1',
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(packet.documents[0].metadata).toMatchObject({
      transactionType: 'NB',
      versionId: 'version-1',
      packetSchemaVersion: 'policy-packet.v2',
      customerSafe: true,
      visibility: ['internal', 'customer'],
    })
    expect(packet.documents[0].metadata.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(packet.documents[0].metadata.formSetHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('renders identical bytes and hashes from the same pinned snapshot', async () => {
    const rows = { forms_admin_forms: [{
      form_id: '11111111-1111-1111-1111-111111111111', form_number: 'PA-DEC',
      form_title: 'Declarations', edition_date: '2026-01-01', transaction_types: ['NB'],
      visibility: ['internal', 'customer'], state_code: 'CA', regulatory_status: 'Approved',
    }] }
    const first = await buildPolicyDocumentPacket(createQuery(rows), context)
    const second = await buildPolicyDocumentPacket(createQuery(rows), context)
    expect(second.documents[0].hash).toBe(first.documents[0].hash)
    expect(second.documents[0].metadata.inputHash).toBe(first.documents[0].metadata.inputHash)
    expect(second.documents[0].metadata.formSetHash).toBe(first.documents[0].metadata.formSetHash)
  })

  it('blocks completion when a required form is missing', async () => {
    await expect(buildPolicyDocumentPacket(createQuery({}), {
      ...context,
      requiredFormCodes: ['CA-CANCEL-NOTICE'],
    })).rejects.toMatchObject({ code: 'DOCUMENT_PACKET_INCOMPLETE' })
  })

  it('includes catalog forms and keeps mixed packets internal only', async () => {
    const packet = await buildPolicyDocumentPacket(createQuery({
      forms_catalog: [
        {
          form_id: '33333333-3333-3333-3333-333333333333',
          code: 'PA-IDCARD',
          edition: '2026-01',
          name: 'Auto ID Card',
          jurisdiction: { state: 'CA' },
          applicability: {
            productCode: 'personal-auto',
            transactionTypes: ['NB'],
            visibility: ['customer'],
            sortOrder: 5,
          },
          render: { templateId: 'id-card' },
        },
        {
          form_id: '44444444-4444-4444-4444-444444444444',
          code: 'PA-UW-WKS',
          edition: '2026-01',
          name: 'Underwriting Worksheet',
          jurisdiction: { state: 'CA' },
          applicability: {
            productCode: 'personal-auto',
            transactionTypes: ['NB'],
            visibility: ['internal'],
            sortOrder: 6,
          },
          render: { templateId: 'uw-worksheet' },
        },
      ],
    }), context)

    expect(packet.forms.map((form) => form.code)).toEqual(['PA-IDCARD', 'PA-UW-WKS'])
    expect(packet.forms[0]).toMatchObject({
      formId: '33333333-3333-3333-3333-333333333333',
      source: 'forms_catalog',
      customerSafe: true,
    })
    expect(packet.documents[0].metadata).toMatchObject({
      customerSafe: false,
      visibility: ['internal'],
    })
  })

  it('selects servicing forms for cancellation and non-renewal transactions (issue #89)', async () => {
    const query = createQuery({
      forms_admin_forms: [
        {
          form_id: '55555555-5555-5555-5555-555555555555',
          form_number: 'PA-NOTICE',
          form_title: 'Personal Auto Servicing Notice',
          edition_date: '2026-01-01',
          form_type: 'Notice',
          transaction_types: ['Cancel', 'NonRenewal', 'Reinstate', 'Renew', 'Rewrite'],
          output_format: 'PDF',
          packet_placement: 'Front',
          sort_order: 10,
          visibility: ['internal', 'customer'],
          state_code: 'CA',
          regulatory_status: 'Approved',
        },
        {
          form_id: '66666666-6666-6666-6666-666666666666',
          form_number: 'PA-DEC',
          form_title: 'Personal Auto Declarations',
          edition_date: '2026-01-01',
          form_type: 'Declarations',
          transaction_types: ['NB'],
          output_format: 'PDF',
          packet_placement: 'Front',
          sort_order: 10,
          visibility: ['internal', 'customer'],
          state_code: 'CA',
          regulatory_status: 'Approved',
        },
      ],
    })

    const cancelPacket = await buildPolicyDocumentPacket(query, {
      ...context,
      transactionType: 'Cancel',
      transactionId: 'transaction-cancel',
    })
    expect(cancelPacket.forms.map((form) => form.code)).toEqual(['PA-NOTICE'])
    expect(cancelPacket.documents[0].metadata).toMatchObject({ transactionType: 'Cancel', customerSafe: true })

    const nonRenewalPacket = await buildPolicyDocumentPacket(query, {
      ...context,
      transactionType: 'NonRenewal',
      transactionId: 'transaction-nonrenewal',
    })
    expect(nonRenewalPacket.forms.map((form) => form.code)).toEqual(['PA-NOTICE'])
    expect(nonRenewalPacket.documents[0].metadata).toMatchObject({ transactionType: 'NonRenewal', customerSafe: true })
  })

  it('does not select forms for a transaction type outside a form applicability list', async () => {
    const query = createQuery({
      forms_admin_forms: [
        {
          form_id: '77777777-7777-7777-7777-777777777777',
          form_number: 'PA-END-ONLY',
          form_title: 'Endorsement Only Form',
          edition_date: '2026-01-01',
          form_type: 'Endorsement',
          transaction_types: ['Endorse'],
          output_format: 'PDF',
          packet_placement: 'End',
          sort_order: 20,
          visibility: ['internal', 'customer'],
          state_code: 'CA',
          regulatory_status: 'Approved',
        },
      ],
    })

    const packet = await buildPolicyDocumentPacket(query, {
      ...context,
      transactionType: 'Cancel',
      transactionId: 'transaction-cancel-no-match',
    })
    expect(packet.forms).toHaveLength(0)
    expect(packet.documents).toHaveLength(0)
  })

  it('normalizes coverage changes and evaluates conservative endorsement criteria', () => {
    const changes = buildEndorsementChangeSet(
      { coverages: [{ code: 'BI', limit: 100000 }, { code: 'PD', limit: 50000 }] },
      { coverages: [{ code: 'BI', limit: 250000 }, { code: 'COMP', deductible: 500 }] },
      ['/coverages/0/limit', '/coverages/1'],
    )

    expect(changes).toEqual({
      changedPaths: ['/coverages/0/limit', '/coverages/1'],
      addedCoverageCodes: ['COMP'],
      removedCoverageCodes: ['PD'],
      modifiedCoverageCodes: ['BI'],
    })
    expect(matchesEndorsementChanges(undefined, changes)).toBe(false)
    expect(matchesEndorsementChanges({}, changes)).toBe(false)
    expect(matchesEndorsementChanges({ coverageCodes: ['BI'], changeTypes: ['modified'], match: 'all' }, changes)).toBe(true)
    expect(matchesEndorsementChanges({ coverageCodes: ['PD'], changeTypes: ['modified'], match: 'all' }, changes)).toBe(false)
    expect(matchesEndorsementChanges({ changedPathPatterns: ['/coverages/*/limit'] }, changes)).toBe(true)
    expect(matchesEndorsementChanges({ alwaysAttachOnEndorsement: true }, changes)).toBe(true)
  })

  it('attaches only forms whose endorsement criteria match the changed coverage', async () => {
    const packet = await buildPolicyDocumentPacket(createQuery({
      forms_admin_forms: [
        {
          form_id: '88888888-8888-4888-8888-888888888888', form_number: 'PA-BI-END',
          form_title: 'BI Change', transaction_types: ['Endorse'],
          endorsement_change_criteria: { coverageCodes: ['BI'] }, visibility: ['internal'],
          state_code: 'CA', regulatory_status: 'Approved', sort_order: 10,
        },
        {
          form_id: '99999999-9999-4999-8999-999999999999', form_number: 'PA-PD-END',
          form_title: 'PD Change', transaction_types: ['Endorse'],
          endorsement_change_criteria: { coverageCodes: ['PD'] }, visibility: ['internal'],
          state_code: 'CA', regulatory_status: 'Approved', sort_order: 20,
        },
        {
          form_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', form_number: 'PA-GENERIC-END',
          form_title: 'Unscoped Endorsement', transaction_types: ['Endorse'],
          endorsement_change_criteria: {}, visibility: ['internal'],
          state_code: 'CA', regulatory_status: 'Approved', sort_order: 30,
        },
      ],
    }), {
      ...context,
      transactionType: 'Endorse',
      endorsementChanges: {
        changedPaths: ['/coverages/0/limit'],
        addedCoverageCodes: [], removedCoverageCodes: [], modifiedCoverageCodes: ['BI'],
      },
    })

    expect(packet.forms.map((form) => form.code)).toEqual(['PA-BI-END'])
    expect(packet.documents[0].metadata).toMatchObject({
      endorsementChanges: { modifiedCoverageCodes: ['BI'] },
    })
  })

  describe('forms-applicability parity with the Wizard preview (zero applicability rows)', () => {
    // These lock in that a form with zero rows in forms_admin_applicability is
    // treated identically by the Wizard's live preview (isPreviewApplicabilityMatch
    // in forms.service.ts) and by the actual packet-building path
    // (selectPolicyForms here) — the exact gap described in the task: a form could
    // previously show as "will attach" in the preview and then silently not attach
    // when the policy actually bound, because selectPolicyForms used an INNER JOIN
    // against forms_admin_applicability that excluded every zero-row form outright.

    it('selectPolicyForms queries forms_admin_applicability with a LEFT JOIN, not an INNER JOIN, so zero-row forms are not excluded at the SQL layer', async () => {
      const { query, calls } = createCapturingQuery({})
      await selectPolicyForms(query, context)
      const adminQuery = calls.find((text) => text.includes('FROM forms_admin_forms'))
      expect(adminQuery).toBeDefined()
      // Must LEFT JOIN applicability (an INNER/plain JOIN would silently drop every
      // form with zero applicability rows before the zero-rows rule ever runs).
      expect(adminQuery).toMatch(/LEFT JOIN forms_admin_applicability/)
      expect(adminQuery).not.toMatch(/\bJOIN forms_admin_applicability a\s*\n\s*ON[^\n]*\n\s*LEFT JOIN forms_admin_output/)
      // The WHERE clause must explicitly admit the zero-applicability-row case.
      expect(adminQuery).toMatch(/has_app\.form_id IS NULL/)
    })

    it('includes a form with zero applicability rows in the actual packet (parity with the preview matching every submission)', async () => {
      // This row represents what the LEFT JOIN now returns for a zero-applicability-row
      // form: all applicability-sourced columns (transaction_types,
      // endorsement_change_criteria) come back null, exactly as a real LEFT JOIN with
      // no matching right-hand row would produce.
      const forms = await selectPolicyForms(createQuery({
        forms_admin_forms: [
          {
            form_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            form_number: 'PA-UNSCOPED',
            form_title: 'Unscoped Personal Auto Notice',
            edition_date: '2026-01-01',
            form_type: 'Notice',
            transaction_types: null,
            endorsement_change_criteria: null,
            visibility: ['internal', 'customer'],
            state_code: 'CA',
            regulatory_status: 'Approved',
            sort_order: 50,
          },
        ],
      }), context)

      expect(forms.map((form) => form.code)).toEqual(['PA-UNSCOPED'])
      expect(forms[0].customerSafe).toBe(true)

      // Same zero-rows input, same transaction type, evaluated through the Wizard
      // preview's own matcher: it must also treat this as a match.
      expect(
        isPreviewApplicabilityMatch([], {
          lineOfBusiness: 'personal-auto',
          productCode: context.productCode,
          transactionType: 'NB',
        })
      ).toBe(true)
    })

    it('still excludes a zero-applicability-row form for an Endorse transaction with no explicit endorsement criteria (conservative default, unchanged)', async () => {
      const forms = await selectPolicyForms(createQuery({
        forms_admin_forms: [
          {
            form_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            form_number: 'PA-UNSCOPED-END',
            form_title: 'Unscoped Form',
            edition_date: '2026-01-01',
            form_type: 'Notice',
            transaction_types: null,
            endorsement_change_criteria: null,
            visibility: ['internal'],
            state_code: 'CA',
            regulatory_status: 'Approved',
            sort_order: 50,
          },
        ],
      }), { ...context, transactionType: 'Endorse' })

      expect(forms).toHaveLength(0)
    })
  })

  describe('filled .docx form documents (Task C: real variable substitution at generation time)', () => {
    const docxFormRow = {
      form_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      form_number: 'PA-DOCX',
      form_title: 'Personal Auto Docx Declarations',
      edition_date: '2026-01-01',
      form_type: 'Declarations',
      transaction_types: ['NB'],
      output_format: 'DOCX',
      packet_placement: 'Front',
      sort_order: 10,
      visibility: ['internal', 'customer'],
      state_code: 'CA',
      regulatory_status: 'Approved',
    }

    it('adds a filled POLICY_FORM_DOCUMENT with real substituted text for a form with a validated .docx template', async () => {
      const template = buildFixtureDocx([
        'Insured: {{insuredName}}',
        'Policy Number: {{policyNumber}}',
      ])
      const query = createQueryWithTemplateAsset(
        { forms_admin_forms: [docxFormRow] },
        { mime_type: DOCX_TEMPLATE_MIME_TYPE, content: template }
      )

      const packet = await buildPolicyDocumentPacket(query, {
        ...context,
        inputSnapshot: { applicant: { firstName: 'Ada', lastName: 'Lovelace' }, coverages: [] },
      })

      expect(packet.forms.map((f) => f.code)).toEqual(['PA-DOCX'])
      // The original generic packet document is still produced (additive, not replacing).
      expect(packet.documents.some((doc) => doc.type === 'POLICY_PACKET')).toBe(true)

      const formDoc = packet.documents.find((doc) => doc.type === 'POLICY_FORM_DOCUMENT')
      expect(formDoc).toBeDefined()
      expect(formDoc!.hash).toMatch(/^[a-f0-9]{64}$/)
      expect(formDoc!.metadata).toMatchObject({ code: 'PA-DOCX', formId: docxFormRow.form_id })

      const stored = await retrieveStoredDocument(formDoc!.uri)
      expect(stored).not.toBeNull()
      const outZip = new PizZip(stored!)
      const documentXml = outZip.file('word/document.xml')!.asText()
      expect(documentXml).toContain('Insured: Ada Lovelace')
      expect(documentXml).toContain(`Policy Number: ${context.policyNumber}`)
      expect(documentXml).not.toContain('{{')
    })

    it('skips the .docx substitution and leaves the packet exactly as before when the form has no template asset (regression: unaffected forms)', async () => {
      const query = createQueryWithTemplateAsset({ forms_admin_forms: [docxFormRow] }, null)
      const packet = await buildPolicyDocumentPacket(query, context)
      expect(packet.documents.some((doc) => doc.type === 'POLICY_FORM_DOCUMENT')).toBe(false)
      expect(packet.documents).toHaveLength(1)
      expect(packet.documents[0].type).toBe('POLICY_PACKET')
    })

    it('skips the .docx substitution for a PDF template asset, leaving the existing PDF path untouched (regression)', async () => {
      const query = createQueryWithTemplateAsset(
        { forms_admin_forms: [docxFormRow] },
        { mime_type: 'application/pdf', content: Buffer.from('%PDF-1.4 fake') }
      )
      const packet = await buildPolicyDocumentPacket(query, context)
      expect(packet.documents.some((doc) => doc.type === 'POLICY_FORM_DOCUMENT')).toBe(false)
      expect(packet.documents).toHaveLength(1)
      expect(packet.documents[0].type).toBe('POLICY_PACKET')
    })

    it('skips (does not throw) when the stored .docx template has an unrecognized placeholder token', async () => {
      const template = buildFixtureDocx(['Hello {{thisTokenDoesNotExist}}'])
      const query = createQueryWithTemplateAsset(
        { forms_admin_forms: [docxFormRow] },
        { mime_type: DOCX_TEMPLATE_MIME_TYPE, content: template }
      )
      const packet = await buildPolicyDocumentPacket(query, context)
      expect(packet.documents.some((doc) => doc.type === 'POLICY_FORM_DOCUMENT')).toBe(false)
      expect(packet.documents).toHaveLength(1)
    })
  })
})
