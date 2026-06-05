import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appendPolicyStatusFilterClause,
  derivePolicyWorkflowStatus,
  matchesPolicyStatusFilter,
  normalizePolicyStatusFilter,
} from '../policy.utils.js'

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
})
