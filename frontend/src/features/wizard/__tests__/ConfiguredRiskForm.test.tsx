import { useState } from 'react'
import { fireEvent, render, screen as view, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProductScreen, ScreenField } from '@lattice-policy/rules'
import { ConfiguredRiskForm, ConfiguredRiskSummary, SCREEN_FORM_ERROR_KEY, screenErrors } from '../ConfiguredRiskForm'
import { setByPath } from '../schema'

function field(key: string, label: string, overrides: Partial<ScreenField> = {}): ScreenField {
  return { key, label, path: `risks.0.${key}`, dataType: 'string', widget: 'text', ...overrides }
}

// The shape the API returns for the example carrier pack product.
const packScreen: ProductScreen = {
  layout: 'tabs',
  sections: [
    {
      title: 'Unit',
      columns: 3,
      fields: [
        field('address', 'Unit Address', { required: true, span: 2, placeholder: 'Street and unit' }),
        field('floorLevel', 'Floor Level', { dataType: 'int', widget: 'number', required: true, help: 'Enter the floor the unit is on' }),
        field('occupancy', 'Occupancy', { dataType: 'enum', widget: 'radio', options: ['OwnerOccupied', 'TenantOccupied'], required: true }),
        field('monthlyRent', 'Monthly Rent', { dataType: 'number', widget: 'currency', visibleWhen: "risk.occupancy == 'TenantOccupied'", requiredWhen: "risk.occupancy == 'TenantOccupied'" }),
      ],
    },
    {
      title: 'Building',
      help: 'Details of the building the unit is in.',
      fields: [
        field('construction', 'Building Construction', { dataType: 'enum', widget: 'select', options: ['frame', 'masonry'] }),
        field('buildingFloors', 'Floors in Building', { dataType: 'int', widget: 'number' }),
        field('hasElevator', 'Building Has an Elevator', { dataType: 'bool', widget: 'checkbox' }),
        field('elevatorCount', 'Number of Elevators', { dataType: 'int', widget: 'number', visibleWhen: 'risk.hasElevator', requiredWhen: 'risk.hasElevator' }),
      ],
    },
    {
      title: 'Loss assessment',
      visibleWhen: 'coverages.LOSS_ASSESS.selected',
      fields: [field('specialAssessmentNotes', 'Known Special Assessments', { widget: 'textarea' })],
    },
  ],
  validations: [
    { rule: 'risk.floorLevel <= risk.buildingFloors', when: 'isSet(risk.buildingFloors)', field: 'floorLevel', message: 'Floor level cannot be higher than the building' },
    { rule: '!(risk.floorLevel > 3 && risk.hasElevator != true)', when: 'isSet(risk.floorLevel) && isSet(risk.buildingFloors)', message: 'A unit above the third floor needs an elevator' },
  ],
}

/** Holds the quote the way the wizard does, so rules re-run as the user types. */
function Harness({ initial, layout = 'tabs', showAllErrors = false, onQuote }: { initial: any; layout?: 'tabs' | 'sections'; showAllErrors?: boolean; onQuote?: (quote: any) => void }) {
  const [quote, setQuote] = useState(initial)
  return (
    <ConfiguredRiskForm
      screen={{ ...packScreen, layout }}
      value={quote}
      showAllErrors={showAllErrors}
      onChange={(path, value) => {
        const next = { ...quote, risks: quote.risks.map((risk: any) => ({ ...risk })) }
        setByPath(next, path, value)
        setQuote(next)
        onQuote?.(next)
      }}
    />
  )
}

const baseQuote = { state: 'TX', risks: [{ address: '1 Main St #4', floorLevel: 4, occupancy: 'OwnerOccupied' }], coverages: [] }

