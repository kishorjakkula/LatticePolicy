import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BusinessownersPremisesEditor, CoverageSelector, defaultRisksForProduct, DynamicRiskForm } from '../QuoteWizard'
import { buildGenericCoverageDefaults } from '../coverageUtils'
import { CoveragePackageTerms, coveragePackageTerms } from '../../../components/CoveragePackageTerms'

vi.mock('../../../api/request', async importOriginal => ({ ...await importOriginal<typeof import('../../../api/request')>(), request: vi.fn().mockResolvedValue({ enabled: false }) }))

const config = { product: 'businessowners', coverages: [
  { code: 'BOP_BUILDING', name: 'Building', optional: true, defaultLimit: 500000, limitType: 'value', deductibles: [1000, 2500, 5000] },
  { code: 'BOP_BPP', name: 'Business personal property', required: true, defaultLimit: 100000, limitType: 'value', deductibles: [1000, 2500, 5000] },
  { code: 'BOP_BI_EE', name: 'Business income and extra expense', required: true, limits: [100000], packageTerms: { basis: 'limited-dollar', restorationMonths: 12, waitingPeriodHours: 72, extraExpenseIncluded: true, sharedLimit: true } },
  { code: 'BOP_LIAB', name: 'Business liability', required: true, defaultLimit: 1000000, limits: [500000, 1000000, 2000000], aggregateMultiplier: 2, personalAdvertisingInjuryMultiplier: 1, packageTerms: { basis: 'occurrence', damageToRentedPremisesLimit: 100000, medicalExpensesPerPerson: 5000 } },
  { code: 'BOP_MED', name: 'Medical expenses (included)', required: true, limits: [5000], packageTerms: { basis: 'perPerson', included: true } },
  { code: 'BOP_EQUIP', name: 'Equipment breakdown', optional: true, limits: [25000, 50000, 100000], deductibles: [1000] },
  { code: 'BOP_WATER', name: 'Water backup', optional: true, limits: [5000, 10000, 25000], deductibles: [1000] },
] }

function Editor({ risk = { occupancy: 'tenant', buildingInterest: false }, disabled = false }: { risk?: any; disabled?: boolean }) {
  const [value, onChange] = useState(buildGenericCoverageDefaults(config))
  return <CoverageSelector product="businessowners" cfg={config} value={value} onChange={onChange} risk={risk} disabled={disabled} />
}

