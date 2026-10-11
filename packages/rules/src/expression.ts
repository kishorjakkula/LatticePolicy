/**
 * Expression language for carrier pack rules: screen visibility, required
 * conditions, and validations. It is deliberately small and has no access to
 * anything but the values handed to it: no globals, no property calls, no
 * loops, no assignment.
 *
 *   risk.floorLevel > 3 && risk.hasElevator != true
 *   quote.state in ['TX', 'FL']
 *   isSet(risk.associationName) || coverages.LOSS_ASSESS.selected == false
 *   risk.squareFeet / max(risk.rooms, 1) < 400
 *
 * Values     numbers, 'strings' or "strings", true, false, null, [lists]
 * Names      dotted paths into the context; a missing name is null
 * Operators  || && !   == != < <= > >=   in, not in   + - * /   ( )
 * Functions  isSet isEmpty len min max abs round lower upper contains
 *            startsWith number
 *            count(list)              number of items in a list
 *            sum(list, 'field')       total of a field across a list's items
 *            lookup('table', key, 'column')
 *                                     a value from a lookup table, or null
 *
 * Form controls hand back text, so comparisons are forgiving in two specific
 * ways: 'true'/'false' compare equal to the booleans, and numeric text
 * compares as a number. Everything else is compared as it is.
 *
 * The API and the UI both import this package, so the browser and the server
 * reach the same answer for the same rule.
 */

export class ExpressionError extends Error {
  constructor(message: string, public readonly position: number) {
    super(message)
    this.name = 'ExpressionError'
  }
}

export type CompiledExpression = {
  source: string
  /** Dotted names the expression reads, for example risk.floorLevel. */
  variables: string[]
  evaluate: (context: Record<string, unknown>) => unknown
}

type Token = { type: 'num' | 'str' | 'name' | 'op' | 'end'; value: string; position: number }

type Node =
  | { kind: 'lit'; value: unknown }
  | { kind: 'name'; path: string[] }
  | { kind: 'list'; items: Node[] }
  | { kind: 'unary'; op: '!' | '-'; arg: Node }
  | { kind: 'binary'; op: string; left: Node; right: Node }
  | { kind: 'call'; name: string; args: Node[]; position: number }

const MAX_LENGTH = 1000
const MAX_DEPTH = 40
const OPERATORS = ['||', '&&', '==', '!=', '<=', '>=', '<', '>', '!', '+', '-', '*', '/', '(', ')', '[', ']', ',', '.']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (/[0-9]/.test(char)) {
      const match = /^[0-9]+(\.[0-9]+)?/.exec(source.slice(index)) as RegExpExecArray
      tokens.push({ type: 'num', value: match[0], position: index })
      index += match[0].length
      continue
    }
    if (char === "'" || char === '"') {
      let end = index + 1
      let text = ''
      while (end < source.length && source[end] !== char) {
        if (source[end] === '\\' && end + 1 < source.length) end += 1
        text += source[end]
        end += 1
      }
      if (end >= source.length) throw new ExpressionError('text is missing its closing quote', index)
      tokens.push({ type: 'str', value: text, position: index })
      index = end + 1
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index)) as RegExpExecArray
      tokens.push({ type: 'name', value: match[0], position: index })
      index += match[0].length
      continue
    }
    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, index))
    if (!operator) throw new ExpressionError(`unexpected character '${char}'`, index)
    tokens.push({ type: 'op', value: operator, position: index })
    index += operator.length
  }
  tokens.push({ type: 'end', value: '', position: source.length })
  return tokens
}

