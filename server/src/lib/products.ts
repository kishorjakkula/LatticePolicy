import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import { getInstalledProductCapabilities, resolveProductPackDir } from './product-registry.js'
import type { ProductScreen } from '@lattice-policy/rules'
import { carrierPackFieldMetaPath, carrierPackFor, loadCarrierPackConfig } from './carrier-pack.js'
import { buildProductScreen, loadProductScreen } from './product-screen.js'
import { loadCarrierTables } from './carrier-tables.js'
import { assertValidProductPackageConfig } from './product-package-config.js'

/** Products whose risk screens are built into the framework. */
const CORE_PRODUCT_CODES = new Set(['personal-auto', 'commercial-auto', 'homeowners', 'cyber', 'professional-liability'])

export function hasBuiltInRiskFields(productCode: string): boolean {
  return CORE_PRODUCT_CODES.has(productCode)
}

/**
 * The risk screen a carrier pack defines for a product, or null. For a core
 * product the pack can only add sections for its own extra fields; the fields
 * the built-in screen already shows are reserved.
 */
export function loadRiskScreen(productCode: ProductCode, cfg: any, tenantId: string | undefined): ProductScreen | null {
  if (Array.isArray(cfg?.fields)) {
    const meta = tenantId ? loadFieldMeta(productCode, tenantId) : cfg.fields
    return buildProductScreen(productCode, meta.filter((field: any) => field.type !== 'object'), cfg.screen, [], tenantId ? loadCarrierTables(tenantId) : {}).screen
  }
  if (!tenantId) return null
  const reserved = CORE_PRODUCT_CODES.has(productCode) ? buildRiskFields(productCode, cfg).map((field) => field.key) : []
  return loadProductScreen(productCode, tenantId, reserved)
}

export type ProductCode = string

export type Rates = {
  fees?: { policy?: number }
  taxes?: { rate?: number }
  territoryFactors?: { default?: number; byZip?: Record<string, number> }
  stateFactors?: Record<string, number>
  vehicleCountFactors?: Record<string, number>
  driverCountFactors?: Record<string, number>
  radiusClassFactors?: Record<string, number>
  vehicleTypeFactors?: Record<string, number>
  useClassFactors?: Record<string, number>
  gvwClassFactors?: Record<string, number>
  annualMileageFactors?: Record<string, number>
  driverAgeFactors?: Record<string, number>
  vehicleSymbolFactors?: Record<string, number>
  base?: any
  constructionFactors?: Record<string, number>
  protectionClassFactors?: Record<string, number>
  roofAgeFactors?: Record<string, number>
  // Homeowners version 2: each applies only when present.
  deductibleFactors?: Record<string, number>
  windHailFactors?: Record<string, number>
  dwellingAgeFactors?: Record<string, number>
  roofTypeFactors?: Record<string, number>
  dwellingUnitsFactors?: Record<string, number>
  fireStationDistanceFactors?: Record<string, number>
  protectiveDeviceCredits?: { fireAlarm?: number; burglarAlarm?: number }
  industryFactors?: Record<string, number>
  revenueFactors?: Record<string, number>
  employeeCountFactors?: Record<string, number>
  recordsCountFactors?: Record<string, number>
  yearsInBusinessFactors?: Record<string, number>
  largestContractValueFactors?: Record<string, number>
  subcontractorPctFactors?: Record<string, number>
  securityControlFactors?: {
    mfaEnabled?: Record<string, number>
    endpointProtection?: Record<string, number>
    backups?: Record<string, number>
  }
  riskManagementFactors?: {
    writtenContracts?: Record<string, number>
    qualityControl?: Record<string, number>
    retroactiveYears?: Record<string, number>
  }
  priorIncidents?: {
    perIncidentFactor?: number
    maxIncidentsConsidered?: number
  }
  priorLosses?: {
    perLossFactor?: number
    maxLossesConsidered?: number
  }
  priorClaims?: {
    perClaimFactor?: number
    maxClaimsConsidered?: number
  }
  publicFacingAppsFactor?: {
    perAppFactor?: number
    maxAppsConsidered?: number
  }
}

