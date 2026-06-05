import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  derivePolicyWorkflowStatus,
  deriveWizardTransactionStatus,
  policyStatusBadgeColor,
} from '../statusModel'

describe('statusModel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives policy workflow statuses from raw status and term dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))

    expect(derivePolicyWorkflowStatus('cancelled', { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' })).toBe('Cancelled')
    expect(derivePolicyWorkflowStatus('issued', { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' })).toBe('In Force')
    expect(derivePolicyWorkflowStatus('issued', { effectiveDate: '2026-08-01', expirationDate: '2027-08-01' })).toBe('Issued')
    expect(derivePolicyWorkflowStatus('issued', { effectiveDate: '2025-01-01', expirationDate: '2026-01-01' })).toBe('Expired')
    expect(derivePolicyWorkflowStatus('bound')).toBe('Bind')
    expect(derivePolicyWorkflowStatus('rated')).toBe('Rated')
    expect(derivePolicyWorkflowStatus('quote')).toBe('Draft')
  })

  it('maps policy statuses to badge colors', () => {
    expect(policyStatusBadgeColor('Cancelled')).toBe('red')
    expect(policyStatusBadgeColor('Expired')).toBe('gray')
    expect(policyStatusBadgeColor('In Force')).toBe('green')
    expect(policyStatusBadgeColor('Issued')).toBe('blue')
    expect(policyStatusBadgeColor('Bind')).toBe('blue')
    expect(policyStatusBadgeColor('Rated')).toBe('yellow')
    expect(policyStatusBadgeColor('Draft')).toBe('yellow')
  })

  it('derives wizard transaction status from transaction flags', () => {
    expect(deriveWizardTransactionStatus({ isPolicyTransactionMode: false, issued: true, bound: true, hasRateResult: true })).toBe('Issued')
    expect(deriveWizardTransactionStatus({ isPolicyTransactionMode: false, issued: false, bound: true, hasRateResult: true })).toBe('Bind')
    expect(deriveWizardTransactionStatus({ isPolicyTransactionMode: false, issued: false, bound: false, hasRateResult: true })).toBe('Rated')
    expect(deriveWizardTransactionStatus({ isPolicyTransactionMode: true, issued: false, bound: true, hasRateResult: false })).toBe('Draft')
    expect(deriveWizardTransactionStatus({ isPolicyTransactionMode: true, issued: false, bound: false, hasRateResult: true })).toBe('Rated')
  })
})
