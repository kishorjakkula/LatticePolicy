import { describe, expect, it } from 'vitest'
import { buildPolicyDocumentPacket } from '../document-generation.service.js'

function createQuery(rowsByTable: Record<string, any[]>) {
  return async (text: string) => {
    if (text.includes('FROM forms_admin_forms')) return { rows: rowsByTable.forms_admin_forms || [], rowCount: rowsByTable.forms_admin_forms?.length || 0 }
    if (text.includes('FROM forms_catalog')) return { rows: rowsByTable.forms_catalog || [], rowCount: rowsByTable.forms_catalog?.length || 0 }
    return { rows: [], rowCount: 0 }
  }
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
      customerSafe: true,
      visibility: ['internal', 'customer'],
    })
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
})
