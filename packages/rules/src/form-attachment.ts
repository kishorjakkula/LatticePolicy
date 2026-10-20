import { compileExpression, isTruthy, type CompiledExpression } from './expression.js'
import { buildValidationContext, normalizeValidationTransaction, parseValidationTransaction } from './validation-rules.js'

type FormAttachmentInput = {
  payload?: unknown
  productCode?: string
  state?: string
  effectiveDate?: string
  transactionType?: string
  transaction?: unknown
  policy?: unknown
  premium?: unknown
  coverages?: unknown
  attributes?: unknown
  uw?: unknown
}

type FormTriggerDefinition = {
  triggerType: string
  conditionExpression?: string | null
  suppressExpression?: string | null
}

type FormTriggerRow = {
  trigger_id?: string | number | null
  triggerId?: string | number | null
  trigger_type?: string | null
  triggerType?: string | null
  condition_expression?: string | null
  conditionExpression?: string | null
  suppress_expression?: string | null
  suppressExpression?: string | null
  priority?: number | null
  active?: boolean
}

/**
 * Context failures carry a reason so callers can tell an oversized policy
 * ('limits') from malformed data ('invalid') without exposing any values.
 */
export class FormAttachmentContextError extends Error {
  constructor(readonly reason: 'limits' | 'invalid') {
    super(reason === 'limits' ? 'Form attachment context exceeds safety limits' : 'Form attachment context is invalid')
    this.name = 'FormAttachmentContextError'
  }
}

const MAX_ROWS = 1000
const MAX_EXPRESSION = 1000
// Context bounds guard against pathological input. MAX_VALUES counts every
// value and reference, so copying any request body stays under about a second
// and a few hundred MB, while large commercial schedules (e.g. 5,000
// locations x 50 fields, or 10,000 vehicles x 25 fields) still evaluate.
const MAX_DEPTH = 64
const MAX_VALUES = 500000
const MAX_LIST = 100000
const MAX_TEXT = 1000000
const MAX_TOTAL_TEXT = 50000000
const TRIGGER_TYPES = new Set(['Always', 'Coverage Selected', 'Threshold', 'UW Rule', 'Attribute-based', 'Expression'])
const BUSINESS_ROOTS = [
  'productCode', 'state', 'effectiveDate', 'transactionType', 'termMonths', 'expirationDate',
  'risk', 'risks', 'insureds', 'applicant', 'additionalInterests', 'mailingAddress',
  'billingAddress', 'drivers', 'vehicles', 'locations', 'customFields', 'lineOfBusiness',
  'producer', 'agency', 'namedInsured', 'qualificationAnswers', 'uwAnswers',
] as const
const ROOTS = new Set<string>([
  ...BUSINESS_ROOTS, 'payload', 'quote', 'transaction', 'policy', 'premium',
  'coverages', 'coverageCodes', 'attributes', 'uw',
])
const FORBIDDEN_NAMES = new Set([
  'proto', 'prototype', 'constructor', 'tostring', 'valueof', 'tolocalestring',
  'definegetter', 'definesetter', 'lookupgetter', 'lookupsetter',
  'auth', 'session', 'sessionid', 'headers', 'env', 'process', 'global', 'globalthis',
  'window', 'document', 'require', 'module', 'exports', 'eval', 'function',
  'ssn', 'socialsecuritynumber', 'cvv', 'cvc', 'jwt', 'bearer', 'databaseurl',
  'accesskey', 'signingkey', 'encryptionkey', 'mfa', 'otp', 'database', 'db', 'dbconfig',
])

