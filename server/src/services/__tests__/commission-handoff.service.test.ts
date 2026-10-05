import { describe, expect, it } from 'vitest'
import { buildCommissionHandoffPayload } from '../commission-handoff.service.js'

describe('commission handoff event contract', () => {
  it('builds a tenant-scoped idempotent payload with producer and premium context', () => {
    const payload = buildCommissionHandoffPayload({
      tenantId: 'sample-carrier',
      policyId: 'policy-1',
      policyNumber: 'PA-100',
      transactionId: 'txn-1',
      transactionNumber: 'NB-100',
      transactionType: 'QuoteBind',
      sourceEvent: 'QUOTE_BOUND',
      effectiveDate: '2026-07-01',
      expirationDate: '2027-07-01',
      processedAt: '2026-06-01T12:00:00.000Z',
      productCode: 'personal-auto',
      state: 'CA',
      premiumImpact: 1234.56,
      currency: 'USD',
      payload: {
        producer: {
          producerKey: 'PROD-001',
          npn: '1234567',
          firstName: 'Pat',
          lastName: 'Producer',
          agency: {
            agencyCode: 'AGY-001',
            legalName: 'Demo Agency LLC',
          },
        },
      },
      correlationId: 'NB-100',
    })

    expect(payload).toMatchObject({
      schemaVersion: 'commission-handoff.v1',
      eventType: 'COMMISSION_HANDOFF',
      sourceEvent: 'QUOTE_BOUND',
      idempotencyKey: 'sample-carrier:policy-1:txn-1:QuoteBind',
      correlationId: 'NB-100',
      tenantId: 'sample-carrier',
      policy: {
        policyId: 'policy-1',
        policyNumber: 'PA-100',
        productCode: 'personal-auto',
        state: 'CA',
      },
      transaction: {
        transactionId: 'txn-1',
        transactionNumber: 'NB-100',
        transactionType: 'QuoteBind',
        effectiveDate: '2026-07-01',
      },
      producer: {
        producerKey: 'PROD-001',
        producerNpn: '1234567',
        producerName: 'Pat Producer',
        agencyCode: 'AGY-001',
        agencyName: 'Demo Agency LLC',
      },
      premiumImpact: {
        amount: 1234.56,
        currency: 'USD',
      },
    })
    expect(payload.accountingBoundary.latticePolicyOwns).toContain('tenant-scoped idempotent handoff event')
    expect(payload.accountingBoundary.externalCommissionSystemOwns).toContain('commission calculation')
    expect(payload.accountingBoundary.externalCommissionSystemOwns).toContain('payment and settlement status')
  })
})
