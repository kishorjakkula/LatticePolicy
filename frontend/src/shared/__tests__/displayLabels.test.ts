import { describe, expect, it } from 'vitest'
import { aiModelSummary, coverageLabel, formatCurrency, productLabel, statusLabel } from '../displayLabels'

describe('display labels', () => {
  it('turns internal insurance codes into client-friendly labels', () => {
    expect(productLabel('personal-auto')).toBe('Personal Auto')
    expect(statusLabel('RISK')).toBe('Risk')
    expect(statusLabel('PENDING_COMPLIANCE')).toBe('Pending Compliance')
    expect(statusLabel('QUOTA_SHARE')).toBe('Quota Share')
    expect(coverageLabel('BI')).toBe('Bodily Injury Liability')
  })

  it('formats money and AI model details for business users', () => {
    expect(formatCurrency(100000)).toContain('100,000')
    expect(aiModelSummary({ enabled: false, shadowMode: true })).toBe('Portfolio baseline model - Advisory mode')
  })
})
