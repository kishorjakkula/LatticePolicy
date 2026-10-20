import { ExpressionError, TABLES_CONTEXT_KEY, TODAY_CONTEXT_KEY, compileExpression, evaluateExpression, isTruthy, type LookupTable } from './expression.js'
import { buildScreenContext } from './screen-rules.js'

/**
 * Carrier-configured validation rules, checked at every level of every
 * transaction:
 *
 *   level        screen (as the user types, per wizard screen), rate (rating
 *                or a transaction preview), bind (new business), issue (issuing
 *                new business, or processing any policy change)
 *   transaction  new business, endorsement, cancellation, reinstatement,
 *                renewal, rewrite, non-renewal, or `common` for all of them
 *   scope        one product or all, one state or all, effective-dated
 *   severity     error   a hard stop: the step cannot complete
 *                warning a soft stop: shown on screens and at rating; at bind
 *                        and issue a person must acknowledge it to continue
 *
 * The browser and the API run this same code, so what the screen shows is
 * what the server enforces.
 */

export const VALIDATION_LEVELS = ['screen', 'rate', 'bind', 'issue'] as const
export type ValidationLevel = (typeof VALIDATION_LEVELS)[number]

export const VALIDATION_TRANSACTIONS = [
  'new_business',
  'endorsement',
  'cancellation',
  'reinstatement',
  'renewal',
  'rewrite',
  'non_renewal',
] as const
export type ValidationTransaction = (typeof VALIDATION_TRANSACTIONS)[number]
/** Applies to every transaction type. */
export const COMMON_TRANSACTION = 'common'

/** Wizard screens a screen-level rule is shown on. */
export const VALIDATION_SCREENS = ['product', 'qualification', 'insureds', 'risk', 'coverages', 'rating', 'premium', 'forms'] as const
export type ValidationScreen = (typeof VALIDATION_SCREENS)[number]

export type ValidationSeverity = 'error' | 'warning'
export type ValidationRuleKind = 'required' | 'condition'

export type ValidationRule = {
  ruleCode: string
  name: string
  /** required: fieldPath must have a value. condition: the condition must be true. */
  kind: ValidationRuleKind
  /** The field the rule is about. Required for `required`; optional (for display) for `condition`. */
  fieldPath?: string | null
  /** Expression that must be true; used by `condition` rules. */
  condition?: string | null
  /** The rule is only checked while this expression is true. */
  appliesWhen?: string | null
  levels: ValidationLevel[]
  /** Transaction types, or ['common'] for all of them. */
  transactionTypes: Array<ValidationTransaction | typeof COMMON_TRANSACTION>
  /** null: every product. */
  productCode?: string | null
  /** null: every state. */
  stateCode?: string | null
  /** Wizard screen for screen-level rules. */
  screen?: ValidationScreen | null
  severity: ValidationSeverity
  message: string
  effectiveDate?: string | null
  expirationDate?: string | null
  active?: boolean
}

export type ValidationFinding = {
  ruleCode: string
  severity: ValidationSeverity
  message: string
  /** Concrete field path, with a list index when the rule covers every item. */
  fieldPath: string | null
  screen: ValidationScreen | null
}

export type ValidationOutcome = {
  errors: ValidationFinding[]
  warnings: ValidationFinding[]
}

export type ValidationTarget = {
  level: ValidationLevel
  transactionType: ValidationTransaction
  productCode?: string | null
  stateCode?: string | null
  /** YYYY-MM-DD the rule's effective window is compared with; also what today() returns. */
  asOf?: string | null
}

/** Extra facts a transaction adds to the payload for rule expressions. */
export type ValidationExtras = {
  transaction?: Record<string, unknown>
  policy?: Record<string, unknown>
  premium?: Record<string, unknown>
  tables?: Record<string, LookupTable>
}

/**
 * Maps the UI's wizard modes and the API's transaction names onto the rule
 * vocabulary.
 */
export function normalizeValidationTransaction(value: string | null | undefined): ValidationTransaction {
  return parseValidationTransaction(value) || 'new_business'
}

