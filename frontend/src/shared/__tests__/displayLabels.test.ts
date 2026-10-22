import { describe, expect, it } from 'vitest'
import {
  aiModelSummary,
  coverageLabel,
  documentDisplayName,
  documentTypeLabel,
  formatCurrency,
  POLICY_STATUS_LEGEND,
  productLabel,
  statusLabel,
  transactionTypeLabel,
} from '../displayLabels'

describe('display labels', () => {
  it('turns internal insurance codes into client-friendly labels', () => {
    expect(productLabel('personal-auto')).toBe('Personal Auto')
    expect(statusLabel('RISK')).toBe('Risk')
    expect(statusLabel('PENDING_COMPLIANCE')).toBe('Pending Compliance')
    expect(statusLabel('QUOTA_SHARE')).toBe('Quota Share')
    expect(coverageLabel('BI')).toBe('Bodily Injury Liability')
  })

  it('formats money and AI model details for business users', () => {
    expect(formatCurrency(100000)).toContain('100,000')
    expect(aiModelSummary({ enabled: false, shadowMode: true })).toBe('Portfolio baseline model - Advisory mode')
  })
})

describe('transaction and document display names', () => {
  it('maps stored transaction codes to the names users know', () => {
    expect(transactionTypeLabel('NB')).toBe('New business')
    expect(transactionTypeLabel('new-business')).toBe('New business')
    expect(transactionTypeLabel('Endorse')).toBe('Endorsement')
    expect(transactionTypeLabel('CANCEL')).toBe('Cancellation')
    expect(transactionTypeLabel('Reinstate')).toBe('Reinstatement')
    expect(transactionTypeLabel('RENEW')).toBe('Renewal')
    expect(transactionTypeLabel('non renewal')).toBe('Non-renewal')
    expect(transactionTypeLabel('Issue')).toBe('Issue')
  })

  it('never shows a raw code for unknown or empty transaction types', () => {
    expect(transactionTypeLabel('OUT_OF_SEQUENCE')).not.toMatch(/_/)
    expect(transactionTypeLabel('')).toBe('-')
    expect(transactionTypeLabel(null)).toBe('-')
  })

  it('maps document types to sentence-case names', () => {
    expect(documentTypeLabel('POLICY_PACKET')).toBe('Policy packet')
    expect(documentTypeLabel('rating_worksheet')).toBe('Rating worksheet')
    expect(documentTypeLabel('POLICY_FORM_DOCUMENT')).toBe('Policy form')
    expect(documentTypeLabel('LOSS_RUN_REPORT')).not.toMatch(/_/)
    expect(documentTypeLabel('')).toBe('-')
  })

  it('names a generated document by type and transaction', () => {
    expect(documentDisplayName({ type: 'POLICY_PACKET', transactionType: 'Renew' })).toBe('Policy packet — Renewal')
    expect(documentDisplayName({ type: 'RATING_WORKSHEET', transactionType: 'NB' })).toBe('Rating worksheet — New business')
    expect(documentDisplayName({ type: 'POLICY_PACKET' })).toBe('Policy packet')
    // The stored name is only a fallback when no type is known.
    expect(documentDisplayName({ displayName: 'POLICY_PACKET (Renew) RN-1', type: 'POLICY_PACKET', transactionType: 'Renew' })).toBe('Policy packet — Renewal')
    expect(documentDisplayName({ displayName: 'Uploaded letter' })).toBe('Uploaded letter')
    expect(documentDisplayName({})).toBe('Document')
  })

  it('describes every policy status in the legend', () => {
    for (const status of ['Bound', 'Issued', 'In Force', 'Expired', 'Cancelled']) {
      expect(POLICY_STATUS_LEGEND[status]).toBeTruthy()
    }
  })
})

describe('unknown codes', () => {
  it('read as sentence case', () => {
    expect(transactionTypeLabel('OUT_OF_SEQUENCE')).toBe('Out of sequence')
    expect(documentTypeLabel('LOSS_RUN_REPORT')).toBe('Loss run report')
  })
})