describe('businessowners package', () => {
  it('starts with a typed premises but no invented business or protection facts', () => {
    expect(defaultRisksForProduct('businessowners')).toEqual([{ type: 'businessownersLocation' }])
  })

  it('embeds a single structured address with no contact email or location-add control', () => {
    const onChange = vi.fn()
    const risk = { type: 'businessownersLocation', locationAddress: { line1: '10 Synthetic Way', line2: 'Suite 2', city: 'Columbus', state: 'OH', postalCode: '43215-1234', country: 'US' } }
    const { rerender } = render(<BusinessownersPremisesEditor risk={risk} onChange={onChange} />)
    expect(screen.getByLabelText('ZIP Code')).toHaveValue('43215-1234')
    fireEvent.change(screen.getByLabelText('Address line 1'), { target: { value: '20 Synthetic Way' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ line1: '20 Synthetic Way', line2: 'Suite 2', postalCode: '43215-1234' }))
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument()
    rerender(<BusinessownersPremisesEditor risk={risk} onChange={onChange} disabled />)
    expect(screen.getByLabelText('Address line 1')).toBeDisabled()
  })

  it('defaults only the required package and uses the configured liability default, not its first limit', () => {
    const defaults = buildGenericCoverageDefaults(config)
    expect(defaults.map(selection => selection.code)).toEqual(['BOP_BPP', 'BOP_BI_EE', 'BOP_LIAB', 'BOP_MED'])
    expect(defaults.find(selection => selection.code === 'BOP_LIAB')?.limit).toBe(1000000)
    expect(defaults.some(selection => selection.packageTerms)).toBe(false)
    render(<Editor />)
    expect(screen.getByRole('checkbox', { name: 'Business personal property (Required)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Business personal property (Required)' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Building' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Building' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'Equipment breakdown' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Equipment breakdown' }))
    expect(screen.getByRole('combobox', { name: 'Equipment breakdown limit' })).toHaveValue('25000')
  })

  it('shows config-derived income and included liability terms and updates aggregates with the occurrence limit', () => {
    render(<Editor />)
    expect(screen.getByText('General aggregate: $2,000,000')).toBeInTheDocument()
    expect(screen.getByText('Personal and advertising injury included: $1,000,000')).toBeInTheDocument()
    expect(screen.getByText('Damage to rented premises included: $100,000')).toBeInTheDocument()
    expect(screen.getByText('Medical expenses per person included: $5,000')).toBeInTheDocument()
    expect(screen.getByText('Restoration period: up to 12 months')).toBeInTheDocument()
    expect(screen.getByText('Income waiting period: 72 hours')).toBeInTheDocument()
    expect(screen.getByText('Extra expense included in the shared limit')).toBeInTheDocument()
    expect(screen.getByText('Included - no additional premium')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox', { name: 'Business liability limit' }), { target: { value: '2000000' } })
    expect(screen.getByText('General aggregate: $4,000,000')).toBeInTheDocument()
    expect(screen.getByText('Products-completed operations aggregate: $4,000,000')).toBeInTheDocument()
  })

  it('requires building for an owner and preserves the selection for explicit review after occupancy changes', () => {
    const { rerender } = render(<Editor risk={{ occupancy: 'owner', buildingInterest: true }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Default Coverages' }))
    expect(screen.getByRole('checkbox', { name: 'Building (Required)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Building (Required)' })).toBeDisabled()
    rerender(<Editor risk={{ occupancy: 'tenant', buildingInterest: false }} />)
    expect(screen.getByRole('checkbox', { name: 'Building' })).toBeChecked()
    expect(screen.getByRole('alert')).toHaveTextContent('Review this selection')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Building' }))
    expect(screen.getByRole('checkbox', { name: 'Building' })).not.toBeChecked()
  })

  it('allows explicit tenant building interest and locks controls in read-only mode', () => {
    const { rerender } = render(<Editor risk={{ occupancy: 'tenant', buildingInterest: true }} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Building' }))
    expect(screen.getByRole('spinbutton', { name: 'Building limit' })).toHaveValue(500000)
    rerender(<Editor risk={{ occupancy: 'tenant', buildingInterest: true }} disabled />)
    expect(screen.getByRole('spinbutton', { name: 'Building limit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Default Coverages' })).toBeDisabled()
  })

  it('uses historical terms without rederiving them from newer configuration', () => {
    const selection = { limit: 1000000, packageTerms: { generalAggregate: 1500000 } }
    render(<CoveragePackageTerms terms={coveragePackageTerms(config.coverages[3], selection)} />)
    expect(screen.getByText('General aggregate: $1,500,000')).toBeInTheDocument()
    expect(screen.queryByText('General aggregate: $2,000,000')).not.toBeInTheDocument()
  })

  it('keeps missing classifications and cleared numeric facts blank', () => {
    const onChange = vi.fn()
    render(<DynamicRiskForm fields={[
      { key: 'businessClass', label: 'Business class', type: 'select', options: ['office', 'retail', 'service'], path: 'risks.0.businessClass', required: true },
      { key: 'vacancyDays', label: 'Vacancy days', type: 'number', path: 'risks.0.vacancyDays', required: true },
    ]} value={{ risks: [{ type: 'businessownersLocation', vacancyDays: 2 }] }} onChange={onChange} onValidate={vi.fn()} />)
    expect(screen.getByRole('combobox', { name: 'Business class' })).toHaveValue('')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Vacancy days' }), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith('risks.0.vacancyDays', '')
  })
})