/** Like normalizeValidationTransaction, but returns null for an unrecognized name instead of defaulting. */
export function parseValidationTransaction(value: string | null | undefined): ValidationTransaction | null {
  const key = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  const aliases: Record<string, ValidationTransaction> = {
    quote: 'new_business',
    bind: 'new_business',
    quotebind: 'new_business',
    nb: 'new_business',
    new_business: 'new_business',
    newbusiness: 'new_business',
    issue: 'new_business',
    endorse: 'endorsement',
    endorsement: 'endorsement',
    cancel: 'cancellation',
    cancellation: 'cancellation',
    reinstate: 'reinstatement',
    reinstatement: 'reinstatement',
    renew: 'renewal',
    renewal: 'renewal',
    rewrite: 'rewrite',
    non_renew: 'non_renewal',
    nonrenew: 'non_renewal',
    nonrenewal: 'non_renewal',
    non_renewal: 'non_renewal',
  }
  return Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : null
}

/**
 * Expression names: everything buildScreenContext provides (risk, quote,
 * applicant, coverages) plus
 *   risks, insureds, uwAnswers, qualificationAnswers   the payload lists
 *   payload                 the whole payload
 *   transaction.<field>     the transaction request (type, effectiveDate, reason...)
 *   policy.<field>          the policy being changed (status, policyNumber, term dates)
 *   premium.<field>         the rated premium, when known
 */
export function buildValidationContext(payload: any, extras: ValidationExtras = {}, asOf?: string | null): Record<string, unknown> {
  const base = buildScreenContext(payload || {}, extras.tables)
  const object = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {})
  return {
    ...base,
    risks: Array.isArray(payload?.risks) ? payload.risks : [],
    insureds: Array.isArray(payload?.insureds) ? payload.insureds : [],
    uwAnswers: object(payload?.uwAnswers),
    qualificationAnswers: object(payload?.qualificationAnswers),
    payload: payload && typeof payload === 'object' ? payload : {},
    transaction: object(extras.transaction),
    policy: object(extras.policy),
    premium: object(extras.premium),
    [TABLES_CONTEXT_KEY]: extras.tables || {},
    ...(asOf ? { [TODAY_CONTEXT_KEY]: asOf } : {}),
  }
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

const PATH_PART = /^[A-Za-z_$][\w$]*$|^\d+$|^\*$/

/** Splits `risks[0].vin`, `risks.0.vin` or `risks[*].vin` into parts. */
export function splitFieldPath(path: string): string[] | null {
  const parts = String(path || '')
    .trim()
    .replace(/\[(\d+|\*)\]/g, '.$1')
    .split('.')
    .filter((part) => part !== '')
  if (!parts.length || parts.some((part) => !PATH_PART.test(part))) return null
  if (parts.some((part) => part === '__proto__' || part === 'constructor' || part === 'prototype')) return null
  return parts
}

/** Every concrete value for a path; `*` expands across a list. */
function resolveAll(root: unknown, parts: string[], prefix: string[] = []): Array<{ path: string; value: unknown }> {
  if (!parts.length) return [{ path: prefix.join('.'), value: root }]
  const [head, ...rest] = parts
  if (head === '*') {
    if (!Array.isArray(root)) return []
    return root.flatMap((item, index) => resolveAll(item, rest, [...prefix, String(index)]))
  }
  const next =
    root !== null && typeof root === 'object' && Object.prototype.hasOwnProperty.call(root, head)
      ? (root as Record<string, unknown>)[head]
      : undefined
  return resolveAll(next, rest, [...prefix, head])
}

/** The value a required rule checks, looked up on the payload, then on the transaction/policy facts. */
function requiredValues(payload: any, context: Record<string, unknown>, parts: string[]) {
  const root = parts[0] === 'transaction' || parts[0] === 'policy' || parts[0] === 'premium' ? context : payload
  return resolveAll(root, parts)
}

/** Problems with a rule's own definition (used when an administrator saves it). */
export function validationRuleProblems(rule: Partial<ValidationRule>): string[] {
  const problems: string[] = []
  if (rule.kind !== 'required' && rule.kind !== 'condition') problems.push('Choose required field or condition')
  if (rule.kind === 'required' && !splitFieldPath(rule.fieldPath || '')) problems.push('Enter a valid field path, for example applicant.email or risks[*].vin')
  if (rule.kind !== 'required' && rule.fieldPath && !splitFieldPath(rule.fieldPath)) problems.push('The field path is not valid')
  if (rule.kind === 'condition' && !String(rule.condition || '').trim()) problems.push('Enter the condition that must be true')
  for (const [label, source] of [['Condition', rule.condition], ['Applies when', rule.appliesWhen]] as const) {
    if (!source || !String(source).trim()) continue
    try {
      compileExpression(String(source))
    } catch (error) {
      problems.push(`${label}: ${error instanceof ExpressionError ? error.message : 'invalid expression'}`)
    }
  }
  if (!Array.isArray(rule.levels) || !rule.levels.length || rule.levels.some((level) => !VALIDATION_LEVELS.includes(level)))
    problems.push('Choose at least one level')
  const types = rule.transactionTypes || []
  if (!types.length || types.some((type) => type !== COMMON_TRANSACTION && !VALIDATION_TRANSACTIONS.includes(type as ValidationTransaction)))
    problems.push('Choose Common or at least one transaction')
  if (types.includes(COMMON_TRANSACTION) && types.length > 1) problems.push('Common already covers every transaction')
  if (rule.levels?.includes('screen') && !VALIDATION_SCREENS.includes(rule.screen as ValidationScreen))
    problems.push('Choose the screen a screen-level rule is shown on')
  if (rule.severity !== 'error' && rule.severity !== 'warning') problems.push('Choose error or warning')
  if (!String(rule.message || '').trim()) problems.push('Enter the message people see')
  if (rule.expirationDate && rule.effectiveDate && rule.expirationDate < rule.effectiveDate)
    problems.push('The expiration date is before the effective date')
  return problems
}

