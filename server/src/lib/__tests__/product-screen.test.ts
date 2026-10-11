import fs from 'fs'
import os from 'os'
import path from 'path'
import YAML from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildProductScreen, checkQuoteAgainstScreen, loadProductScreen } from '../product-screen.js'
import { buildRiskFields, loadProductConfig, loadRiskScreen } from '../products.js'
import { validateCarrierPack } from '../carrier-pack-validator.js'

const EXAMPLE_PACK = path.resolve(__dirname, '../../../../examples/carrier-pack')
const meta = JSON.parse(fs.readFileSync(path.join(EXAMPLE_PACK, 'fields/condo-unit-owners.json'), 'utf8'))
const screenFile = YAML.parse(fs.readFileSync(path.join(EXAMPLE_PACK, 'screens/condo-unit-owners.yaml'), 'utf8'))

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
      const { screen, issues } = buildProductScreen('condo-unit-owners', meta, screenFile)
      expect(issues).toEqual([])
      expect(screen?.layout).toBe('tabs')
      expect(screen?.sections.map((section) => [section.title, section.columns, section.fields.length])).toEqual([
        ['Unit', 3, 5], ['Building', 4, 7], ['Association', 2, 2], ['Loss assessment', undefined, 1],
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
      expect(screen!.validations).toHaveLength(4)
    })

    it('derives a screen from the fields file alone: a section per group, in order', () => {
      const { screen, issues } = buildProductScreen('condo-unit-owners', meta, undefined)
      expect(issues).toEqual([])
      expect(screen?.layout).toBe('sections')
      expect(screen?.sections.map((section) => section.title)).toEqual(['Unit', 'Building', 'Occupancy', 'Association'])
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

      expect(errors(buildProductScreen('condo-unit-owners', meta, bad))).toEqual(expect.arrayContaining([
        'must declare product: condo-unit-owners',
        "risk.layout: must be 'sections' or 'tabs'",
        'risk.sections[1] (Unit): columns must be a whole number from 1 to 4',
        "risk.sections[1] (Unit).fields[6] (floorLevel): 'floorLevel' is placed more than once",
        "risk.sections[1] (Unit).fields[7] (penthouseLevel): 'penthouseLevel' is not defined in fields/condo-unit-owners.json",
        "risk.sections[1] (Unit).fields[8] (squareFeet): 'squareFeet' is placed more than once",
        'risk.sections[1] (Unit).fields[9] (yearBuilt): span must be a whole number from 1 to 4',
        "risk.sections[2] (Building).fields[7] (construction): 'construction' is placed more than once",
        "risk.sections[2] (Building).fields[4] (buildingFloors): widget 'textarea' does not fit a int field; use number or currency",
        'risk.sections[2] (Building).fields[8]: name the field to show, as a name or as field: <name>',
        'risk.sections[5] (Empty): fields must be a non-empty list',
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

      const result = buildProductScreen('condo-unit-owners', meta, bad)
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
      const warnings = buildProductScreen('condo-unit-owners', meta, partial).issues.map((issue) => issue.message)
      expect(warnings).toContain("field 'floorLevel' is defined but not placed on the screen, so it cannot be entered")

      const overCore = buildProductScreen('condo-unit-owners', meta, screenFile, ['construction', 'yearBuilt'])
      expect(errors(overCore)).toEqual(expect.arrayContaining([
        "risk.sections[2] (Building).fields[1] (yearBuilt): 'yearBuilt' is already on this product's built-in screen",
        "risk.sections[2] (Building).fields[2] (construction): 'construction' is already on this product's built-in screen",
      ]))
    })
  })

  describe('checking a quote', () => {
    const { screen } = buildProductScreen('condo-unit-owners', meta, screenFile)
    const check = (risk: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      checkQuoteAgainstScreen(screen!, { productCode: 'condo-unit-owners', state: 'TX', risks: [risk], coverages: [], ...extra })

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
      expect(loadProductScreen('condo-unit-owners', 'acme-mutual')?.sections).toHaveLength(4)
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
        'screens/condo-unit-owners.yaml: risk.sections[2] (Building).fields[7] (elevatorCount).visibleWhen: expression ends unexpectedly (at character 20)',
      ])
      expect(validation.warnings.map((issue) => `${issue.file}: ${issue.message}`)).toContain('screens/notes.txt: only <product-code>.yaml files are read from screens/')
    })
  })
})
