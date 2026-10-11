import fs from 'fs'
import path from 'path'
import YAML from 'yaml'
import type { LookupTable } from '@lattice-policy/rules'
import { PACK_SLUG_PATTERN, carrierPackFor, type CarrierPack } from './carrier-pack.js'

/**
 * Lookup and reference tables a carrier keeps in its pack, one file each:
 *
 *   tables/territory.yaml
 *     table: territory
 *     key: zip                         # column that identifies a row
 *     columns: [zip, name, factor]
 *     rows:
 *       - [78701, Austin Core, 1.10]
 *       - { zip: 78702, name: Austin East, factor: 1.05 }
 *
 * They supply option lists for fields (`optionsFrom`), rating factors
 * (`fromTable`), and values for rules (`lookup('territory', risk.zip, 'factor')`).
 */

export type TableIssue = { level: 'error' | 'warning'; message: string }

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value)
}

/** Turns a parsed table file into a lookup table and reports what is wrong with it. */
export function buildLookupTable(name: string, file: unknown): { table: LookupTable | null; issues: TableIssue[] } {
  const issues: TableIssue[] = []
  const error = (message: string) => issues.push({ level: 'error', message })
  if (!isPlainObject(file)) {
    error('must be a YAML mapping with table, key, columns, and rows')
    return { table: null, issues }
  }
  if (String(file.table ?? '').trim() !== name) error(`must declare table: ${name}`)
  const columns: string[] = Array.isArray(file.columns) ? file.columns.map((column: unknown) => String(column ?? '').trim()) : []
  if (columns.length === 0 || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    error('columns must be a non-empty list of names (letters, digits, underscore)')
    return { table: null, issues }
  }
  if (new Set(columns).size !== columns.length) error('columns must not repeat a name')
  const key = String(file.key ?? '').trim()
  if (!columns.includes(key)) error(`key must be one of the columns: ${columns.join(', ')}`)
  // Row problems would only repeat a broken header.
  if (issues.length > 0) return { table: null, issues }
  if (!Array.isArray(file.rows) || file.rows.length === 0) {
    error('rows must be a non-empty list')
    return { table: null, issues }
  }

  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  file.rows.forEach((raw: unknown, index: number) => {
    const where = `rows[${index + 1}]`
    const row: Record<string, unknown> = {}
    if (Array.isArray(raw)) {
      if (raw.length !== columns.length) return error(`${where}: has ${raw.length} values but there are ${columns.length} columns`)
      columns.forEach((column, position) => { row[column] = raw[position] })
    } else if (isPlainObject(raw)) {
      const unknown = Object.keys(raw).filter((column) => !columns.includes(column))
      if (unknown.length) return error(`${where}: unknown column ${unknown.join(', ')}`)
      columns.forEach((column) => { row[column] = raw[column] ?? null })
    } else {
      return error(`${where}: must be a list of values or a mapping of column to value`)
    }
    if (Object.values(row).some((value) => !isScalar(value))) return error(`${where}: values must be text, numbers, true/false, or empty`)
    const identity = row[key]
    if (identity === null || identity === undefined || String(identity).trim() === '') return error(`${where}: the ${key} column is empty`)
    if (seen.has(String(identity))) return error(`${where}: ${key} '${identity}' appears more than once`)
    seen.add(String(identity))
    rows.push(row)
  })

  return { table: issues.some((issue) => issue.level === 'error') ? null : { key, rows }, issues }
}

export function carrierPackTablesDir(pack: CarrierPack): string {
  return path.join(pack.dir, 'tables')
}

/** Every table file in a pack, parsed. Used by the pack check and by loading. */
export function readPackTables(pack: CarrierPack): Array<{ name: string; file: string; table: LookupTable | null; issues: TableIssue[] }> {
  const dir = carrierPackTablesDir(pack)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((file) => file.endsWith('.yaml')).sort().map((file) => {
    const name = file.slice(0, -'.yaml'.length)
    if (!PACK_SLUG_PATTERN.test(name)) {
      return { name, file, table: null, issues: [{ level: 'error' as const, message: 'table name must be 2-63 lowercase letters, digits, or hyphens' }] }
    }
    let parsed: unknown
    try {
      parsed = YAML.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    } catch (err) {
      return { name, file, table: null, issues: [{ level: 'error' as const, message: `not valid YAML: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}` }] }
    }
    return { name, file, ...buildLookupTable(name, parsed) }
  })
}

/** The carrier's lookup tables by name; empty when the tenant has no pack. */
export function loadCarrierTables(tenantId: string | undefined): Record<string, LookupTable> {
  const pack = tenantId ? carrierPackFor(tenantId) : null
  if (!pack) return {}
  const out: Record<string, LookupTable> = {}
  for (const entry of readPackTables(pack)) if (entry.table) out[entry.name] = entry.table
  return out
}

/** Names of tables an expression reads through lookup('name', ...). */
export function tablesReadBy(expression: string | undefined | null): string[] {
  const names = new Set<string>()
  for (const match of String(expression || '').matchAll(/lookup\(\s*(['"])([^'"]+)\1/g)) names.add(match[2])
  return Array.from(names)
}
