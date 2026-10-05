import { describe, expect, it } from 'vitest'
import { policyCurrencyCode, policyTermEffective, reserveTransactionNumber, simplePremium, summarizeRisk } from '../lifecycle-support.js'

describe('lifecycle support contract', () => {
  it('normalizes persisted policy fields without changing transaction semantics', () => {
    expect(policyTermEffective({ term_effective_date: '2026-01-01' })).toBe('2026-01-01')
    expect(policyCurrencyCode({})).toBe('USD')
    expect(simplePremium(10.126).total.amount).toBe(10.13)
  })
  it('preserves transaction number and risk summary formats', () => {
    expect(reserveTransactionNumber('cancel')).toMatch(/^CN-\d{8}-[A-Z0-9]{4}$/)
    expect(summarizeRisk({ type: 'autoVehicle', year: 2024, make: 'Toyota', model: 'Camry' })).toBe('2024 Toyota Camry')
  })
})
