import fs from 'fs'
import YAML from 'yaml'
import {
  ExpressionError,
  compileExpression,
  evaluateScreen,
  type ProductScreen,
  type ScreenDataType,
  type ScreenField,
  type ScreenSection,
  type ScreenValidation,
  type ScreenWidget,
} from '@lattice-policy/rules'
import { carrierPackFieldMetaPath, carrierPackFor, carrierPackScreenPath } from './carrier-pack.js'

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

const DATA_TYPES: ScreenDataType[] = ['string', 'int', 'number', 'bool', 'enum', 'date']
const WIDGETS_BY_TYPE: Record<ScreenDataType, ScreenWidget[]> = {
  string: ['text', 'textarea'],
  int: ['number', 'currency'],
  number: ['number', 'currency'],
  bool: ['checkbox', 'select', 'radio'],
  enum: ['select', 'radio'],
  date: ['date'],
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

function baseField(key: string, definition: any): ScreenField {
  const dataType: ScreenDataType = DATA_TYPES.includes(definition?.type) ? definition.type : 'string'
  const field: ScreenField = {
    key,
    label: text(definition?.label) || humanize(key),
    path: `risks.0.${key}`,
    dataType,
    widget: WIDGETS_BY_TYPE[dataType][0],
  }
  if (definition?.required === true) field.required = true
  if (dataType === 'enum' && Array.isArray(definition?.enum)) field.options = definition.enum
  const help = text(definition?.help) || text(definition?.validation?.message)
  if (help) field.help = help
  return field
}

/** The screen a fields file implies on its own: a section per group, fields in order. */
function screenFromFields(meta: any[]): ProductScreen {
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
    section.fields.push(baseField(key, definition))
  }
  return { layout: 'sections', sections, validations: [] }
}

function checkExpression(source: unknown, where: string, fieldKeys: Set<string>, issues: ScreenIssue[]): string | undefined {
  if (source === undefined || source === null) return undefined
  if (typeof source !== 'string' || !source.trim()) {
    issues.push({ level: 'error', message: `${where}: must be an expression` })
    return undefined
  }
  try {
    const compiled = compileExpression(source)
    for (const name of compiled.variables) {
      const [root, second] = name.split('.')
      if (!CONTEXT_ROOTS.includes(root)) {
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
  reservedKeys: string[] = []
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
    return { screen: screenFromFields(meta), issues }
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
    const sectionCondition = checkExpression(rawSection.visibleWhen, `${sectionLabel}.visibleWhen`, fieldKeys, issues)
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

      const field = baseField(key, known.definition)
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
      const visibleWhen = checkExpression(entry.visibleWhen, `${fieldLabel}.visibleWhen`, fieldKeys, issues)
      if (visibleWhen) field.visibleWhen = visibleWhen
      const requiredWhen = checkExpression(entry.requiredWhen, `${fieldLabel}.requiredWhen`, fieldKeys, issues)
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
    const rule = checkExpression(raw.rule ?? '', `${label}.rule`, fieldKeys, issues)
    const message = text(raw.message)
    if (!message) error(`${label}: message is required`)
    const when = checkExpression(raw.when, `${label}.when`, fieldKeys, issues)
    const target = text(raw.field)
    if (target && !placed.has(target)) error(`${label}: field '${target}' is not placed on the screen`)
    if (rule && message) validations.push({ rule, message, ...(target ? { field: target } : {}), ...(when ? { when } : {}) })
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
  return buildProductScreen(productCode, meta, screenFile, reservedKeys).screen
}

export type ScreenViolation = { path: string; keyword: 'screen'; message: string }

/** Problems with a quote under the product's screen rules, in the shape contract errors use. */
export function checkQuoteAgainstScreen(screen: ProductScreen, quote: unknown): ScreenViolation[] {
  const state = evaluateScreen(screen, quote)
  const labels = new Map<string, string>()
  for (const section of screen.sections) for (const field of section.fields) labels.set(field.key, field.label)
  return [
    ...Object.entries(state.errors).map(([key, message]) => ({
      path: `/risks/0/${key}`,
      keyword: 'screen' as const,
      message: `${labels.get(key) || key}: ${message}`,
    })),
    ...state.formErrors.map((message) => ({ path: '/risks/0', keyword: 'screen' as const, message })),
  ]
}
