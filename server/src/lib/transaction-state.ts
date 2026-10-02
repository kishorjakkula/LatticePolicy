export const POLICY_LIFECYCLE_STATES = [
  'Quote',
  'Draft',
  'Bound',
  'Issued',
  'Cancelled',
  'Expired',
] as const

export type PolicyLifecycleState = (typeof POLICY_LIFECYCLE_STATES)[number]

export type PolicyTransactionAction =
  | 'bind'
  | 'issue'
  | 'endorse'
  | 'cancel'
  | 'reinstate'
  | 'rewrite'
  | 'renew'
  | 'nonRenew'
  | 'expire'

export type PolicyTransition = {
  action: PolicyTransactionAction
  fromState: PolicyLifecycleState
  toState: PolicyLifecycleState
  idempotent: boolean
}

export type TransactionStateValidation =
  | { ok: true }
  | {
      ok: false
      code: 'INVALID_STATE'
      message: string
      action: PolicyTransactionAction
      currentState: string
      allowedFrom: readonly PolicyLifecycleState[]
      targetState: PolicyLifecycleState
    }

type TransitionDefinition = {
  allowedFrom: readonly PolicyLifecycleState[]
  toState: PolicyLifecycleState
  idempotentFrom?: readonly PolicyLifecycleState[]
}

export const POLICY_TRANSITIONS: Readonly<Record<PolicyTransactionAction, TransitionDefinition>> = {
  bind: { allowedFrom: ['Quote', 'Draft'], toState: 'Bound', idempotentFrom: ['Bound'] },
  issue: { allowedFrom: ['Bound'], toState: 'Issued', idempotentFrom: ['Issued'] },
  endorse: { allowedFrom: ['Issued'], toState: 'Issued' },
  cancel: { allowedFrom: ['Bound', 'Issued'], toState: 'Cancelled' },
  reinstate: { allowedFrom: ['Cancelled'], toState: 'Issued' },
  rewrite: { allowedFrom: ['Cancelled'], toState: 'Issued' },
  renew: { allowedFrom: ['Issued'], toState: 'Issued' },
  nonRenew: { allowedFrom: ['Issued'], toState: 'Issued' },
  expire: { allowedFrom: ['Issued'], toState: 'Expired', idempotentFrom: ['Expired'] },
}

const statesByNormalizedName = new Map(
  POLICY_LIFECYCLE_STATES.map((state) => [state.toLowerCase(), state]),
)

export function parsePolicyLifecycleState(rawStatus: unknown): PolicyLifecycleState | null {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  return statesByNormalizedName.get(normalized) || null
}

export function normalizePolicyStatus(rawStatus: unknown): string {
  return parsePolicyLifecycleState(rawStatus)?.toLowerCase() || String(rawStatus || '').trim().toLowerCase()
}

function invalidTransitionMessage(action: PolicyTransactionAction, state: string): string {
  if (action === 'cancel' && state === 'Cancelled') return 'Policy already cancelled'
  if (action === 'reinstate') return 'Policy is not cancelled'
  if (action === 'rewrite') return 'Policy must be cancelled to rewrite'
  if (state === 'Cancelled') {
    return action === 'nonRenew' ? 'Cannot non-renew a cancelled policy.' : 'Policy is cancelled'
  }
  if (!state) return `Cannot ${action} policy without a lifecycle status`
  return `Cannot ${action} policy from status ${state}`
}

export function resolvePolicyTransition(
  action: PolicyTransactionAction,
  rawStatus: unknown,
): PolicyTransition | null {
  const currentState = parsePolicyLifecycleState(rawStatus)
  if (!currentState) return null
  const definition = POLICY_TRANSITIONS[action]
  if (definition.allowedFrom.includes(currentState)) {
    return { action, fromState: currentState, toState: definition.toState, idempotent: false }
  }
  if (definition.idempotentFrom?.includes(currentState)) {
    return { action, fromState: currentState, toState: definition.toState, idempotent: true }
  }
  return null
}

export function validatePolicyTransactionState(
  action: PolicyTransactionAction,
  rawStatus: unknown,
): TransactionStateValidation {
  if (resolvePolicyTransition(action, rawStatus)) return { ok: true }

  const currentState = parsePolicyLifecycleState(rawStatus)
  const displayState = currentState || String(rawStatus || '').trim()
  const definition = POLICY_TRANSITIONS[action]
  return {
    ok: false,
    code: 'INVALID_STATE',
    message: invalidTransitionMessage(action, displayState),
    action,
    currentState: displayState,
    allowedFrom: definition.allowedFrom,
    targetState: definition.toState,
  }
}
