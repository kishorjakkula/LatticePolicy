import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { validateCarrierPack, assertCarrierPackValid } from '../carrier-pack-validator.js'
import { getActiveCarrierPack } from '../carrier-pack.js'
import { getProductCapabilities, listProductCapabilities, resolveProductPackDir } from '../product-registry.js'
import { buildRiskFields, loadFieldMeta, loadProductConfig, loadProductRates, loadTenantOverrides } from '../products.js'
import { rate } from '../../services/rating.service.js'

const EXAMPLE_PACK = path.resolve(__dirname, '../../../../examples/carrier-pack')
const CORE_CODES = ['commercial-auto', 'cyber', 'example-identity-protection', 'homeowners', 'personal-auto', 'professional-liability']

const tempDirs: string[] = []

/** Copies the example pack so a test can break one thing in it. */
function copyOfExamplePack(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrier-pack-'))
  tempDirs.push(dir)
  fs.cpSync(EXAMPLE_PACK, dir, { recursive: true })
  return dir
}

function write(dir: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), content)
}

function messages(dir: string, options = {}) {
  return validateCarrierPack(dir, options).errors.map((issue) => `${issue.file}: ${issue.message}`)
}

describe('carrier pack', () => {
  const originalPackDir = process.env.CARRIER_PACK_DIR

  beforeEach(() => {
    delete process.env.CARRIER_PACK_DIR
  })

  afterEach(() => {
    if (originalPackDir === undefined) delete process.env.CARRIER_PACK_DIR
    else process.env.CARRIER_PACK_DIR = originalPackDir
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })

  describe('with no pack configured', () => {
    it('keeps the core product list and repository overrides', () => {
      expect(getActiveCarrierPack()).toBeNull()
      expect(assertCarrierPackValid('acme-mutual')).toBeNull()
      expect(listProductCapabilities().map((product) => product.code).sort()).toEqual(CORE_CODES)
      expect(getProductCapabilities('condo-unit-owners')).toBeNull()
      expect(loadTenantOverrides('sample-carrier').overrides.rating.driverAgeFactors['<25']).toBe(1.25)
      expect(loadFieldMeta('homeowners', 'sample-carrier')[0]).toMatchObject({ path: 'risks.0.construction' })
    })
  })

  describe('validation', () => {
    it('accepts the example pack', () => {
      const validation = validateCarrierPack(EXAMPLE_PACK, { expectedCarrier: 'acme-mutual' })
      expect(validation.errors).toEqual([])
      expect(validation.ok).toBe(true)
      expect(validation.manifest).toMatchObject({ packFormat: 1, carrier: 'acme-mutual', version: '1.0.0' })
      expect(validation.products).toEqual(['condo-unit-owners'])
    })

    it('reports a missing directory or manifest', () => {
      expect(messages(path.join(os.tmpdir(), 'no-such-carrier-pack'))[0]).toMatch(/carrier pack directory not found/)
      const dir = copyOfExamplePack()
      fs.rmSync(path.join(dir, 'pack.yaml'))
      expect(messages(dir)).toContain('pack.yaml: missing; a carrier pack needs a pack.yaml manifest')
    })

    it('rejects a manifest this release cannot load', () => {
      const dir = copyOfExamplePack()
      write(dir, 'pack.yaml', 'packFormat: 2\ncarrier: Acme Mutual\nversion: latest\n')
      expect(messages(dir)).toEqual(expect.arrayContaining([
        'pack.yaml: packFormat 2 is not supported by this release; expected 1',
        'pack.yaml: carrier must be the tenant id: 2-63 lowercase letters, digits, or hyphens',
        'pack.yaml: version must be a semantic version such as 1.4.0',
      ]))
    })

    it('rejects a pack built for a different carrier than the stack', () => {
      expect(messages(EXAMPLE_PACK, { expectedCarrier: 'other-carrier' })).toEqual([
        "pack.yaml: carrier 'acme-mutual' does not match this stack's carrier 'other-carrier'",
      ])
    })

    it('does not let a pack replace a core product', () => {
      const dir = copyOfExamplePack()
      fs.cpSync(path.join(dir, 'products/condo-unit-owners'), path.join(dir, 'products/homeowners'), { recursive: true })
      expect(messages(dir)).toEqual([
        "products/homeowners: 'homeowners' is a core product; a carrier pack adds products under new codes and cannot replace a core product",
      ])
    })

    it('reports product definition problems with the file they are in', () => {
      const dir = copyOfExamplePack()
      write(dir, 'products/condo-unit-owners/coverage.yaml', [
        'product: condo-unit-owners',
        'version: 1.0.0',
        'capabilities:',
        '  label: Condo',
        '  ratingAdapter: acme-custom-rater',
        '  supportedTransactions: [quote]',
        '  defaultRisk: { type: dwelling }',
        'coverages:',
        '  - code: A',
        '    name: Building',
        '    limits: [100000, "lots"]',
        '  - code: A',
        '    name: Duplicate',
        '  - code: C',
        '    limitAsPercentOf: Z',
        '',
      ].join('\n'))
      write(dir, 'products/condo-unit-owners/rates.yaml', 'product: homeowners\n')
      write(dir, 'products/Bad_Code/coverage.yaml', 'product: x\n')
      fs.mkdirSync(path.join(dir, 'products/no-files'))

      expect(messages(dir)).toEqual(expect.arrayContaining([
        'products/Bad_Code: product code must be 2-63 lowercase letters, digits, or hyphens',
        expect.stringMatching(/^products\/condo-unit-owners\/coverage\.yaml: ratingAdapter 'acme-custom-rater' is not available in this release/),
        'products/condo-unit-owners/coverage.yaml: coverage A: limits must be a non-empty list of numbers',
        'products/condo-unit-owners/coverage.yaml: coverage A: code is defined more than once',
        'products/condo-unit-owners/coverage.yaml: coverage C: name is required',
        "products/condo-unit-owners/coverage.yaml: coverage C: limitAsPercentOf refers to 'Z', which is not a coverage in this product",
        'products/condo-unit-owners/rates.yaml: must declare product: condo-unit-owners',
        'products/no-files/coverage.yaml: missing',
        'products/no-files/rates.yaml: missing',
      ]))
    })

    it('reports config and field metadata that point at unknown products or are malformed', () => {
      const dir = copyOfExamplePack()
      write(dir, 'config.yaml', 'tenantId: someone-else\nenabledProducts: [homeowners, boat]\noverrides: nope\n')
      write(dir, 'fields/boat.json', '[]')
      write(dir, 'fields/homeowners.json', '{"not": "an array"}')
      write(dir, 'fields/condo-unit-owners.json', JSON.stringify([
        { path: 'risks.0.floorLevel', type: 'int' },
        { path: 'risks.0.floorLevel', type: 'integer' },
        { type: 'string' },
        { path: 'risks.0.view', type: 'enum', enum: [] },
      ]))

      const validation = validateCarrierPack(dir)
      expect(validation.errors.map((issue) => `${issue.file}: ${issue.message}`)).toEqual(expect.arrayContaining([
        "config.yaml: enabledProducts lists 'boat', which is neither a core product nor in this pack",
        'config.yaml: overrides must be a mapping',
        "config.yaml: tenantId 'someone-else' does not match the pack carrier 'acme-mutual'",
        "fields/boat.json: 'boat' is neither a core product nor in this pack",
        'fields/homeowners.json: must be a JSON array of field definitions',
        "fields/condo-unit-owners.json: field 2: path 'risks.0.floorLevel' is defined more than once",
        expect.stringMatching(/^fields\/condo-unit-owners\.json: field 2 \(risks\.0\.floorLevel\): type must be one of/),
        'fields/condo-unit-owners.json: field 3: path is required',
        'fields/condo-unit-owners.json: field 4 (risks.0.view): an enum field needs a non-empty enum list or optionsFrom a table',
      ]))
      expect(validation.warnings.map((issue) => issue.message)).toContain(
        "product 'condo-unit-owners' is in this pack but not in enabledProducts, so it will not be offered"
      )
    })

    it('reports rating problems in a rate-table product with the file they are in', () => {
      const dir = copyOfExamplePack()
      const ratesPath = path.join(dir, 'products/condo-unit-owners/rates.yaml')
      fs.writeFileSync(ratesPath, fs.readFileSync(ratesPath, 'utf8')
        .replace("        500000: 68\n", '')
        .replace('      field: floorLevel', '      field: floorNumber'))

      const validation = validateCarrierPack(dir)
      expect(validation.errors.map((issue) => `${issue.file}: ${issue.message}`)).toEqual([
        'products/condo-unit-owners/rates.yaml: rating.coverages.E: no premium for limit 500000, which the product offers',
      ])
      expect(validation.warnings.map((issue) => `${issue.file}: ${issue.message}`)).toContain(
        "products/condo-unit-owners/rates.yaml: rating.factors[5] (Floor level): reads field 'floorNumber', which the product does not define"
      )
    })

    it('warns about, but loads, files outside the format and products that cannot be quoted', () => {
      const dir = copyOfExamplePack()
      write(dir, 'notes.txt', 'scratch')
      const coveragePath = path.join(dir, 'products/condo-unit-owners/coverage.yaml')
      fs.writeFileSync(coveragePath, fs.readFileSync(coveragePath, 'utf8').replace('ratingAdapter: rate-table', 'ratingAdapter: unsupported'))

      const validation = validateCarrierPack(dir)
      expect(validation.ok).toBe(true)
      expect(validation.warnings.map((issue) => `${issue.file}: ${issue.message}`)).toEqual(expect.arrayContaining([
        'notes.txt: not part of the carrier pack format; ignored',
        "products/condo-unit-owners/coverage.yaml: ratingAdapter is 'unsupported', so this product cannot be quoted",
      ]))
    })

    it('stops startup on an invalid pack and names every problem', () => {
      const dir = copyOfExamplePack()
      write(dir, 'pack.yaml', 'packFormat: 1\ncarrier: acme-mutual\nversion: 1.0.0\n')
      write(dir, 'config.yaml', 'enabledProducts: [boat]\n')
      process.env.CARRIER_PACK_DIR = dir
      expect(() => assertCarrierPackValid('acme-mutual')).toThrow(/INVALID[\s\S]*enabledProducts lists 'boat'/)
    })
  })

  describe('with the example pack loaded', () => {
    beforeEach(() => {
      process.env.CARRIER_PACK_DIR = EXAMPLE_PACK
    })

    it('passes the startup check for its own carrier', () => {
      expect(assertCarrierPackValid('acme-mutual')).toMatchObject({ ok: true, products: ['condo-unit-owners'] })
      expect(getActiveCarrierPack()?.manifest.version).toBe('1.0.0')
    })

    it('offers exactly the products the pack enables, including the one it adds', () => {
      expect(listProductCapabilities().map((product) => product.code).sort()).toEqual([
        'condo-unit-owners',
        'homeowners',
        'personal-auto',
      ])
      expect(getProductCapabilities('condo-unit-owners')).toMatchObject({
        label: 'Condo Unit-Owners',
        ratingAdapter: 'rate-table',
        defaultRisk: { floorLevel: 1 },
      })
      // A core product the carrier did not enable is not offered on this stack.
      expect(getProductCapabilities('cyber')).toBeNull()
      expect(resolveProductPackDir('condo-unit-owners')).toBe(path.join(EXAMPLE_PACK, 'products/condo-unit-owners'))
    })

    it('loads the added product, its rates, and its fields from the pack', () => {
      const config = loadProductConfig('condo-unit-owners')
      expect(config.coverages.map((coverage: any) => coverage.code)).toContain('LOSS_ASSESS')
      expect((loadProductRates('condo-unit-owners').rates as any).rating.factors[0]).toMatchObject({ name: 'Construction', table: { frame: 1.05, masonry: 0.9, other: 1.1 } })

      const fields = loadFieldMeta('condo-unit-owners', 'acme-mutual')
      expect(fields.map((field: any) => field.path)).toEqual(expect.arrayContaining([
        'risks.0.floorLevel',
        'risks.0.masterPolicyDeductible',
        'risks.0.associationName',
      ]))
    })

    it('applies the pack only to its own carrier', () => {
      expect(loadTenantOverrides('acme-mutual').overrides.rating.driverAgeFactors['<25']).toBe(1.3)
      // Another tenant on the same process still reads the repository's files.
      expect(loadTenantOverrides('sample-carrier').overrides.rating.driverAgeFactors['<25']).toBe(1.25)
      expect(loadFieldMeta('condo-unit-owners', 'sample-carrier').map((field: any) => field.path)).not.toContain('risks.0.associationName')
    })

    it('rates the added product from its own rates file, with no rating code', () => {
      const result = rate('acme-mutual', {
        productCode: 'condo-unit-owners',
        state: 'TX',
        termMonths: 12,
        risks: [{ type: 'dwelling', construction: 'masonry', protectionClass: 3, roofAgeYears: 5, floorLevel: 4, occupancy: 'OwnerOccupied' }],
        coverages: [{ code: 'A', selected: true, limit: 150000, deductible: 2500 }, { code: 'LOSS_ASSESS', selected: true, limit: 10000 }],
      })
      // A: 150 x 1.35 x 0.883476 (factors) x 0.90 (deductible) = 161.01; LOSS_ASSESS: 22 flat for the limit.
      expect(result.byCoverage.map((item: any) => [item.code, item.amount.amount])).toEqual([['A', 161.01], ['LOSS_ASSESS', 22]])
      expect(result.fees.amount).toBe(25)
      expect(result.total.amount).toBe(211.67) // 183.01 + 25 + 3.66 tax
      expect(result.calcTrace.source).toBe('rate-table')
    })

    it('builds the quote form from the pack field definitions', () => {
      const fields = buildRiskFields('condo-unit-owners', loadProductConfig('condo-unit-owners'), 'acme-mutual')
      expect(fields.map((field) => field.key)).toEqual([
        'address', 'floorLevel', 'squareFeet', 'monthlyRent', 'yearBuilt', 'construction', 'roofAgeYears', 'roofType', 'protectionClass',
        'buildingFloors', 'hasElevator', 'elevatorCount', 'occupancy', 'masterPolicyDeductible', 'associationName', 'specialAssessmentNotes',
      ])
      expect(fields.find((field) => field.key === 'floorLevel')).toEqual({
        key: 'floorLevel', label: 'Floor Level', type: 'number', path: 'risks.0.floorLevel', required: true, help: 'Enter the floor the unit is on', group: 'Unit',
      })
      expect(fields.find((field) => field.key === 'construction')).toMatchObject({
        label: 'Building Construction', type: 'select', options: ['frame', 'masonry', 'other'], group: 'Building',
      })
      expect(fields.find((field) => field.key === 'masterPolicyDeductible')?.help).toMatch(/association policy/)
    })

    it('keeps core product forms and the generic fallback as they were', () => {
      const homeowners = loadProductConfig('homeowners')
      expect(buildRiskFields('homeowners', homeowners, 'acme-mutual')).toEqual(buildRiskFields('homeowners', homeowners))
      // Without the pack's carrier, a pack product still gets the generic form from its rating keys.
      const generic = buildRiskFields('condo-unit-owners', loadProductConfig('condo-unit-owners'))
      expect(generic.map((field) => field.key)).toEqual(['construction', 'protectionClass', 'roofAgeYears', 'floorLevel', 'occupancy'])
      expect(generic.every((field) => field.group === undefined)).toBe(true)
    })

    it('leaves core product rating untouched for a tenant without the pack', () => {
      const payload = {
        productCode: 'homeowners',
        risks: [{ type: 'dwelling', construction: 'frame', roofAgeYears: 5 }],
        coverages: [{ code: 'A', limit: 150000 }],
      }
      const withPack = rate('sample-carrier', payload)
      delete process.env.CARRIER_PACK_DIR
      expect(rate('sample-carrier', payload)).toEqual(withPack)
    })
  })
})

