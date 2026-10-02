import { describe, expect, it } from 'vitest'
import {
  POLICY_LIFECYCLE_STATES,
  POLICY_TRANSITIONS,
  parsePolicyLifecycleState,
  resolvePolicyTransition,
  validatePolicyTransactionState,
  type PolicyTransactionAction,
} from '../transaction-state.js'

describe('canonical policy lifecycle state machine', () => {
  it('uses the persisted policy status vocabulary', () => {
    expect(POLICY_LIFECYCLE_STATES).toEqual([
      'Quote', 'Draft', 'Bound', 'Issued', 'Cancelled', 'Expired',
    ])
    expect(parsePolicyLifecycleState('issued')).toBe('Issued')
    expect(parsePolicyLifecycleState('Active')).toBeNull()
    expect(parsePolicyLifecycleState('')).toBeNull()
  })

  it('defines the expected production transition matrix', () => {
    const allowed: Array<[PolicyTransactionAction, string, string]> = [
      ['bind', 'Quote', 'Bound'],
      ['bind', 'Draft', 'Bound'],
      ['issue', 'Bound', 'Issued'],
      ['endorse', 'Issued', 'Issued'],
      ['cancel', 'Bound', 'Cancelled'],
      ['cancel', 'Issued', 'Cancelled'],
      ['reinstate', 'Cancelled', 'Issued'],
      ['rewrite', 'Cancelled', 'Issued'],
      ['renew', 'Issued', 'Issued'],
      ['nonRenew', 'Issued', 'Issued'],
      ['expire', 'Issued', 'Expired'],
    ]
    for (const [action, fromState, toState] of allowed) {
      expect(resolvePolicyTransition(action, fromState)).toMatchObject({
        action, fromState, toState, idempotent: false,
      })
    }
  })

  it('marks only explicitly repeatable terminal operations as idempotent', () => {
    expect(resolvePolicyTransition('bind', 'Bound')).toMatchObject({ idempotent: true })
    expect(resolvePolicyTransition('issue', 'Issued')).toMatchObject({ idempotent: true })
    expect(resolvePolicyTransition('expire', 'Expired')).toMatchObject({ idempotent: true })
    expect(resolvePolicyTransition('cancel', 'Cancelled')).toBeNull()
    expect(resolvePolicyTransition('endorse', 'Issued')).toMatchObject({ idempotent: false })
  })

  it('rejects every action outside its declared source states', () => {
    for (const action of Object.keys(POLICY_TRANSITIONS) as PolicyTransactionAction[]) {
      for (const state of POLICY_LIFECYCLE_STATES) {
        const definition = POLICY_TRANSITIONS[action]
        const expected = definition.allowedFrom.includes(state) || definition.idempotentFrom?.includes(state)
        expect(validatePolicyTransactionState(action, state).ok, `${action} from ${state}`).toBe(Boolean(expected))
      }
    }
  })

  it('returns structured transition context for invalid requests', () => {
    expect(validatePolicyTransactionState('renew', 'Cancelled')).toMatchObject({
      ok: false,
      code: 'INVALID_STATE',
      action: 'renew',
      currentState: 'Cancelled',
      allowedFrom: ['Issued'],
      targetState: 'Issued',
      message: 'Policy is cancelled',
    })
    expect(validatePolicyTransactionState('cancel', 'Draft')).toMatchObject({
      ok: false,
      action: 'cancel',
      currentState: 'Draft',
      allowedFrom: ['Bound', 'Issued'],
      targetState: 'Cancelled',
    })
    expect(validatePolicyTransactionState('issue', undefined)).toMatchObject({
      ok: false,
      currentState: '',
      message: 'Cannot issue policy without a lifecycle status',
    })
  })
})
