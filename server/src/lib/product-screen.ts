import fs from 'fs'
import YAML from 'yaml'
import {
  ExpressionError,
  compileExpression,
  evaluateScreen,
  type LookupTable,
  type ProductScreen,
  type ScreenDataType,
  type ScreenField,
  type ScreenItemField,
  type ScreenSection,
  type ScreenValidation,
  type ScreenWidget,
} from '@lattice-policy/rules'
import { carrierPackFieldMetaPath, carrierPackFor, carrierPackScreenPath } from './carrier-pack.js'
import { loadCarrierTables, tablesReadBy } from './carrier-tables.js'

/**
 * A carrier pack product's risk screen: the sections, fields, and rules the
 * quote wizard renders and the API enforces. It comes from two pack files:
 *
 *   fields/<code>.json    what each field is (type, label, options, required)
 *   screens/<code>.yaml   how the fields are laid out and when they apply
 *
 * With no screens file, a screen is derived from the fields file alone: one
 * section per ui.group, in ui.order.
 */

export type ScreenIssue = { level: 'error' | 'warning'; message: string }

const DATA_TYPES: ScreenDataType[] = ['string', 'int', 'number', 'bool', 'enum', 'date', 'list']
const ITEM_TYPES: ScreenDataType[] = ['string', 'int', 'number', 'bool', 'enum', 'date']
type Tables = Record<string, LookupTable>
const WIDGETS_BY_TYPE: Record<ScreenDataType, ScreenWidget[]> = {
  string: ['text', 'textarea'],
  int: ['number', 'currency'],
  number: ['number', 'currency'],
  bool: ['checkbox', 'select', 'radio'],
  enum: ['select', 'radio'],
  date: ['date'],
  list: ['table'],
}
/** Names a screen expression may start with (see buildScreenContext in @lattice-policy/rules). */
const CONTEXT_ROOTS = ['risk', 'quote', 'applicant', 'coverages']
const QUOTE_NAMES = ['state', 'termMonths', 'effectiveDate', 'productCode']
const RISK_PATH = /^risks\.0\.([^.]+)$/

