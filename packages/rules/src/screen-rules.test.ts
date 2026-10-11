import { describe, expect, it } from 'vitest'
import { buildScreenContext, evaluateScreen, type ProductScreen, type ScreenField } from './screen-rules.js'

function field(key: string, overrides: Partial<ScreenField> = {}): ScreenField {
  return { key, label: key, path: `risks.0.${key}`, dataType: 'string', widget: 'text', ...overrides }
}

const screen: ProductScreen = {
  layout: 'sections',
  sections: [
    {
      title: 'Unit',
      fields: [
        field('address', { required: true }),
        field('floorLevel', { dataType: 'int', widget: 'number', required: true }),
        field('hasElevator', { dataType: 'bool', widget: 'checkbox' }),
        field('elevatorCount', { dataType: 'int', widget: 'number', visibleWhen: 'risk.hasElevator', requiredWhen: 'risk.hasElevator' }),
        field('construction', { dataType: 'enum', widget: 'select', options: ['frame', 'masonry'] }),
      ],
    },
    {
      title: 'Rental',
      visibleWhen: "risk.occupancy == 'TenantOccupied'",
      fields: [field('monthlyRent', { dataType: 'number', widget: 'currency', required: true }), field('leaseStart', { dataType: 'date', widget: 'date' })],
    },
  ],
  validations: [
    { rule: 'risk.floorLevel <= risk.buildingFloors', when: 'isSet(risk.buildingFloors)', field: 'floorLevel', message: 'Floor level cannot exceed the floors in the building' },
    { rule: "!(quote.state == 'FL' && risk.floorLevel == 1)", message: 'Ground-floor units are not written in Florida' },
    { rule: 'risk.monthlyRent >= 500', field: 'monthlyRent', message: 'Rent must be at least 500' },
  ],
}

function quote(risk: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { state: 'TX', risks: [risk], ...extra }
}

describe('screen rules', () => {
  it('builds the names rules can read from a quote', () => {
    const context = buildScreenContext({
      state: 'TX',
      termMonths: 12,
      productCode: 'condo-unit-owners',
      applicant: { firstName: 'Pat' },
      risks: [{ floorLevel: 4 }, { floorLevel: 9 }],
      coverages: [{ code: 'A', limit: 150000, deductible: '2500' }, { code: 'E', selected: false }],
    })
    expect(context).toEqual({
      risk: { floorLevel: 4 },
      quote: { state: 'TX', termMonths: 12, effectiveDate: null, productCode: 'condo-unit-owners' },
      applicant: { firstName: 'Pat' },
      coverages: {
        A: { selected: true, limit: 150000, deductible: '2500', percent: null },
        E: { selected: false, limit: null, deductible: null, percent: null },
      },
      $tables: {},
    })
    expect(buildScreenContext(undefined)).toEqual({ risk: {}, quote: { state: null, termMonths: null, effectiveDate: null, productCode: null }, applicant: {}, coverages: {}, $tables: {} })
  })

  it('passes a complete, consistent quote', () => {
    const state = evaluateScreen(screen, quote({ address: '1 Main St', floorLevel: 4, construction: 'masonry' }))
    expect(state.errors).toEqual({})
    expect(state.formErrors).toEqual([])
    expect(state.sections).toEqual([true, false])
    expect(state.fields.elevatorCount).toEqual({ visible: false, required: false })
    expect(state.fields.monthlyRent).toEqual({ visible: false, required: false })
  })

  it('reports required fields, wrong types, and values outside the option list', () => {
    const state = evaluateScreen(screen, quote({ address: '  ', floorLevel: 2.5, construction: 'straw' }))
    expect(state.errors).toEqual({
      address: 'Required',
      floorLevel: 'Enter a whole number',
      construction: 'Choose one of the listed options',
    })
    expect(evaluateScreen(screen, quote({ address: 'x', floorLevel: 'four' })).errors).toEqual({ floorLevel: 'Enter a number' })
  })

  it('shows and requires a field only while its condition holds', () => {
    const without = evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, hasElevator: false }))
    expect(without.fields.elevatorCount).toEqual({ visible: false, required: false })
    expect(without.errors).toEqual({})

    const withElevator = evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, hasElevator: true }))
    expect(withElevator.fields.elevatorCount).toEqual({ visible: true, required: true })
    expect(withElevator.errors).toEqual({ elevatorCount: 'Required' })

    // A value left behind in a hidden field is ignored, not reported.
    expect(evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, hasElevator: false, elevatorCount: 'lots' })).errors).toEqual({})
  })

  it('never treats an unticked checkbox as a missing answer', () => {
    const required: ProductScreen = { layout: 'sections', sections: [{ fields: [field('agreed', { dataType: 'bool', widget: 'checkbox', required: true })] }], validations: [] }
    expect(evaluateScreen(required, quote({})).errors).toEqual({})
    expect(evaluateScreen(required, quote({ agreed: 'maybe' })).errors).toEqual({ agreed: 'Choose yes or no' })
  })

  it('shows a whole section, and applies its rules, only while its condition holds', () => {
    const hidden = evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, occupancy: 'OwnerOccupied' }))
    expect(hidden.sections).toEqual([true, false])
    expect(hidden.errors).toEqual({})

    const shown = evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, occupancy: 'TenantOccupied', leaseStart: 'next week' }))
    expect(shown.sections).toEqual([true, true])
    expect(shown.errors).toEqual({ monthlyRent: 'Required', leaseStart: 'Enter a date' })

    const lowRent = evaluateScreen(screen, quote({ address: 'x', floorLevel: 4, occupancy: 'TenantOccupied', monthlyRent: 300, leaseStart: '2026-11-01' }))
    expect(lowRent.errors).toEqual({ monthlyRent: 'Rent must be at least 500' })
  })

  it('applies validations against a field or the whole step', () => {
    const tooHigh = evaluateScreen(screen, quote({ address: 'x', floorLevel: 12, buildingFloors: 10 }))
    expect(tooHigh.errors).toEqual({ floorLevel: 'Floor level cannot exceed the floors in the building' })

    // The guard keeps the rule quiet until there is something to compare with.
    expect(evaluateScreen(screen, quote({ address: 'x', floorLevel: 12 })).errors).toEqual({})

    const florida = evaluateScreen(screen, quote({ address: 'x', floorLevel: 1 }, { state: 'FL' }))
    expect(florida.errors).toEqual({})
    expect(florida.formErrors).toEqual(['Ground-floor units are not written in Florida'])
  })

  it('keeps a more basic problem over a validation message on the same field', () => {
    const state = evaluateScreen(screen, quote({ address: 'x', floorLevel: 'twelve', buildingFloors: 10 }))
    expect(state.errors).toEqual({ floorLevel: 'Enter a number' })
  })
})