export function ruleAppliesTo(rule: ValidationRule, target: ValidationTarget): boolean {
  if (rule.active === false) return false
  if (!rule.levels.includes(target.level)) return false
  if (!rule.transactionTypes.includes(COMMON_TRANSACTION) && !rule.transactionTypes.includes(target.transactionType)) return false
  if (rule.productCode && rule.productCode !== target.productCode) return false
  if (rule.stateCode && String(rule.stateCode).toUpperCase() !== String(target.stateCode || '').toUpperCase()) return false
  const asOf = target.asOf ? String(target.asOf).slice(0, 10) : null
  if (asOf && rule.effectiveDate && asOf < String(rule.effectiveDate).slice(0, 10)) return false
  if (asOf && rule.expirationDate && asOf > String(rule.expirationDate).slice(0, 10)) return false
  return true
}

/** Runs the rules that apply to this level and transaction against a payload. */
export function evaluateValidationRules(
  rules: ValidationRule[],
  payload: any,
  target: ValidationTarget,
  extras: ValidationExtras = {},
): ValidationOutcome {
  const asOf = target.asOf ? String(target.asOf).slice(0, 10) : null
  const context = buildValidationContext(payload, { ...extras, transaction: { type: target.transactionType, ...(extras.transaction || {}) } }, asOf)
  const outcome: ValidationOutcome = { errors: [], warnings: [] }
  const add = (rule: ValidationRule, fieldPath: string | null, message = rule.message) => {
    const finding: ValidationFinding = {
      ruleCode: rule.ruleCode,
      severity: rule.severity,
      message,
      fieldPath,
      screen: rule.screen || null,
    }
    ;(rule.severity === 'error' ? outcome.errors : outcome.warnings).push(finding)
  }
  // Unlike screen visibility, a broken expression must surface, so errors propagate.
  const holds = (source: string | null | undefined) =>
    source === null || source === undefined || String(source).trim() === '' ? true : isTruthy(evaluateExpression(String(source), context))
  for (const rule of rules) {
    if (!ruleAppliesTo(rule, target)) continue
    try {
      if (!holds(rule.appliesWhen)) continue
      if (rule.kind === 'required') {
        const parts = splitFieldPath(rule.fieldPath || '')
        if (!parts) {
          add(rule, rule.fieldPath || null, `${rule.message} (rule field path is not valid)`)
          continue
        }
        const found = requiredValues(payload, context, parts)
        // A path through an empty list (risks[*].vin with no risks) checks nothing.
        if (!found.length && parts.includes('*')) continue
        if (!found.length) add(rule, rule.fieldPath || null)
        for (const entry of found) if (isBlank(entry.value)) add(rule, entry.path)
      } else if (!holds(rule.condition)) {
        add(rule, rule.fieldPath || null)
      }
    } catch {
      // A rule that cannot run is reported, never silently passed.
      add(rule, rule.fieldPath || null, `${rule.message} (rule could not be evaluated)`)
    }
  }
  return outcome
}

/** Warnings that still need a person's acknowledgement at this level. */
export function unacknowledgedWarnings(outcome: ValidationOutcome, acknowledged: string[]): ValidationFinding[] {
  const done = new Set(acknowledged)
  return outcome.warnings.filter((warning) => !done.has(warning.ruleCode))
}

/** Bind and issue require warnings to be acknowledged; screens and rating only show them. */
export function levelRequiresAcknowledgement(level: ValidationLevel): boolean {
  return level === 'bind' || level === 'issue'
}
