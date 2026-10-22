import { describe, expect, it, vi } from 'vitest'
import { barWidth, buildAiTrend, loadPagedRows, renewalsDue } from '../dashboardModel'

describe('dashboard model', () => {
  it('starts bars at zero and bounds nonzero values without a minimum fill', () => {
    expect(barWidth(0, 20)).toBe(0)
    expect(barWidth(1, 1000)).toBe(0.1)
    expect(barWidth(30, 20)).toBe(100)
    expect(barWidth(-1, 2)).toBe(0)
    expect(barWidth(1, 0)).toBe(0)
    expect(barWidth(NaN, 2)).toBe(0)
  })

  it('keeps actuals through this month and model forecasts strictly in future months, sorted across years', () => {
    const actual = (monthKey: string) => ({ monthKey, quotes: 2, policies: 1, cancellations: 0 })
    const forecast = (monthKey: string) => ({ monthKey, projectedQuotes: 7, projectedPolicies: 4, projectedCancellations: 1 })
    const rows = buildAiTrend({
      historical: [actual('2026-12'), actual('2026-10'), actual('2026-09'), actual('invalid')],
      forecast: [forecast('2027-01'), forecast('2026-09'), forecast('2026-10'), forecast('2026-11'), forecast('2026-13')],
    }, new Date(2026, 9, 20))
    expect(rows.map((row) => row.monthKey)).toEqual(['2026-09', '2026-10', '2026-11', '2027-01'])
    expect(rows[1].forecast).toBeUndefined()
    expect(rows[2].actual).toBeUndefined()
    expect(rows[2].forecast?.projectedQuotes).toBe(7)
    expect(rows[3].label).toBe('Jan 2027')
    expect(buildAiTrend(undefined)).toEqual([])
  })

  it('counts only issued/in-force terms expiring today through day 30 inclusive', () => {
    const policy = (policyId: string, expirationDate: string, internalStatus = 'Issued') => ({ policyId, internalStatus, term: { expirationDate } })
    const rows = renewalsDue([
      policy('today', '2026-12-20'), policy('last', '2027-01-19T00:00:00.000Z'),
      policy('late', '2027-01-20'), policy('expired', '2026-12-19'),
      policy('cancelled', '2026-12-25', 'Cancelled'), policy('draft', '2026-12-25', 'Draft'),
      policy('bound', '2026-12-25', 'Bound'), policy('missing', ''),
    ], new Date('2026-12-20T12:00:00Z'))
    expect(rows.map((row) => row.policyId)).toEqual(['today', 'last'])
  })

  it('loads all pages, not just the first page, including a real empty list', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ items: [1, 2], total: 3 }).mockResolvedValueOnce({ items: [3], total: 3 })
    expect(await loadPagedRows(fetch)).toEqual([1, 2, 3])
    expect(fetch).toHaveBeenNthCalledWith(2, 2, 100)
    expect(await loadPagedRows(async () => ({ items: [], total: 0 }))).toEqual([])
  })

  it.each([
    ['America/New_York', '2026-10-21T01:00:00Z'],
    ['Asia/Tokyo', '2026-10-19T18:00:00Z'],
  ])('uses the local renewal calendar across UTC midnight in %s', (timezone, instant) => {
    vi.stubEnv('TZ', timezone)
    try {
      const policy = (date: string) => ({ policyId: date, status: 'Issued', term: { expirationDate: date } })
      expect(renewalsDue(['2026-10-19', '2026-10-20', '2026-11-19', '2026-11-20'].map(policy), new Date(instant))
        .map(row => row.policyId)).toEqual(['2026-10-20', '2026-11-19'])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('does not turn malformed or incomplete responses into invented zero/partial counts', async () => {
    await expect(loadPagedRows(async () => ({ items: [] }))).rejects.toThrow('Incomplete')
    await expect(loadPagedRows(async () => ({ items: [], total: 5 }))).rejects.toThrow('List changed')
    await expect(loadPagedRows(async () => ({ items: [1], total: 0 }))).rejects.toThrow('List changed')
    await expect(loadPagedRows(vi.fn().mockResolvedValueOnce({ items: [1], total: 3 }).mockResolvedValueOnce({ items: [2], total: 2 }))).rejects.toThrow('List changed')
    await expect(loadPagedRows(async () => ({ items: [1], total: 1000 }))).rejects.toThrow('too large')
  })
})
