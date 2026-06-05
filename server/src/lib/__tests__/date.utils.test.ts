import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addDays,
  addMonths,
  asDateOnly,
  coerceDateOnly,
  diffMonths,
  proRataFactor,
  round2,
  today,
} from '../date.utils.js'

describe('date.utils', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses ISO UTC dates for today and fallback coercion', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T17:45:00Z'))

    expect(today()).toBe('2026-06-04')
    expect(coerceDateOnly('not a date')).toBe('2026-06-04')
    expect(coerceDateOnly(null, '2026-01-01')).toBe('2026-01-01')
  })

  it('coerces strings and Date values to date-only values', () => {
    expect(coerceDateOnly('2026-07-01')).toBe('2026-07-01')
    expect(coerceDateOnly('July 4, 2026')).toBe('2026-07-04')
    expect(coerceDateOnly(new Date('2026-08-09T10:30:00Z'))).toBe('2026-08-09')

    expect(asDateOnly('2026-09-10T12:00:00Z')).toBe('2026-09-10')
    expect(asDateOnly(new Date('2026-10-11T03:00:00Z'))).toBe('2026-10-11')
    expect(asDateOnly('')).toBeUndefined()
    expect(asDateOnly('not a date')).toBeUndefined()
  })

  it('adds calendar days and months and computes month differences', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15')
    expect(addMonths('2026-07-01', -6)).toBe('2026-01-01')
    expect(diffMonths('2026-01-01', '2027-07-01')).toBe(18)
  })

  it('calculates pro-rata factors and rounds money values', () => {
    expect(proRataFactor('2026-07-01', '2026-01-01', '2027-01-01')).toBeCloseTo(184 / 365, 6)
    expect(proRataFactor('2027-02-01', '2026-01-01', '2027-01-01')).toBe(0)
    expect(round2(12.345)).toBe(12.35)
    expect(round2(12.344)).toBe(12.34)
  })
})
