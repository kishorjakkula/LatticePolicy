import fs from 'fs'
import os from 'os'
import path from 'path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildProductScreen, checkQuoteAgainstScreen, loadProductScreen, tablesUsedByScreen } from '../product-screen.js'
import { buildRiskFields, loadProductConfig, loadRiskScreen } from '../products.js'
import { validateCarrierPack } from '../carrier-pack-validator.js'
import { readPackTables } from '../carrier-tables.js'

const EXAMPLE_PACK = path.resolve(__dirname, '../../../../examples/carrier-pack')
const meta = JSON.parse(fs.readFileSync(path.join(EXAMPLE_PACK, 'fields/condo-unit-owners.json'), 'utf8'))
const screenFile = YAML.parse(fs.readFileSync(path.join(EXAMPLE_PACK, 'screens/condo-unit-owners.yaml'), 'utf8'))
const tables = Object.fromEntries(
  readPackTables({ dir: EXAMPLE_PACK, manifest: { packFormat: 1, carrier: 'acme-mutual', version: '1.0.0' } }).map((entry) => [entry.name, entry.table!])
)
/** The example product's screen, built the way the pack loader does. */
const build = (file: unknown, reserved: string[] = []) => buildProductScreen('condo-unit-owners', meta, file, reserved, tables)

const tempDirs: string[] = []
function copyOfExamplePack(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrier-pack-screen-'))
  tempDirs.push(dir)
  fs.cpSync(EXAMPLE_PACK, dir, { recursive: true })
  return dir
}

