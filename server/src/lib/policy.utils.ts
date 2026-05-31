/**
 * Policy workflow/status utility functions extracted from routes.ts.
 */

import { coerceDateOnly, today } from './date.utils.js'

export type PolicyStatusFilter =
  | ''
  | 'Draft'
  | 'Rated'
  | 'Bind'
  | 'Issued'
  | 'Inforced'
  | 'Expired'
  | 'Cancelled'

/**
 * Derive a human-readable workflow status from raw DB status + effective/expiration dates.
 */
export function derivePolicyWorkflowStatus(
  rawStatus: any,
  effectiveDate: any,
  expirationDate: any
): string {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  const todayValue = today()
  const eff = coerceDateOnly(effectiveDate, todayValue)
  const exp = coerceDateOnly(expirationDate, todayValue)

  if (normalized === 'cancelled') return 'Cancelled'
  // Expired means term has ended before today.
  if (exp < todayValue) return 'Expired'
  if (normalized === 'bound') return 'Bind'
  if (normalized === 'issued') {
    if (eff <= todayValue && exp >= todayValue) return 'Inforced'
    return 'Issued'
  }
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'draft' || normalized === 'quote') return 'Draft'
  if (!normalized) return 'Draft'
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1)
}

/**
 * Normalize a raw status query-string value to a typed PolicyStatusFilter.
 */
export function normalizePolicyStatusFilter(rawValue: any): PolicyStatusFilter {
  const value = String(rawValue || '').trim()
  if (!value) return ''
  const normalized = value.toLowerCase()
  if (normalized === 'bound' || normalized === 'bind') return 'Bind'
  if (normalized === 'inforce' || normalized === 'inforced') return 'Inforced'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled'
  if (normalized === 'draft') return 'Draft'
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'issued') return 'Issued'
  if (normalized === 'expired') return 'Expired'
  return ''
}

/**
 * Append WHERE-clause fragments for a policy status filter to an existing
 * clauses/params array. Returns the next parameter index.
 */
export function appendPolicyStatusFilterClause(
  clauses: string[],
  params: any[],
  idx: number,
  statusFilter: PolicyStatusFilter,
  columns: { statusColumn: string; effectiveDateColumn: string; expirationDateColumn: string }
): number {
  if (!statusFilter) return idx
  const { statusColumn, effectiveDateColumn, expirationDateColumn } = columns
  const statusExpr = `LOWER(${statusColumn}::text)`

  if (statusFilter === 'Draft') {
    clauses.push(`${statusExpr} IN ('draft','quote')`)
    return idx
  }
  if (statusFilter === 'Rated') {
    clauses.push(`${statusExpr} = 'rated'`)
    return idx
  }
  if (statusFilter === 'Bind') {
    clauses.push(`${statusExpr} = 'bound'`)
    return idx
  }
  if (statusFilter === 'Cancelled') {
    clauses.push(`${statusExpr} = 'cancelled'`)
    return idx
  }

  const todayValue = today()
  params.push(todayValue)
  if (statusFilter === 'Issued') {
    clauses.push(
      `${statusExpr} = 'issued' AND ${effectiveDateColumn} > $${idx} AND ${expirationDateColumn} >= $${idx}`
    )
    return idx + 1
  }
  if (statusFilter === 'Inforced') {
    clauses.push(
      `${statusExpr} = 'issued' AND ${effectiveDateColumn} <= $${idx} AND ${expirationDateColumn} >= $${idx}`
    )
    return idx + 1
  }
  if (statusFilter === 'Expired') {
    clauses.push(`${statusExpr} <> 'cancelled' AND ${expirationDateColumn} < $${idx}`)
    return idx + 1
  }
  params.pop()
  return idx
}

/**
 * In-memory equivalent of appendPolicyStatusFilterClause for the store fallback path.
 */
export function matchesPolicyStatusFilter(
  statusFilter: PolicyStatusFilter,
  rawStatus: any,
  effectiveDate: any,
  expirationDate: any
): boolean {
  if (!statusFilter) return true
  if (statusFilter === 'Issued') {
    const normalized = String(rawStatus || '').trim().toLowerCase()
    if (normalized !== 'issued') return false
    const todayValue = today()
    const eff = coerceDateOnly(effectiveDate, todayValue)
    const exp = coerceDateOnly(expirationDate, todayValue)
    return eff > todayValue && exp >= todayValue
  }
  return derivePolicyWorkflowStatus(rawStatus, effectiveDate, expirationDate) === statusFilter
}
