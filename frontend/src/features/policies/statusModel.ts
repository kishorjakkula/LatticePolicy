export type PolicyWorkflowStatus =
  | 'Draft'
  | 'Rated'
  | 'Bind'
  | 'Issued'
  | 'In Force'
  | 'Expired'
  | 'Cancelled'

export type TransactionWorkflowStatus = 'Draft' | 'Rated' | 'Bind' | 'Issued'

function toDateOnly(value: any): string {
  if (!value) return ''
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
    return ''
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10)
}

export function derivePolicyWorkflowStatus(rawStatus: any, term?: { effectiveDate?: any; expirationDate?: any }): PolicyWorkflowStatus {
  const status = String(rawStatus || '').trim().toLowerCase()
  const todayValue = todayDateOnly()
  const effectiveDate = toDateOnly(term?.effectiveDate) || todayValue
  const expirationDate = toDateOnly(term?.expirationDate) || todayValue

  if (status === 'cancelled') return 'Cancelled'
  // Expired applies after term end date.
  if (expirationDate < todayValue) return 'Expired'
  if (status === 'bound') return 'Bind'
  if (status === 'issued') {
    if (effectiveDate <= todayValue && expirationDate >= todayValue) return 'In Force'
    return 'Issued'
  }
  if (status === 'rated') return 'Rated'
  if (status === 'draft' || status === 'quote') return 'Draft'
  return 'Draft'
}

export function policyStatusBadgeColor(status: PolicyWorkflowStatus): 'green' | 'yellow' | 'blue' | 'gray' | 'red' {
  if (status === 'Cancelled') return 'red'
  if (status === 'Expired') return 'gray'
  if (status === 'In Force') return 'green'
  if (status === 'Bind') return 'blue'
  if (status === 'Issued') return 'blue'
  if (status === 'Rated') return 'yellow'
  return 'yellow'
}

export function deriveWizardTransactionStatus(args: {
  isPolicyTransactionMode: boolean
  issued: boolean
  bound: boolean
  hasRateResult: boolean
}): TransactionWorkflowStatus {
  if (args.issued) return 'Issued'
  if (args.isPolicyTransactionMode) return args.hasRateResult ? 'Rated' : 'Draft'
  if (args.bound) return 'Bind'
  return args.hasRateResult ? 'Rated' : 'Draft'
}