function parse(source: string): Node {
  const tokens = tokenize(source)
  let cursor = 0
  let depth = 0

  const peek = () => tokens[cursor]
  const isOp = (value: string) => peek().type === 'op' && peek().value === value
  const isName = (value: string) => peek().type === 'name' && peek().value === value
  const take = () => tokens[cursor++]
  const expectOp = (value: string) => {
    if (!isOp(value)) throw new ExpressionError(`expected '${value}'`, peek().position)
    take()
  }
  const nested = <T>(fn: () => T): T => {
    depth += 1
    if (depth > MAX_DEPTH) throw new ExpressionError('expression is nested too deeply', peek().position)
    try {
      return fn()
    } finally {
      depth -= 1
    }
  }

  const parseOr = (): Node => nested(() => {
    let left = parseAnd()
    while (isOp('||')) {
      take()
      left = { kind: 'binary', op: '||', left, right: parseAnd() }
    }
    return left
  })

  const parseAnd = (): Node => {
    let left = parseNot()
    while (isOp('&&')) {
      take()
      left = { kind: 'binary', op: '&&', left, right: parseNot() }
    }
    return left
  }

  const parseNot = (): Node => {
    if (isOp('!')) {
      take()
      return nested(() => ({ kind: 'unary', op: '!', arg: parseNot() }))
    }
    return parseComparison()
  }

  const parseComparison = (): Node => {
    const left = parseSum()
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (isOp(op)) {
        take()
        return { kind: 'binary', op, left, right: parseSum() }
      }
    }
    if (isName('in')) {
      take()
      return { kind: 'binary', op: 'in', left, right: parseSum() }
    }
    if (isName('not') && tokens[cursor + 1]?.type === 'name' && tokens[cursor + 1].value === 'in') {
      take()
      take()
      return { kind: 'unary', op: '!', arg: { kind: 'binary', op: 'in', left, right: parseSum() } }
    }
    return left
  }

  const parseSum = (): Node => {
    let left = parseProduct()
    while (isOp('+') || isOp('-')) {
      const op = take().value
      left = { kind: 'binary', op, left, right: parseProduct() }
    }
    return left
  }

  const parseProduct = (): Node => {
    let left = parseUnary()
    while (isOp('*') || isOp('/')) {
      const op = take().value
      left = { kind: 'binary', op, left, right: parseUnary() }
    }
    return left
  }

  const parseUnary = (): Node => {
    if (isOp('-')) {
      take()
      return nested(() => ({ kind: 'unary', op: '-', arg: parseUnary() }))
    }
    return parsePrimary()
  }

  const parseList = (close: string): Node[] => {
    const items: Node[] = []
    if (!isOp(close)) {
      items.push(parseOr())
      while (isOp(',')) {
        take()
        items.push(parseOr())
      }
    }
    expectOp(close)
    return items
  }

  const parsePrimary = (): Node => {
    const token = take()
    if (token.type === 'num') return { kind: 'lit', value: Number(token.value) }
    if (token.type === 'str') return { kind: 'lit', value: token.value }
    if (token.type === 'op' && token.value === '(') {
      const inner = parseOr()
      expectOp(')')
      return inner
    }
    if (token.type === 'op' && token.value === '[') return { kind: 'list', items: parseList(']') }
    if (token.type === 'name') {
      if (token.value === 'true') return { kind: 'lit', value: true }
      if (token.value === 'false') return { kind: 'lit', value: false }
      if (token.value === 'null') return { kind: 'lit', value: null }
      if (isOp('(')) {
        take()
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, token.value)) {
          throw new ExpressionError(`unknown function '${token.value}'`, token.position)
        }
        return { kind: 'call', name: token.value, args: parseList(')'), position: token.position }
      }
      const path = [token.value]
      while (isOp('.')) {
        take()
        const part = take()
        if (part.type !== 'name' && part.type !== 'num') throw new ExpressionError('expected a name after .', part.position)
        path.push(part.value)
      }
      return { kind: 'name', path }
    }
    throw new ExpressionError(token.type === 'end' ? 'expression ends unexpectedly' : `unexpected '${token.value}'`, token.position)
  }

  const root = parseOr()
  if (peek().type !== 'end') throw new ExpressionError(`unexpected '${peek().value}'`, peek().position)
  return root
}

// --- value rules ---------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/** How a value counts as a condition: blank, 0, false and 'false' are false. */
export function isTruthy(value: unknown): boolean {
  if (isBlank(value)) return false
  const asBoolean = toBoolean(value)
  if (asBoolean !== null) return asBoolean
  if (typeof value === 'number') return value !== 0
  return true
}

function looseEquals(left: unknown, right: unknown): boolean {
  if (isBlank(left) && isBlank(right)) return !Array.isArray(left) && !Array.isArray(right)
  if (typeof left === 'boolean' || typeof right === 'boolean') {
    const a = toBoolean(left)
    const b = toBoolean(right)
    return a !== null && b !== null && a === b
  }
  if (typeof left === 'number' || typeof right === 'number') {
    const a = toNumber(left)
    const b = toNumber(right)
    return a !== null && b !== null && a === b
  }
  return left === right
}

