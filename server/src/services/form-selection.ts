import { asDateOnly } from '../lib/date.utils.js'

// Form transaction scope, jurisdiction and endorsement-change decisions shared by the admin/wizard
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

/** Approved or Filed (file-and-use): the statuses under which a form may be used in a state. */
export function isUsableRegulatoryStatus(status: unknown): boolean {
  return USABLE_REGULATORY_STATUSES.has(String(status ?? '').trim().toLowerCase())
}
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

export type EndorsementChangeType = 'added' | 'removed' | 'modified'

export type EndorsementChangeSet = {
  changedPaths: string[]
  addedCoverageCodes: string[]
  removedCoverageCodes: string[]
  modifiedCoverageCodes: string[]
}

export type EndorsementChangeCriteria = {
  alwaysAttachOnEndorsement?: boolean
  match?: 'any' | 'all'
  coverageCodes?: string[]
  changeTypes?: EndorsementChangeType[]
  changedPathPatterns?: string[]
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

/** Whether a transaction name is an endorsement, in either the preview or the generation vocabulary. */
export function isEndorsementTransaction(transactionType: unknown): boolean {
  return formTransaction(transactionType) === 'endorsement'
}

const MAX_CHANGE_ENTRIES = 500

function stringList(value: unknown, upperCase: boolean): string[] {
  if (!Array.isArray(value)) return []
  const items = value
    .filter((item) => typeof item === 'string')
    .slice(0, MAX_CHANGE_ENTRIES)
    .map((item) => (upperCase ? normalizeText(item).toUpperCase() : normalizeText(item)))
    .filter(Boolean)
  return [...new Set(items)].sort()
}

/**
 * Reads an endorsement change set supplied by a caller (the form preview
 * body) into the shape generation builds with buildEndorsementChangeSet.
 * Anything that is not an object is no change set; non-string entries are
 * dropped, so a malformed body cannot widen what matches.
 */
export function normalizeEndorsementChangeSet(value: unknown): EndorsementChangeSet | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  return {
    changedPaths: stringList(input.changedPaths, false),
    addedCoverageCodes: stringList(input.addedCoverageCodes, true),
    removedCoverageCodes: stringList(input.removedCoverageCodes, true),
    modifiedCoverageCodes: stringList(input.modifiedCoverageCodes, true),
  }
}

function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')
  return new RegExp(`^${escaped}$`).test(path)
}

/**
 * Endorsement-change gate for one form on an endorsement. A form attaches
 * only when its criteria say so: alwaysAttachOnEndorsement, or a coverage
 * code / change type / changed path in the change set. A form with no
 * criteria, empty criteria, or no change set to compare against does not
 * attach (unless it always attaches on endorsement).
 */
export function matchesEndorsementChanges(
  criteria: EndorsementChangeCriteria | null | undefined,
  changes: EndorsementChangeSet | null | undefined
): boolean {
  if (!criteria || typeof criteria !== 'object') return false
  if (criteria.alwaysAttachOnEndorsement === true) return true
  if (!changes) return false

  const coverageCodes = (criteria.coverageCodes || []).map((code) => normalizeText(code).toUpperCase()).filter(Boolean)
  const changeTypes = (criteria.changeTypes || []).filter((type) => ['added', 'removed', 'modified'].includes(type))
  const pathPatterns = (criteria.changedPathPatterns || []).map(normalizeText).filter(Boolean)
  if (!coverageCodes.length && !changeTypes.length && !pathPatterns.length) return false

  const changedByType: Record<EndorsementChangeType, string[]> = {
    added: changes.addedCoverageCodes,
    removed: changes.removedCoverageCodes,
    modified: changes.modifiedCoverageCodes,
  }
  const changedCoverageCodes = new Set(Object.values(changedByType).flat())
  const checks: boolean[] = []
  if (coverageCodes.length && changeTypes.length) {
    checks.push(changeTypes.some((type) => coverageCodes.some((code) => changedByType[type].includes(code))))
  } else if (coverageCodes.length) {
    checks.push(coverageCodes.some((code) => changedCoverageCodes.has(code)))
  } else if (changeTypes.length) {
    checks.push(changeTypes.some((type) => changedByType[type].length > 0))
  }
  if (pathPatterns.length) checks.push(pathPatterns.some((pattern) => changes.changedPaths.some((path) => pathMatches(pattern, path))))
  return criteria.match === 'all' ? checks.every(Boolean) : checks.some(Boolean)
}
