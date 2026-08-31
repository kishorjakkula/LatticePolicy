import { describe, expect, it } from 'vitest'
import { computeRenewalWindowBounds, DEFAULT_RENEWAL_WINDOW_DAYS } from '../renewalCandidateScan.js'

describe('computeRenewalWindowBounds', () => {
  it('returns from=now and to=now+windowDays as inclusive ISO dates', () => {
    const now = new Date('2026-06-01T15:30:00.000Z')
    const { from, to } = computeRenewalWindowBounds(45, now)
    expect(from).toBe('2026-06-01')
    expect(to).toBe('2026-07-16')
  })

  it('uses the default window when none is provided', () => {
    expect(DEFAULT_RENEWAL_WINDOW_DAYS).toBe(45)
  })

  it('handles a window that crosses a year boundary', () => {
    const now = new Date('2026-12-20T00:00:00.000Z')
    const { from, to } = computeRenewalWindowBounds(30, now)
    expect(from).toBe('2026-12-20')
    expect(to).toBe('2027-01-19')
  })

  it('handles a zero-day window (only policies expiring today)', () => {
    const now = new Date('2026-06-01T09:00:00.000Z')
    const { from, to } = computeRenewalWindowBounds(0, now)
    expect(from).toBe('2026-06-01')
    expect(to).toBe('2026-06-01')
  })
})