describe('list fields', () => {
  const listScreen: ProductScreen = {
    layout: 'sections',
    sections: [{
      title: 'Schedule',
      fields: [
        field('hasSchedule', { dataType: 'bool', widget: 'checkbox' }),
        field('scheduledItems', {
          dataType: 'list', widget: 'table', visibleWhen: 'risk.hasSchedule', requiredWhen: 'risk.hasSchedule', maxItems: 3,
          item: [
            { key: 'description', label: 'Description', dataType: 'string', required: true },
            { key: 'category', label: 'Category', dataType: 'enum', options: ['jewelry', 'art'] },
            { key: 'value', label: 'Value', dataType: 'number', required: true },
          ],
        }),
      ],
    }],
    validations: [
      { each: 'scheduledItems', rule: 'item.value >= 500', field: 'value', message: 'Schedule items worth 500 or more' },
      { each: 'scheduledItems', rule: "!(item.category == 'art' && item.value > 20000)", message: 'Art above 20,000 needs an appraisal' },
      { rule: "sum(risk.scheduledItems, 'value') <= lookup('limits', quote.state, 'scheduleMax')", when: 'risk.hasSchedule', field: 'scheduledItems', message: 'Schedule exceeds the state maximum' },
    ],
  }
  const tables = { limits: { key: 'state', rows: [{ state: 'TX', scheduleMax: 50000 }] } }
  const check = (risk: Record<string, unknown>) => evaluateScreen(listScreen, quote(risk), tables)

  it('accepts a valid schedule and ignores a hidden one', () => {
    expect(check({ hasSchedule: true, scheduledItems: [{ description: 'Ring', category: 'jewelry', value: 5000 }] }).errors).toEqual({})
    // Hidden: nothing about the list is reported, even with bad content.
    expect(check({ hasSchedule: false, scheduledItems: [{ value: 'x' }] }).errors).toEqual({})
  })

  it('requires items when the list is required and limits how many', () => {
    expect(check({ hasSchedule: true }).errors).toEqual({ scheduledItems: 'Add at least one' })
    expect(check({ hasSchedule: true, scheduledItems: [] }).errors).toEqual({ scheduledItems: 'Add at least one' })
    const four = Array.from({ length: 4 }, (_, index) => ({ description: `Item ${index}`, value: 1000 }))
    expect(check({ hasSchedule: true, scheduledItems: four }).errors).toEqual({ scheduledItems: 'No more than 3 allowed' })
    expect(check({ hasSchedule: true, scheduledItems: 'ring' }).errors).toEqual({ scheduledItems: 'Enter a list of items' })
  })

  it('reports each problem against the item and column it is in', () => {
    const state = check({
      hasSchedule: true,
      scheduledItems: [
        { description: '', category: 'boat', value: 'lots' },
        { description: 'Small', category: 'jewelry', value: 100 },
        { description: 'Big canvas', category: 'art', value: 25000 },
      ],
    })
    expect(state.errors).toEqual({
      'scheduledItems.0.description': 'Required',
      'scheduledItems.0.category': 'Choose one of the listed options',
      'scheduledItems.0.value': 'Enter a number',
      'scheduledItems.1.value': 'Schedule items worth 500 or more',
      'scheduledItems.2': 'Art above 20,000 needs an appraisal',
    })
  })

  it('applies a rule over the whole list using a lookup table', () => {
    const items = [{ description: 'A', value: 30000 }, { description: 'B', value: 25000 }]
    expect(check({ hasSchedule: true, scheduledItems: items }).errors).toEqual({ scheduledItems: 'Schedule exceeds the state maximum' })
    // Without the table the limit is unknown, so the comparison cannot pass.
    expect(evaluateScreen(listScreen, quote({ hasSchedule: true, scheduledItems: items })).errors).toEqual({ scheduledItems: 'Schedule exceeds the state maximum' })
  })
})
