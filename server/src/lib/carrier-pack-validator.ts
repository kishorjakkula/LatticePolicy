import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import {
  CARRIER_PACK_FORMAT,
  PACK_SLUG_PATTERN,
  getCarrierPackDir,
  readCarrierPackManifest,
  type CarrierPackManifest,
} from './carrier-pack.js'
import { RATING_ADAPTERS, parseProductDescriptor, resolveCoreProductsDir } from './product-registry.js'
import { validateRateTable } from './rating-table.js'
import { buildProductScreen } from './product-screen.js'
import { readPackTables } from './carrier-tables.js'
import type { LookupTable } from '@lattice-policy/rules'
import { buildRiskFields } from './products.js'

export type CarrierPackIssue = {
  /** Path inside the pack the issue is about, for example products/condo/coverage.yaml. */
  file: string
  message: string
}

export type CarrierPackValidation = {
  ok: boolean
  dir: string
  manifest: CarrierPackManifest | null
  /** Product codes the pack adds. */
  products: string[]
  errors: CarrierPackIssue[]
  warnings: CarrierPackIssue[]
}

export type CarrierPackValidationOptions = {
  /** When set, the pack must be for this carrier (the stack's CARRIER_TENANT_ID). */
  expectedCarrier?: string | null
  /** Overrides the core products directory; used by tests. */
  coreProductsDir?: string
}

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
const FIELD_TYPES = new Set(['string', 'int', 'number', 'bool', 'enum', 'date', 'list'])
const TOP_LEVEL_ENTRIES = new Set(['pack.yaml', 'config.yaml', 'products', 'fields', 'screens', 'tables', 'README.md'])

