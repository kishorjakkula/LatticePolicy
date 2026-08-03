import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendPolicyStatusFilterClause,
  derivePolicyWorkflowStatus,
  matchesPolicyStatusFilter,
  normalizePolicyStatusFilter,
  type PolicyStatusFilter,
} from '../policy.utils.js'

const COLUMNS = {
  statusColumn: 'p.status',
  effectiveDateColumn: 'p.term_effective_date',
  expirationDateColumn: 'p.term_expiration_date',
}

type PolicyRow = {
  label: string
  status: string
  effectiveDate: string
  expirationDate: string
}

/**
 * Evaluate a clause produced by appendPolicyStatusFilterClause against an
 * in-memory row. Only understands the fragment shapes that function emits, and
 * throws on anything else so a new clause shape cannot silently skip the parity
 * check below.
 */
function evaluateSqlClause(clause: string, params: any[], row: PolicyRow): boolean {
  const stripOuterParens = (value: string): string => {
    let term = value.trim()
    while (term.startsWith('(') && term.endsWith(')')) {
      let depth = 0
      let wraps = true
      for (let i = 0; i < term.length; i += 1) {
        if (term[i] === '(') depth += 1
        if (term[i] === ')') depth -= 1
        if (depth === 0 && i < term.length - 1) {
          wraps = false
          break
        }
      }
      if (!wraps) break
      term = term.slice(1, -1).trim()
    }
    return term
  }

  const splitTopLevel = (value: string, separator: string): string[] => {
    const pieces: string[] = []
    let depth = 0
    let start = 0
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === '(') depth += 1
      if (value[i] === ')') depth -= 1
      if (depth === 0 && value.slice(i, i + separator.length) === separator) {
        pieces.push(value.slice(start, i))
        start = i + separator.length
        i += separator.length - 1
      }
    }
    pieces.push(value.slice(start))
    return pieces.map((piece) => piece.trim()).filter(Boolean)
  }

  const evaluateTerm = (fragment: string): boolean => {
    const term = stripOuterParens(fragment)
    const status = row.status.trim().toLowerCase()

    const orPieces = splitTopLevel(term, ' OR ')
    if (orPieces.length > 1) return orPieces.some((piece) => evaluateTerm(piece))

    const andPieces = splitTopLevel(term, ' AND ')
    if (andPieces.length > 1) return andPieces.every((piece) => evaluateTerm(piece))

    const inMatch = /^LOWER\(p\.status::text\) IN \((.+)\)$/.exec(term)
    if (inMatch) {
      const values = inMatch[1].split(',').map((value) => value.trim().replace(/^'|'$/g, ''))
      return values.includes(status)
    }

    const statusMatch = /^LOWER\(p\.status::text\) (=|<>) '(.+)'$/.exec(term)
    if (statusMatch) {
      const equal = status === statusMatch[2]
      return statusMatch[1] === '=' ? equal : !equal
    }

    const dateMatch = /^(p\.term_\w+) (>=|<=|>|<) \$(\d+)$/.exec(term)
    if (dateMatch) {
      const left =
        dateMatch[1] === COLUMNS.effectiveDateColumn ? row.effectiveDate : row.expirationDate
      const right = String(params[Number(dateMatch[3]) - 1])
      if (dateMatch[2] === '>=') return left >= right
      if (dateMatch[2] === '<=') return left <= right
      if (dateMatch[2] === '>') return left > right
      return left < right
    }

    throw new Error(`Unsupported SQL fragment in parity evaluator: ${term}`)
  }

  return evaluateTerm(clause)
}

function matchesSqlFilter(statusFilter: PolicyStatusFilter, row: PolicyRow): boolean {
  const clauses: string[] = []
  const params: any[] = ['tenant-a']
  appendPolicyStatusFilterClause(clauses, params, 2, statusFilter, COLUMNS)
  return clauses.every((clause) => evaluateSqlClause(clause, params, row))
}

