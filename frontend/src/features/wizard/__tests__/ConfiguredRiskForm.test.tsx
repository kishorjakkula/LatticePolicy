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

describe('ConfiguredRiskForm: list fields and lookup tables', () => {
  const listScreen: ProductScreen = {
    layout: 'sections',
    sections: [{
      title: 'Schedule',
      columns: 2,
      fields: [
        field('roofType', 'Roof Type', { dataType: 'enum', widget: 'select', options: ['asphalt', 'metal'], optionLabels: { asphalt: 'Asphalt shingle', metal: 'Standing-seam metal' } }),
        field('scheduledItems', 'Scheduled Items', {
          dataType: 'list', widget: 'table', maxItems: 2,
          item: [
            { key: 'description', label: 'Description', dataType: 'string', required: true },
            { key: 'category', label: 'Category', dataType: 'enum', options: ['jewelry', 'art'] },
            { key: 'value', label: 'Insured Value', dataType: 'number', required: true },
          ],
        }),
      ],
    }],
    validations: [
      { each: 'scheduledItems', rule: 'item.value >= 500', field: 'value', message: 'Schedule only items worth 500 or more' },
      { rule: "sum(risk.scheduledItems, 'value') <= lookup('schedule-limits', quote.state, 'scheduleMax')", field: 'scheduledItems', message: 'Scheduled items exceed the maximum for this state' },
    ],
  }
  const tables = { 'schedule-limits': { key: 'state', rows: [{ state: 'TX', scheduleMax: 50000 }] } }

  function ListHarness({ initial, showAllErrors = false, onQuote }: { initial: any; showAllErrors?: boolean; onQuote?: (quote: any) => void }) {
    const [quote, setQuote] = useState(initial)
    return (
      <ConfiguredRiskForm
        screen={listScreen}
        value={quote}
        tables={tables}
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

  it('shows the carrier table\'s labels for options and stores the option value', () => {
    const onQuote = vi.fn()
    render(<ListHarness initial={{ state: 'TX', risks: [{}] }} onQuote={onQuote} />)
    const select = view.getByLabelText('Roof Type')
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Select…', 'Asphalt shingle', 'Standing-seam metal'])
    fireEvent.change(select, { target: { value: 'metal' } })
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({ risks: [expect.objectContaining({ roofType: 'metal' })] }))
  })

  it('adds, edits, and removes items in a list', () => {
    const onQuote = vi.fn()
    render(<ListHarness initial={{ state: 'TX', risks: [{}] }} onQuote={onQuote} />)
    expect(view.getByText('None added.')).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Add scheduled item' }))
    expect(view.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Description *', 'Category', 'Insured Value *', 'Remove'])
    fireEvent.change(view.getByLabelText('Description, item 1'), { target: { value: 'Ring' } })
    fireEvent.change(view.getByLabelText('Category, item 1'), { target: { value: 'jewelry' } })
    fireEvent.change(view.getByLabelText('Insured Value, item 1'), { target: { value: '5000' } })
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({
      risks: [expect.objectContaining({ scheduledItems: [{ description: 'Ring', category: 'jewelry', value: 5000 }] })],
    }))

    fireEvent.click(view.getByRole('button', { name: 'Add scheduled item' }))
    fireEvent.change(view.getByLabelText('Description, item 2'), { target: { value: 'Painting' } })
    // The list is full at its maximum of two.
    expect(view.getByRole('button', { name: 'Add scheduled item' })).toBeDisabled()
    expect(view.getByText('Maximum of 2 reached.')).toBeInTheDocument()

    fireEvent.click(view.getByRole('button', { name: 'Remove item 1' }))
    expect(onQuote).toHaveBeenLastCalledWith(expect.objectContaining({
      risks: [expect.objectContaining({ scheduledItems: [{ description: 'Painting' }] })],
    }))
    expect(view.getByLabelText('Description, item 1')).toHaveValue('Painting')
  })

  it('shows each item problem in its own cell, and the list problem under the list', () => {
    const items = [{ description: '', category: 'art', value: 100 }, { description: 'Canvas', category: 'art', value: 60000 }]
    render(<ListHarness initial={{ state: 'TX', risks: [{ scheduledItems: items }] }} showAllErrors />)

    const rows = view.getAllByRole('row').slice(1)
    expect(within(rows[0]).getAllByRole('alert').map((alert) => alert.textContent)).toEqual(['Required', 'Schedule only items worth 500 or more'])
    expect(within(rows[1]).queryByRole('alert')).toBeNull()
    expect(view.getByLabelText('Description, item 1')).toHaveAttribute('aria-invalid', 'true')
    // 60,100 is over the Texas limit of 50,000 from the lookup table.
    expect(view.getByText('Scheduled items exceed the maximum for this state')).toBeInTheDocument()
  })

  it('gives the wizard list problems keyed by item and column', () => {
    expect(screenErrors(listScreen, { state: 'TX', risks: [{ scheduledItems: [{ description: 'Ring', value: 100 }] }] }, tables)).toEqual({
      'scheduledItems.0.value': 'Schedule only items worth 500 or more',
    })
  })

  it('summarises a list by its size and an option by its label', () => {
    render(<ConfiguredRiskSummary screen={listScreen} tables={tables} value={{ risks: [{ roofType: 'metal', scheduledItems: [{}, {}] }] }} />)
    expect(Array.from(document.querySelectorAll('.kvline')).map((row) => row.textContent)).toEqual(['Roof TypeStanding-seam metal', 'Scheduled Items2 items'])
  })
})
