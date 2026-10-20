import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect(prefs.dateFormatsByCountry.US).toBe('MM/DD/YYYY')
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
    expect(resolveDateFormat('US')).toBe('MM/DD/YYYY')
    expect(localStorage.getItem('tenantDatePreferences')).toBeNull()
  })

  it('formats date-only values in the requested country format', () => {
    applyTenantDatePreferences({
      defaultCountry: 'US',
      dateFormatsByCountry: { US: 'MM/DD/YYYY', GB: 'DD/MM/YYYY', JP: 'YYYY/MM/DD' },
    })

    expect(formatDisplayDate('2026-02-03', { country: 'US' })).toBe('02/03/2026')
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

  describe('REQ-7 country-aware formats', () => {
    const originalTz = process.env.TZ

    afterEach(() => {
      process.env.TZ = originalTz
    })

    it('defaults the US to MM/DD/YYYY with no tenant preferences', () => {
      expect(resolveDateFormat()).toBe('MM/DD/YYYY')
      expect(formatDisplayDate('2027-09-18')).toBe('09/18/2027')
      expect(formatDisplayDate('2027-09-18', { country: 'US' })).toBe('09/18/2027')
    })

    it('reads the legacy stored US dash format as the US slash format', () => {
      // Every tenant was stored with US: MM-DD-YYYY before REQ-7 (migration 012).
      applyTenantDatePreferences({ defaultCountry: 'US', dateFormatsByCountry: { US: 'MM-DD-YYYY', CA: 'MM-DD-YYYY' } })
      expect(resolveDateFormat('US')).toBe('MM/DD/YYYY')
      expect(formatDisplayDate('2027-09-18')).toBe('09/18/2027')
      // Only the US is upgraded; other countries keep the configured value.
      expect(resolveDateFormat('CA')).toBe('MM-DD-YYYY')
      expect(formatDisplayDate('2027-09-18', { country: 'CA' })).toBe('09-18-2027')
    })

    it('shows US date-times as MM/DD/YYYY h:mm AM/PM', () => {
      process.env.TZ = 'America/New_York'
      // 16:29 UTC is 12:29 PM in New York (EDT).
      expect(formatDisplayDateTime('2026-10-18T16:29:00.000Z', { includeTime: true })).toBe('10/18/2026 12:29 PM')
      expect(formatDisplayDateTime('2026-10-18T04:05:00.000Z', { includeTime: true })).toBe('10/18/2026 12:05 AM')
      expect(formatDisplayDateTime('2026-10-18T13:07:00.000Z', { includeTime: true, country: 'US' })).toBe('10/18/2026 9:07 AM')
      expect(formatDisplayDateTime('2026-10-19T01:45:00.000Z', { includeTime: true })).toBe('10/18/2026 9:45 PM')
    })

    it('keeps the configured order and a 24-hour clock for a non-US country', () => {
      process.env.TZ = 'Europe/London'
      applyTenantDatePreferences({ defaultCountry: 'US', dateFormatsByCountry: { US: 'MM/DD/YYYY', GB: 'DD/MM/YYYY' } })
      expect(formatDisplayDate('2027-09-18', { country: 'GB' })).toBe('18/09/2027')
      // 16:29 UTC is 17:29 in London (BST).
      expect(formatDisplayDateTime('2026-10-18T16:29:00.000Z', { includeTime: true, country: 'GB' })).toBe('18/10/2026 17:29')
      expect(formatDisplayDateTime('2026-10-18T07:05:00.000Z', { includeTime: true, country: 'GB' })).toBe('18/10/2026 08:05')
    })

    it('uses the tenant default country when none is given', () => {
      process.env.TZ = 'UTC'
      applyTenantDatePreferences({ defaultCountry: 'DE', dateFormatsByCountry: { DE: 'DD-MM-YYYY', US: 'MM/DD/YYYY' } })
      expect(formatDisplayDateTime('2026-10-18T16:29:00.000Z', { includeTime: true })).toBe('18-10-2026 16:29')
      expect(formatDisplayDateTime('2026-10-18T16:29:00.000Z', { includeTime: true, country: 'US' })).toBe('10/18/2026 4:29 PM')
    })

    it('still reads stored ISO dates and leaves non-dates as given', () => {
      expect(formatDisplayDate('2028-02-29')).toBe('02/29/2028')
      expect(formatDisplayDate('{{effectiveDate}}', { fallback: '-' })).toBe('{{effectiveDate}}')
      expect(formatDisplayDate(null, { fallback: '-' })).toBe('-')
      expect(formatDisplayDate('   ', { fallback: '-' })).toBe('-')
    })
  })

  describe('DATE columns serialized as UTC-midnight timestamps', () => {
    const originalTz = process.env.TZ

    afterEach(() => {
      process.env.TZ = originalTz
    })

    // Regression: west of UTC, "2026-10-10T00:00:00.000Z" is still Oct 9 local
    // time, so effective dates rendered one day early.
    it.each(['America/New_York', 'America/Los_Angeles', 'UTC', 'Asia/Kolkata'])('keeps the calendar date in %s', (tz) => {
      process.env.TZ = tz
      expect(formatDisplayDate('2026-10-10T00:00:00.000Z')).toBe('10/10/2026')
      expect(formatDisplayDate('2026-10-10T00:00:00Z')).toBe('10/10/2026')
      expect(formatDisplayDate('2026-01-01T00:00:00.000Z')).toBe('01/01/2026')
      expect(formatDisplayDate('2026-10-10')).toBe('10/10/2026')
    })

    it('renders a UTC-midnight value as a date even when a time was requested', () => {
      process.env.TZ = 'America/New_York'
      expect(formatDisplayDateTime('2026-10-10T00:00:00.000Z', { includeTime: true })).toBe('10/10/2026')
    })

    it('still converts real instants to local time', () => {
      process.env.TZ = 'America/New_York'
      expect(formatDisplayDate('2026-10-10T02:30:00.000Z')).toBe('10/09/2026')
    })
  })
})
