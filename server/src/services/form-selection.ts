import { asDateOnly } from '../lib/date.utils.js'

// Form transaction scope and jurisdiction decisions shared by the admin/wizard
// preview (forms.service.ts) and actual document generation
// (document-generation.service.ts), so a form never previews one way and
// attaches another.

type FormTransaction =
  | 'quote' | 'bind' | 'issue' | 'new_business'
  | 'endorsement' | 'cancellation' | 'reinstatement' | 'renewal' | 'rewrite' | 'non_renewal'

const TRANSACTION_ALIASES: Record<string, FormTransaction> = {
  quote: 'quote',
  bind: 'bind', quotebind: 'bind',
  issue: 'issue',
  // Generic new business: configured forms scoped this way attach at every new-business stage.
  nb: 'new_business', newbusiness: 'new_business',
  endorse: 'endorsement', endorsement: 'endorsement',
  cancel: 'cancellation', cancellation: 'cancellation',
  reinstate: 'reinstatement', reinstatement: 'reinstatement',
  renew: 'renewal', renewal: 'renewal',
  rewrite: 'rewrite',
  nonrenew: 'non_renewal', nonrenewal: 'non_renewal',
}

function formTransaction(value: unknown): FormTransaction | null {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '')
  return Object.prototype.hasOwnProperty.call(TRANSACTION_ALIASES, key) ? TRANSACTION_ALIASES[key] : null
}

/**
 * Whether a form scoped to `configured` transaction names applies to the
 * transaction being produced. Generation passes NB at bind and Issue at issue,
 * so "Bind" and "Issue" scopes attach only at their own stage, while a generic
 * new-business scope (NB, new_business) attaches at Quote, Bind and Issue. An
 * empty scope applies to every transaction; an unrecognized configured name
 * matches nothing rather than widening the form's scope.
 */
export function formTransactionMatches(configured: unknown, transactionType: string): boolean {
  const values = Array.isArray(configured) ? configured.filter((value) => String(value ?? '').trim()) : []
  if (!values.length) return true
  let current = formTransaction(transactionType)
  if (current === 'new_business') current = 'bind'
  if (!current) return false
  const newBusinessStage = current === 'quote' || current === 'bind' || current === 'issue'
  return values.some((value) => {
    const scope = formTransaction(value)
    return scope === current || (scope === 'new_business' && newBusinessStage)
  })
}

const USABLE_REGULATORY_STATUSES = new Set(['approved', 'filed'])
const OPEN_ENDED = '9999-12-31'

export type FormJurisdictionRow = {
  state_code?: string | null
  regulatory_status?: string | null
  effective_date?: unknown
  sunset_date?: unknown
}

/**
 * Jurisdiction gate for one form. Rows in force on the effective date decide,
 * state-specific rows ahead of ALL rows: an Approved or Filed row allows the
 * form (Filed covers file-and-use states); a Pending or Withdrawn row blocks it. With no row in force, the form
 * attaches only when it does not require an approved jurisdiction.
 */
export function formJurisdictionDecision<T extends FormJurisdictionRow>(
  rows: T[] | null | undefined,
  state: string,
  effectiveDate: string,
  requireApproved: boolean,
): { attach: boolean; jurisdiction: T | null } {
  const stateCode = String(state || '').trim().toUpperCase()
  const inForce = (rows || []).filter((row) => {
    const rowState = String(row.state_code || '').trim().toUpperCase()
    if (stateCode && rowState !== stateCode && rowState !== 'ALL') return false
    const start = asDateOnly(row.effective_date)
    const end = asDateOnly(row.sunset_date) || OPEN_ENDED
    return Boolean(start) && start! <= effectiveDate && effectiveDate <= end
  })
  // State-specific rows override ALL rows: a Pending CA row blocks even when ALL is Approved.
  const specific = stateCode ? inForce.filter((row) => String(row.state_code || '').trim().toUpperCase() === stateCode) : []
  const deciding = specific.length ? specific : inForce
  const usable = deciding.find((row) => USABLE_REGULATORY_STATUSES.has(String(row.regulatory_status || '').trim().toLowerCase()))
  if (usable) return { attach: true, jurisdiction: usable }
  if (deciding.length) return { attach: false, jurisdiction: null }
  return { attach: !requireApproved, jurisdiction: null }
}
