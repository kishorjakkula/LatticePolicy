import { describe, expect, it } from 'vitest'
import { additionalInterestRowsFromPayload } from '../quote-bind.service.js'

describe('additionalInterestRowsFromPayload', () => {
  it('preserves unit, line3, county, ZIP+4 and non-US region in the bound primary projection', () => {
    const rows = additionalInterestRowsFromPayload({ additionalInterests: [{ role: 'MORTGAGEE', name: 'Example Bank', street: '20 Example', line2: 'STE 4', line3: 'Building C', county: 'County Name', city: 'London', state: 'London', zip: 'SW1A 1AA', country: 'GB' }] })
    expect(rows[0].address).toMatchObject({ line2: 'STE 4', line3: 'Building C', county: 'County Name', state: 'LONDON', country: 'GB', zip: 'SW1A 1AA' })
  })
  it('keeps named interests with a known role and normalises them', () => {
    const rows = additionalInterestRowsFromPayload({
      additionalInterests: [
        { role: 'mortgagee', name: '  First Federal Bank  ', loanNumber: 'L-1', street: '9 Main St', city: 'Austin', state: 'tx', zip: '78701' },
        { role: 'MORTGAGEE', name: '' },
        { role: 'LANDLORD', name: 'Unknown role' },
      ],
    })
    expect(rows).toEqual([{ role: 'MORTGAGEE', name: 'First Federal Bank', loanNumber: 'L-1', address: { street: '9 Main St', city: 'Austin', state: 'TX', zip: '78701' } }])
  })

  it('returns nothing when the quote has no interests', () => {
    expect(additionalInterestRowsFromPayload({})).toEqual([])
    expect(additionalInterestRowsFromPayload({ additionalInterests: 'x' })).toEqual([])
  })
})