function compare(left: unknown, right: unknown): number | null {
  const a = toNumber(left)
  const b = toNumber(right)
  if (a !== null && b !== null) return a === b ? 0 : a < b ? -1 : 1
  if (typeof left === 'string' && typeof right === 'string') return left === right ? 0 : left < right ? -1 : 1
  return null
}

function numbers(args: unknown[]): number[] | null {
  const out = args.map(toNumber)
  return out.some((value) => value === null) ? null : (out as number[])
}

/** Lookup tables a context can carry under this name, for lookup(). */
export const TABLES_CONTEXT_KEY = '$tables'

export type LookupTable = {
  /** Column whose value identifies a row. */
  key: string
  rows: Array<Record<string, unknown>>
}

function lookupValue(context: Record<string, unknown>, tableName: unknown, key: unknown, column: unknown): unknown {
  const tables = context[TABLES_CONTEXT_KEY]
  if (!tables || typeof tables !== 'object' || typeof tableName !== 'string' || typeof column !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(tables, tableName)) return null
  const table = (tables as Record<string, LookupTable>)[tableName]
  if (!table || !Array.isArray(table.rows) || isBlank(key)) return null
  const row = table.rows.find((candidate) => looseEquals(candidate?.[table.key], key))
  if (!row || !Object.prototype.hasOwnProperty.call(row, column)) return null
  const value = row[column]
  return value === undefined ? null : value
}

const FUNCTIONS: Record<string, { min: number; max: number; run: (args: unknown[], context: Record<string, unknown>) => unknown }> = {
  count: { min: 1, max: 1, run: ([value]) => (Array.isArray(value) ? value.length : 0) },
  sum: {
    min: 2,
    max: 2,
    run: ([list, field]) => {
      if (!Array.isArray(list) || typeof field !== 'string') return 0
      let total = 0
      for (const item of list) {
        const value = item && typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, field) ? toNumber((item as any)[field]) : null
        if (value !== null) total += value
      }
      return total
    },
  },
  lookup: { min: 3, max: 3, run: ([tableName, key, column], context) => lookupValue(context, tableName, key, column) },
  isSet: { min: 1, max: 1, run: ([value]) => !isBlank(value) },
  isEmpty: { min: 1, max: 1, run: ([value]) => isBlank(value) },
  len: { min: 1, max: 1, run: ([value]) => (typeof value === 'string' || Array.isArray(value) ? value.length : 0) },
  min: { min: 1, max: 20, run: (args) => { const list = numbers(args); return list ? Math.min(...list) : null } },
  max: { min: 1, max: 20, run: (args) => { const list = numbers(args); return list ? Math.max(...list) : null } },
  abs: { min: 1, max: 1, run: ([value]) => { const n = toNumber(value); return n === null ? null : Math.abs(n) } },
  round: {
    min: 1,
    max: 2,
    run: ([value, places]) => {
      const n = toNumber(value)
      const digits = places === undefined ? 0 : toNumber(places)
      if (n === null || digits === null) return null
      const scale = Math.pow(10, Math.max(0, Math.min(6, Math.trunc(digits))))
      return Math.round(n * scale) / scale
    },
  },
  lower: { min: 1, max: 1, run: ([value]) => (typeof value === 'string' ? value.toLowerCase() : value) },
  upper: { min: 1, max: 1, run: ([value]) => (typeof value === 'string' ? value.toUpperCase() : value) },
  contains: {
    min: 2,
    max: 2,
    run: ([container, item]) => {
      if (Array.isArray(container)) return container.some((entry) => looseEquals(entry, item))
      if (typeof container === 'string') return typeof item === 'string' && container.includes(item)
      return false
    },
  },
  startsWith: { min: 2, max: 2, run: ([value, prefix]) => typeof value === 'string' && typeof prefix === 'string' && value.startsWith(prefix) },
  number: { min: 1, max: 1, run: ([value]) => toNumber(value) },
}

function lookup(context: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = context
  for (const part of path) {
    if (current === null || current === undefined || typeof current !== 'object') return null
    // Own properties only: nothing inherited (constructor, __proto__) is reachable.
    if (!Object.prototype.hasOwnProperty.call(current, part)) return null
    current = (current as Record<string, unknown>)[part]
  }
  return current === undefined ? null : current
}