function forbidden(key: string): boolean {
  const name = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return /password|passwd|secret|token|credential|apikey|privatekey|authorization|authentication|cookie|connectionstring|accesskey|signingkey|encryptionkey|databaseurl/.test(name)
    || /^(auth(?!or)|oauth|session)/.test(name)
    || FORBIDDEN_NAMES.has(name)
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : Object.create(null)

/**
 * Copy data descriptors only; never invoke getters, coercion hooks or inherited properties.
 * `freeze` makes the copy immutable, so evaluation can trust it without copying again.
 */
function snapshot(value: unknown, freeze = false): unknown {
  let nodes = 0
  let text = 0
  const ancestors = new Set<object>()
  // A subtree reachable from several roots (payload, quote, risks) is copied
  // and counted once and stays shared in the copy.
  const copies = new Map<object, unknown>()
  const tooLarge = () => new FormAttachmentContextError('limits')
  const invalid = () => new FormAttachmentContextError('invalid')
  const copy = (entry: unknown, depth: number): unknown => {
    if (depth > MAX_DEPTH || ++nodes > MAX_VALUES) throw tooLarge()
    if (entry === null || entry === undefined || typeof entry === 'boolean') return entry
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) throw invalid()
      return entry
    }
    if (typeof entry === 'string') {
      text += entry.length
      if (entry.length > MAX_TEXT || text > MAX_TOTAL_TEXT) throw tooLarge()
      return entry
    }
    if (typeof entry !== 'object') throw invalid()
    if (ancestors.has(entry)) throw invalid()
    if (copies.has(entry)) return copies.get(entry)
    ancestors.add(entry)
    try {
      const array = Array.isArray(entry)
      const prototype = Object.getPrototypeOf(entry)
      if (!array && prototype !== null && prototype !== Object.prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')) {
        throw invalid()
      }
      if (array && entry.length > MAX_LIST) throw tooLarge()
      const keys = Object.getOwnPropertyNames(entry)
      if (keys.length > MAX_LIST + (array ? 1 : 0)) throw tooLarge()
      const result: Record<string, unknown> | unknown[] = array ? new Array(entry.length) : Object.create(null)
      // Dense own slots prevent sparse lists from reading inherited numeric values.
      if (array) for (let index = 0; index < entry.length; index += 1) {
        Object.defineProperty(result, index, { value: null, enumerable: true, writable: true, configurable: true })
      }
      for (const key of keys) {
        if (forbidden(key) || (array && (key === 'length' || !/^(0|[1-9][0-9]*)$/.test(key)))) continue
        text += key.length
        if (key.length > MAX_TEXT || text > MAX_TOTAL_TEXT) throw tooLarge()
        const descriptor = Object.getOwnPropertyDescriptor(entry, key)
        if (!descriptor || !descriptor.enumerable) continue
        if (!('value' in descriptor)) throw invalid()
        Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, writable: true, configurable: true })
      }
      if (freeze) Object.freeze(result)
      copies.set(entry, result)
      return result
    } finally {
      ancestors.delete(entry)
    }
  }
  try {
    return copy(value, 0)
  } catch (error) {
    // Never include source values, keys, or arbitrary proxy/getter errors in diagnostics.
    throw error instanceof FormAttachmentContextError ? error : new FormAttachmentContextError('invalid')
  }
}

// Contexts produced by buildFormAttachmentContext are frozen safe snapshots,
// so evaluation can use them without copying the whole policy again.
const builtContexts = new WeakSet<object>()

