import { describe, expect, it } from 'vitest'
import { ExpressionError, TABLES_CONTEXT_KEY, compileExpression, evaluateCondition, evaluateExpression, isTruthy } from './expression.js'

const context = {
  risk: { floorLevel: 4, hasElevator: 'false', squareFeet: '1100', rooms: 0, occupancy: 'OwnerOccupied', associationName: '  ', tags: ['corner', 'renovated'] },
  quote: { state: 'TX', termMonths: 12 },
  coverages: { A: { selected: true, limit: 150000 }, LOSS_ASSESS: { selected: false, limit: null } },
}

const value = (source: string) => evaluateExpression(source, context)

describe('expression language', () => {
  it('reads values, literals, and lists', () => {
    expect(value('risk.floorLevel')).toBe(4)
    expect(value('quote.state')).toBe('TX')
    expect(value("'it\\'s'")).toBe("it's")
    expect(value('[1, "two", true, null]')).toEqual([1, 'two', true, null])
    expect(value('risk.tags.0')).toBe('corner')
  })

  it('treats a missing name as null instead of failing', () => {
    expect(value('risk.notThere')).toBeNull()
    expect(value('nowhere.at.all')).toBeNull()
    expect(value('risk.floorLevel.deeper')).toBeNull()
  })

  it('compares numbers, text, and the text that form controls hand back', () => {
    expect(value('risk.floorLevel > 3')).toBe(true)
    expect(value('risk.floorLevel <= 3')).toBe(false)
    expect(value('risk.squareFeet >= 1100')).toBe(true) // numeric text
    expect(value('risk.squareFeet == 1100')).toBe(true)
    expect(value('risk.hasElevator == false')).toBe(true) // 'false' from a select
    expect(value('risk.hasElevator != true')).toBe(true)
    expect(value("quote.state == 'TX'")).toBe(true)
    expect(value("quote.state == 'tx'")).toBe(false) // text is case-sensitive
    expect(value("quote.state < 'UT'")).toBe(true)
    expect(value('risk.notThere == null')).toBe(true)
    expect(value("risk.associationName == null")).toBe(true) // blank text counts as empty
    expect(value('risk.notThere > 1')).toBe(false) // nothing to compare
  })

  it('supports and, or, not, in, and not in', () => {
    expect(value('risk.floorLevel > 3 && risk.hasElevator != true')).toBe(true)
    expect(value('risk.floorLevel > 10 || quote.termMonths == 12')).toBe(true)
    expect(value('!(risk.floorLevel > 3)')).toBe(false)
    expect(value("quote.state in ['TX', 'FL']")).toBe(true)
    expect(value("quote.state not in ['TX', 'FL']")).toBe(false)
    expect(value('quote.termMonths in [6, "12"]')).toBe(true)
    expect(value('coverages.A.selected && !coverages.LOSS_ASSESS.selected')).toBe(true)
  })

  it('does arithmetic with the usual precedence and no surprises on bad input', () => {
    expect(value('2 + 3 * 4')).toBe(14)
    expect(value('(2 + 3) * 4')).toBe(20)
    expect(value('-risk.floorLevel + 10')).toBe(6)
    expect(value('coverages.A.limit / 1000')).toBe(150)
    expect(value('risk.squareFeet / risk.rooms')).toBeNull() // divide by zero
    expect(value("quote.state + 1")).toBeNull() // text is not a number
    expect(value('risk.squareFeet / max(risk.rooms, 1) > 400')).toBe(true)
  })

  it('provides a fixed set of functions', () => {
    expect(value('isSet(risk.occupancy)')).toBe(true)
    expect(value('isSet(risk.associationName)')).toBe(false)
    expect(value('isEmpty(risk.notThere)')).toBe(true)
    expect(value('len(risk.tags)')).toBe(2)
    expect(value('len(quote.state)')).toBe(2)
    expect(value('min(3, risk.floorLevel, 9)')).toBe(3)
    expect(value('max(3, risk.floorLevel)')).toBe(4)
    expect(value('abs(0 - 5)')).toBe(5)
    expect(value('round(10 / 3, 2)')).toBe(3.33)
    expect(value('round(2.5)')).toBe(3)
    expect(value("lower(quote.state) == 'tx'")).toBe(true)
    expect(value("upper('tx')")).toBe('TX')
    expect(value("contains(risk.tags, 'corner')")).toBe(true)
    expect(value("contains(risk.occupancy, 'Owner')")).toBe(true)
    expect(value("startsWith(risk.occupancy, 'Tenant')")).toBe(false)
    expect(value('number(risk.squareFeet) + 1')).toBe(1101)
  })

  it('decides conditions the way a form expects', () => {
    expect([true, 1, 'yes', 'true', [0]].map(isTruthy)).toEqual([true, true, true, true, true])
    expect([false, 0, '', '  ', null, undefined, 'false', []].map(isTruthy)).toEqual([false, false, false, false, false, false, false, false])
    expect(evaluateCondition('risk.hasElevator', context)).toBe(false)
    expect(evaluateCondition('', context)).toBe(true) // no condition
    expect(evaluateCondition(undefined, context, false)).toBe(false)
    expect(evaluateCondition('risk.floorLevel >', context)).toBe(false) // broken rule never passes silently
  })

  it('reports what is wrong with a rule and where', () => {
    const failure = (source: string) => {
      try {
        compileExpression(source)
      } catch (err) {
        return err instanceof ExpressionError ? `${err.message} @${err.position}` : `unexpected ${String(err)}`
      }
      return 'compiled'
    }
    expect(failure('')).toBe('expression is empty @0')
    expect(failure('risk.floorLevel >')).toBe('expression ends unexpectedly @17')
    expect(failure('risk.floorLevel = 3')).toBe("unexpected character '=' @16")
    expect(failure("quote.state == 'TX")).toBe('text is missing its closing quote @15')
    expect(failure('explode(1)')).toBe("unknown function 'explode' @0")
    expect(failure('round()')).toBe('round() takes 1 to 2 values @0')
    expect(failure('isSet(1, 2)')).toBe('isSet() takes 1 value @0')
    expect(failure('(1 + 2')).toBe("expected ')' @6")
    expect(failure('1 2')).toBe("unexpected '2' @2")
    expect(failure('risk.')).toBe('expected a name after . @5')
    expect(failure('1 +'.repeat(400) + '1')).toMatch(/longer than 1000 characters/)
    expect(failure('('.repeat(60) + '1' + ')'.repeat(60))).toMatch(/nested too deeply/)
  })

  it('lists the names a rule reads', () => {
    expect(compileExpression("risk.floorLevel > 3 && quote.state in ['TX'] || isSet(coverages.A.limit)").variables).toEqual([
      'coverages.A.limit',
      'quote.state',
      'risk.floorLevel',
    ])
  })

  it('cannot reach anything outside the values it is given', () => {
    const exposed = { risk: { name: 'x' } }
    for (const source of ['risk.constructor', 'risk.__proto__', 'risk.name.constructor', 'constructor', 'risk.toString', 'process', 'globalThis']) {
      expect(evaluateExpression(source, exposed), source).toBeNull()
    }
    // Names are never callable; only the built-in functions are.
    expect(() => compileExpression('risk.name()')).toThrow(ExpressionError)
    expect(() => compileExpression('risk["name"]')).toThrow(ExpressionError)
    expect(() => compileExpression('a = 1')).toThrow(ExpressionError)
    expect(() => compileExpression('a; b')).toThrow(ExpressionError)
  })
})

