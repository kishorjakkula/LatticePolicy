import { describe, expect, it } from 'vitest'
import { validateQuoteSetup } from '../setupValidation'
describe('quote setup validation', () => {
  const valid = { underwritingCompanyName: 'Pilot Property', productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: '2028-02-29', termMonths: 12 }
  it('accepts a complete setup and a real leap-day effective date', () => expect(validateQuoteSetup(valid)).toEqual({}))
  it('reports missing selections together and rejects calendar and term errors', () => {
    expect(validateQuoteSetup({ ...valid, underwritingCompanyName: ' ', productCode: '', effectiveDate: '2027-02-29', termMonths: 0 })).toEqual({
      underwritingCompanyName: 'Underwriting company is required.', productCode: 'Product is required.',
      effectiveDate: 'Enter a valid effective date.', termMonths: 'Enter a positive term in months.',
    })
  })
})
