import { describe, expect, it } from 'vitest'
import { computeStaleQuoteCutoff, DEFAULT_STALE_QUOTE_DAYS } from '../staleQuoteCleanup.js'

describe('stale quote cleanup', () => {
  it('computes the inactivity cutoff in UTC', () => {
    const now = new Date('2026-06-01T12:00:00.000Z')
    expect(computeStaleQuoteCutoff(30, now).toISOString()).toBe('2026-05-02T12:00:00.000Z')
  })

  it('defaults to a 90-day inactivity window', () => {
    expect(DEFAULT_STALE_QUOTE_DAYS).toBe(90)
  })
})
