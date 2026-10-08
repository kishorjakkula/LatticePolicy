import { describe, expect, it } from 'vitest'
import { detectPriorNonpaymentDiscrepancy, type PriorCancellationRecord } from '../quote-bind.service.js'

describe('detectPriorNonpaymentDiscrepancy', () => {
  it('does not flag when the submission never claimed continuous insurance', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: false },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        { policyId: 'p1', effectiveDate: '2026-05-01', cancellationType: 'NON_PAYMENT' },
      ],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })

  it('does not flag when qualification answers are absent entirely (regression safety)', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: null,
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        { policyId: 'p1', effectiveDate: '2026-05-01', cancellationType: 'NON_PAYMENT' },
      ],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })

  it('does not flag when there are no prior cancellations at all (no matched customer, or clean history)', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })

  it('does not flag a prior cancellation for a non-nonpayment reason (e.g. insured requested)', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        { policyId: 'p1', effectiveDate: '2026-05-01', cancellationType: 'SHORT_RATE' },
      ],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })

  it('does not flag a NON_PAYMENT cancellation that falls outside the 6-month lookback window', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        // More than 6 months before the new policy's effective date.
        { policyId: 'p1', effectiveDate: '2025-10-01', cancellationType: 'NON_PAYMENT' },
      ],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })

  it('flags a genuine contradiction: claimed continuous insurance but a NON_PAYMENT cancellation inside the window', () => {
    const priorCancellations: PriorCancellationRecord[] = [
      { policyId: 'p1', effectiveDate: '2026-03-15', cancellationType: 'NON_PAYMENT' },
    ]
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations,
    })
    expect(result.discrepancy).toBe(true)
    expect(result.reason).toBe('INTERNAL_RECORD_PRIOR_NONPAYMENT_CANCELLATION_CONTRADICTS_QUALIFICATION')
  })

  it('flags when the cancellation lands exactly on the new policy effective date', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { continuousInsurance6Months: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        { policyId: 'p1', effectiveDate: '2026-07-01', cancellationType: 'NON_PAYMENT' },
      ],
    })
    expect(result.discrepancy).toBe(true)
  })

  it('does not flag when other qualification answers are present but continuousInsurance6Months is not explicitly true', () => {
    const result = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: { noAtFaultAccidents3Years: true },
      newPolicyEffectiveDate: '2026-07-01',
      priorCancellations: [
        { policyId: 'p1', effectiveDate: '2026-05-01', cancellationType: 'NON_PAYMENT' },
      ],
    })
    expect(result).toEqual({ discrepancy: false, reason: null })
  })
})