function errors(result: { issues: Array<{ level: string; message: string }> }) {
  return result.issues.filter((issue) => issue.level === 'error').map((issue) => issue.message)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

const completeRisk = {
  type: 'dwelling', address: '1 Main St #4', floorLevel: 4, occupancy: 'OwnerOccupied', yearBuilt: 2005,
  construction: 'masonry', roofAgeYears: 5, buildingFloors: 10, hasElevator: true, elevatorCount: 2,
}

describe('product screen', () => {
  const originalPackDir = process.env.CARRIER_PACK_DIR
  beforeEach(() => { delete process.env.CARRIER_PACK_DIR })
  afterEach(() => {
    if (originalPackDir === undefined) delete process.env.CARRIER_PACK_DIR
    else process.env.CARRIER_PACK_DIR = originalPackDir
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  describe('building a screen from pack files', () => {
    it('resolves the example screen: tabs, columns, widgets, and conditions', () => {
      const { screen, issues } = build(screenFile)
      expect(issues).toEqual([])
      expect(screen?.layout).toBe('tabs')
      expect(screen?.sections.map((section) => [section.title, section.columns, section.fields.length])).toEqual([
        ['Unit', 3, 5], ['Building', 4, 8], ['Association', 2, 2], ['Loss assessment', undefined, 1], ['Scheduled items', 1, 1],
      ])
      const unit = screen!.sections[0].fields
      expect(unit[0]).toEqual({
        key: 'address', label: 'Unit Address', path: 'risks.0.address', dataType: 'string', widget: 'text', required: true,
        span: 2, placeholder: 'Street, unit number, city, state, ZIP',
      })
      expect(unit.find((field) => field.key === 'occupancy')).toMatchObject({ widget: 'radio', dataType: 'enum', options: ['OwnerOccupied', 'TenantOccupied', 'Seasonal'] })
      expect(unit.find((field) => field.key === 'monthlyRent')).toMatchObject({
        widget: 'currency', visibleWhen: "risk.occupancy == 'TenantOccupied'", requiredWhen: "risk.occupancy == 'TenantOccupied'",
      })
      expect(screen!.sections[1].fields.find((field) => field.key === 'hasElevator')).toMatchObject({ dataType: 'bool', widget: 'checkbox' })
      expect(screen!.sections[3].visibleWhen).toBe('coverages.LOSS_ASSESS.selected')
      expect(screen!.validations).toHaveLength(6)
    })

    it('derives a screen from the fields file alone: a section per group, in order', () => {
      const { screen, issues } = build(undefined)
      expect(issues).toEqual([])
      expect(screen?.layout).toBe('sections')
      expect(screen?.sections.map((section) => section.title)).toEqual(['Unit', 'Building', 'Occupancy', 'Association', 'Schedule'])
      expect(screen?.sections[0].fields.map((field) => field.key)).toEqual(['address', 'floorLevel', 'squareFeet', 'monthlyRent'])
      expect(screen?.validations).toEqual([])
    })

    it('gives a core product no pack screen unless the pack lays out extra fields', () => {
      expect(buildProductScreen('homeowners', meta, undefined, ['construction'])).toEqual({ screen: null, issues: [] })
      expect(buildProductScreen('condo-unit-owners', [], undefined)).toEqual({ screen: null, issues: [] })
    })

    it('reports layout mistakes', () => {
      const bad = clone(screenFile)
      bad.product = 'homeowners'
      bad.risk.layout = 'accordion'
      bad.risk.sections[0].columns = 7
      bad.risk.sections[0].fields.push('floorLevel', 'penthouseLevel', { field: 'squareFeet' }, { field: 'yearBuilt', span: 9 })
      bad.risk.sections[1].fields = bad.risk.sections[1].fields.filter((field: any) => field !== 'yearBuilt')
      bad.risk.sections[1].fields = bad.risk.sections[1].fields.map((field: any) => (field === 'buildingFloors' ? { field: 'buildingFloors', widget: 'textarea' } : field))
      bad.risk.sections[1].fields.push({ field: 'construction' }, {})
      delete bad.risk.sections[2].title
      bad.risk.sections.push({ title: 'Empty', fields: [] })

      expect(errors(build(bad))).toEqual(expect.arrayContaining([
        'must declare product: condo-unit-owners',
        "risk.layout: must be 'sections' or 'tabs'",
        'risk.sections[1] (Unit): columns must be a whole number from 1 to 4',
        "risk.sections[1] (Unit).fields[6] (floorLevel): 'floorLevel' is placed more than once",
        "risk.sections[1] (Unit).fields[7] (penthouseLevel): 'penthouseLevel' is not defined in fields/condo-unit-owners.json",
        "risk.sections[1] (Unit).fields[8] (squareFeet): 'squareFeet' is placed more than once",
        'risk.sections[1] (Unit).fields[9] (yearBuilt): span must be a whole number from 1 to 4',
        "risk.sections[2] (Building).fields[8] (construction): 'construction' is placed more than once",
        "risk.sections[2] (Building).fields[5] (buildingFloors): widget 'textarea' does not fit a int field; use number or currency",
        'risk.sections[2] (Building).fields[9]: name the field to show, as a name or as field: <name>',
        'risk.sections[6] (Empty): fields must be a non-empty list',
      ]))
    })

    it('reports broken or out-of-reach expressions with where they are', () => {
      const bad = clone(screenFile)
      bad.risk.sections[0].visibleWhen = 'risk.floorLevel >'
      bad.risk.sections[0].fields[4].visibleWhen = 'policy.premium > 100'
      bad.risk.sections[0].fields[4].requiredWhen = 'quote.agentName == 1'
      bad.risk.validations[0].rule = 'explode(risk.floorLevel)'
      bad.risk.validations[1].field = 'penthouseLevel'
      delete bad.risk.validations[2].message
      bad.risk.validations[3].when = 'risk.rentControl == true'

      const result = build(bad)
      expect(errors(result)).toEqual(expect.arrayContaining([
        'risk.sections[1] (Unit).visibleWhen: expression ends unexpectedly (at character 18)',
        "risk.sections[1] (Unit).fields[5] (monthlyRent).visibleWhen: 'policy.premium' is not available; start names with risk, quote, applicant, coverages",
        'risk.sections[1] (Unit).fields[5] (monthlyRent).requiredWhen: quote.agentName is not available; use quote.state, quote.termMonths, quote.effectiveDate, quote.productCode',
        "risk.validations[1].rule: unknown function 'explode' (at character 1)",
        "risk.validations[2]: field 'penthouseLevel' is not placed on the screen",
        'risk.validations[3]: message is required',
      ]))
      expect(result.issues.filter((issue) => issue.level === 'warning').map((issue) => issue.message)).toContain(
        'risk.validations[4].when: reads risk.rentControl, which the product does not define'
      )
      expect(result.screen).toBeNull()
    })

    it('warns about a defined field the screen leaves out, and keeps core fields reserved', () => {
      const partial = clone(screenFile)
      partial.risk.sections = [partial.risk.sections[2]]
      partial.risk.validations = []
      const warnings = build(partial).issues.map((issue) => issue.message)
      expect(warnings).toContain("field 'floorLevel' is defined but not placed on the screen, so it cannot be entered")

      const overCore = build(screenFile, ['construction', 'yearBuilt'])
      expect(errors(overCore)).toEqual(expect.arrayContaining([
        "risk.sections[2] (Building).fields[1] (yearBuilt): 'yearBuilt' is already on this product's built-in screen",
        "risk.sections[2] (Building).fields[2] (construction): 'construction' is already on this product's built-in screen",
      ]))
    })
  })

  describe('checking a quote', () => {
    const { screen } = build(screenFile)
    const check = (risk: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      checkQuoteAgainstScreen(screen!, { productCode: 'condo-unit-owners', state: 'TX', risks: [risk], coverages: [], ...extra }, tables)

    it('accepts a complete quote', () => {
      expect(check(completeRisk)).toEqual([])
    })

    it('reports each problem against the field path, with the field label', () => {
      const problems = check({ ...completeRisk, address: '', floorLevel: 12, yearBuilt: 1850, occupancy: 'Squatting', elevatorCount: undefined })
      expect(problems).toHaveLength(5)
      expect(problems).toEqual(expect.arrayContaining([
        { path: '/risks/0/address', keyword: 'screen', message: 'Unit Address: Required' },
        { path: '/risks/0/floorLevel', keyword: 'screen', message: 'Floor Level: Floor level cannot be higher than the number of floors in the building' },
        { path: '/risks/0/occupancy', keyword: 'screen', message: 'Occupancy: Choose one of the listed options' },
        { path: '/risks/0/yearBuilt', keyword: 'screen', message: 'Year Built: Enter a year between 1900 and 2030' },
        { path: '/risks/0/elevatorCount', keyword: 'screen', message: 'Number of Elevators: Required' },
      ]))
    })

    it('applies conditional and whole-step rules', () => {
      expect(check({ ...completeRisk, occupancy: 'TenantOccupied' })).toEqual([
        { path: '/risks/0/monthlyRent', keyword: 'screen', message: 'Monthly Rent: Required' },
      ])
      expect(check({ ...completeRisk, occupancy: 'TenantOccupied', monthlyRent: 250 })).toEqual([
        { path: '/risks/0/monthlyRent', keyword: 'screen', message: 'Monthly Rent: Monthly rent must be at least 300' },
      ])
      expect(check({ ...completeRisk, hasElevator: false, elevatorCount: undefined })).toEqual([
        { path: '/risks/0', keyword: 'screen', message: 'A unit above the third floor needs a building with an elevator' },
      ])
      // The rent rule belongs to a hidden field, so it does not apply to an owner-occupied unit.
      expect(check({ ...completeRisk, monthlyRent: 10 })).toEqual([])
    })
  })

  describe('through the carrier pack', () => {
    it('serves the pack screen for its own carrier only', () => {
      process.env.CARRIER_PACK_DIR = EXAMPLE_PACK
      const cfg = loadProductConfig('condo-unit-owners')
      expect(loadRiskScreen('condo-unit-owners', cfg, 'acme-mutual')?.layout).toBe('tabs')
      expect(loadRiskScreen('condo-unit-owners', cfg, 'sample-carrier')).toBeNull()
      expect(loadRiskScreen('condo-unit-owners', cfg, undefined)).toBeNull()
      // Core products keep their built-in screen: no pack screen is returned.
      expect(loadRiskScreen('homeowners', loadProductConfig('homeowners'), 'acme-mutual')).toBeNull()
      expect(loadProductScreen('condo-unit-owners', 'acme-mutual')?.sections).toHaveLength(5)
    })

    it('lets a pack add a section of its own fields to a core product screen', () => {
      const dir = copyOfExamplePack()
      fs.writeFileSync(path.join(dir, 'fields/homeowners.json'), JSON.stringify([
        { path: 'risks.0.construction', type: 'enum', enum: ['frame', 'masonry', 'other'] },
        { path: 'risks.0.solarPanels', label: 'Solar Panels Installed', type: 'bool' },
        { path: 'risks.0.solarPanelValue', label: 'Solar Panel Replacement Value', type: 'number' },
      ]))
      fs.mkdirSync(path.join(dir, 'screens'), { recursive: true })
      fs.writeFileSync(path.join(dir, 'screens/homeowners.yaml'), [
        'product: homeowners',
        'risk:',
        '  sections:',
        '    - title: Solar',
        '      fields:',
        '        - solarPanels',
        '        - field: solarPanelValue',
        '          widget: currency',
        '          visibleWhen: risk.solarPanels',
        '          requiredWhen: risk.solarPanels',
        '',
      ].join('\n'))
      expect(validateCarrierPack(dir).errors).toEqual([])

      process.env.CARRIER_PACK_DIR = dir
      const cfg = loadProductConfig('homeowners')
      const screen = loadRiskScreen('homeowners', cfg, 'acme-mutual')
      expect(screen?.sections.map((section) => [section.title, section.fields.map((field) => field.key)])).toEqual([['Solar', ['solarPanels', 'solarPanelValue']]])
      // The built-in homeowners form itself is untouched.
      expect(buildRiskFields('homeowners', cfg, 'acme-mutual')).toEqual(buildRiskFields('homeowners', cfg))
      expect(checkQuoteAgainstScreen(screen!, { risks: [{ solarPanels: true }] })).toEqual([
        { path: '/risks/0/solarPanelValue', keyword: 'screen', message: 'Solar Panel Replacement Value: Required' },
      ])

      // Placing a built-in field again is refused by the pack check.
      fs.appendFileSync(path.join(dir, 'screens/homeowners.yaml'), '        - construction\n')
      expect(validateCarrierPack(dir).errors.map((issue) => `${issue.file}: ${issue.message}`)).toEqual([
        "screens/homeowners.yaml: risk.sections[1] (Solar).fields[3] (construction): 'construction' is already on this product's built-in screen",
      ])
    })

    it('reports screen problems from the pack check with the file they are in', () => {
      const dir = copyOfExamplePack()
      const screenPath = path.join(dir, 'screens/condo-unit-owners.yaml')
      fs.writeFileSync(screenPath, fs.readFileSync(screenPath, 'utf8').replace('visibleWhen: risk.hasElevator', 'visibleWhen: risk.hasElevator &&'))
      fs.writeFileSync(path.join(dir, 'screens/boat.yaml'), 'product: boat\n')
      fs.writeFileSync(path.join(dir, 'screens/notes.txt'), 'x')
      const validation = validateCarrierPack(dir)
      expect(validation.errors.map((issue) => `${issue.file}: ${issue.message}`)).toEqual([
        "screens/boat.yaml: 'boat' is neither a core product nor in this pack",
        'screens/condo-unit-owners.yaml: risk.sections[2] (Building).fields[8] (elevatorCount).visibleWhen: expression ends unexpectedly (at character 20)',
      ])
      expect(validation.warnings.map((issue) => `${issue.file}: ${issue.message}`)).toContain('screens/notes.txt: only <product-code>.yaml files are read from screens/')
    })
  })
})

describe('product screen: lookup tables and list fields', () => {
  const { screen } = build(screenFile)

  it('takes option lists and their labels from a carrier table', () => {
    const roofType = screen!.sections[1].fields.find((field) => field.key === 'roofType')
    expect(roofType).toMatchObject({
      dataType: 'enum',
      widget: 'select',
      options: ['asphalt', 'metal', 'tile', 'flat'],
      optionLabels: { asphalt: 'Asphalt shingle', metal: 'Standing-seam metal', tile: 'Clay or concrete tile', flat: 'Flat membrane' },
    })
  })

  it('defines a list field as a table of typed columns', () => {
    const schedule = screen!.sections[4].fields[0]
    expect(schedule).toMatchObject({ key: 'scheduledItems', dataType: 'list', widget: 'table', maxItems: 20, requiredWhen: 'coverages.SCHEDULED.selected' })
    expect(schedule.item).toEqual([
      { key: 'description', label: 'Description', dataType: 'string', required: true },
      { key: 'category', label: 'Category', dataType: 'enum', required: true, options: ['jewelry', 'art', 'electronics', 'other'] },
      { key: 'value', label: 'Insured Value', dataType: 'number', required: true },
    ])
    expect(screen!.validations).toContainEqual({ each: 'scheduledItems', rule: 'item.value >= 500', field: 'value', message: 'Schedule only items worth 500 or more' })
    expect(Object.keys(tablesUsedByScreen(screen!, tables))).toEqual(['schedule-limits'])
  })

  it('reports mistakes in tables, options, lists, and per-item rules', () => {
    const badMeta = JSON.parse(JSON.stringify(meta))
    badMeta.find((field: any) => field.path === 'risks.0.roofType').optionsFrom = { table: 'roof-kinds', value: 'code' }
    const list = badMeta.find((field: any) => field.path === 'risks.0.scheduledItems')
    list.item.push({ key: 'value', type: 'number' }, { key: 'weight', type: 'heavy' }, { key: 'condition', type: 'enum' })
    list.maxItems = -1
    const badScreen = JSON.parse(JSON.stringify(screenFile))
    badScreen.risk.validations[0].rule = 'item.weight > 0'
    badScreen.risk.validations[0].field = 'weight'
    badScreen.risk.validations[1].rule = "sum(risk.scheduledItems, 'value') <= lookup('schedule-caps', quote.state, 'scheduleMax')"
    badScreen.risk.validations.push({ each: 'floorLevel', rule: 'item.value > 0', message: 'x' })

    const messages = buildProductScreen('condo-unit-owners', badMeta, badScreen, [], tables).issues.filter((issue) => issue.level === 'error').map((issue) => issue.message)
    expect(messages).toEqual(expect.arrayContaining([
      "risk.sections[2] (Building).fields[4] (roofType): optionsFrom: table 'roof-kinds' is not in the pack",
      'risk.sections[5] (Scheduled items).fields[1] (scheduledItems): item[4] (value): key is defined more than once',
      'risk.sections[5] (Scheduled items).fields[1] (scheduledItems): item[5] (weight): type must be one of string, int, number, bool, enum, date',
      'risk.sections[5] (Scheduled items).fields[1] (scheduledItems): item[6] (condition): an enum column needs enum or optionsFrom',
      'risk.sections[5] (Scheduled items).fields[1] (scheduledItems): maxItems must be a whole number of 0 or more',
      'risk.validations[1].rule: item.weight is not a column of the list',
      "risk.validations[1]: field 'weight' is not a column of list 'scheduledItems'",
      "risk.validations[2].rule: lookup table 'schedule-caps' is not in the pack",
      "risk.validations[7]: each 'floorLevel' is not a list field placed on the screen",
    ]))
  })

  it('checks a quote\'s list against the item rules and the state limit from a table', () => {
    const check = (items: unknown, state = 'TX') => checkQuoteAgainstScreen(
      screen!,
      { productCode: 'condo-unit-owners', state, risks: [{ ...completeRisk, scheduledItems: items }], coverages: [{ code: 'SCHEDULED', selected: true }] },
      tables
    )
    expect(check([{ description: 'Ring', category: 'jewelry', value: 5000 }])).toEqual([])
    expect(check(undefined)).toEqual([{ path: '/risks/0/scheduledItems', keyword: 'screen', message: 'Scheduled Items: Add at least one' }])
    expect(check([{ description: '', category: 'boat', value: 100 }])).toEqual([
      { path: '/risks/0/scheduledItems/0/description', keyword: 'screen', message: 'Scheduled Items item 1, Description: Required' },
      { path: '/risks/0/scheduledItems/0/category', keyword: 'screen', message: 'Scheduled Items item 1, Category: Choose one of the listed options' },
      { path: '/risks/0/scheduledItems/0/value', keyword: 'screen', message: 'Scheduled Items item 1, Insured Value: Schedule only items worth 500 or more' },
    ])
    // 30,000 is within the Texas limit of 50,000 and over the Florida limit of 25,000.
    const large = [{ description: 'Painting', category: 'art', value: 30000 }]
    expect(check(large, 'TX')).toEqual([])
    expect(check(large, 'FL')).toEqual([{ path: '/risks/0/scheduledItems', keyword: 'screen', message: 'Scheduled Items: Scheduled items exceed the maximum for this state' }])
    // No limit is on file for Nevada, so the rule's guard keeps it out of the way.
    expect(check(large, 'NV')).toEqual([])
  })
})