function run(node: Node, context: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'lit':
      return node.value
    case 'name':
      return lookup(context, node.path)
    case 'list':
      return node.items.map((item) => run(item, context))
    case 'unary': {
      const value = run(node.arg, context)
      if (node.op === '!') return !isTruthy(value)
      const n = toNumber(value)
      return n === null ? null : -n
    }
    case 'call':
      return FUNCTIONS[node.name].run(node.args.map((arg) => run(arg, context)), context)
    case 'binary': {
      if (node.op === '&&') return isTruthy(run(node.left, context)) && isTruthy(run(node.right, context))
      if (node.op === '||') return isTruthy(run(node.left, context)) || isTruthy(run(node.right, context))
      const left = run(node.left, context)
      const right = run(node.right, context)
      switch (node.op) {
        case '==':
          return looseEquals(left, right)
        case '!=':
          return !looseEquals(left, right)
        case 'in':
          return Array.isArray(right) && right.some((entry) => looseEquals(left, entry))
        case '<':
        case '<=':
        case '>':
        case '>=': {
          const order = compare(left, right)
          if (order === null) return false
          return node.op === '<' ? order < 0 : node.op === '<=' ? order <= 0 : node.op === '>' ? order > 0 : order >= 0
        }
        default: {
          const a = toNumber(left)
          const b = toNumber(right)
          if (a === null || b === null) return null
          if (node.op === '+') return a + b
          if (node.op === '-') return a - b
          if (node.op === '*') return a * b
          return b === 0 ? null : a / b
        }
      }
    }
  }
}

function collectVariables(node: Node, into: Set<string>) {
  if (node.kind === 'name') into.add(node.path.join('.'))
  else if (node.kind === 'list') node.items.forEach((item) => collectVariables(item, into))
  else if (node.kind === 'unary') collectVariables(node.arg, into)
  else if (node.kind === 'call') node.args.forEach((arg) => collectVariables(arg, into))
  else if (node.kind === 'binary') {
    collectVariables(node.left, into)
    collectVariables(node.right, into)
  }
}

function checkCalls(node: Node) {
  if (node.kind === 'call') {
    const fn = FUNCTIONS[node.name]
    if (node.args.length < fn.min || node.args.length > fn.max) {
      const expected = fn.min === fn.max ? String(fn.min) : `${fn.min} to ${fn.max}`
      throw new ExpressionError(`${node.name}() takes ${expected} value${fn.max === 1 ? '' : 's'}`, node.position)
    }
    node.args.forEach(checkCalls)
  } else if (node.kind === 'list') node.items.forEach(checkCalls)
  else if (node.kind === 'unary') checkCalls(node.arg)
  else if (node.kind === 'binary') {
    checkCalls(node.left)
    checkCalls(node.right)
  }
}

const compiled = new Map<string, CompiledExpression>()

/** Parses an expression once. Throws ExpressionError with a position when it is not valid. */
export function compileExpression(source: string): CompiledExpression {
  const text = String(source ?? '')
  const cached = compiled.get(text)
  if (cached) return cached
  if (!text.trim()) throw new ExpressionError('expression is empty', 0)
  if (text.length > MAX_LENGTH) throw new ExpressionError(`expression is longer than ${MAX_LENGTH} characters`, MAX_LENGTH)
  const root = parse(text)
  checkCalls(root)
  const variables = new Set<string>()
  collectVariables(root, variables)
  const result: CompiledExpression = {
    source: text,
    variables: Array.from(variables).sort(),
    evaluate: (context) => run(root, context || {}),
  }
  if (compiled.size > 2000) compiled.clear()
  compiled.set(text, result)
  return result
}

export function evaluateExpression(source: string, context: Record<string, unknown>): unknown {
  return compileExpression(source).evaluate(context)
}

/** Evaluates a condition. A blank condition is the given default; a broken one is false. */
export function evaluateCondition(source: string | null | undefined, context: Record<string, unknown>, whenBlank = true): boolean {
  if (source === null || source === undefined || String(source).trim() === '') return whenBlank
  try {
    return isTruthy(evaluateExpression(String(source), context))
  } catch {
    return false
  }
}
