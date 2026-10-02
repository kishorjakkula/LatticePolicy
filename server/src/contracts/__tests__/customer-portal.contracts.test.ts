import { describe, expect, it } from 'vitest'
import {
  PortalResponseContractError,
  validatePortalResponse,
} from '../customer-portal.contracts.js'

const policy = {
  policyId: 'policy-1',
  policyNumber: 'PA-1001',
  productCode: 'personal-auto',
  status: 'Issued',
  term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
  premium: { amount: 1250.5, currency: 'USD' },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: null,
}

describe('customer portal response contracts', () => {
  it('accepts safe summary projections and serializes dates', () => {
    const result = validatePortalResponse('summary', {
      customer: {
        customerId: 'customer-1', customerKey: 'C-1001',
        customerName: 'Ada Lovelace', entityType: 'PERSON',
      },
      policies: [policy],
    })

    expect(result.policies[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('rejects unknown customer-facing fields', () => {
    expect(() => validatePortalResponse('summary', {
      customer: {
        customerId: 'customer-1', customerKey: null, customerName: null,
        entityType: null, taxId: 'should-not-leave-server',
      },
      policies: [],
    })).toThrow(PortalResponseContractError)
  })

  it('rejects nested objects in coverage values', () => {
    expect(() => validatePortalResponse('policyDetail', {
      policy,
      declarations: {
        policyNumber: 'PA-1001', productCode: 'personal-auto', status: 'Issued',
        namedInsured: 'Ada Lovelace', customerKey: 'C-1001', term: policy.term,
        premium: policy.premium, transaction: null,
        coverages: [{
          code: 'BI', label: 'Bodily Injury', selected: true,
          limit: { internalFormula: 'secret' }, deductible: null, percent: null,
        }],
      },
      idCard: {
        available: true, policyNumber: 'PA-1001', namedInsured: 'Ada Lovelace',
        term: policy.term, vehicles: [], state: 'CT',
      },
    })).toThrow(PortalResponseContractError)
  })

  it('accepts the strict document projection', () => {
    const result = validatePortalResponse('documents', {
      documents: [{
        documentId: 'document-1', displayName: 'Policy Document Packet',
        type: 'POLICY_PACKET', generatedAt: '2026-01-02T00:00:00Z',
        transaction: { transactionId: null, transactionType: 'NB', transactionNumber: '1' },
        forms: [{ code: 'PA-DEC', title: 'Declarations', edition: '2026-01' }],
        contentId: 'sha256:abc',
      }],
    })

    expect(result.documents).toHaveLength(1)
  })
})
