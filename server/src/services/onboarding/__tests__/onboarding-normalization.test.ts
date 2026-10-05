import { describe, expect, it } from 'vitest'
import { normalizeAgencyCodePrefix, normalizeAgencyStatus, normalizeDate, toBoolean, toOptionalNumber } from '../onboarding-normalization.js'

describe('onboarding normalization contract', () => {
  it('applies canonical defaults and formats', () => {
    expect(normalizeAgencyStatus('active')).toBe('ACTIVE')
    expect(normalizeAgencyStatus('unknown')).toBe('PROSPECT')
    expect(normalizeAgencyCodePrefix(' a-1 ')).toBe('AA')
    expect(normalizeDate('12/31/2026')).toBe('2026-12-31')
  })
  it('coerces service payload primitives consistently', () => {
    expect(toBoolean('yes')).toBe(true)
    expect(toBoolean('off', true)).toBe(false)
    expect(toOptionalNumber('12.5')).toBe(12.5)
    expect(toOptionalNumber('')).toBeNull()
  })
})
