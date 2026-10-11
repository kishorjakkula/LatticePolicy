import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DynamicRiskForm } from '../QuoteWizard'
import type { Field } from '../schema'

const ungrouped: Field[] = [
  { key: 'construction', label: 'Construction', type: 'select', path: 'risks.0.construction', options: ['frame', 'masonry'] },
  { key: 'yearBuilt', label: 'Year Built', type: 'number', path: 'risks.0.yearBuilt', required: true },
]

// The shape the API returns for a carrier pack product: labels, options, help and sections from the pack.
const packFields: Field[] = [
  { key: 'address', label: 'Unit Address', type: 'text', path: 'risks.0.address', required: true, group: 'Unit' },
  { key: 'floorLevel', label: 'Floor Level', type: 'number', path: 'risks.0.floorLevel', required: true, help: 'Enter the floor the unit is on', group: 'Unit' },
  { key: 'construction', label: 'Building Construction', type: 'select', path: 'risks.0.construction', options: ['frame', 'masonry', 'other'], group: 'Building' },
  { key: 'associationName', label: 'Association Name', type: 'text', path: 'risks.0.associationName', group: 'Association' },
]

const quote = { risks: [{ address: '1 Main St #4', floorLevel: 4, construction: 'masonry' }] }

describe('DynamicRiskForm', () => {
  it('renders one flat grid when no field names a section', () => {
    const { container } = render(<DynamicRiskForm fields={ungrouped} value={quote} onChange={vi.fn()} onValidate={vi.fn()} />)
    expect(container.querySelectorAll('.dynamic-grid')).toHaveLength(1)
    expect(container.querySelector('.dynamic-group')).toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.getByText('Construction')).toBeInTheDocument()
  })

  it('renders a carrier pack product under its own section headings, in order', () => {
    render(<DynamicRiskForm fields={packFields} value={quote} onChange={vi.fn()} onValidate={vi.fn()} />)

    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['Unit', 'Building', 'Association'])
    expect(screen.getByText('Floor Level')).toBeInTheDocument()
    expect(screen.getByText('Enter the floor the unit is on')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1 Main St #4')).toBeInTheDocument()
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('masonry')
  })

  it('reports edits by field path and validates every field once', () => {
    const onChange = vi.fn()
    const onValidate = vi.fn()
    render(<DynamicRiskForm fields={packFields} value={quote} onChange={onChange} onValidate={onValidate} />)

    fireEvent.change(screen.getByDisplayValue('4'), { target: { value: '12' } })
    expect(onChange).toHaveBeenCalledWith('risks.0.floorLevel', 12)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'frame' } })
    expect(onChange).toHaveBeenCalledWith('risks.0.construction', 'frame')

    // Section grids must not each report their own partial result over the full one.
    expect(onValidate).toHaveBeenCalledTimes(1)
    expect(onValidate.mock.calls[0][0]).toEqual({})
  })
})