describe('ConfiguredRiskForm', () => {
  it('renders tabs for the sections the rules show, with labelled, required-marked fields', () => {
    render(<Harness initial={baseQuote} />)

    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Unit', 'Building'])
    expect(view.getByRole('tab', { name: 'Unit' })).toHaveAttribute('aria-selected', 'true')
    expect(view.getByLabelText(/Unit Address/)).toHaveValue('1 Main St #4')
    expect(view.getByLabelText(/Unit Address/)).toHaveAttribute('aria-required', 'true')
    expect(view.getByLabelText(/Unit Address/)).toHaveAttribute('placeholder', 'Street and unit')
    expect(view.getByLabelText(/Floor Level/)).toHaveValue(4)
    expect(view.getByText('Enter the floor the unit is on')).toBeInTheDocument()
    expect(view.getByRole('radio', { name: 'OwnerOccupied' })).toBeChecked()
    // Hidden by its rule until the unit is tenant occupied.
    expect(view.queryByLabelText(/Monthly Rent/)).toBeNull()
  })

  it('shows and requires a field as soon as its condition holds, and hides it again', () => {
    render(<Harness initial={baseQuote} />)

    fireEvent.click(view.getByRole('radio', { name: 'TenantOccupied' }))
    const rent = view.getByLabelText(/Monthly Rent/)
    expect(rent).toHaveAttribute('aria-required', 'true')

    fireEvent.click(view.getByRole('radio', { name: 'OwnerOccupied' }))
    expect(view.queryByLabelText(/Monthly Rent/)).toBeNull()
  })

  it('switches tabs and reveals a dependent field when a checkbox is ticked', () => {
    const onQuote = vi.fn()
    render(<Harness initial={baseQuote} onQuote={onQuote} />)

    fireEvent.click(view.getByRole('tab', { name: 'Building' }))
    expect(view.getByText('Details of the building the unit is in.')).toBeInTheDocument()
    expect(view.queryByLabelText(/Number of Elevators/)).toBeNull()

    fireEvent.click(view.getByLabelText('Building Has an Elevator'))
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({ risks: [expect.objectContaining({ hasElevator: true })] }))
    expect(view.getByLabelText(/Number of Elevators/)).toHaveAttribute('aria-required', 'true')

    fireEvent.change(view.getByLabelText(/Number of Elevators/), { target: { value: '2' } })
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({ risks: [expect.objectContaining({ elevatorCount: 2 })] }))
    fireEvent.change(view.getByLabelText('Building Construction'), { target: { value: 'masonry' } })
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({ risks: [expect.objectContaining({ construction: 'masonry' })] }))
  })

  it('adds a tab when a coverage rule shows a whole section', () => {
    render(<Harness initial={{ ...baseQuote, coverages: [{ code: 'LOSS_ASSESS', selected: true, limit: 10000 }] }} />)
    expect(view.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Unit', 'Building', 'Loss assessment'])
    fireEvent.click(view.getByRole('tab', { name: 'Loss assessment' }))
    expect(view.getByLabelText('Known Special Assessments').tagName).toBe('TEXTAREA')
  })

  it('keeps quiet about problems until a field is left or the step is checked', () => {
    render(<Harness initial={{ ...baseQuote, risks: [{ occupancy: 'OwnerOccupied' }] }} />)
    expect(view.queryByRole('alert')).toBeNull()

    fireEvent.blur(view.getByLabelText(/Unit Address/))
    expect(view.getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Required'])
    expect(view.getByLabelText(/Unit Address/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows every problem, per tab, once the step has been checked', () => {
    render(<Harness initial={{ ...baseQuote, risks: [{ floorLevel: 12, buildingFloors: 10, occupancy: 'OwnerOccupied' }] }} showAllErrors />)

    // Whole-step rule first, then the problems on the open tab.
    expect(view.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'A unit above the third floor needs an elevator',
      'Required',
      'Floor level cannot be higher than the building',
    ])
    expect(within(view.getByRole('tab', { name: /Unit/ })).getByLabelText('2 to fix')).toBeInTheDocument()
    expect(view.getByRole('tab', { name: 'Building' }).textContent).toBe('Building')
  })

  it('stacks titled sections when the screen is not tabbed', () => {
    render(<Harness initial={baseQuote} layout="sections" />)
    expect(view.queryByRole('tablist')).toBeNull()
    expect(view.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['Unit', 'Building'])
    expect(view.getByLabelText('Building Construction')).toBeInTheDocument()
  })

  it('gives the wizard the same problems to block the step on', () => {
    expect(screenErrors(packScreen, baseQuote)).toEqual({})
    expect(screenErrors(packScreen, { ...baseQuote, risks: [{ floorLevel: 12, buildingFloors: 10, occupancy: 'TenantOccupied' }] })).toEqual({
      address: 'Required',
      monthlyRent: 'Required',
      floorLevel: 'Floor level cannot be higher than the building',
      [SCREEN_FORM_ERROR_KEY]: 'A unit above the third floor needs an elevator',
    })
  })
})

describe('ConfiguredRiskSummary', () => {
  it('lists the visible fields with readable values', () => {
    render(
      <ConfiguredRiskSummary
        screen={packScreen}
        value={{ risks: [{ address: '1 Main St #4', floorLevel: 4, occupancy: 'TenantOccupied', monthlyRent: 1850, hasElevator: true, elevatorCount: 2 }], coverages: [] }}
      />
    )
    const rows = Array.from(document.querySelectorAll('.kvline')).map((row) => row.textContent)
    expect(rows).toEqual([
      'Unit Address1 Main St #4',
      'Floor Level4',
      'OccupancyTenantOccupied',
      'Monthly Rent$1,850.00',
      'Building Construction-',
      'Floors in Building-',
      'Building Has an ElevatorYes',
      'Number of Elevators2',
    ])
  })
})
