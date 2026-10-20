const PRODUCT_LABELS: Record<string, string> = {
  'personal-auto': 'Personal Auto',
  'commercial-auto': 'Commercial Auto',
  homeowners: 'Homeowners',
  cyber: 'Cyber',
  'professional-liability': 'Professional Liability',
}

const STATUS_LABELS: Record<string, string> = {
  RISK: 'Risk',
  QUOTA_SHARE: 'Quota Share',
  EXCESS_OF_LOSS: 'Excess of Loss',
  FACULTATIVE_OBLIGATORY: 'Facultative Obligatory',
  CLAIMS_REFERENCE_HANDOFF: 'Claims Reference Handoff',
  PENDING_COMPLIANCE: 'Pending Compliance',
  PENDING_CONTRACT: 'Pending Contract',
  PENDING_APPOINTMENT: 'Pending Appointment',
  FILING_PENDING: 'Filing Pending',
  INFO_REQUESTED: 'Information Requested',
}

const COVERAGE_LABELS: Record<string, string> = {
  BI: 'Bodily Injury Liability',
  PD: 'Property Damage Liability',
  UM: 'Uninsured Motorist',
  UIM: 'Underinsured Motorist',
  COMP: 'Comprehensive',
  COLL: 'Collision',
}

// Policy transaction types as stored (NB, RENEW, Endorse…) to the names users know.
const TRANSACTION_LABELS: Record<string, string> = {
  NB: 'New business',
  NEWBUSINESS: 'New business',
  NEW_BUSINESS: 'New business',
  QUOTE: 'Quote',
  BIND: 'Bind',
  ISSUE: 'Issue',
  ENDORSE: 'Endorsement',
  ENDORSEMENT: 'Endorsement',
  CANCEL: 'Cancellation',
  CANCELLATION: 'Cancellation',
  REINSTATE: 'Reinstatement',
  REINSTATEMENT: 'Reinstatement',
  RENEW: 'Renewal',
  RENEWAL: 'Renewal',
  REWRITE: 'Rewrite',
  NONRENEW: 'Non-renewal',
  NONRENEWAL: 'Non-renewal',
  NON_RENEWAL: 'Non-renewal',
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  POLICY_PACKET: 'Policy packet',
  RATING_WORKSHEET: 'Rating worksheet',
  POLICY_FORM_DOCUMENT: 'Policy form',
  DECLARATIONS: 'Declarations',
  ID_CARD: 'ID card',
  QUOTE_SUMMARY: 'Quote summary',
  BINDER: 'Binder',
  CANCELLATION_NOTICE: 'Cancellation notice',
  NONRENEWAL_NOTICE: 'Non-renewal notice',
}

/** What each policy status means, for legends and tooltips. */
export const POLICY_STATUS_LEGEND: Record<string, string> = {
  // Keyed by the label StatusBadge shows (it shows the "Bind" status as "Bound").
  Bound: 'Coverage bound; documents not yet issued.',
  Issued: 'Documents issued; the term has not started yet.',
  'In Force': 'Issued and the current term has started.',
  Expired: 'The term ended; no coverage now.',
  Cancelled: 'Cancelled; no coverage now.',
}

export function transactionTypeLabel(value: unknown): string {
  const code = String(value || '').trim()
  return TRANSACTION_LABELS[code.toUpperCase().replace(/[\s-]+/g, '_')] || TRANSACTION_LABELS[code.toUpperCase().replace(/[\s_-]+/g, '')]
    // Unknown codes read as sentence case: OUT_OF_SEQUENCE -> "Out of sequence".
    || sentenceCase(code)
}

export function documentTypeLabel(value: unknown): string {
  const code = String(value || '').trim()
  return DOCUMENT_TYPE_LABELS[code.toUpperCase()] || sentenceCase(code)
}

/**
 * A generated document's name for people: "Policy packet — Renewal". The stored
 * name (e.g. "POLICY_PACKET (Renew) RN-…") is only used when no type is known.
 */
export function documentDisplayName(doc: { type?: unknown; transactionType?: unknown; displayName?: unknown }): string {
  if (!doc.type) return String(doc.displayName || 'Document')
  const type = documentTypeLabel(doc.type)
  return doc.transactionType ? `${type} — ${transactionTypeLabel(doc.transactionType)}` : type
}

export function productLabel(value: unknown): string {
  const code = String(value || '').trim()
  return PRODUCT_LABELS[code.toLowerCase()] || humanizeCode(code)
}

export function statusLabel(value: unknown): string {
  const code = String(value || '').trim()
  return STATUS_LABELS[code.toUpperCase()] || humanizeCode(code)
}

export function coverageLabel(value: unknown): string {
  const code = String(value || '').trim()
  return COVERAGE_LABELS[code.toUpperCase()] || humanizeCode(code)
}

/** OUT_OF_SEQUENCE -> "Out of sequence". */
function sentenceCase(code: string): string {
  const text = humanizeCode(code).toLowerCase()
  return text === '-' ? text : text.charAt(0).toUpperCase() + text.slice(1)
}

export function humanizeCode(value: unknown): string {
  const text = String(value || '').trim()
  if (!text) return '-'
  return text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatCurrency(value: unknown, currency = 'USD'): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function aiModelSummary(input: {
  enabled?: boolean
  shadowMode?: boolean
  provider?: string
  modelVersion?: string
}): string {
  const mode = input.shadowMode ? 'Advisory mode' : 'Workflow mode'
  const source = input.enabled ? 'Configured predictive model' : 'Portfolio baseline model'
  return `${source} - ${mode}`
}