describe('policy.utils', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('derives workflow status from raw status and term dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))

    expect(derivePolicyWorkflowStatus('Cancelled', '2026-01-01', '2027-01-01')).toBe('Cancelled')
    expect(derivePolicyWorkflowStatus('Bound', '2026-01-01', '2027-01-01')).toBe('Bind')
    expect(derivePolicyWorkflowStatus('Issued', '2026-01-01', '2027-01-01')).toBe('Inforced')
    expect(derivePolicyWorkflowStatus('Issued', '2026-07-01', '2027-07-01')).toBe('Issued')
    expect(derivePolicyWorkflowStatus('Issued', '2025-01-01', '2026-01-01')).toBe('Expired')
    expect(derivePolicyWorkflowStatus('', '2026-01-01', '2027-01-01')).toBe('Draft')
  })

  it('normalizes supported status filter aliases', () => {
    expect(normalizePolicyStatusFilter('bound')).toBe('Bind')
    expect(normalizePolicyStatusFilter('inforce')).toBe('Inforced')
    expect(normalizePolicyStatusFilter('canceled')).toBe('Cancelled')
    expect(normalizePolicyStatusFilter('expired')).toBe('Expired')
    expect(normalizePolicyStatusFilter('unknown')).toBe('')
  })

  it('appends SQL clauses and parameters for date-sensitive status filters', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))
    const clauses: string[] = []
    const params: any[] = ['tenant-a']

    const nextIdx = appendPolicyStatusFilterClause(clauses, params, 2, 'Inforced', {
      statusColumn: 'p.status',
      effectiveDateColumn: 'p.effective_date',
      expirationDateColumn: 'p.expiration_date',
    })

    expect(nextIdx).toBe(3)
    expect(params).toEqual(['tenant-a', '2026-06-04'])
    expect(clauses).toEqual([
      "LOWER(p.status::text) = 'issued' AND p.effective_date <= $2 AND p.expiration_date >= $2",
    ])
  })

  it('matches in-memory policy status filters with date-sensitive issued handling', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))

    expect(matchesPolicyStatusFilter('', 'issued', '2026-01-01', '2027-01-01')).toBe(true)
    expect(matchesPolicyStatusFilter('Inforced', 'issued', '2026-01-01', '2027-01-01')).toBe(true)
    expect(matchesPolicyStatusFilter('Issued', 'issued', '2026-07-01', '2027-07-01')).toBe(true)
    expect(matchesPolicyStatusFilter('Issued', 'bound', '2026-07-01', '2027-07-01')).toBe(false)
    expect(matchesPolicyStatusFilter('Expired', 'issued', '2025-01-01', '2026-01-01')).toBe(true)
  })

  it('guards Draft, Rated, and Bind filters against expired terms', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))

    const cases: Array<[PolicyStatusFilter, string]> = [
      ['Draft', "LOWER(p.status::text) IN ('draft','quote') AND p.term_expiration_date >= $2"],
      ['Rated', "LOWER(p.status::text) = 'rated' AND p.term_expiration_date >= $2"],
      ['Bind', "LOWER(p.status::text) = 'bound' AND p.term_expiration_date >= $2"],
    ]

    for (const [statusFilter, expected] of cases) {
      const clauses: string[] = []
      const params: any[] = ['tenant-a']

      const nextIdx = appendPolicyStatusFilterClause(clauses, params, 2, statusFilter, COLUMNS)

      expect(nextIdx).toBe(3)
      expect(params).toEqual(['tenant-a', '2026-06-04'])
      expect(clauses).toEqual([expected])
    }
  })

  it('does not apply a term guard to the Cancelled filter', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))
    const clauses: string[] = []
    const params: any[] = ['tenant-a']

    const nextIdx = appendPolicyStatusFilterClause(clauses, params, 2, 'Cancelled', COLUMNS)

    expect(nextIdx).toBe(2)
    expect(params).toEqual(['tenant-a'])
    expect(clauses).toEqual(["LOWER(p.status::text) = 'cancelled'"])
  })

  it('keeps params balanced when the status filter is empty', () => {
    const clauses: string[] = []
    const params: any[] = ['tenant-a']

    expect(appendPolicyStatusFilterClause(clauses, params, 2, '', COLUMNS)).toBe(2)
    expect(params).toEqual(['tenant-a'])
    expect(clauses).toEqual([])
  })

  // Regression guard for the defect this suite was extended for: the SQL filter
  // used by the database path and the in-memory matcher used by the fallback
  // path are separate implementations of the same rule, and they had drifted.
  it('produces identical results from the SQL clause and the in-memory matcher', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))

    const rows: PolicyRow[] = [
      { label: 'draft, current term', status: 'draft', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'draft, expired term', status: 'draft', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'quote, current term', status: 'quote', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'quote, expired term', status: 'quote', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'rated, current term', status: 'rated', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'rated, expired term', status: 'rated', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'bound, current term', status: 'bound', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'bound, expired term', status: 'bound', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'issued, in force', status: 'issued', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'issued, future term', status: 'issued', effectiveDate: '2026-07-01', expirationDate: '2027-07-01' },
      { label: 'issued, expired term', status: 'issued', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'cancelled, current term', status: 'cancelled', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'cancelled, expired term', status: 'cancelled', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'raw expired, current term', status: 'expired', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'raw expired, expired term', status: 'expired', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
      { label: 'unmapped status, current term', status: 'active', effectiveDate: '2026-01-01', expirationDate: '2027-01-01' },
      { label: 'unmapped status, expired term', status: 'active', effectiveDate: '2024-01-01', expirationDate: '2025-01-01' },
    ]

    const filters: PolicyStatusFilter[] = [
      '',
      'Draft',
      'Rated',
      'Bind',
      'Issued',
      'Inforced',
      'Expired',
      'Cancelled',
    ]

    for (const statusFilter of filters) {
      for (const row of rows) {
        const inMemory = matchesPolicyStatusFilter(
          statusFilter,
          row.status,
          row.effectiveDate,
          row.expirationDate
        )
        expect(
          matchesSqlFilter(statusFilter, row),
          `filter "${statusFilter || '(none)'}" disagreed for ${row.label}`
        ).toBe(inMemory)
      }
    }
  })

  // A filter must never return a row that the same response labels differently.
  it('never matches a row whose derived workflow status differs from the filter', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00Z'))

    const expiredDraft: PolicyRow = {
      label: 'draft, expired term',
      status: 'draft',
      effectiveDate: '2024-01-01',
      expirationDate: '2025-01-01',
    }

    expect(
      derivePolicyWorkflowStatus(
        expiredDraft.status,
        expiredDraft.effectiveDate,
        expiredDraft.expirationDate
      )
    ).toBe('Expired')
    expect(matchesSqlFilter('Draft', expiredDraft)).toBe(false)
    expect(matchesSqlFilter('Expired', expiredDraft)).toBe(true)
  })
})
