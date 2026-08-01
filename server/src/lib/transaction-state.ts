export type PolicyTransactionAction =
  | 'issue'
  | 'endorse'
  | 'cancel'
  | 'reinstate'
  | 'rewrite'
  | 'renew'
  | 'nonRenew'

export type TransactionStateValidation =
  | { ok: true }
  | { ok: false; code: 'INVALID_STATE'; message: string }

const ACTIVE_STATUSES = new Set(['bound', 'issued', 'active'])

export function normalizePolicyStatus(rawStatus: unknown): string {
  return String(rawStatus || '').trim().toLowerCase()
}

export function validatePolicyTransactionState(
  action: PolicyTransactionAction,
  rawStatus: unknown
): TransactionStateValidation {
  const status = normalizePolicyStatus(rawStatus)

  if (action === 'issue') {
    if (status === 'cancelled') {
      return { ok: false, code: 'INVALID_STATE', message: 'Policy is cancelled' }
    }
    if (status && status !== 'bound' && status !== 'issued') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Cannot issue policy from status ${String(rawStatus || '')}`,
      }
    }
    return { ok: true }
  }

  if (action === 'reinstate') {
    if (status !== 'cancelled') {
      return { ok: false, code: 'INVALID_STATE', message: 'Policy is not cancelled' }
    }
    return { ok: true }
  }

  if (action === 'rewrite') {
    if (status !== 'cancelled') {
      return { ok: false, code: 'INVALID_STATE', message: 'Policy must be cancelled to rewrite' }
    }
    return { ok: true }
  }

  if (action === 'cancel') {
    if (status === 'cancelled') {
      return { ok: false, code: 'INVALID_STATE', message: 'Policy already cancelled' }
    }
    return { ok: true }
  }

  if (status === 'cancelled') {
    const message =
      action === 'nonRenew'
        ? 'Cannot non-renew a cancelled policy.'
        : 'Policy is cancelled'
    return { ok: false, code: 'INVALID_STATE', message }
  }

  if (status && !ACTIVE_STATUSES.has(status)) {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `Cannot ${action} policy from status ${String(rawStatus || '')}`,
    }
  }

  return { ok: true }
}
