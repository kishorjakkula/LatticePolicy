export type PendingTransactionMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

export type PendingTransactionDraft = {
  policyId: string
  policyNumber?: string
  mode: PendingTransactionMode
  quoteId: string
  transactionNumber?: string
  effectiveDate: string
  updatedAt: string
}

export type PendingTransactionByMode = Record<PendingTransactionMode, PendingTransactionDraft | null>

export const PENDING_TRANSACTION_MODES: PendingTransactionMode[] = ['endorse', 'cancel', 'reinstate', 'rewrite', 'renew']

const STORAGE_PREFIX = 'policy.pending-transaction.v1'

function emptyPendingTransactionByMode(): PendingTransactionByMode {
  return {
    endorse: null,
    cancel: null,
    reinstate: null,
    rewrite: null,
    renew: null
  }
}

function storageKey(policyId: string, mode: PendingTransactionMode): string {
  return `${STORAGE_PREFIX}:${policyId}:${mode}`
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function isPendingMode(value: any): value is PendingTransactionMode {
  return value === 'endorse' || value === 'cancel' || value === 'reinstate' || value === 'rewrite' || value === 'renew'
}

function isValidPendingTransaction(value: any): value is PendingTransactionDraft {
  return !!(
    value &&
    typeof value.policyId === 'string' &&
    value.policyId &&
    typeof value.quoteId === 'string' &&
    value.quoteId &&
    isPendingMode(value.mode) &&
    typeof value.effectiveDate === 'string' &&
    value.effectiveDate
  )
}

export function readPendingTransaction(policyId: string, mode: PendingTransactionMode): PendingTransactionDraft | null {
  if (!policyId || !canUseStorage()) return null
  try {
    const raw = window.localStorage.getItem(storageKey(policyId, mode))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isValidPendingTransaction(parsed)) return null
    return {
      ...parsed,
      policyNumber: typeof parsed.policyNumber === 'string' ? parsed.policyNumber : undefined,
      transactionNumber: typeof parsed.transactionNumber === 'string' ? parsed.transactionNumber : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString()
    }
  } catch {
    return null
  }
}

export function readPendingTransactions(policyId: string): PendingTransactionByMode {
  const next = emptyPendingTransactionByMode()
  if (!policyId) return next
  for (const mode of PENDING_TRANSACTION_MODES) {
    next[mode] = readPendingTransaction(policyId, mode)
  }
  return next
}

export function savePendingTransaction(
  value: Omit<PendingTransactionDraft, 'updatedAt'> & { updatedAt?: string }
): PendingTransactionDraft | null {
  if (!value?.policyId || !value?.quoteId || !value?.effectiveDate || !isPendingMode(value?.mode) || !canUseStorage()) {
    return null
  }
  const next: PendingTransactionDraft = {
    policyId: value.policyId,
    policyNumber: value.policyNumber,
    mode: value.mode,
    quoteId: value.quoteId,
    transactionNumber: value.transactionNumber || undefined,
    effectiveDate: value.effectiveDate,
    updatedAt: value.updatedAt || new Date().toISOString()
  }
  try {
    window.localStorage.setItem(storageKey(next.policyId, next.mode), JSON.stringify(next))
    return next
  } catch {
    return null
  }
}

export function clearPendingTransaction(policyId: string, mode: PendingTransactionMode) {
  if (!policyId || !canUseStorage()) return
  try {
    window.localStorage.removeItem(storageKey(policyId, mode))
  } catch {
    // no-op
  }
}

// Backward-compatible endorsement helpers.
export type PendingEndorsement = PendingTransactionDraft

export function readPendingEndorsement(policyId: string): PendingEndorsement | null {
  return readPendingTransaction(policyId, 'endorse')
}

export function savePendingEndorsement(
  value: Omit<PendingEndorsement, 'mode' | 'updatedAt'> & { updatedAt?: string }
): PendingEndorsement | null {
  return savePendingTransaction({ ...value, mode: 'endorse' })
}

export function clearPendingEndorsement(policyId: string) {
  clearPendingTransaction(policyId, 'endorse')
}