export type ProductPack = {
  product: string
  version: string
  rates: Rates
}

function resolveRepoRoot(): string {
  const cwd = process.cwd()
  const candidates = [cwd, path.resolve(cwd, '..')]
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'products'))) return c
  }
  return cwd
}

/**
 * A product's pack directory: core, or added by the carrier pack. Unknown
 * codes keep resolving under the repository's products/ folder so a missing
 * product fails the same way it always has.
 */
function productPackDir(productCode: ProductCode): string {
  return resolveProductPackDir(productCode) || path.join(resolveRepoRoot(), 'products', productCode)
}

export function loadProductRates(productCode: ProductCode): ProductPack {
  const ratesPath = path.join(productPackDir(productCode), 'rates.yaml')
  const content = fs.readFileSync(ratesPath, 'utf8')
  const rates = YAML.parse(content) as any
  return { product: productCode, version: rates.version || '1.0.0', rates }
}

export function loadTenantOverrides(tenantId: string): any {
  // The carrier pack is the single source of a pinned carrier's overrides.
  const pack = carrierPackFor(tenantId)
  if (pack) return loadCarrierPackConfig(pack)
  const baseDir = resolveRepoRoot()
  const configPath = path.join(baseDir, 'tenants', tenantId, 'config.yaml')
  if (!fs.existsSync(configPath)) return {}
  const content = fs.readFileSync(configPath, 'utf8')
  return YAML.parse(content)
}

export function mergeRates(baseRates: Rates, tenantOverrides: any): Rates {
  const out: Rates = JSON.parse(JSON.stringify(baseRates || {}))
  const rating = tenantOverrides?.overrides?.rating || {}
  for (const key of Object.keys(rating)) {
    if (typeof rating[key] === 'object' && rating[key] !== null) {
      ;(out as any)[key] = { ...(out as any)[key], ...rating[key] }
    } else {
      ;(out as any)[key] = rating[key]
    }
  }
  return out
}

export function loadProductConfig(productCode: ProductCode): any {
  const cfgPath = path.join(productPackDir(productCode), 'coverage.yaml')
  const content = fs.readFileSync(cfgPath, 'utf8')
  const data = YAML.parse(content)
  assertValidProductPackageConfig(data, { required: productCode === 'businessowners' })
  return data
}

export type FormField = {
  key: string
  label: string
  type: 'text'|'number'|'select'
  path: string
  required?: boolean
  options?: any[]
  help?: string
  /** Section heading the field is shown under, when the product defines one. */
  group?: string
}

function humanizeFieldKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

/**
 * Risk form built from a carrier pack's field metadata (fields/<code>.json):
 * the carrier's own labels, option lists, required flags, grouping and order.
 */
function riskFieldsFromFieldMeta(meta: any[]): FormField[] {
  return meta
    .filter((field) => typeof field?.path === 'string' && /^risks\.0\.[^.]+$/.test(field.path) && field.type !== 'list' && field.type !== 'object')
    .map((field, index) => ({ field, index }))
    .sort((left, right) => {
      const leftOrder = Number(left.field?.ui?.order)
      const rightOrder = Number(right.field?.ui?.order)
      if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.index - right.index
    })
    .map(({ field }) => {
      const key = String(field.path).split('.').pop() as string
      const out: FormField = {
        key,
        label: typeof field.label === 'string' && field.label.trim() ? field.label.trim() : humanizeFieldKey(key),
        type: field.type === 'enum' || field.type === 'bool' ? 'select' : field.type === 'int' || field.type === 'number' ? 'number' : 'text',
        path: field.path,
        required: field.required === true,
      }
      if (field.type === 'enum' && Array.isArray(field.enum)) out.options = field.enum
      if (field.type === 'bool') out.options = ['true', 'false']
      const help = typeof field.help === 'string' && field.help.trim() ? field.help.trim() : field?.validation?.message
      if (typeof help === 'string' && help.trim()) out.help = help.trim()
      if (typeof field?.ui?.group === 'string' && field.ui.group.trim()) out.group = field.ui.group.trim()
      return out
    })
}