function numeric(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function normalizeCoverages(value: unknown): { coverages: Record<string, unknown>; coverageCodes: string[] } {
  const coverages: Record<string, unknown> = Object.create(null)
  const add = (code: unknown, item: unknown) => {
    if (typeof code !== 'string') throw new Error('Invalid form attachment coverage code')
    const key = code.trim().toUpperCase()
    if (!/^[A-Z0-9_][A-Z0-9_-]{0,99}$/.test(key) || forbidden(key)) throw new Error('Invalid form attachment coverage code')
    const fields = object(item)
    const selected = fields.selected ?? (typeof item === 'boolean' ? item : true)
    coverages[key] = { ...fields, selected: isTruthy(selected) }
  }
  if (typeof value === 'string') {
    for (const code of value.split(/[,|]/)) add(code, true)
  } else if (Array.isArray(value)) {
    for (const item of value) add(typeof item === 'string' ? item : object(item).code, item)
  } else {
    for (const [code, item] of Object.entries(object(value))) add(code, item)
  }
  const coverageCodes = Object.keys(coverages).filter((code) => object(coverages[code]).selected === true).sort()
  return { coverages, coverageCodes }
}

/** Caller supplies an approved business snapshot, never a database/session object. */
export function buildFormAttachmentContext(input: FormAttachmentInput): Record<string, unknown> {
  const clean = object(snapshot(input))
  const payload = object(clean.payload)
  for (const key of ['productCode', 'state', 'effectiveDate'] as const) {
    if (clean[key] !== undefined) payload[key] = clean[key]
  }
  const transaction = { ...object(payload.transaction), ...object(clean.transaction) }
  const businessType = transaction.type ?? clean.transactionType ?? payload.transactionType
  if (businessType !== undefined && typeof businessType !== 'string') throw new FormAttachmentContextError('invalid')
  // An unrecognized name must not silently attach new-business forms.
  if (typeof businessType === 'string' && businessType.trim() && !parseValidationTransaction(businessType)) {
    throw new FormAttachmentContextError('invalid')
  }
  transaction.type = normalizeValidationTransaction(businessType as string | undefined)
  // Stage (Bind/Issue) is a new-business concept. Other transactions have no
  // stage, so a rule written as "stage == 'Issue'" means issuance of a new
  // policy and never fires on an endorsement or cancellation.
  const newBusiness = transaction.type === 'new_business'
  if (!newBusiness) delete transaction.stage
  const policy = { ...object(payload.policy), ...object(clean.policy) }
  const policyTerm = object(policy.term)
  policy.termEffectiveDate = policy.termEffectiveDate ?? policyTerm.effectiveDate
  policy.termExpirationDate = policy.termExpirationDate ?? policyTerm.expirationDate
  policy.term = { ...policyTerm, effectiveDate: policy.termEffectiveDate, expirationDate: policy.termExpirationDate }
  const rawPremium = clean.premium ?? payload.premium ?? payload.totalPremium
  const premium = object(rawPremium)
  const rawTotal = premium.total ?? premium.totalPremium ?? rawPremium
  const money = object(rawTotal)
  premium.total = numeric(money.amount ?? rawTotal)
  if (premium.currency === undefined && money.currency !== undefined) premium.currency = money.currency
  const { coverages, coverageCodes } = normalizeCoverages(clean.coverages ?? payload.coverages)
  const firstRisk = object(Array.isArray(payload.risks) ? payload.risks[0] : payload.risk)
  const attributes = {
    ...firstRisk,
    country: payload.country, state: payload.state, termMonths: payload.termMonths,
    underwritingCompany: payload.underwritingCompanyName,
    agencyId: payload.agencyId, agencyName: payload.agencyName,
    agencyContactName: payload.agencyContactName,
    agencyCommissionPct: numeric(payload.agencyCommissionPct),
    policyOffering: payload.policyOffering, underwriter: payload.underwriterName,
    priorPolicyNumber: payload.priorPolicyNumber, priorCarrier: payload.priorCarrier,
    applicant: payload.applicant ?? {},
    ...object(payload.attributes), ...object(clean.attributes),
  }
  // Servicing transactions run on a policy that is already bound; it counts as
  // issued unless it was still Bound. Cancellation passes the pre-transaction
  // status as policy.priorStatus, because its policy.status is the result. Only
  // the caller's explicit policy input is trusted for it, never stored payload.
  const priorStatus = transaction.type === 'cancellation' ? object(clean.policy).priorStatus : undefined
  const uw = {
    ...object(payload.uwAnswers), ...object(payload.uw), ...object(clean.uw),
    isBound: newBusiness ? transaction.stage === 'Bind' || transaction.stage === 'Issue' : true,
    isIssued: newBusiness ? transaction.stage === 'Issue' : String(priorStatus ?? policy.status ?? '').toLowerCase() !== 'bound',
  }
  const effectiveDate = payload.effectiveDate ?? transaction.effectiveDate
  const asOf = typeof effectiveDate === 'string' ? effectiveDate.slice(0, 10) : new Date().toISOString().slice(0, 10)
  // The shared builder's array coverage projection is replaced by the safe map above.
  const base = buildValidationContext({ ...payload, coverages: [] }, { transaction, policy, premium }, asOf)
  const result: Record<string, unknown> = Object.create(null)
  for (const key of BUSINESS_ROOTS) if (payload[key] !== undefined) result[key] = payload[key]
  Object.assign(result, base, {
    payload, quote: { ...payload, ...object(base.quote) }, transactionType: transaction.type,
    coverages, coverageCodes, attributes, uw,
    insureds: payload.insureds ?? base.insureds,
    additionalInterests: payload.additionalInterests ?? [],
  })
  // Snapshot once more to remove prototypes introduced by shared builders and enforce final bounds.
  const built = object(snapshot(result, true))
  builtContexts.add(built)
  return built
}

/** The rule fields worth pinning on a generated form; audit columns stay in the forms catalog. */
export function pinnedFormTriggerRules(rows: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(rows)) return []
  return rows.filter((row) => row && typeof row === 'object').map((row) => {
    const value = row as FormTriggerRow
    return {
      triggerId: value.triggerId ?? value.trigger_id ?? null,
      triggerType: value.triggerType ?? value.trigger_type ?? 'Always',
      conditionExpression: value.conditionExpression ?? value.condition_expression ?? null,
      suppressExpression: value.suppressExpression ?? value.suppress_expression ?? null,
      priority: value.priority ?? null,
      active: value.active ?? true,
    }
  })
}

