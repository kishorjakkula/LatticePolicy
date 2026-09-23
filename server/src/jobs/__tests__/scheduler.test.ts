import { describe, expect, it } from 'vitest'
import { calculateNextRunAt } from '../scheduler.js'

describe('calculateNextRunAt', () => {
  it.each([
    ['interval:30s', '2026-01-01T00:00:30.000Z'],
    ['interval:15m', '2026-01-01T00:15:00.000Z'],
    ['interval:2h', '2026-01-01T02:00:00.000Z'],
    ['interval:1d', '2026-01-02T00:00:00.000Z'],
  ])('advances %s by one interval', (expression, expected) => {
    const scheduledAt = new Date('2026-01-01T00:00:00.000Z')
    expect(calculateNextRunAt(expression, scheduledAt, scheduledAt).toISOString()).toBe(expected)
  })

  it('skips missed intervals and returns the first occurrence after now', () => {
    const next = calculateNextRunAt(
      'interval:1h',
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-01-01T03:20:00.000Z')
    )
    expect(next.toISOString()).toBe('2026-01-01T04:00:00.000Z')
  })

  it.each(['', '0 0 * * *', 'interval:0m', 'interval:five-minutes'])('rejects unsupported expression %j', (expression) => {
    expect(() => calculateNextRunAt(expression, new Date())).toThrow()
  })
})