export function buildRiskFields(productCode: ProductCode, cfg: any, tenantId?: string): FormField[] {
  const keys: string[] = Array.isArray(cfg?.ratingKeys) ? cfg.ratingKeys : []
  const out: FormField[] = []
  const add = (f: FormField) => out.push(f)
  if (productCode === 'personal-auto') {
    if (keys.includes('garagingZip')) add({ key: 'garagingZip', label: 'Garaging ZIP', type: 'text', path: 'risks.0.garagingZip', required: true, help: '5-digit ZIP' })
    if (keys.includes('driverAge')) add({ key: 'driverAge', label: 'Driver Age', type: 'number', path: 'risks.0.driverAge', required: true })
    if (keys.includes('vehicleSymbol')) add({ key: 'symbol', label: 'Vehicle Symbol', type: 'text', path: 'risks.0.symbol' })
    add({ key: 'year', label: 'Vehicle Year', type: 'number', path: 'risks.0.year', required: true })
    add({ key: 'make', label: 'Make', type: 'text', path: 'risks.0.make', required: true })
    add({ key: 'model', label: 'Model', type: 'text', path: 'risks.0.model', required: true })
    add({ key: 'usage', label: 'Usage', type: 'select', path: 'risks.0.usage', required: true, options: ['pleasure','commute','business'] })
    add({ key: 'annualMiles', label: 'Annual Miles', type: 'number', path: 'risks.0.annualMiles', required: true })
  } else if (productCode === 'commercial-auto') {
    if (keys.includes('garagingZip')) add({ key: 'garagingZip', label: 'Primary Garaging ZIP', type: 'text', path: 'risks.0.garagingZip', required: true, help: 'Primary fleet garaging ZIP' })
    if (keys.includes('vehicleCount')) add({ key: 'vehicleCount', label: 'Vehicle Count', type: 'number', path: 'risks.0.vehicleCount', required: true })
    if (keys.includes('driverCount')) add({ key: 'driverCount', label: 'Driver Count', type: 'number', path: 'risks.0.driverCount', required: true })
    if (keys.includes('useClass')) add({ key: 'useClass', label: 'Use Class', type: 'select', path: 'risks.0.useClass', required: true, options: ['artisan-contractor', 'service', 'retail-delivery', 'wholesale-distribution', 'for-hire', 'livery', 'mixed-business', 'other'] })
    if (keys.includes('radiusClass')) add({ key: 'radiusClass', label: 'Operating Radius', type: 'select', path: 'risks.0.radiusClass', required: true, options: ['local', 'intermediate', 'long-haul'] })
    if (keys.includes('vehicleType')) add({ key: 'vehicleType', label: 'Primary Vehicle Type', type: 'select', path: 'risks.0.vehicleType', required: true, options: ['light-truck', 'service-van', 'pickup', 'box-truck', 'mixed-fleet', 'dump-truck', 'tractor-trailer', 'other'] })
    if (keys.includes('gvwClass')) add({ key: 'gvwClass', label: 'GVW Class', type: 'select', path: 'risks.0.gvwClass', required: true, options: ['light', 'medium', 'heavy'] })
    if (keys.includes('annualMileage')) add({ key: 'annualMileage', label: 'Average Annual Mileage (per vehicle)', type: 'number', path: 'risks.0.annualMileage', required: true })
    if (keys.includes('yearsInBusiness')) add({ key: 'yearsInBusiness', label: 'Years in Business', type: 'number', path: 'risks.0.yearsInBusiness', required: true })
    if (keys.includes('priorLossesCount')) add({ key: 'priorLossesCount', label: 'Prior Auto Losses (3 Years)', type: 'number', path: 'risks.0.priorLossesCount', required: true })
    add({ key: 'businessName', label: 'Business Name', type: 'text', path: 'risks.0.businessName', required: false })
  } else if (productCode === 'homeowners') {
    if (keys.includes('construction')) add({ key: 'construction', label: 'Construction', type: 'select', path: 'risks.0.construction', required: true, options: ['frame','masonry','other'] })
    if (keys.includes('protectionClass')) add({ key: 'protectionClass', label: 'Protection Class', type: 'number', path: 'risks.0.protectionClass' })
    if (keys.includes('roofAgeYears')) add({ key: 'roofAgeYears', label: 'Roof Age (years)', type: 'number', path: 'risks.0.roofAgeYears', required: true })
    add({ key: 'address', label: 'Address', type: 'text', path: 'risks.0.address', required: true })
    add({ key: 'yearBuilt', label: 'Year Built', type: 'number', path: 'risks.0.yearBuilt', required: true })
    add({ key: 'squareFeet', label: 'Square Feet', type: 'number', path: 'risks.0.squareFeet' })
    add({ key: 'occupancy', label: 'Occupancy', type: 'select', path: 'risks.0.occupancy', required: false, options: ['OwnerOccupied','TenantOccupied','Seasonal'] })
    if (keys.includes('roofType')) add({ key: 'roofType', label: 'Roof Type', type: 'select', path: 'risks.0.roofType', required: false, options: ['asphalt-shingle', 'metal', 'tile', 'slate', 'wood-shake', 'other'] })
    if (keys.includes('dwellingUnits')) add({ key: 'dwellingUnits', label: 'Dwelling Units (families)', type: 'select', path: 'risks.0.dwellingUnits', required: false, options: ['1', '2'] })
    if (keys.includes('stories')) add({ key: 'stories', label: 'Stories', type: 'number', path: 'risks.0.stories', required: false })
    if (keys.includes('distanceToFireStationMiles')) add({ key: 'distanceToFireStationMiles', label: 'Distance to Fire Station (miles)', type: 'number', path: 'risks.0.distanceToFireStationMiles', required: false })
    add({ key: 'fireAlarm', label: 'Fire Alarm', type: 'select', path: 'risks.0.fireAlarm', required: false, options: ['true','false'] })
    add({ key: 'burglarAlarm', label: 'Burglar Alarm', type: 'select', path: 'risks.0.burglarAlarm', required: false, options: ['true','false'] })
  } else if (productCode === 'cyber') {
    if (keys.includes('industry')) {
      add({
        key: 'industry',
        label: 'Industry',
        type: 'select',
        path: 'risks.0.industry',
        required: true,
        options: ['technology', 'healthcare', 'finance', 'retail', 'manufacturing', 'education', 'professional-services', 'other']
      })
    }
    if (keys.includes('annualRevenue')) add({ key: 'annualRevenue', label: 'Annual Revenue (USD)', type: 'number', path: 'risks.0.annualRevenue', required: true })
    if (keys.includes('employeeCount')) add({ key: 'employeeCount', label: 'Employee Count', type: 'number', path: 'risks.0.employeeCount', required: true })
    if (keys.includes('recordsCount')) add({ key: 'recordsCount', label: 'Sensitive Records Count', type: 'number', path: 'risks.0.recordsCount', required: true })
    if (keys.includes('mfaEnabled')) {
      add({
        key: 'mfaEnabled',
        label: 'MFA Enabled for Admin/Remote Access',
        type: 'select',
        path: 'risks.0.mfaEnabled',
        required: true,
        options: ['true', 'false']
      })
    }
    if (keys.includes('endpointProtection')) {
      add({
        key: 'endpointProtection',
        label: 'Endpoint Protection / EDR Enabled',
        type: 'select',
        path: 'risks.0.endpointProtection',
        required: true,
        options: ['true', 'false']
      })
    }
    if (keys.includes('backups')) {
      add({
        key: 'backups',
        label: 'Backup Frequency',
        type: 'select',
        path: 'risks.0.backups',
        required: true,
        options: ['daily', 'weekly', 'monthly', 'none']
      })
    }
    if (keys.includes('priorIncidents')) add({ key: 'priorIncidents', label: 'Prior Cyber Incidents (Last 3 Years)', type: 'number', path: 'risks.0.priorIncidents', required: true })
    if (keys.includes('publicFacingApps')) add({ key: 'publicFacingApps', label: 'Public-Facing Applications', type: 'number', path: 'risks.0.publicFacingApps', required: true })
    if (keys.includes('domain')) add({ key: 'domain', label: 'Primary Internet Domain', type: 'text', path: 'risks.0.domain', required: true, help: 'Example: company.com' })
  } else if (productCode === 'professional-liability') {
    if (keys.includes('industry')) {
      add({
        key: 'industry',
        label: 'Professional Service Industry',
        type: 'select',
        path: 'risks.0.industry',
        required: true,
        options: [
          'accounting',
          'architecture-engineering',
          'consulting',
          'insurance-agency',
          'it-services',
          'legal-services',
          'management-consulting',
          'marketing-media',
          'real-estate',
          'staffing',
          'other'
        ]
      })
    }
    if (keys.includes('annualRevenue')) add({ key: 'annualRevenue', label: 'Annual Revenue (USD)', type: 'number', path: 'risks.0.annualRevenue', required: true })
    if (keys.includes('employeeCount')) add({ key: 'employeeCount', label: 'Employee Count', type: 'number', path: 'risks.0.employeeCount', required: true })
    if (keys.includes('yearsInBusiness')) add({ key: 'yearsInBusiness', label: 'Years in Business', type: 'number', path: 'risks.0.yearsInBusiness', required: true })
    if (keys.includes('priorClaimsCount')) add({ key: 'priorClaimsCount', label: 'Prior Professional Liability Claims (5 Years)', type: 'number', path: 'risks.0.priorClaimsCount', required: true })
    if (keys.includes('largestContractValue')) add({ key: 'largestContractValue', label: 'Largest Single Contract Value (USD)', type: 'number', path: 'risks.0.largestContractValue', required: true })
    if (keys.includes('subcontractorPct')) add({ key: 'subcontractorPct', label: 'Revenue from Subcontracted Work (%)', type: 'number', path: 'risks.0.subcontractorPct', required: true })
    if (keys.includes('writtenContracts')) {
      add({
        key: 'writtenContracts',
        label: 'Written Contracts Used for All Engagements',
        type: 'select',
        path: 'risks.0.writtenContracts',
        required: true,
        options: ['true', 'false']
      })
    }
    if (keys.includes('qualityControl')) {
      add({
        key: 'qualityControl',
        label: 'Quality Control / Peer Review Process',
        type: 'select',
        path: 'risks.0.qualityControl',
        required: true,
        options: ['formal', 'standard', 'limited']
      })
    }
    if (keys.includes('retroactiveYears')) add({ key: 'retroactiveYears', label: 'Years of Prior Acts / Retroactive Coverage', type: 'number', path: 'risks.0.retroactiveYears', required: true })
  }
  // A product the carrier pack defines fields for gets exactly that form.
  if (!out.length && Array.isArray(cfg?.fields)) {
    out.push(...riskFieldsFromFieldMeta(cfg.fields))
  }
  if (!out.length && tenantId) {
    const pack = carrierPackFor(tenantId)
    const metaPath = pack ? carrierPackFieldMetaPath(pack, productCode) : null
    if (metaPath && fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8').replace(/^\uFEFF/, ''))
        if (Array.isArray(meta)) out.push(...riskFieldsFromFieldMeta(meta))
      } catch {
        // fall through to the generic form below
      }
    }
  }
  if (!out.length) {
    const defaults = getInstalledProductCapabilities(productCode)?.defaultRisk || {}
    for (const key of keys) {
      const defaultValue = defaults[key]
      const label = key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
      if (typeof defaultValue === 'boolean') {
        add({ key, label, type: 'select', path: `risks.0.${key}`, options: ['true', 'false'] })
      } else {
        add({ key, label, type: typeof defaultValue === 'number' ? 'number' : 'text', path: `risks.0.${key}` })
      }
    }
  }
  return out
}

