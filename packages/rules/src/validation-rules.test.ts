import { describe, expect, it } from 'vitest'
import { evaluateExpression } from './expression.js'
import {
  evaluateValidationRules,
  normalizeValidationTransaction,
  ruleAppliesTo,
  splitFieldPath,
  unacknowledgedWarnings,
  validationRuleProblems,
  type ValidationRule,
} from './validation-rules.js'

function rule(overrides: Partial<ValidationRule> = {}): ValidationRule {
  return {
    ruleCode: 'R1',
    name: 'Rule',
    kind: 'required',
    fieldPath: 'applicant.email',
    levels: ['bind'],
    transactionTypes: ['common'],
    severity: 'error',
    message: 'Email is required',
    ...overrides,
  }
}

const payload = {
  productCode: 'homeowners',
  state: 'TX',
  effectiveDate: '2026-11-01',
  applicant: { name: 'Pat Doe', email: '' },
  risks: [{ vin: '1HGCM82633A004352' }, { vin: '' }],
  coverages: [{ code: 'DWELL', limit: 300000 }],
}
const nb = { level: 'bind' as const, transactionType: 'new_business' as const, productCode: 'homeowners', stateCode: 'TX', asOf: '2026-11-01' }

describe('validation rules', () => {
  it('reports a blank required field as an error at the configured level', () => {
    const outcome = evaluateValidationRules([rule()], payload, nb)
    expect(outcome.errors).toEqual([
      { ruleCode: 'R1', severity: 'error', message: 'Email is required', fieldPath: 'applicant.email', screen: null },
    ])
    expect(outcome.warnings).toEqual([])
  })

  it('checks every item of a list with [*]', () => {
    const outcome = evaluateValidationRules([rule({ fieldPath: 'risks[*].vin', message: 'VIN required' })], payload, nb)
    expect(outcome.errors.map((finding) => finding.fieldPath)).toEqual(['risks.1.vin'])
  })

  it('applies Common to every transaction and specific types only to themselves', () => {
    const common = rule({ levels: ['issue'] })
    const cancelOnly = rule({ ruleCode: 'R2', levels: ['issue'], transactionTypes: ['cancellation'] })
    for (const transactionType of ['new_business', 'endorsement', 'cancellation', 'renewal'] as const)
      expect(ruleAppliesTo(common, { ...nb, level: 'issue', transactionType })).toBe(true)
    expect(ruleAppliesTo(cancelOnly, { ...nb, level: 'issue', transactionType: 'endorsement' })).toBe(false)
    expect(ruleAppliesTo(cancelOnly, { ...nb, level: 'issue', transactionType: 'cancellation' })).toBe(true)
  })

  it('scopes by level, product, state, effective window and active flag', () => {
    expect(ruleAppliesTo(rule(), { ...nb, level: 'rate' })).toBe(false)
    expect(ruleAppliesTo(rule({ productCode: 'cyber' }), nb)).toBe(false)
    expect(ruleAppliesTo(rule({ stateCode: 'tx' }), nb)).toBe(true)
    expect(ruleAppliesTo(rule({ stateCode: 'FL' }), nb)).toBe(false)
    expect(ruleAppliesTo(rule({ effectiveDate: '2026-12-01' }), nb)).toBe(false)
    expect(ruleAppliesTo(rule({ expirationDate: '2026-10-31' }), nb)).toBe(false)
    expect(ruleAppliesTo(rule({ active: false }), nb)).toBe(false)
  })

  it('evaluates condition rules with transaction facts and appliesWhen', () => {
    const backdated = rule({
      ruleCode: 'BACKDATE',
      kind: 'condition',
      fieldPath: 'transaction.effectiveDate',
      condition: "daysBetween(transaction.effectiveDate, today()) <= 30",
      severity: 'warning',
      message: 'Cancellation is backdated more than 30 days',
      levels: ['issue'],
      transactionTypes: ['cancellation'],
    })
    const reason = rule({
      ruleCode: 'REASON',
      kind: 'required',
      fieldPath: 'transaction.reasonCode',
      appliesWhen: "transaction.method == 'insured_request'",
      levels: ['issue'],
      transactionTypes: ['cancellation'],
      message: 'Reason required',
    })
    const target = { ...nb, level: 'issue' as const, transactionType: 'cancellation' as const, asOf: '2026-12-15' }
    const outcome = evaluateValidationRules([backdated, reason], payload, target, {
      transaction: { effectiveDate: '2026-11-01', method: 'insured_request' },
    })
    expect(outcome.warnings.map((finding) => finding.ruleCode)).toEqual(['BACKDATE'])
    expect(outcome.errors.map((finding) => finding.ruleCode)).toEqual(['REASON'])
    const skipped = evaluateValidationRules([reason], payload, target, { transaction: { method: 'nonpayment' } })
    expect(skipped.errors).toEqual([])
  })

  it('reads coverages, risks and the rated premium in conditions', () => {
    const outcome = evaluateValidationRules(
      [
        rule({ ruleCode: 'LIMIT', kind: 'condition', condition: 'coverages.DWELL.limit >= 100000', message: 'Low limit' }),
        rule({ ruleCode: 'PREMIUM', kind: 'condition', condition: 'premium.total < 5000', severity: 'warning', message: 'High premium' }),
        rule({ ruleCode: 'COUNT', kind: 'condition', condition: 'count(risks) <= 1', message: 'One risk only' }),
      ],
      payload,
      nb,
      { premium: { total: 7200 } },
    )
    expect(outcome.errors.map((finding) => finding.ruleCode)).toEqual(['COUNT'])
    expect(outcome.warnings.map((finding) => finding.ruleCode)).toEqual(['PREMIUM'])
  })

  it('reports a rule that cannot be evaluated instead of passing it', () => {
    const outcome = evaluateValidationRules([rule({ kind: 'condition', condition: 'risk.(' })], payload, nb)
    expect(outcome.errors[0].message).toMatch(/could not be evaluated/)
  })

  it('tracks which warnings still need acknowledgement', () => {
    const outcome = evaluateValidationRules(
      [rule({ severity: 'warning' }), rule({ ruleCode: 'R2', fieldPath: 'risks[*].vin', severity: 'warning' })],
      payload,
      nb,
    )
    expect(unacknowledgedWarnings(outcome, ['R1']).map((finding) => finding.ruleCode)).toEqual(['R2'])
  })

  it('validates rule definitions for administrators', () => {
    expect(validationRuleProblems(rule())).toEqual([])
    expect(validationRuleProblems(rule({ fieldPath: 'risks[x' }))).toContain(
      'Enter a valid field path, for example applicant.email or risks[*].vin',
    )
    expect(validationRuleProblems(rule({ kind: 'condition', condition: 'a ==' })).join()).toMatch(/Condition:/)
    expect(validationRuleProblems(rule({ levels: ['screen'] }))).toContain('Choose the screen a screen-level rule is shown on')
    expect(validationRuleProblems(rule({ transactionTypes: ['common', 'renewal'] }))).toContain(
      'Common already covers every transaction',
    )
    expect(validationRuleProblems(rule({ fieldPath: '__proto__.x' })).length).toBeGreaterThan(0)
  })

  it('normalizes wizard modes and API transaction names', () => {
    expect(normalizeValidationTransaction('quote')).toBe('new_business')
    expect(normalizeValidationTransaction('endorse')).toBe('endorsement')
    expect(normalizeValidationTransaction('non-renew')).toBe('non_renewal')
    expect(normalizeValidationTransaction('REINSTATE')).toBe('reinstatement')
  })

  it('splits bracket and dotted paths', () => {
    expect(splitFieldPath('risks[0].vin')).toEqual(['risks', '0', 'vin'])
    expect(splitFieldPath('risks[*].vin')).toEqual(['risks', '*', 'vin'])
    expect(splitFieldPath('a..b')).toEqual(['a', 'b'])
    expect(splitFieldPath('a.b-c')).toBeNull()
  })

  it('adds date functions to the expression language', () => {
    expect(evaluateExpression('daysBetween("2026-01-01", "2026-01-31")', {})).toBe(30)
    expect(evaluateExpression('today()', { $today: '2026-05-04' })).toBe('2026-05-04')
    expect(evaluateExpression('daysBetween("x", "2026-01-31")', {})).toBeNull()
  })
})
