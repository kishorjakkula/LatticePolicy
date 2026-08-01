import { describe, expect, it } from 'vitest'
import { validatePolicyTransactionState } from '../transaction-state.js'

describe('policy transaction state validation', () => {
  it('allows issuing bound or already issued policies only', () => {
    expect(validatePolicyTransactionState('issue', 'Bound')).toEqual({ ok: true })
    expect(validatePolicyTransactionState('issue', 'Issued')).toEqual({ ok: true })
    expect(validatePolicyTransactionState('issue', 'Cancelled')).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
      message: 'Policy is cancelled',
    })
    expect(validatePolicyTransactionState('issue', 'Draft')).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
      message: 'Cannot issue policy from status Draft',
    })
  })

  it('keeps cancellation, reinstatement, and rewrite mutually consistent', () => {
    expect(validatePolicyTransactionState('cancel', 'Issued')).toEqual({ ok: true })
    expect(validatePolicyTransactionState('cancel', 'Cancelled')).toMatchObject({
      ok: false,
      message: 'Policy already cancelled',
    })
    expect(validatePolicyTransactionState('reinstate', 'Cancelled')).toEqual({ ok: true })
    expect(validatePolicyTransactionState('reinstate', 'Issued')).toMatchObject({
      ok: false,
      message: 'Policy is not cancelled',
    })
    expect(validatePolicyTransactionState('rewrite', 'Cancelled')).toEqual({ ok: true })
    expect(validatePolicyTransactionState('rewrite', 'Issued')).toMatchObject({
      ok: false,
      message: 'Policy must be cancelled to rewrite',
    })
  })

  it('blocks forward transactions once a policy is cancelled', () => {
    expect(validatePolicyTransactionState('endorse', 'Cancelled')).toMatchObject({
      ok: false,
      message: 'Policy is cancelled',
    })
    expect(validatePolicyTransactionState('renew', 'Cancelled')).toMatchObject({
      ok: false,
      message: 'Policy is cancelled',
    })
    expect(validatePolicyTransactionState('nonRenew', 'Cancelled')).toMatchObject({
      ok: false,
      message: 'Cannot non-renew a cancelled policy.',
    })
  })
})