describe('quote contract and carrier pack products', () => {
  const originalPackDir = process.env.CARRIER_PACK_DIR
  const quote = (productCode: string) => ({
    productCode,
    effectiveDate: '2026-11-01',
    termMonths: 12,
    applicant: { firstName: 'Pat', lastName: 'Condo' },
    risks: [{ type: 'dwelling', address: '1 Main St #4', construction: 'masonry', yearBuilt: 2005, floorLevel: 4 }],
    coverages: [{ code: 'A', selected: true, limit: 150000 }],
  })

  afterEach(() => {
    if (originalPackDir === undefined) delete process.env.CARRIER_PACK_DIR
    else process.env.CARRIER_PACK_DIR = originalPackDir
  })

  it('accepts a product the carrier pack adds and still rejects unknown products', async () => {
    const { validateQuoteDetailed } = await import('../../contracts.js')
    const productErrors = (code: string) => validateQuoteDetailed(quote(code)).errors.filter((error) => error.path === '/productCode')

    delete process.env.CARRIER_PACK_DIR
    expect(productErrors('homeowners')).toEqual([])
    expect(productErrors('condo-unit-owners')).toHaveLength(1)

    process.env.CARRIER_PACK_DIR = EXAMPLE_PACK
    expect(productErrors('condo-unit-owners')).toEqual([])
    expect(productErrors('boat')).toMatchObject([{ keyword: 'enum' }])
    // Other contract errors on a pack product are still reported.
    const missingRisks = validateQuoteDetailed({ ...quote('condo-unit-owners'), risks: [] })
    expect(missingRisks.valid).toBe(false)
  })
})
