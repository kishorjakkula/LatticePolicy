import { describe, expect, it } from 'vitest'
import { additionalInterestRowsFromPayload } from '../quote-bind.service.js'

describe('additionalInterestRowsFromPayload', () => {
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
