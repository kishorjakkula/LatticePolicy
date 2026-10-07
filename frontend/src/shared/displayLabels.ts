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
