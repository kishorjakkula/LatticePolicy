import { describe, expect, it } from 'vitest'
import { validateQuote, validateQuoteDetailed } from '../contracts.js'

const validQuote = {
  productCode: 'personal-auto',
  effectiveDate: '2026-07-01',
  termMonths: 12,
  state: 'CA',
  applicant: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  risks: [
    {
      type: 'autoVehicle',
      year: 2023,
      make: 'Toyota',
      model: 'Camry',
      garagingZip: '94105',
      usage: 'commute',
    },
  ],
  coverages: [{ code: 'BI', selected: true, limit: 100000 }],
}

describe('contract validation', () => {
  it('validates quote payloads with JSON Schema semantics', () => {
    expect(validateQuote(validQuote)).toBe(true)
    expect(validateQuoteDetailed(validQuote)).toEqual({ valid: true, errors: [] })
  })

  it('returns structured contract validation errors', () => {
    const result = validateQuoteDetailed({
      ...validQuote,
      termMonths: 9,
      risks: [],
    })

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/termMonths',
          keyword: 'enum',
          schema: 'quote.request.schema.json',
        }),
        expect.objectContaining({
          path: '/risks',
          keyword: 'minItems',
          schema: 'quote.request.schema.json',
        }),
      ])
    )
  })

  it('matches the API tenant contract by not requiring tenantId in the body', () => {
    const result = validateQuoteDetailed(validQuote)

    expect(result.valid).toBe(true)
  })
})