describe('lists and lookup tables in expressions', () => {
  const tables = {
    territory: { key: 'zip', rows: [{ zip: '78701', name: 'Austin Core', factor: 1.1 }, { zip: 78702, name: 'Austin East', factor: 1.05 }] },
  }
  const withTables = {
    risk: { zip: 78701, scheduledItems: [{ description: 'Ring', value: 5000 }, { description: 'Painting', value: '12000' }, { description: 'No value' }] },
    [TABLES_CONTEXT_KEY]: tables,
  }
  const value = (source: string) => evaluateExpression(source, withTables)

  it('counts and totals the items of a list', () => {
    expect(value('count(risk.scheduledItems)')).toBe(3)
    expect(value("sum(risk.scheduledItems, 'value')")).toBe(17000)
    expect(value("sum(risk.scheduledItems, 'value') <= 20000 && count(risk.scheduledItems) < 5")).toBe(true)
    expect(value('count(risk.notAList)')).toBe(0)
    expect(value("sum(risk.notAList, 'value')")).toBe(0)
  })

  it('looks a value up in a carrier table, matching numbers and numeric text', () => {
    expect(value("lookup('territory', risk.zip, 'factor')")).toBe(1.1)
    expect(value("lookup('territory', '78702', 'name')")).toBe('Austin East')
    expect(value("lookup('territory', risk.zip, 'factor') > 1")).toBe(true)
  })

  it('returns null for an unknown table, key, or column', () => {
    expect(value("lookup('nowhere', risk.zip, 'factor')")).toBeNull()
    expect(value("lookup('territory', 99999, 'factor')")).toBeNull()
    expect(value("lookup('territory', risk.zip, 'surcharge')")).toBeNull()
    expect(value("lookup('territory', risk.missing, 'factor')")).toBeNull()
    expect(evaluateExpression("lookup('territory', 78701, 'factor')", { risk: {} })).toBeNull()
  })

  it('does not let a rule read the tables except through lookup()', () => {
    expect(() => compileExpression('$tables.territory')).toThrow(ExpressionError)
    expect(evaluateExpression('tables', withTables)).toBeNull()
  })
})