function humanize(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Field definitions from fields/<code>.json, keyed by the field name on the risk. */
function fieldsByKey(meta: any[]): Map<string, { definition: any; index: number }> {
  const out = new Map<string, { definition: any; index: number }>()
  meta.forEach((definition, index) => {
    const match = typeof definition?.path === 'string' ? RISK_PATH.exec(definition.path.trim()) : null
    if (match && !out.has(match[1])) out.set(match[1], { definition, index })
  })
  return out
}

/**
 * Option values for an enum: a fixed `enum` list, or `optionsFrom` a carrier
 * table ({ table, value, label? }). Problems are reported through `report`.
 */
function resolveOptions(definition: any, tables: Tables, report: (message: string) => void): { options?: Array<string | number>; optionLabels?: Record<string, string> } {
  const from = definition?.optionsFrom
  if (from === undefined || from === null) {
    return Array.isArray(definition?.enum) ? { options: definition.enum } : {}
  }
  if (!isPlainObject(from) || !text(from.table) || !text(from.value)) {
    report('optionsFrom needs a table and the value column to take options from')
    return {}
  }
  const table = tables[from.table]
  if (!table) {
    report(`optionsFrom: table '${from.table}' is not in the pack`)
    return {}
  }
  const columns = Object.keys(table.rows[0] || {})
  for (const column of [from.value, from.label].filter(Boolean)) {
    if (!columns.includes(column)) {
      report(`optionsFrom: table '${from.table}' has no column '${column}'`)
      return {}
    }
  }
  const options = table.rows.map((row) => row[from.value] as string | number).filter((value) => value !== null && value !== undefined)
  if (!from.label) return { options }
  const optionLabels: Record<string, string> = {}
  for (const row of table.rows) optionLabels[String(row[from.value])] = String(row[from.label] ?? row[from.value])
  return { options, optionLabels }
}

function itemFields(definition: any, tables: Tables, report: (message: string) => void): ScreenItemField[] {
  if (!Array.isArray(definition?.item) || definition.item.length === 0) {
    report('a list field needs item: a non-empty list of columns')
    return []
  }
  const seen = new Set<string>()
  const out: ScreenItemField[] = []
  definition.item.forEach((raw: any, index: number) => {
    const key = text(raw?.key)
    const where = `item[${index + 1}]${key ? ` (${key})` : ''}`
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return report(`${where}: key is required (letters, digits, underscore)`)
    if (seen.has(key)) return report(`${where}: key is defined more than once`)
    seen.add(key)
    if (!ITEM_TYPES.includes(raw.type)) return report(`${where}: type must be one of ${ITEM_TYPES.join(', ')}`)
    const column: ScreenItemField = { key, label: text(raw.label) || humanize(key), dataType: raw.type }
    if (raw.required === true) column.required = true
    if (raw.type === 'enum') {
      const resolved = resolveOptions(raw, tables, (message) => report(`${where}: ${message}`))
      if (!resolved.options || resolved.options.length === 0) report(`${where}: an enum column needs enum or optionsFrom`)
      Object.assign(column, resolved)
    }
    if (text(raw.help)) column.help = text(raw.help)
    out.push(column)
  })
  return out
}

function baseField(key: string, definition: any, tables: Tables = {}, report: (message: string) => void = () => {}): ScreenField {
  const dataType: ScreenDataType = DATA_TYPES.includes(definition?.type) ? definition.type : 'string'
  const field: ScreenField = {
    key,
    label: text(definition?.label) || humanize(key),
    path: `risks.0.${key}`,
    dataType,
    widget: WIDGETS_BY_TYPE[dataType][0],
  }
  if (definition?.required === true) field.required = true
  if (dataType === 'enum') Object.assign(field, resolveOptions(definition, tables, report))
  if (dataType === 'list') {
    field.item = itemFields(definition, tables, report)
    for (const bound of ['minItems', 'maxItems'] as const) {
      if (definition?.[bound] === undefined) continue
      if (Number.isInteger(definition[bound]) && definition[bound] >= 0) field[bound] = definition[bound]
      else report(`${bound} must be a whole number of 0 or more`)
    }
  }
  const help = text(definition?.help) || text(definition?.validation?.message)
  if (help) field.help = help
  return field
}

/** The screen a fields file implies on its own: a section per group, fields in order. */
function screenFromFields(meta: any[], tables: Tables, report: (key: string, message: string) => void): ProductScreen {
  const ordered = Array.from(fieldsByKey(meta).entries()).sort(([, left], [, right]) => {
    const a = Number(left.definition?.ui?.order)
    const b = Number(right.definition?.ui?.order)
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b
    return left.index - right.index
  })
  const sections: ScreenSection[] = []
  for (const [key, { definition }] of ordered) {
    const title = text(definition?.ui?.group)
    let section = sections.find((candidate) => candidate.title === title)
    if (!section) {
      section = { ...(title ? { title } : {}), fields: [] }
      sections.push(section)
    }
    section.fields.push(baseField(key, definition, tables, (message) => report(key, message)))
  }
  return { layout: 'sections', sections, validations: [] }
}

function checkExpression(
  source: unknown,
  where: string,
  fieldKeys: Set<string>,
  issues: ScreenIssue[],
  options: { tables?: Tables; itemColumns?: string[] } = {}
): string | undefined {
  if (source === undefined || source === null) return undefined
  if (typeof source !== 'string' || !source.trim()) {
    issues.push({ level: 'error', message: `${where}: must be an expression` })
    return undefined
  }
  try {
    const compiled = compileExpression(source)
    for (const table of tablesReadBy(source)) {
      if (!options.tables?.[table]) issues.push({ level: 'error', message: `${where}: lookup table '${table}' is not in the pack` })
    }
    for (const name of compiled.variables) {
      const [root, second] = name.split('.')
      if (options.itemColumns && (root === 'item' || root === 'index')) {
        if (root === 'item' && second && !options.itemColumns.includes(second)) {
          issues.push({ level: 'error', message: `${where}: item.${second} is not a column of the list` })
        }
      } else if (!CONTEXT_ROOTS.includes(root)) {
        issues.push({ level: 'error', message: `${where}: '${name}' is not available; start names with ${CONTEXT_ROOTS.join(', ')}` })
      } else if (root === 'risk' && second && !fieldKeys.has(second)) {
        issues.push({ level: 'warning', message: `${where}: reads risk.${second}, which the product does not define` })
      } else if (root === 'quote' && second && !QUOTE_NAMES.includes(second)) {
        issues.push({ level: 'error', message: `${where}: quote.${second} is not available; use ${QUOTE_NAMES.map((item) => `quote.${item}`).join(', ')}` })
      }
    }
    return source.trim()
  } catch (err) {
    const detail = err instanceof ExpressionError ? `${err.message} (at character ${err.position + 1})` : String(err)
    issues.push({ level: 'error', message: `${where}: ${detail}` })
    return undefined
  }
}

/**
 * Builds the screen from the parsed pack files and reports everything wrong
 * with it. `screenFile` is the parsed screens/<code>.yaml or undefined;
 * `reservedKeys` are fields a core product's built-in screen already shows,
 * which a pack screen may not place again.
 */
export function buildProductScreen(
  productCode: string,
  meta: any[],
  screenFile: unknown,
  reservedKeys: string[] = [],
  tables: Tables = {}
): { screen: ProductScreen | null; issues: ScreenIssue[] } {
  const issues: ScreenIssue[] = []
  const error = (message: string) => issues.push({ level: 'error', message })
  const warning = (message: string) => issues.push({ level: 'warning', message })
  const definitions = fieldsByKey(Array.isArray(meta) ? meta : [])
  const fieldKeys = new Set(definitions.keys())
  const reserved = new Set(reservedKeys)

  if (screenFile === undefined || screenFile === null) {
    // A core product keeps its built-in screen unless the pack lays out extra fields.
    if (reserved.size > 0 || definitions.size === 0) return { screen: null, issues }
    const derived = screenFromFields(meta, tables, (key, message) => error(`field '${key}': ${message}`))
    return { screen: issues.some((issue) => issue.level === 'error') ? null : derived, issues }
  }

  if (!isPlainObject(screenFile)) {
    error('must be a YAML mapping')
    return { screen: null, issues }
  }
  if (String(screenFile.product ?? '').trim().toLowerCase() !== productCode) error(`must declare product: ${productCode}`)
  const risk = screenFile.risk
  if (!isPlainObject(risk)) {
    error('risk: must describe the risk step (layout, sections, validations)')
    return { screen: null, issues }
  }
  const layout = risk.layout === undefined ? 'sections' : risk.layout
  if (layout !== 'sections' && layout !== 'tabs') error("risk.layout: must be 'sections' or 'tabs'")
  if (!Array.isArray(risk.sections) || risk.sections.length === 0) {
    error('risk.sections: must be a non-empty list')
    return { screen: null, issues }
  }

  const placed = new Set<string>()
  const sections: ScreenSection[] = []
  risk.sections.forEach((rawSection: any, sectionIndex: number) => {
    const sectionLabel = `risk.sections[${sectionIndex + 1}]${text(rawSection?.title) ? ` (${text(rawSection.title)})` : ''}`
    if (!isPlainObject(rawSection)) return error(`${sectionLabel}: must be a mapping`)
    const section: ScreenSection = { fields: [] }
    if (text(rawSection.title)) section.title = text(rawSection.title)
    else if (layout === 'tabs') error(`${sectionLabel}: a tab needs a title`)
    if (text(rawSection.help)) section.help = text(rawSection.help)
    if (rawSection.columns !== undefined) {
      if (Number.isInteger(rawSection.columns) && rawSection.columns >= 1 && rawSection.columns <= 4) section.columns = rawSection.columns
      else error(`${sectionLabel}: columns must be a whole number from 1 to 4`)
    }
    const sectionCondition = checkExpression(rawSection.visibleWhen, `${sectionLabel}.visibleWhen`, fieldKeys, issues, { tables })
    if (sectionCondition) section.visibleWhen = sectionCondition

    if (!Array.isArray(rawSection.fields) || rawSection.fields.length === 0) {
      error(`${sectionLabel}: fields must be a non-empty list`)
      return
    }
    rawSection.fields.forEach((rawField: any, fieldIndex: number) => {
      const entry = typeof rawField === 'string' ? { field: rawField } : rawField
      const key = isPlainObject(entry) ? text(entry.field) : undefined
      const fieldLabel = `${sectionLabel}.fields[${fieldIndex + 1}]${key ? ` (${key})` : ''}`
      if (!key) return error(`${fieldLabel}: name the field to show, as a name or as field: <name>`)
      const known = definitions.get(key)
      if (!known) return error(`${fieldLabel}: '${key}' is not defined in fields/${productCode}.json`)
      if (reserved.has(key)) return error(`${fieldLabel}: '${key}' is already on this product's built-in screen`)
      if (placed.has(key)) return error(`${fieldLabel}: '${key}' is placed more than once`)
      placed.add(key)

      const field = baseField(key, known.definition, tables, (message) => error(`${fieldLabel}: ${message}`))
      if (entry.widget !== undefined) {
        const allowed = WIDGETS_BY_TYPE[field.dataType]
        if (allowed.includes(entry.widget)) field.widget = entry.widget
        else error(`${fieldLabel}: widget '${entry.widget}' does not fit a ${field.dataType} field; use ${allowed.join(' or ')}`)
      }
      if (entry.span !== undefined) {
        if (Number.isInteger(entry.span) && entry.span >= 1 && entry.span <= 4) field.span = entry.span
        else error(`${fieldLabel}: span must be a whole number from 1 to 4`)
      }
      if (text(entry.label)) field.label = text(entry.label) as string
      if (text(entry.help)) field.help = text(entry.help)
      if (text(entry.placeholder)) field.placeholder = text(entry.placeholder)
      if (entry.readOnly === true) field.readOnly = true
      const visibleWhen = checkExpression(entry.visibleWhen, `${fieldLabel}.visibleWhen`, fieldKeys, issues, { tables })
      if (visibleWhen) field.visibleWhen = visibleWhen
      const requiredWhen = checkExpression(entry.requiredWhen, `${fieldLabel}.requiredWhen`, fieldKeys, issues, { tables })
      if (requiredWhen) field.requiredWhen = requiredWhen
      section.fields.push(field)
    })
    sections.push(section)
  })

  for (const key of fieldKeys) {
    if (!placed.has(key) && !reserved.has(key)) warning(`field '${key}' is defined but not placed on the screen, so it cannot be entered`)
  }

  const validations: ScreenValidation[] = []
  if (risk.validations !== undefined && !Array.isArray(risk.validations)) error('risk.validations: must be a list')
  ;(Array.isArray(risk.validations) ? risk.validations : []).forEach((raw: any, index: number) => {
    const label = `risk.validations[${index + 1}]`
    if (!isPlainObject(raw)) return error(`${label}: must be a mapping`)
    // `each` runs the rule once per item of a list field, with `item` in reach.
    const each = text(raw.each)
    const list = each ? sections.flatMap((section) => section.fields).find((field) => field.key === each) : undefined
    if (each && (!list || list.dataType !== 'list')) error(`${label}: each '${each}' is not a list field placed on the screen`)
    const itemColumns = list?.item?.map((column) => column.key)
    const expressionOptions = { tables, ...(each ? { itemColumns: itemColumns || [] } : {}) }
    const rule = checkExpression(raw.rule ?? '', `${label}.rule`, fieldKeys, issues, expressionOptions)
    const message = text(raw.message)
    if (!message) error(`${label}: message is required`)
    const when = checkExpression(raw.when, `${label}.when`, fieldKeys, issues, expressionOptions)
    const target = text(raw.field)
    if (each) {
      if (target && itemColumns && !itemColumns.includes(target)) error(`${label}: field '${target}' is not a column of list '${each}'`)
    } else if (target && !placed.has(target)) {
      error(`${label}: field '${target}' is not placed on the screen`)
    }
    if (rule && message) {
      validations.push({ rule, message, ...(target ? { field: target } : {}), ...(when ? { when } : {}), ...(each ? { each } : {}) })
    }
  })

  const screen: ProductScreen = { layout: layout === 'tabs' ? 'tabs' : 'sections', sections, validations }
  return { screen: issues.some((issue) => issue.level === 'error') ? null : screen, issues }
}

function readJsonArray(filePath: string): any[] {
  if (!fs.existsSync(filePath)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * The screen the carrier pack defines for a product, or null when there is
 * none (no pack for this tenant, or a core product the pack does not extend).
 * Startup has already validated the pack, so a broken file yields null here
 * rather than an error on a request.
 */
export function loadProductScreen(productCode: string, tenantId: string, reservedKeys: string[] = []): ProductScreen | null {
  const pack = carrierPackFor(tenantId)
  if (!pack) return null
  const meta = readJsonArray(carrierPackFieldMetaPath(pack, productCode))
  const screenPath = carrierPackScreenPath(pack, productCode)
  let screenFile: unknown
  if (fs.existsSync(screenPath)) {
    try {
      screenFile = YAML.parse(fs.readFileSync(screenPath, 'utf8'))
    } catch {
      return null
    }
  }
  return buildProductScreen(productCode, meta, screenFile, reservedKeys, loadCarrierTables(tenantId)).screen
}

/** Lookup tables the screen's rules read; the wizard needs them to apply the same rules. */
export function tablesUsedByScreen(screen: ProductScreen, tables: Tables): Tables {
  const names = new Set<string>()
  const scan = (expression?: string) => tablesReadBy(expression).forEach((name) => names.add(name))
  for (const section of screen.sections) {
    scan(section.visibleWhen)
    for (const field of section.fields) {
      scan(field.visibleWhen)
      scan(field.requiredWhen)
    }
  }
  for (const validation of screen.validations) {
    scan(validation.rule)
    scan(validation.when)
  }
  const out: Tables = {}
  for (const name of names) if (tables[name]) out[name] = tables[name]
  return out
}

export type ScreenViolation = { path: string; keyword: 'screen'; message: string }

/** Problems with a quote under the product's screen rules, in the shape contract errors use. */
export function checkQuoteAgainstScreen(screen: ProductScreen, quote: unknown, tables: Tables = {}): ScreenViolation[] {
  const state = evaluateScreen(screen, quote, tables)
  const fields = new Map<string, ScreenField>()
  for (const section of screen.sections) for (const field of section.fields) fields.set(field.key, field)
  const describe = (key: string): string => {
    // '<list>.<index>' or '<list>.<index>.<column>' names an item in a list.
    const [listKey, index, column] = key.split('.')
    const field = fields.get(listKey)
    if (!field) return key
    if (index === undefined) return field.label
    const columnLabel = column ? field.item?.find((candidate) => candidate.key === column)?.label || column : ''
    return `${field.label} item ${Number(index) + 1}${columnLabel ? `, ${columnLabel}` : ''}`
  }
  return [
    ...Object.entries(state.errors).map(([key, message]) => ({
      path: `/risks/0/${key.split('.').join('/')}`,
      keyword: 'screen' as const,
      message: `${describe(key)}: ${message}`,
    })),
    ...state.formErrors.map((message) => ({ path: '/risks/0', keyword: 'screen' as const, message })),
  ]
}
