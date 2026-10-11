import { describe, expect, it } from 'vitest'
import { buildLookupTable, tablesReadBy } from '../carrier-tables.js'

const errors = (name: string, file: unknown) => buildLookupTable(name, file).issues.map((issue) => issue.message)

describe('carrier lookup tables', () => {
  it('reads rows written as lists or as mappings', () => {
    const { table, issues } = buildLookupTable('territory', {
      table: 'territory',
      key: 'zip',
      columns: ['zip', 'name', 'factor'],
      rows: [[78701, 'Austin Core', 1.1], { zip: 78702, name: 'Austin East' }],
    })
    expect(issues).toEqual([])
    expect(table).toEqual({
      key: 'zip',
      rows: [
        { zip: 78701, name: 'Austin Core', factor: 1.1 },
        { zip: 78702, name: 'Austin East', factor: null },
      ],
    })
  })

  it('reports structural problems', () => {
    expect(errors('territory', [])).toEqual(['must be a YAML mapping with table, key, columns, and rows'])
    expect(errors('territory', { table: 'zones', key: 'zip', columns: ['zip'], rows: [[1]] })).toEqual(['must declare table: territory'])
    expect(errors('territory', { table: 'territory', key: 'zip', columns: ['zip code'], rows: [[1]] })).toEqual([
      'columns must be a non-empty list of names (letters, digits, underscore)',
    ])
    expect(errors('territory', { table: 'territory', key: 'state', columns: ['zip', 'zip'], rows: [[1, 2]] })).toEqual([
      'columns must not repeat a name',
      'key must be one of the columns: zip, zip',
    ])
    expect(errors('territory', { table: 'territory', key: 'zip', columns: ['zip'], rows: [] })).toEqual(['rows must be a non-empty list'])
  })

  it('reports row problems with the row they are in', () => {
    const { table, issues } = buildLookupTable('territory', {
      table: 'territory',
      key: 'zip',
      columns: ['zip', 'factor'],
      rows: [[78701, 1.1], [78702], { zip: 78703, surcharge: 2 }, 'row', [78701, 1.2], ['', 1], [78704, { nested: true }]],
    })
    expect(table).toBeNull()
    expect(issues.map((issue) => issue.message)).toEqual([
      'rows[2]: has 1 values but there are 2 columns',
      'rows[3]: unknown column surcharge',
      'rows[4]: must be a list of values or a mapping of column to value',
      "rows[5]: zip '78701' appears more than once",
      'rows[6]: the zip column is empty',
      'rows[7]: values must be text, numbers, true/false, or empty',
    ])
  })

  it('finds the tables an expression reads', () => {
    expect(tablesReadBy("lookup('limits', quote.state, 'max') > sum(risk.items, 'value') && isSet(lookup(\"zones\", risk.zip, 'name'))")).toEqual(['limits', 'zones'])
    expect(tablesReadBy('risk.floorLevel > 3')).toEqual([])
    expect(tablesReadBy(undefined)).toEqual([])
  })
})
