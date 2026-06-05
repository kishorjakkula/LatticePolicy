import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyTenantDatePreferences,
  formatDisplayDate,
  formatDisplayDateTime,
  getTenantDatePreferences,
  normalizeTenantDatePreferences,
  resetTenantDatePreferences,
  resolveDateFormat,
} from '../dateDisplay'

describe('dateDisplay', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTenantDatePreferences()
  })

  it('normalizes tenant date preferences with fallback formats', () => {
    const prefs = normalizeTenantDatePreferences({
      defaultCountry: 'gb',
      dateFormatsByCountry: {
        gb: 'DD/MM/YYYY',
        us: 'not-valid',
      },
    })

    expect(prefs.defaultCountry).toBe('GB')
    expect(prefs.dateFormatsByCountry.GB).toBe('DD/MM/YYYY')
    expect(prefs.dateFormatsByCountry.US).toBe('MM-DD-YYYY')
  })

  it('applies, stores, resolves, and resets tenant preferences', () => {
    applyTenantDatePreferences({
      defaultCountry: 'CA',
      dateFormatsByCountry: { CA: 'YYYY-MM-DD', US: 'MM/DD/YYYY' },
    })

    expect(getTenantDatePreferences()).toEqual({
      defaultCountry: 'CA',
      dateFormatsByCountry: { CA: 'YYYY-MM-DD', US: 'MM/DD/YYYY' },
    })
    expect(resolveDateFormat('US')).toBe('MM/DD/YYYY')
    expect(resolveDateFormat()).toBe('YYYY-MM-DD')
    expect(localStorage.getItem('tenantDatePreferences')).toContain('YYYY-MM-DD')

    resetTenantDatePreferences()
    expect(resolveDateFormat('US')).toBe('MM-DD-YYYY')
    expect(localStorage.getItem('tenantDatePreferences')).toBeNull()
  })

  it('formats date-only values in the requested country format', () => {
    applyTenantDatePreferences({
      defaultCountry: 'US',
      dateFormatsByCountry: { US: 'MM-DD-YYYY', GB: 'DD/MM/YYYY', JP: 'YYYY/MM/DD' },
    })

    expect(formatDisplayDate('2026-02-03', { country: 'US' })).toBe('02-03-2026')
    expect(formatDisplayDate('2026-02-03', { country: 'GB' })).toBe('03/02/2026')
    expect(formatDisplayDate('2026-02-03', { country: 'JP' })).toBe('2026/02/03')
  })

  it('formats date-time values with optional time and preserves invalid fallback behavior', () => {
    applyTenantDatePreferences({
      defaultCountry: 'US',
      dateFormatsByCountry: { US: 'YYYY-MM-DD' },
    })

    expect(formatDisplayDateTime('2026-02-03T14:30:00.000Z', { includeTime: false })).toBe('2026-02-03')
    expect(formatDisplayDateTime('not-a-date', { fallback: 'fallback' })).toBe('not-a-date')
    expect(formatDisplayDate('', { fallback: 'fallback' })).toBe('fallback')
  })
})
