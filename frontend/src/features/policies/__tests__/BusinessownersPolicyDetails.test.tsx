import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BusinessownersPolicyDetails } from '../BusinessownersPolicyDetails'

describe('BOP policy package snapshot', () => {
  it('renders persisted premises, included terms and historical aggregates without current product configuration', () => {
    render(<BusinessownersPolicyDetails payload={{
      risks: [{ businessName: 'Synthetic business', occupancy: 'tenant', buildingInterest: false,
        locationAddress: { line1: '10 Synthetic Way', city: 'Columbus', state: 'OH', postalCode: '43215-1234', country: 'US' } }],
      coverages: [
        { code: 'BOP_LIAB', limit: 1000000, packageTerms: { generalAggregate: 2000000, damageToRentedPremisesLimit: 100000 } },
        { code: 'BOP_MED', limit: 5000, packageTerms: { basis: 'perPerson', included: true } },
        { code: 'BOP_WATER', limit: 5000, selected: false }
      ]
    }} />)
    expect(screen.getByText('General aggregate: $2,000,000')).toBeInTheDocument()
    expect(screen.getByText('Included - no additional premium')).toBeInTheDocument()
    expect(screen.getByText(/43215-1234/)).toBeInTheDocument()
    expect(screen.queryByText('Water backup')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
