import { describe, expect, it } from 'vitest'
import { validateInsureds } from '../insuredValidation'

describe('validateInsureds', () => {
  it('requires first and last name for personal lines primary insureds', () => {
    expect(validateInsureds({ primary: { firstName: '', lastName: '' } }, 'personal-auto')).toEqual({
      'insureds.primary.firstName': 'Primary insured first name is required',
      'insureds.primary.lastName': 'Primary insured last name is required',
    })

    expect(validateInsureds({ primary: { firstName: 'Ada', lastName: 'Lovelace' } }, 'homeowners')).toEqual({})
  })

  it('trims primary insured names before validating personal lines', () => {
    expect(validateInsureds({ primary: { firstName: '  ', lastName: '  Hopper  ' } }, 'personal-auto')).toEqual({
      'insureds.primary.firstName': 'Primary insured first name is required',
    })
  })

  it('does not accept customer identity or contact fields as a primary insured name', () => {
    expect(validateInsureds({
      primary: {
        customerId: 'cust-123',
        email: 'customer@example.com',
        phone: '555-0100',
      },
    }, 'homeowners')).toEqual({
      'insureds.primary.firstName': 'Primary insured first name is required',
      'insureds.primary.lastName': 'Primary insured last name is required',
    })
  })

  it('allows a display name for commercial primary insureds', () => {
    expect(validateInsureds({ primary: { displayName: 'Acme Consulting LLC' } }, 'professional-liability')).toEqual({})
    expect(validateInsureds({ primary: { firstName: 'Ada', lastName: 'Lovelace' } }, 'commercial-auto')).toEqual({})
    expect(validateInsureds({ primary: {} }, 'commercial-auto')).toEqual({
      'insureds.primary.displayName': 'Primary insured name is required',
    })
  })

  it('validates optional secondary and additional insureds only when populated', () => {
    expect(validateInsureds({
      primary: { firstName: 'Ada', lastName: 'Lovelace' },
      secondary: {},
      additional: [{}],
    }, 'personal-auto')).toEqual({})

    expect(validateInsureds({
      primary: { firstName: 'Ada', lastName: 'Lovelace' },
      secondary: { firstName: 'Grace' },
      additional: [{ email: 'partial@example.com' }],
    }, 'personal-auto')).toEqual({
      'insureds.secondary.lastName': 'Secondary insured last name is required',
      'insureds.additional.0.firstName': 'Additional insured 1 first name is required',
      'insureds.additional.0.lastName': 'Additional insured 1 last name is required',
    })
  })

  it('allows display names for populated commercial optional insureds', () => {
    expect(validateInsureds({
      primary: { displayName: 'Acme Consulting LLC' },
      secondary: { displayName: 'Acme Holdings Inc.' },
      additional: [{ displayName: 'Building Owner LLC' }],
    }, 'commercial-auto')).toEqual({})
  })

  it('requires a recognizable name when optional insureds only have identifiers or contact data', () => {
    expect(validateInsureds({
      primary: { displayName: 'Acme Consulting LLC' },
      secondary: { customerKey: 'CUST-1001' },
      additional: [{ phone: '555-0101' }],
    }, 'cyber')).toEqual({
      'insureds.secondary.firstName': 'Secondary insured first name is required',
      'insureds.secondary.lastName': 'Secondary insured last name is required',
      'insureds.additional.0.firstName': 'Additional insured 1 first name is required',
      'insureds.additional.0.lastName': 'Additional insured 1 last name is required',
    })
  })
})