export function loadFieldMeta(productCode: ProductCode, tenantId: string): any[] {
  const baseDir = resolveRepoRoot()
  const pack = carrierPackFor(tenantId)
  const tenantPath = pack
    ? carrierPackFieldMetaPath(pack, productCode)
    : path.join(baseDir, 'tenants', tenantId, `field_meta.${productCode}.json`)
  if (fs.existsSync(tenantPath)) {
    try {
      return JSON.parse(fs.readFileSync(tenantPath, 'utf8'))
    } catch {
      // fall through to defaults
    }
  }
  // Fallback minimal catalog
  const configuredFields = loadProductConfig(productCode)?.fields
  if (Array.isArray(configuredFields)) return configuredFields
  if (productCode === 'homeowners') {
    return [
      { path: 'risks.0.construction', type: 'enum', enum: ['frame','masonry','other'], required: true, ui: { group: 'Dwelling', order: 110 }},
      { path: 'risks.0.yearBuilt', type: 'int', required: true, validation: { message: 'Enter valid year' }, ui: { group: 'Dwelling', order: 120 }},
      { path: 'risks.0.roofAgeYears', type: 'int', required: true, ui: { group: 'Dwelling', order: 130 }},
      { path: 'risks.0.squareFeet', type: 'int', required: false, ui: { group: 'Dwelling', order: 140 }},
      { path: 'risks.0.occupancy', type: 'enum', enum: ['OwnerOccupied','TenantOccupied','Seasonal'], required: false, ui: { group: 'Dwelling', order: 150 }},
      { path: 'risks.0.roofType', type: 'enum', enum: ['asphalt-shingle', 'metal', 'tile', 'slate', 'wood-shake', 'other'], required: false, ui: { group: 'Dwelling', order: 160 }},
      { path: 'risks.0.dwellingUnits', type: 'enum', enum: ['1', '2'], required: false, ui: { group: 'Dwelling', order: 170 }},
      { path: 'risks.0.stories', type: 'int', required: false, ui: { group: 'Dwelling', order: 180 }},
      { path: 'risks.0.distanceToFireStationMiles', type: 'number', required: false, ui: { group: 'Protection', order: 190 }},
      { path: 'risks.0.fireAlarm', type: 'bool', required: false, ui: { group: 'Credits', order: 210 }},
      { path: 'risks.0.burglarAlarm', type: 'bool', required: false, ui: { group: 'Credits', order: 220 }}
    ]
  }
  if (productCode === 'cyber') {
    return [
      { path: 'risks.0.industry', type: 'enum', enum: ['technology', 'healthcare', 'finance', 'retail', 'manufacturing', 'education', 'professional-services', 'other'], required: true, ui: { group: 'Insured Profile', order: 110 } },
      { path: 'risks.0.annualRevenue', type: 'int', required: true, ui: { group: 'Insured Profile', order: 120 } },
      { path: 'risks.0.employeeCount', type: 'int', required: true, ui: { group: 'Insured Profile', order: 130 } },
      { path: 'risks.0.domain', type: 'string', required: true, ui: { group: 'Insured Profile', order: 140 } },
      { path: 'risks.0.recordsCount', type: 'int', required: true, ui: { group: 'Exposure', order: 210 } },
      { path: 'risks.0.publicFacingApps', type: 'int', required: true, ui: { group: 'Exposure', order: 220 } },
      { path: 'risks.0.priorIncidents', type: 'int', required: true, ui: { group: 'Exposure', order: 230 } },
      { path: 'risks.0.mfaEnabled', type: 'bool', required: true, ui: { group: 'Security Controls', order: 310 } },
      { path: 'risks.0.endpointProtection', type: 'bool', required: true, ui: { group: 'Security Controls', order: 320 } },
      { path: 'risks.0.backups', type: 'enum', enum: ['daily', 'weekly', 'monthly', 'none'], required: true, ui: { group: 'Security Controls', order: 330 } }
    ]
  }
  if (productCode === 'professional-liability') {
    return [
      { path: 'risks.0.industry', type: 'enum', enum: ['accounting', 'architecture-engineering', 'consulting', 'insurance-agency', 'it-services', 'legal-services', 'management-consulting', 'marketing-media', 'real-estate', 'staffing', 'other'], required: true, ui: { group: 'Firm Profile', order: 110 } },
      { path: 'risks.0.annualRevenue', type: 'int', required: true, ui: { group: 'Firm Profile', order: 120 } },
      { path: 'risks.0.employeeCount', type: 'int', required: true, ui: { group: 'Firm Profile', order: 130 } },
      { path: 'risks.0.yearsInBusiness', type: 'int', required: true, ui: { group: 'Firm Profile', order: 140 } },
      { path: 'risks.0.largestContractValue', type: 'int', required: true, ui: { group: 'Exposure', order: 210 } },
      { path: 'risks.0.subcontractorPct', type: 'number', required: true, ui: { group: 'Exposure', order: 220 } },
      { path: 'risks.0.priorClaimsCount', type: 'int', required: true, ui: { group: 'Claims History', order: 310 } },
      { path: 'risks.0.retroactiveYears', type: 'int', required: true, ui: { group: 'Coverage History', order: 410 } },
      { path: 'risks.0.writtenContracts', type: 'bool', required: true, ui: { group: 'Risk Controls', order: 510 } },
      { path: 'risks.0.qualityControl', type: 'enum', enum: ['formal', 'standard', 'limited'], required: true, ui: { group: 'Risk Controls', order: 520 } }
    ]
  }
  if (productCode === 'commercial-auto') {
    return [
      { path: 'risks.0.businessName', type: 'string', required: false, ui: { group: 'Insured', order: 110 } },
      { path: 'risks.0.garagingZip', type: 'string', required: true, ui: { group: 'Exposure', order: 210 } },
      { path: 'risks.0.vehicleCount', type: 'int', required: true, ui: { group: 'Exposure', order: 220 } },
      { path: 'risks.0.driverCount', type: 'int', required: true, ui: { group: 'Exposure', order: 230 } },
      { path: 'risks.0.useClass', type: 'enum', enum: ['artisan-contractor', 'service', 'retail-delivery', 'wholesale-distribution', 'for-hire', 'livery', 'mixed-business', 'other'], required: true, ui: { group: 'Operations', order: 310 } },
      { path: 'risks.0.radiusClass', type: 'enum', enum: ['local', 'intermediate', 'long-haul'], required: true, ui: { group: 'Operations', order: 320 } },
      { path: 'risks.0.vehicleType', type: 'enum', enum: ['light-truck', 'service-van', 'pickup', 'box-truck', 'mixed-fleet', 'dump-truck', 'tractor-trailer', 'other'], required: true, ui: { group: 'Fleet', order: 410 } },
      { path: 'risks.0.gvwClass', type: 'enum', enum: ['light', 'medium', 'heavy'], required: true, ui: { group: 'Fleet', order: 420 } },
      { path: 'risks.0.annualMileage', type: 'int', required: true, ui: { group: 'Fleet', order: 430 } },
      { path: 'risks.0.yearsInBusiness', type: 'int', required: true, ui: { group: 'History', order: 510 } },
      { path: 'risks.0.priorLossesCount', type: 'int', required: true, ui: { group: 'History', order: 520 } }
    ]
  }
  const cfg = loadProductConfig(productCode)
  const defaults = getInstalledProductCapabilities(productCode)?.defaultRisk || {}
  return (Array.isArray(cfg?.ratingKeys) ? cfg.ratingKeys : []).map((key: string, index: number) => ({
    path: `risks.0.${key}`,
    type: typeof defaults[key] === 'number' ? 'number' : typeof defaults[key] === 'boolean' ? 'bool' : 'string',
    required: false,
    ui: { group: 'Risk', order: (index + 1) * 10 },
  }))
}