function listDirectories(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

function readYaml(filePath: string): { value: any; error: string | null } {
  try {
    return { value: YAML.parse(fs.readFileSync(filePath, 'utf8')), error: null }
  } catch (err) {
    return { value: null, error: err instanceof Error ? err.message.split('\n')[0] : String(err) }
  }
}

function isNumberList(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

/**
 * Checks a carrier pack against what this release can load. Errors mean the
 * stack must not start with the pack; warnings are worth a look but load.
 * Run it before taking a release to see whether the pack still fits.
 */
export function validateCarrierPack(dir: string, options: CarrierPackValidationOptions = {}): CarrierPackValidation {
  const errors: CarrierPackIssue[] = []
  const warnings: CarrierPackIssue[] = []
  const error = (file: string, message: string) => errors.push({ file, message })
  const warning = (file: string, message: string) => warnings.push({ file, message })
  const result = (manifest: CarrierPackManifest | null, products: string[]): CarrierPackValidation => ({
    ok: errors.length === 0,
    dir,
    manifest,
    products,
    errors,
    warnings,
  })

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    error('.', `carrier pack directory not found: ${dir}`)
    return result(null, [])
  }

  // --- pack.yaml --------------------------------------------------------------
  let manifest: CarrierPackManifest | null = null
  if (!fs.existsSync(path.join(dir, 'pack.yaml'))) {
    error('pack.yaml', 'missing; a carrier pack needs a pack.yaml manifest')
  } else {
    try {
      manifest = readCarrierPackManifest(dir)
    } catch (err) {
      error('pack.yaml', `not valid YAML: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
    }
    if (!manifest && !errors.length) error('pack.yaml', 'must be a YAML mapping with packFormat, carrier, and version')
  }
  if (manifest) {
    if (manifest.packFormat !== CARRIER_PACK_FORMAT) {
      error('pack.yaml', `packFormat ${Number.isNaN(manifest.packFormat) ? '(missing)' : manifest.packFormat} is not supported by this release; expected ${CARRIER_PACK_FORMAT}`)
    }
    if (!PACK_SLUG_PATTERN.test(manifest.carrier)) {
      error('pack.yaml', 'carrier must be the tenant id: 2-63 lowercase letters, digits, or hyphens')
    } else if (options.expectedCarrier && manifest.carrier !== options.expectedCarrier) {
      error('pack.yaml', `carrier '${manifest.carrier}' does not match this stack's carrier '${options.expectedCarrier}'`)
    }
    if (!SEMVER_PATTERN.test(manifest.version)) error('pack.yaml', 'version must be a semantic version such as 1.4.0')
  }

  for (const entry of fs.readdirSync(dir)) {
    if (!TOP_LEVEL_ENTRIES.has(entry) && !entry.startsWith('.')) warning(entry, 'not part of the carrier pack format; ignored')
  }

  // --- products/ --------------------------------------------------------------
  const coreProductsDir = options.coreProductsDir || resolveCoreProductsDir()
  const coreCodes = new Set(listDirectories(coreProductsDir))
  const packProducts: string[] = []
  // rate-table products are checked after fields/ is read, so a factor that
  // reads an undefined field can be reported.
  const rateTableProducts: Array<{ code: string; coverage: any; rates: any }> = []
  for (const code of listDirectories(path.join(dir, 'products'))) {
    const base = `products/${code}`
    if (!PACK_SLUG_PATTERN.test(code)) {
      error(base, 'product code must be 2-63 lowercase letters, digits, or hyphens')
      continue
    }
    if (coreCodes.has(code)) {
      error(base, `'${code}' is a core product; a carrier pack adds products under new codes and cannot replace a core product`)
      continue
    }

    let coverageValue: any = null
    let usesRateTable = false
    const coveragePath = path.join(dir, 'products', code, 'coverage.yaml')
    if (!fs.existsSync(coveragePath)) {
      error(`${base}/coverage.yaml`, 'missing')
    } else {
      const coverage = readYaml(coveragePath)
      if (coverage.error) {
        error(`${base}/coverage.yaml`, `not valid YAML: ${coverage.error}`)
      } else {
        coverageValue = coverage.value
        try {
          const descriptor = parseProductDescriptor(coverage.value, code)
          usesRateTable = descriptor.ratingAdapter === 'rate-table'
          if (!(RATING_ADAPTERS as readonly string[]).includes(descriptor.ratingAdapter)) {
            error(`${base}/coverage.yaml`, `ratingAdapter '${descriptor.ratingAdapter}' is not available in this release; use one of: ${RATING_ADAPTERS.join(', ')}`)
          } else if (descriptor.ratingAdapter === 'unsupported') {
            warning(`${base}/coverage.yaml`, "ratingAdapter is 'unsupported', so this product cannot be quoted")
          }
          if (!descriptor.supportedTransactions.length) warning(`${base}/coverage.yaml`, 'supportedTransactions is empty, so nothing can be done with this product')
          if (!Object.keys(descriptor.defaultRisk).length) warning(`${base}/coverage.yaml`, 'capabilities.defaultRisk is empty; quote screens will have no starting values')
        } catch (err) {
          error(`${base}/coverage.yaml`, err instanceof Error ? err.message : String(err))
        }
        validateCoverages(coverage.value, `${base}/coverage.yaml`, error)
      }
    }

    const ratesPath = path.join(dir, 'products', code, 'rates.yaml')
    if (!fs.existsSync(ratesPath)) {
      error(`${base}/rates.yaml`, 'missing')
    } else {
      const rates = readYaml(ratesPath)
      if (rates.error) error(`${base}/rates.yaml`, `not valid YAML: ${rates.error}`)
      else if (!rates.value || typeof rates.value !== 'object' || Array.isArray(rates.value)) error(`${base}/rates.yaml`, 'must be a YAML mapping')
      else if (String(rates.value.product || '').trim().toLowerCase() !== code) error(`${base}/rates.yaml`, `must declare product: ${code}`)
      else if (usesRateTable) rateTableProducts.push({ code, coverage: coverageValue, rates: rates.value })
    }
    packProducts.push(code)
  }

  const knownProducts = new Set([...coreCodes, ...packProducts])

  // --- config.yaml ------------------------------------------------------------
  if (fs.existsSync(path.join(dir, 'config.yaml'))) {
    const config = readYaml(path.join(dir, 'config.yaml'))
    if (config.error) {
      error('config.yaml', `not valid YAML: ${config.error}`)
    } else if (config.value != null && (typeof config.value !== 'object' || Array.isArray(config.value))) {
      error('config.yaml', 'must be a YAML mapping')
    } else if (config.value) {
      const enabled = config.value.enabledProducts
      if (enabled != null && !Array.isArray(enabled)) {
        error('config.yaml', 'enabledProducts must be a list of product codes')
      } else if (Array.isArray(enabled)) {
        for (const item of enabled) {
          const code = String(item).trim().toLowerCase()
          if (!knownProducts.has(code)) error('config.yaml', `enabledProducts lists '${code}', which is neither a core product nor in this pack`)
        }
        for (const code of packProducts) {
          if (enabled.length && !enabled.map((item: unknown) => String(item).trim().toLowerCase()).includes(code)) {
            warning('config.yaml', `product '${code}' is in this pack but not in enabledProducts, so it will not be offered`)
          }
        }
      }
      if (config.value.overrides != null && (typeof config.value.overrides !== 'object' || Array.isArray(config.value.overrides))) {
        error('config.yaml', 'overrides must be a mapping')
      }
      if (config.value.tenantId != null && manifest && String(config.value.tenantId).trim() !== manifest.carrier) {
        error('config.yaml', `tenantId '${config.value.tenantId}' does not match the pack carrier '${manifest.carrier}'`)
      }
    }
  }

  // --- tables/ ----------------------------------------------------------------
  const tables: Record<string, LookupTable> = {}
  if (manifest) {
    for (const entry of readPackTables({ dir, manifest })) {
      for (const issue of entry.issues) {
        if (issue.level === 'error') error(`tables/${entry.file}`, issue.message)
        else warning(`tables/${entry.file}`, issue.message)
      }
      if (entry.table) tables[entry.name] = entry.table
    }
  }
  const tablesDir = path.join(dir, 'tables')
  if (fs.existsSync(tablesDir)) {
    for (const file of fs.readdirSync(tablesDir)) {
      if (!file.endsWith('.yaml')) warning(`tables/${file}`, 'only <table-name>.yaml files are read from tables/')
    }
  }

  // --- fields/ ----------------------------------------------------------------
  const fieldPathsByProduct = new Map<string, string[]>()
  const fieldMetaByProduct = new Map<string, any[]>()
  const fieldsDir = path.join(dir, 'fields')
  if (fs.existsSync(fieldsDir)) {
    for (const file of fs.readdirSync(fieldsDir).sort()) {
      const rel = `fields/${file}`
      if (!file.endsWith('.json')) {
        warning(rel, 'only <product-code>.json files are read from fields/')
        continue
      }
      const code = file.slice(0, -'.json'.length)
      if (!knownProducts.has(code)) {
        error(rel, `'${code}' is neither a core product nor in this pack`)
        continue
      }
      let parsed: unknown
      try {
        // Editors on Windows often add a byte order mark; JSON.parse rejects it.
        parsed = JSON.parse(fs.readFileSync(path.join(fieldsDir, file), 'utf8').replace(/^﻿/, ''))
      } catch (err) {
        error(rel, `not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
        continue
      }
      if (!Array.isArray(parsed)) {
        error(rel, 'must be a JSON array of field definitions')
        continue
      }
      const seen = new Set<string>()
      fieldPathsByProduct.set(code, parsed.map((field: any) => (typeof field?.path === 'string' ? field.path.trim() : '')).filter(Boolean))
      fieldMetaByProduct.set(code, parsed)
      parsed.forEach((field: any, index: number) => {
        const where = `field ${index + 1}`
        const fieldPath = typeof field?.path === 'string' ? field.path.trim() : ''
        if (!fieldPath) return error(rel, `${where}: path is required`)
        if (seen.has(fieldPath)) error(rel, `${where}: path '${fieldPath}' is defined more than once`)
        seen.add(fieldPath)
        if (!FIELD_TYPES.has(String(field.type))) {
          error(rel, `${where} (${fieldPath}): type must be one of ${Array.from(FIELD_TYPES).join(', ')}`)
        }
        if (field.type === 'enum' && !(Array.isArray(field.enum) && field.enum.length > 0) && field.optionsFrom == null) {
          error(rel, `${where} (${fieldPath}): an enum field needs a non-empty enum list or optionsFrom a table`)
        }
      })
    }
  }

  // --- screens/ -----------------------------------------------------------------
  const screensDir = path.join(dir, 'screens')
  if (fs.existsSync(screensDir)) {
    for (const file of fs.readdirSync(screensDir).sort()) {
      const rel = `screens/${file}`
      if (!file.endsWith('.yaml')) {
        warning(rel, 'only <product-code>.yaml files are read from screens/')
        continue
      }
      const code = file.slice(0, -'.yaml'.length)
      if (!knownProducts.has(code)) {
        error(rel, `'${code}' is neither a core product nor in this pack`)
        continue
      }
      const parsed = readYaml(path.join(screensDir, file))
      if (parsed.error) {
        error(rel, `not valid YAML: ${parsed.error}`)
        continue
      }
      // A core product's built-in screen already shows these fields.
      let reserved: string[] = []
      if (coreCodes.has(code)) {
        const coreConfig = readYaml(path.join(coreProductsDir, code, 'coverage.yaml'))
        reserved = coreConfig.error ? [] : buildRiskFields(code, coreConfig.value).map((field) => field.key)
      }
      for (const issue of buildProductScreen(code, fieldMetaByProduct.get(code) || [], parsed.value, reserved, tables).issues) {
        if (issue.level === 'error') error(rel, issue.message)
        else warning(rel, issue.message)
      }
    }
  }
  // A pack product with fields but no screen file gets a screen derived from
  // the fields; list columns and table options still have to be valid.
  for (const code of packProducts) {
    if (!fieldMetaByProduct.has(code) || fs.existsSync(path.join(screensDir, `${code}.yaml`))) continue
    for (const issue of buildProductScreen(code, fieldMetaByProduct.get(code) || [], undefined, [], tables).issues) {
      if (issue.level === 'error') error(`fields/${code}.json`, issue.message)
      else warning(`fields/${code}.json`, issue.message)
    }
  }

  // --- rate-table rating --------------------------------------------------------
  for (const product of rateTableProducts) {
    const defaultRisk = product.coverage?.capabilities?.defaultRisk
    const fieldNames = new Set<string>(defaultRisk && typeof defaultRisk === 'object' ? Object.keys(defaultRisk) : [])
    for (const fieldPath of fieldPathsByProduct.get(product.code) || []) {
      const match = /^risks\.0\.(.+)$/.exec(fieldPath)
      if (match) fieldNames.add(match[1])
    }
    // Columns of each list field, for per-item pricing.
    const listColumns: Record<string, string[]> = {}
    for (const field of fieldMetaByProduct.get(product.code) || []) {
      const match = typeof field?.path === 'string' ? /^risks\.0\.(.+)$/.exec(field.path.trim()) : null
      if (match && field.type === 'list' && Array.isArray(field.item)) listColumns[match[1]] = field.item.map((column: any) => String(column?.key || ''))
    }
    for (const issue of validateRateTable(product.rates, product.coverage, Array.from(fieldNames), { tables, listColumns })) {
      if (issue.level === 'error') error(`products/${product.code}/rates.yaml`, issue.message)
      else warning(`products/${product.code}/rates.yaml`, issue.message)
    }
  }

  return result(manifest, packProducts)
}

function validateCoverages(coverage: any, file: string, error: (file: string, message: string) => void) {
  if (!Array.isArray(coverage?.coverages) || coverage.coverages.length === 0) {
    error(file, 'coverages must be a non-empty list')
    return
  }
  const seen = new Set<string>()
  const codes = new Set<string>(coverage.coverages.map((item: any) => String(item?.code ?? '').trim()))
  coverage.coverages.forEach((item: any, index: number) => {
    const code = String(item?.code ?? '').trim()
    const where = code ? `coverage ${code}` : `coverage ${index + 1}`
    if (!code) return error(file, `${where}: code is required`)
    if (seen.has(code)) error(file, `${where}: code is defined more than once`)
    seen.add(code)
    if (!String(item?.name ?? '').trim()) error(file, `${where}: name is required`)
    if (item.limits != null && !isNumberList(item.limits)) error(file, `${where}: limits must be a non-empty list of numbers`)
    if (item.deductibles != null && !isNumberList(item.deductibles)) error(file, `${where}: deductibles must be a non-empty list of numbers`)
    if (item.percentOptions != null && !isNumberList(item.percentOptions)) error(file, `${where}: percentOptions must be a non-empty list of numbers`)
    if (item.limitType != null && item.limitType !== 'value') error(file, `${where}: limitType must be 'value' (a free-form amount) when set`)
    if (item.defaultLimit != null && !(typeof item.defaultLimit === 'number' && Number.isFinite(item.defaultLimit) && item.defaultLimit > 0)) {
      error(file, `${where}: defaultLimit must be a number above 0`)
    }
    if (item.limitAsPercentOf != null && !codes.has(String(item.limitAsPercentOf))) {
      error(file, `${where}: limitAsPercentOf refers to '${item.limitAsPercentOf}', which is not a coverage in this product`)
    }
  })
  if (coverage.ratingKeys != null && !(Array.isArray(coverage.ratingKeys) && coverage.ratingKeys.every((key: unknown) => typeof key === 'string' && key.trim()))) {
    error(file, 'ratingKeys must be a list of field names')
  }
}

export function formatCarrierPackValidation(validation: CarrierPackValidation): string {
  const lines: string[] = []
  const label = validation.manifest ? `${validation.manifest.carrier} ${validation.manifest.version}` : validation.dir
  lines.push(`Carrier pack ${label}: ${validation.ok ? 'valid' : 'INVALID'}`)
  if (validation.products.length) lines.push(`  products added: ${validation.products.join(', ')}`)
  for (const issue of validation.errors) lines.push(`  error   ${issue.file}: ${issue.message}`)
  for (const issue of validation.warnings) lines.push(`  warning ${issue.file}: ${issue.message}`)
  return lines.join('\n')
}

/**
 * Startup gate: with CARRIER_PACK_DIR set, refuse to run on a pack this
 * release cannot load. Returns the validation (or null with no pack) so the
 * caller can log warnings.
 */
export function assertCarrierPackValid(expectedCarrier?: string | null): CarrierPackValidation | null {
  const dir = getCarrierPackDir()
  if (!dir) return null
  const validation = validateCarrierPack(dir, { expectedCarrier })
  if (!validation.ok) throw new Error(formatCarrierPackValidation(validation))
  return validation
}