function compileSafe(source: unknown): CompiledExpression {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_EXPRESSION) throw new Error('Invalid form trigger expression')
  try {
    const expression = compileExpression(source)
    for (const path of expression.variables) {
      const parts = path.split('.')
      if (!ROOTS.has(parts[0]) || parts.some(forbidden)) throw new Error('Invalid path')
    }
    // The shared parser owns grammar/arity. This token scan only checks string
    // selectors in sum/lookup; ordinary business string comparisons stay unrestricted.
    const calls: Array<{ name: string; argument: number }> = []
    let previous = ''
    for (const match of source.matchAll(/(['"])(?:\\.|(?!\1)[^\\])*\1|[A-Za-z_][A-Za-z0-9_]*|[()[\],]|[^\s]/g)) {
      const token = match[0]
      if (token === '(' || token === '[') calls.push({ name: token === '(' ? previous : '', argument: 0 })
      else if (token === ')' || token === ']') calls.pop()
      else if (token === ',') {
        if (calls.length) calls[calls.length - 1].argument += 1
      } else if ((token[0] === "'" || token[0] === '"') && calls.some((call) =>
        (call.name === 'sum' && call.argument === 1) || (call.name === 'lookup' && call.argument !== 1))) {
        const literal = token.slice(1, -1).replace(/\\(.)/g, '$1')
        if (literal.split(/[^A-Za-z0-9_]+/).some((part) => part && forbidden(part))) throw new Error('Invalid field')
      }
      previous = token
    }
    return expression
  } catch {
    throw new Error('Invalid form trigger expression or context path')
  }
}

function coverageList(source: unknown): string[] {
  if (typeof source !== 'string' || !source.trim() || source.length > MAX_EXPRESSION) throw new Error('Invalid form trigger coverage list')
  const codes = source.split(/[,|]/).map((code) => code.trim().toUpperCase())
  if (codes.some((code) => !/^[A-Z0-9_][A-Z0-9_-]{0,99}$/.test(code) || forbidden(code))) throw new Error('Invalid form trigger coverage list')
  return codes
}

function compileDefinition(definition: FormTriggerDefinition) {
  if (!TRIGGER_TYPES.has(definition.triggerType)) throw new Error('Invalid form trigger type')
  for (const source of [definition.conditionExpression, definition.suppressExpression]) {
    if (source != null && (typeof source !== 'string' || source.length > MAX_EXPRESSION)) throw new Error('Invalid form trigger expression')
  }
  const source = definition.conditionExpression
  const codes = definition.triggerType === 'Coverage Selected' ? coverageList(source) : undefined
  const condition = definition.triggerType === 'Always'
    ? (source == null || source.trim() === '' ? undefined : compileSafe(source))
    : codes ? undefined : compileSafe(source)
  const suppression = definition.suppressExpression
  const suppress = suppression == null || (typeof suppression === 'string' && !suppression.trim()) ? undefined : compileSafe(suppression)
  return { codes, condition, suppress }
}

/** Validate at authoring time; runtime repeats validation so invalid rules cannot silently pass. */
export function validateFormTriggerDefinition(definition: FormTriggerDefinition): void {
  compileDefinition(definition)
}

function projectTriggerRows(rows: FormTriggerRow[]): FormTriggerRow[] {
  const fields = [
    'trigger_id', 'triggerId', 'trigger_type', 'triggerType', 'condition_expression',
    'conditionExpression', 'suppress_expression', 'suppressExpression', 'priority', 'active',
  ] as const
  const projected: FormTriggerRow[] = []
  try {
    for (let index = 0; index < rows.length; index += 1) {
      const slot = Object.getOwnPropertyDescriptor(rows, String(index))
      if (!slot || !('value' in slot)) throw new Error('Invalid row slot')
      const row: unknown = slot.value
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid row')
      const result: Record<string, unknown> = Object.create(null)
      for (const field of fields) {
        const descriptor = Object.getOwnPropertyDescriptor(row, field)
        if (!descriptor || !descriptor.enumerable) continue
        if (!('value' in descriptor)) throw new Error('Invalid row accessor')
        result[field] = descriptor.value
      }
      projected.push(result)
    }
    return projected
  } catch {
    throw new Error('Invalid form trigger row')
  }
}

export function evaluateFormTriggers(rows: FormTriggerRow[], context: Record<string, unknown>): { attach: boolean; reason: string; matchedRuleIds: string[] } {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw new Error('Form trigger row limit exceeded')
  // Persisted rows may contain unrelated timestamps/metadata. Only the contract
  // fields enter evaluation; do not traverse database columns or invoke accessors.
  const cleanRows = snapshot(projectTriggerRows(rows)) as FormTriggerRow[]
  const active: Array<{ id: string; priority: number; index: number; type: string; compiled: ReturnType<typeof compileDefinition> }> = []
  for (let index = 0; index < cleanRows.length; index += 1) {
    const row = cleanRows[index]
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Invalid form trigger row')
    if (row.active === false) continue
    if (row.active !== undefined && row.active !== true) throw new Error('Invalid form trigger active flag')
    const type = row.triggerType ?? row.trigger_type ?? 'Always'
    const id = row.triggerId ?? row.trigger_id
    if (id != null && typeof id !== 'string' && typeof id !== 'number') throw new Error('Invalid form trigger identifier')
    if (row.priority != null && (typeof row.priority !== 'number' || !Number.isFinite(row.priority))) throw new Error('Invalid form trigger priority')
    active.push({
      id: id == null ? '' : String(id), priority: row.priority ?? 0, index, type,
      compiled: compileDefinition({ triggerType: type, conditionExpression: row.conditionExpression ?? row.condition_expression, suppressExpression: row.suppressExpression ?? row.suppress_expression }),
    })
  }
  if (!active.length) return { attach: true, reason: 'No active trigger rules configured', matchedRuleIds: [] }
  active.sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.index - b.index)
  const safeContext = builtContexts.has(context) ? context : object(snapshot(context))
  const evaluate = (expression: CompiledExpression) => {
    try { return isTruthy(expression.evaluate(safeContext)) } catch { throw new Error('Form trigger evaluation failed') }
  }
  const suppressed: string[] = []
  let suppressionMatched = false
  for (const rule of active) {
    if (rule.compiled.suppress && evaluate(rule.compiled.suppress)) {
      suppressionMatched = true
      if (rule.id) suppressed.push(rule.id)
    }
  }
  if (suppressionMatched) return { attach: false, reason: 'Suppression rule matched', matchedRuleIds: [...new Set(suppressed)] }
  const matched: string[] = []
  let attach = false
  const selected = safeContext.coverageCodes
  for (const rule of active) {
    const holds = rule.type === 'Always' || (rule.compiled.codes
      ? rule.compiled.codes.some((code) => Array.isArray(selected) && Array.prototype.includes.call(selected, code))
      : rule.compiled.condition !== undefined && evaluate(rule.compiled.condition))
    if (holds) {
      attach = true
      if (rule.id) matched.push(rule.id)
    }
  }
  return { attach, reason: attach ? 'Trigger rule matched' : 'No trigger rule matched', matchedRuleIds: [...new Set(matched)] }
}
