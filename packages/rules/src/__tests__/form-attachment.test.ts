import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFormAttachmentContext, evaluateFormTriggers, FormAttachmentContextError, pinnedFormTriggerRules, validateFormTriggerDefinition } from '../index.js'
import { evaluateExpression } from '../expression.js'

const context = () => buildFormAttachmentContext({
  productCode: 'commercial-auto', state: 'TX', effectiveDate: '2026-10-01', transactionType: 'endorse',
  payload: {
    termMonths: 12, applicant: { name: 'Synthetic Business', corporation: 'true' },
    insureds: [{ name: 'Synthetic Insured' }], additionalInterests: [{ type: 'Mortgagee', loanNumber: '001' }],
    risks: [{ vin: 'TEST-1', value: '100', customFields: { elevated: true } }, { vin: 'TEST-2', value: 200 }],
    customFields: { foo: 'carrier-defined', threshold: '42', enabled: false },
    mailingAddress: { zip: '00001' }, qualificationAnswers: { eligible: true },
    uwAnswers: { reviewed: true }, coverages: [{ code: 'liab', limit: '100000' }, { code: 'COLL', selected: 'false' }],
  },
  transaction: { type: 'endorse', stage: 'Issue', effectiveDate: '2026-09-01', reasonCode: 'ADD_VEHICLE' },
  policy: { status: 'Issued', policyNumber: 'TEST-01', termEffectiveDate: '2026-01-01' },
  premium: { total: '1200.50', fees: 25 }, attributes: { fleet: true }, uw: { referral: false },
})

function holds(expression: string, value = context()): boolean {
  return evaluateFormTriggers([{ triggerId: 'test', triggerType: 'Expression', conditionExpression: expression }], value).attach
}

afterEach(() => vi.useRealTimers())

describe('form attachment context', () => {
  it('normalizes flat and nested policy term aliases identically', () => {
    for (const policy of [
      { termEffectiveDate: '2026-01-01', termExpirationDate: '2027-01-01' },
      { term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' } },
    ]) {
      expect(holds("policy.termEffectiveDate == policy.term.effectiveDate && policy.termExpirationDate == policy.term.expirationDate && policy.termEffectiveDate == '2026-01-01'", buildFormAttachmentContext({ policy }))).toBe(true)
    }
  })
  it('retains business transaction fields when authoritative lifecycle facts are supplied', () => {
    const value = buildFormAttachmentContext({
      payload: { transaction: { reasonCode: 'CHANGE_ROOF', type: 'cancel' }, policy: { carrierClass: 'preferred', status: 'Quote' } },
      transaction: { type: 'Endorse', stage: 'Issue' }, policy: { status: 'Issued' },
    })
    expect(holds("transaction.reasonCode == 'CHANGE_ROOF' && transaction.type == 'endorsement' && policy.status == 'Issued' && policy.carrierClass == 'preferred'", value)).toBe(true)
  })
  it.each(['Bind', 'Issue'] as const)('derives identical business aliases for %s without browser-only facts', (stage) => {
    const value = buildFormAttachmentContext({
      payload: { risks: [{ roofAgeYears: 25 }], uwAnswers: { approved: true }, agencyCommissionPct: '12.5' },
      transaction: { type: 'NB', stage }, uw: { decision: 'Accept' },
    })
    expect(holds('attributes.roofAgeYears >= 20 && attributes.agencyCommissionPct == 12.5 && uw.approved && uw.isBound', value)).toBe(true)
    expect(holds("uw.decision == 'Accept'", value)).toBe(true)
    expect(holds('uw.isIssued', value)).toBe(stage === 'Issue')
  })
  it('preserves named insured objects used by policy payloads', () => {
    const value = buildFormAttachmentContext({ payload: { insureds: { primary: { name: 'Synthetic Carrier Insured' } } } })
    expect(holds("insureds.primary.name == payload.insureds.primary.name && insureds.primary.name == 'Synthetic Carrier Insured'", value)).toBe(true)
  })
  it('provides shared validation aliases and the complete safe business snapshot', () => {
    const value = context()
    expect(holds("quote.productCode == 'commercial-auto' && quote.state == 'TX'", value)).toBe(true)
    expect(holds("risk.vin == risks.0.vin && count(risks) == 2 && sum(risks, 'value') == 300", value)).toBe(true)
    expect(holds("applicant.name == payload.applicant.name && count(insureds) == 1", value)).toBe(true)
    expect(holds("additionalInterests.0.loanNumber == '001' && mailingAddress.zip == '00001'", value)).toBe(true)
    expect(holds('qualificationAnswers.eligible && uwAnswers.reviewed && attributes.fleet && !uw.referral', value)).toBe(true)
    expect(holds("policy.status == 'Issued' && transaction.reasonCode == 'ADD_VEHICLE' && premium.total == 1200.5", value)).toBe(true)
    expect(holds("quote.customFields.foo == payload.customFields.foo && payload.customFields.foo == 'carrier-defined'", value)).toBe(true)
    expect(holds('risk.customFields.elevated && customFields.threshold == 42', value)).toBe(true)
  })

  it('keeps stage for new business only, so an Issue-stage rule never fires on servicing transactions', () => {
    const value = context()
    expect(value.transaction).toMatchObject({ type: 'endorsement' })
    expect(value.transaction).not.toHaveProperty('stage')
    expect(value.transactionType).toBe('endorsement')
    expect(holds("transaction.stage == 'Issue'", value)).toBe(false)
    expect(holds("transaction.type == 'endorsement' && !isSet(transaction.stage)", value)).toBe(true)
    const issue = buildFormAttachmentContext({ transactionType: 'Issue', transaction: { stage: 'Issue' } })
    expect(issue.transaction).toMatchObject({ type: 'new_business', stage: 'Issue' })
    expect(holds("transaction.type == 'new_business' && transaction.stage == 'Issue'", issue)).toBe(true)
  })

  it.each(['Endorse', 'Cancel', 'Reinstate', 'Renew', 'Rewrite'])('does not treat %s as issuance of a new policy', (type) => {
    const value = buildFormAttachmentContext({ transactionType: type, transaction: { stage: 'Issue' }, policy: { status: 'Issued' } })
    expect(holds("transaction.stage == 'Issue'", value)).toBe(false)
    expect(value.uw).toMatchObject({ isBound: true, isIssued: true })
  })

  it('reads issued-ness from the status before a cancellation', () => {
    const neverIssued = buildFormAttachmentContext({ transactionType: 'Cancel', policy: { status: 'Cancelled', priorStatus: 'Bound' } })
    expect(neverIssued.uw).toMatchObject({ isBound: true, isIssued: false })
    const issued = buildFormAttachmentContext({ transactionType: 'Cancel', policy: { status: 'Cancelled', priorStatus: 'Issued' } })
    expect(issued.uw).toMatchObject({ isBound: true, isIssued: true })
  })

  it('ignores priorStatus outside cancellation and from stored payload', () => {
    const endorse = buildFormAttachmentContext({ transactionType: 'Endorse', policy: { status: 'Issued', priorStatus: 'Bound' } })
    expect(endorse.uw).toMatchObject({ isIssued: true })
    const stale = buildFormAttachmentContext({ transactionType: 'Cancel', payload: { policy: { priorStatus: 'Bound' } }, policy: { status: 'Cancelled' } })
    expect(stale.uw).toMatchObject({ isIssued: true })
  })

  it('rejects unrecognized transaction types instead of treating them as new business', () => {
    expect(() => buildFormAttachmentContext({ transactionType: 'Audit' })).toThrow(FormAttachmentContextError)
    expect(() => buildFormAttachmentContext({ transaction: { type: 'mystery' } })).toThrow('Form attachment context is invalid')
    expect(buildFormAttachmentContext({}).transactionType).toBe('new_business')
    expect(buildFormAttachmentContext({ transactionType: ' ' }).transactionType).toBe('new_business')
  })

  it.each([
    ['quote', 'new_business'], ['endorse', 'endorsement'], ['cancel', 'cancellation'],
    ['reinstate', 'reinstatement'], ['renew', 'renewal'], ['rewrite', 'rewrite'], ['non-renew', 'non_renewal'], ['NonRenewal', 'non_renewal'],
  ])('normalizes business transaction %s', (type, expected) => {
    expect(buildFormAttachmentContext({ transactionType: type }).transactionType).toBe(expected)
  })

  it('uses payload transaction/policy/premium/attributes/uw fallbacks', () => {
    const value = buildFormAttachmentContext({ payload: {
      transaction: { type: 'cancel', stage: 'issue' }, policy: { status: 'Active' },
      totalPremium: '99', attributes: { a: true }, uwAnswers: { b: true },
    } })
    expect(value.transaction).toEqual({ type: 'cancellation' })
    expect(value.policy).toMatchObject({ status: 'Active' })
    expect(value.premium).toMatchObject({ total: 99 })
    expect(value.attributes).toMatchObject({ a: true })
    expect(value.uw).toMatchObject({ b: true, isBound: true, isIssued: true })
  })

  it('accepts arbitrary tenant business fields beneath payload and quote, not arbitrary root globals', () => {
    const value = buildFormAttachmentContext({ payload: { tenantExtension: { schedules: [{ units: 7 }] }, customFields: { neverInCatalog: 'yes' } } })
    expect(holds('payload.tenantExtension.schedules.0.units == 7', value)).toBe(true)
    expect(holds("payload.customFields.neverInCatalog == 'yes'", value)).toBe(true)
    expect(() => holds('tenantExtension.schedules.0.units == 7', value)).toThrow()
    expect(value.tenantExtension).toBeUndefined()
  })

  it('explicit context metadata overrides payload metadata without mutating input', () => {
    const payload = Object.freeze({ productCode: 'old', state: 'FL', effectiveDate: '2020-01-01' })
    const value = buildFormAttachmentContext({ payload, productCode: 'new', state: 'TX', effectiveDate: '2026-10-01' })
    expect(value.quote).toMatchObject({ productCode: 'new', state: 'TX', effectiveDate: '2026-10-01' })
    expect(payload.state).toBe('FL')
  })

  it('pins today to effectiveDate and otherwise to the current UTC date', () => {
    vi.useFakeTimers().setSystemTime(new Date('2030-03-04T23:00:00Z'))
    expect(holds("today() == '2026-10-01' && daysBetween(transaction.effectiveDate, today()) == 30")).toBe(true)
    const value = buildFormAttachmentContext({})
    expect(holds("today() == '2030-03-04'", value)).toBe(true)
    expect(holds("today() == '2026-11-01'", buildFormAttachmentContext({ transaction: { effectiveDate: '2026-11-01' } }))).toBe(true)
  })

  it.each([undefined, null, 'not an object', 12, false])('handles missing/non-object payload %s', (payload) => {
    const value = buildFormAttachmentContext({ payload })
    expect(value.payload).toEqual({})
    expect(holds('isEmpty(payload.missing) && count(risks) == 0 && count(insureds) == 0', value)).toBe(true)
    expect(holds('premium.total > 0', value)).toBe(false)
  })

  it.each([
    [123, 123], ['123.45', 123.45], [{ total: '14' }, 14], [{ totalPremium: '25' }, 25],
    [{ total: { amount: '1200.50', currency: 'USD' } }, 1200.5],
    [{ total: { amount: 0, currency: 'USD' } }, 0],
    [{ total: 0 }, 0], [{ total: '' }, null], ['invalid', null], [true, null],
  ])('normalizes premium %j', (premium, total) => {
    expect(buildFormAttachmentContext({ premium }).premium).toMatchObject({ total })
  })

  it('normalizes native Money totals while preserving currency, fees and taxes without mutation', () => {
    const premium = Object.freeze({
      total: Object.freeze({ amount: '1200.50', currency: 'USD' }),
      fees: Object.freeze([{ code: 'POLICY', amount: 20 }]),
      taxes: Object.freeze({ amount: 80, currency: 'USD' }),
    })
    const value = buildFormAttachmentContext({ premium })
    expect(value.premium).toEqual({ total: 1200.5, currency: 'USD', fees: [{ code: 'POLICY', amount: 20 }], taxes: { amount: 80, currency: 'USD' } })
    expect(holds("premium.total > 1200 && premium.currency == 'USD' && sum(premium.fees, 'amount') == 20 && premium.taxes.amount == 80", value)).toBe(true)
    expect(premium.total).toEqual({ amount: '1200.50', currency: 'USD' })
    expect(buildFormAttachmentContext({ payload: { premium } }).premium).toEqual(value.premium)
  })

  it('returns deeply independent snapshots and does not mutate payload, extras or evaluation context', () => {
    const input = { payload: { risks: [{ value: 1 }], customFields: { x: 1 } }, transaction: { type: 'renew', stage: 'rate' }, premium: { total: '10' } }
    const original = structuredClone(input)
    const value = buildFormAttachmentContext(input)
    expect(input).toEqual(original)
    input.payload.risks[0].value = 9
    expect(evaluateExpression('risk.value', value)).toBe(1)
    // Built contexts are frozen, so evaluation can trust them without another copy.
    expect(() => { (value.payload as any).customFields.x = 2 }).toThrow(TypeError)
    expect(() => Object.defineProperty(value, 'payload', { get: () => ({}) })).toThrow(TypeError)
    expect(input.payload.customFields.x).toBe(1)
    const before = structuredClone(value)
    expect(holds('premium.total == 10', value)).toBe(true)
    expect(value).toEqual(before)
  })

  it('only reads own enumerable data properties, including null-prototype objects', () => {
    const payload = Object.create({ inheritedBusiness: 'never' })
    payload.customFields = Object.assign(Object.create(null), { foo: 1 })
    Object.defineProperty(payload, 'hidden', { value: 'never' })
    const value = buildFormAttachmentContext({ payload })
    expect(value.payload).toEqual({ customFields: { foo: 1 } })
    expect(Object.getPrototypeOf(value)).toBeNull()
    expect(Object.getPrototypeOf(value.payload)).toBeNull()
    expect(holds('payload.customFields.foo == 1', value)).toBe(true)
  })

  it('does not invoke poisoned accessors, even through shared aliases', () => {
    const get = vi.fn(() => { throw new Error('PRIVATE VALUE') })
    const payload = Object.defineProperty({}, 'risks', { get, enumerable: true })
    expect(() => buildFormAttachmentContext({ payload })).toThrow('Form attachment context is invalid')
    expect(get).not.toHaveBeenCalled()
    const forbiddenGetter = Object.defineProperty({}, 'password', { get, enumerable: true })
    expect(buildFormAttachmentContext({ payload: forbiddenGetter }).payload).toEqual({})
    expect(get).not.toHaveBeenCalled()
  })

  it.each([
    '__proto__', 'constructor', 'prototype', 'password', 'passwordHash', 'access_token', 'refreshToken',
    'apiKey', 'clientSecret', 'credentials', 'authorization', 'auth', 'cookie', 'session',
    'private_key', 'connectionString', 'process', 'globalThis', 'ssn', 'authInfo', 'auth_config', 'accessKeyId', 'database',
  ])('strips unsafe key %s at every depth, including arrays and custom fields', (key) => {
    const poison = JSON.parse(`{"${key}":"PRIVATE VALUE","safe":true}`)
    const value = buildFormAttachmentContext({
      payload: { customFields: poison, risks: [poison], additionalInterests: [poison] },
      policy: poison, transaction: poison, attributes: poison, uw: poison,
    })
    expect(evaluateExpression('payload.customFields.safe', value)).toBe(true)
    expect(JSON.stringify(value)).not.toContain('PRIVATE VALUE')
    expect(({} as any).safe).toBeUndefined()
  })

  it('ignores inherited numeric array slots and inherited object properties', () => {
    const list = new Array(1)
    Object.setPrototypeOf(list, { 0: { value: 'PRIVATE VALUE' } })
    const value = buildFormAttachmentContext({ payload: { risks: list } })
    expect(holds('isEmpty(risks.0) && sum(risks, "value") == 0', value)).toBe(true)
    expect(JSON.stringify(value)).not.toContain('PRIVATE VALUE')
  })

  it('never exposes arbitrary extra input roots', () => {
    const value = buildFormAttachmentContext({ payload: { customFields: { x: true } }, database: { host: 'PRIVATE VALUE' } } as any)
    expect(value.database).toBeUndefined()
    expect(JSON.stringify(value)).not.toContain('PRIVATE VALUE')
  })
})

describe('coverage normalization', () => {
  it.each([
    [['liab', 'coll'], ['COLL', 'LIAB']],
    [' liab | coll ', ['COLL', 'LIAB']],
    [[{ code: ' liab ', selected: true, limit: '100' }, { code: 'COLL', selected: false }], ['LIAB']],
    [{ liab: { limit: 100 }, coll: { selected: 'false' }, comp: false }, ['LIAB']],
    [[], []], [undefined, []],
  ])('normalizes coverage selection %j', (coverages, codes) => {
    const value = buildFormAttachmentContext({ coverages })
    expect(value.coverageCodes).toEqual(codes)
    const result = evaluateFormTriggers([{ triggerType: 'Coverage Selected', conditionExpression: 'LIAB, COLL' }], value)
    expect(result.attach).toBe(codes.length > 0)
  })

  it('preserves safe coverage-specific custom fields and typed values', () => {
    const value = buildFormAttachmentContext({ coverages: [{ code: 'LIAB', limit: '100', customFields: { special: true }, password: 'PRIVATE VALUE' }] })
    expect(holds('coverages.LIAB.selected && coverages.LIAB.limit == 100 && coverages.LIAB.customFields.special', value)).toBe(true)
    expect(JSON.stringify(value)).not.toContain('PRIVATE VALUE')
  })

  it('lets explicit selections override payload coverages and deduplicates codes', () => {
    const value = buildFormAttachmentContext({ payload: { coverages: ['OLD'] }, coverages: ['new', 'NEW'] })
    expect(value.coverageCodes).toEqual(['NEW'])
    expect(value.coverages).not.toHaveProperty('OLD')
  })

  it.each(['__proto__', 'constructor', 'AUTH_TOKEN', 'LIAB || true', '', 'a.b'])('rejects unsafe coverage code %j', (code) => {
    expect(() => buildFormAttachmentContext({ coverages: [{ code }] })).toThrow()
  })
})

describe('form trigger definition safety', () => {
  it.each(['Threshold', 'UW Rule', 'Attribute-based', 'Expression'])('uses shared expressions for %s', (triggerType) => {
    expect(() => validateFormTriggerDefinition({ triggerType, conditionExpression: 'premium.total > 100 && payload.customFields.enabled == false' })).not.toThrow()
    expect(evaluateFormTriggers([{ triggerType, conditionExpression: 'premium.total > 100' }], context()).attach).toBe(true)
  })

  it.each([
    '', 'risk.(', 'risk.x = 1', 'new Function("return true")()', 'eval("true")',
    'process.exit()', 'globalThis.process', 'window.location', 'document.cookie',
    'require("fs")', 'fetch("https://example.com")', 'Math.random()', 'payload.x; true',
    '(() => true)()', 'payload["x"]', 'true // comment', 'true /* comment */',
    'payload.constructor.constructor', 'payload.__proto__.x', 'payload.customFields.password',
    'payload.customFields.api_key', 'transaction.auth.user', 'policy.session.id',
    'risk.toString', 'sum(risks, "password")', 'sum(risks, "pass\\word")',
    'unknownBusinessRoot.value', 'payload.customFields.refreshToken', 'lookup("x", 1, "credentials")',
    'count()',
  ])('rejects invalid, secret or executable expression %j', (conditionExpression) => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression })).toThrow()
    expect(() => evaluateFormTriggers([{ triggerType: 'Expression', conditionExpression }], context())).toThrow()
  })

  it('validates suppression even on Always and Coverage Selected definitions', () => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Always', suppressExpression: 'window.location' })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Coverage Selected', conditionExpression: 'LIAB', suppressExpression: 'payload.secret' })).toThrow()
  })

  it.each(['LIAB, COLL | COMP', 'liab', 'A-B_1,123'])('accepts legacy comma/pipe lists %s', (conditionExpression) => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Coverage Selected', conditionExpression })).not.toThrow()
  })

  it.each(['LIAB || true', 'contains(coverageCodes, "LIAB")', '["LIAB"]', 'LIAB,', '|LIAB', '', 'A B', 'constructor'])('rejects expressions/non-lists in Coverage Selected: %s', (conditionExpression) => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Coverage Selected', conditionExpression })).toThrow()
  })

  it('rejects unknown types and absent required conditions', () => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Unrecognized', conditionExpression: 'true' })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Expression' })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Coverage Selected' })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Always', conditionExpression: 'bad(' })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Always' })).not.toThrow()
  })

  it('permits business string values that would be forbidden as field names', () => {
    const value = buildFormAttachmentContext({ payload: { customFields: { reason: 'authorization', label: 'token', note: 'constructor' } } })
    expect(holds("payload.customFields.reason == 'authorization' && payload.customFields.label == 'token' && payload.customFields.note == 'constructor'", value)).toBe(true)
    expect(holds("contains(['password', 'safe'], 'password')", value)).toBe(true)
  })

  it.each([
    "sum(risks, ('password'))", "sum(risks, lower('PASSWORD'))",
    "lookup('t', 1, lower('CONSTRUCTOR'))", "lookup('credentials', 1, 'value')",
  ])('denies secret/prototype string selectors inside nested calls: %s', (conditionExpression) => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression })).toThrow()
  })
})

describe('form trigger evaluation', () => {
  it('attaches for no rows or only inactive rows for compatibility', () => {
    expect(evaluateFormTriggers([], context())).toMatchObject({ attach: true, matchedRuleIds: [] })
    expect(evaluateFormTriggers([{ active: false, triggerType: 'Expression', conditionExpression: 'broken(' }], context())).toMatchObject({ attach: true, matchedRuleIds: [] })
  })

  it.each([
    ['true', true], ['false', false], ['1', true], ['0', false], ['null', false],
    ["'false'", false], ["''", false], ['payload.customFields.enabled', false],
    ['isSet(payload.missing)', false], ['isEmpty(payload.missing)', true],
    ['payload.missing == null', true], ['payload.missing > 3', false],
    ['applicant.corporation == true', true], ['customFields.threshold == 42', true],
    ['1 / 0 > 0', false], ['number("not a number") == null', true],
    ['contains(coverageCodes, "LIAB")', true], ['count(risks) == 2 && sum(risks, "value") >= 300', true],
  ])('uses shared data/truthiness semantics for %s', (expression, attach) => {
    expect(holds(expression)).toBe(attach)
  })

  it('checks suppression after an earlier Always match regardless of priority', () => {
    const rows = [
      { triggerId: 'always', triggerType: 'Always', priority: -100 },
      { triggerId: 'suppress', triggerType: 'Expression', conditionExpression: 'false', suppressExpression: 'attributes.fleet', priority: 100 },
    ]
    expect(evaluateFormTriggers(rows, context())).toEqual({ attach: false, reason: 'Suppression rule matched', matchedRuleIds: ['suppress'] })
    expect(evaluateFormTriggers([...rows].reverse(), context()).attach).toBe(false)
  })

  it('returns all matching suppression IDs in deterministic priority/ID order', () => {
    const rows = [
      { trigger_id: 'z', trigger_type: 'Always', suppress_expression: 'true', priority: 5 },
      { triggerId: 'b', triggerType: 'Always', suppressExpression: 'true', priority: 1 },
      { triggerId: 'a', triggerType: 'Always', suppressExpression: 'true', priority: 1 },
      { triggerId: 'ignored', triggerType: 'Always', suppressExpression: 'false' },
    ]
    expect(evaluateFormTriggers(rows, context()).matchedRuleIds).toEqual(['a', 'b', 'z'])
    expect(evaluateFormTriggers([...rows].reverse(), context()).matchedRuleIds).toEqual(['a', 'b', 'z'])
  })

  it('returns all positive matches in priority/lexical ID order, supports aliases and deduplicates IDs', () => {
    const rows = [
      { trigger_id: 2, trigger_type: 'Always', priority: 2 },
      { triggerId: 'z', triggerType: 'Expression', conditionExpression: 'true', priority: 0 },
      { triggerId: 'a', triggerType: 'Coverage Selected', conditionExpression: 'liab', priority: 0 },
      { triggerId: 'absent', triggerType: 'Expression', conditionExpression: 'false' },
      { triggerId: 'a', triggerType: 'Always', priority: 10 },
    ]
    const original = structuredClone(rows)
    expect(evaluateFormTriggers(rows, context())).toEqual({ attach: true, reason: 'Trigger rule matched', matchedRuleIds: ['a', 'z', '2'] })
    expect(rows).toEqual(original)
    expect(evaluateFormTriggers([...rows].reverse(), context()).matchedRuleIds).toEqual(['a', 'z', '2'])
  })

  it('a matching rule without an ID still attaches/suppresses', () => {
    expect(evaluateFormTriggers([{ triggerType: 'Always' }], {}).attach).toBe(true)
    expect(evaluateFormTriggers([{ triggerType: 'Always', suppressExpression: 'true' }], {})).toMatchObject({ attach: false, matchedRuleIds: [] })
  })

  it('does not suppress or match inactive rules', () => {
    expect(evaluateFormTriggers([
      { triggerType: 'Always', active: false, suppressExpression: 'true' },
      { triggerType: 'Expression', conditionExpression: 'false' },
    ], context())).toEqual({ attach: false, reason: 'No trigger rule matched', matchedRuleIds: [] })
  })

  it('validates every active definition before any match can short-circuit', () => {
    for (const row of [
      { triggerType: 'Expression', conditionExpression: 'invalid(' },
      { triggerType: 'Always', suppressExpression: 'invalid(' },
    ]) {
      expect(() => evaluateFormTriggers([{ triggerType: 'Always' }, row], context())).toThrow()
      expect(() => evaluateFormTriggers([{ triggerType: 'Always', suppressExpression: 'true' }, row], context())).toThrow()
    }
  })

  it('sanitizes caller-created contexts and reports evaluation errors without leaking data', () => {
    const get = vi.fn(() => { throw new Error('PRIVATE VALUE') })
    const value = Object.defineProperty({}, 'payload', { get, enumerable: true })
    expect(() => evaluateFormTriggers([{ triggerType: 'Always' }], value)).toThrow('Form attachment context is invalid')
    expect(get).not.toHaveBeenCalled()
    const rule = { triggerType: 'Expression', conditionExpression: "lookup('t', 1, 'value')" }
    // A malformed table key cannot be coerced from a data-only object into a property name.
    expect(() => evaluateFormTriggers([rule], { $tables: { t: { key: {}, rows: [{ id: 1 }] } } })).toThrow('Form trigger evaluation failed')
  })

  it('checks every suppression, including later evaluation failures', () => {
    expect(() => evaluateFormTriggers([
      { triggerType: 'Always', suppressExpression: 'true' },
      { triggerType: 'Always', suppressExpression: "lookup('t', 1, 'value')" },
    ], { $tables: { t: { key: {}, rows: [{ id: 1 }] } } })).toThrow()
  })

  it('does not hide later positive evaluation errors behind an Always match', () => {
    expect(() => evaluateFormTriggers([
      { triggerType: 'Always', priority: -1 },
      { triggerType: 'Expression', conditionExpression: "lookup('t', 1, 'value')" },
    ], { $tables: { t: { key: {}, rows: [{ id: 1 }] } } })).toThrow('Form trigger evaluation failed')
  })

  it('finishes suppression before evaluating any positive condition', () => {
    expect(evaluateFormTriggers([
      { triggerType: 'Expression', conditionExpression: "lookup('t', 1, 'value')", priority: -1 },
      { triggerId: 's', triggerType: 'Always', suppressExpression: 'true' },
    ], { $tables: { t: { key: {}, rows: [{ id: 1 }] } } })).toEqual({ attach: false, reason: 'Suppression rule matched', matchedRuleIds: ['s'] })
  })

  it('never includes payload or expression values in errors/reasons', () => {
    const value = buildFormAttachmentContext({ payload: { customFields: { marker: 'PRIVATE VALUE' } } })
    expect(evaluateFormTriggers([{ triggerType: 'Always' }], value).reason).not.toContain('PRIVATE VALUE')
    try {
      validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression: "invalid('PRIVATE VALUE')" })
      expect.unreachable()
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE VALUE')
    }
  })

  it('ignores extra persisted columns including native Dates without reading unrelated accessors', () => {
    const get = vi.fn(() => { throw new Error('PRIVATE VALUE') })
    const row = Object.defineProperty({
      trigger_id: 'database-rule', trigger_type: 'Always',
      created_at: new Date('2026-10-18T00:00:00Z'), updated_at: new Date('2026-10-18T00:00:00Z'),
      metadata: { database: { password: 'PRIVATE VALUE' } },
    }, 'unrelated', { get, enumerable: true })
    expect(evaluateFormTriggers([row], {})).toEqual({ attach: true, reason: 'Trigger rule matched', matchedRuleIds: ['database-rule'] })
    expect(get).not.toHaveBeenCalled()
    expect(row.created_at).toBeInstanceOf(Date)
  })

  it('does not invoke accessors on trigger fields or array slots', () => {
    const get = vi.fn(() => 'Always')
    const row = Object.defineProperty({}, 'triggerType', { get, enumerable: true })
    expect(() => evaluateFormTriggers([row], {})).toThrow('Invalid form trigger row')
    const rows = Object.defineProperty(new Array(1), '0', { get, enumerable: true })
    expect(() => evaluateFormTriggers(rows, {})).toThrow('Invalid form trigger row')
    expect(get).not.toHaveBeenCalled()
  })
})

describe('form attachment resource bounds', () => {
  it('bounds trigger rows even when inactive', () => {
    expect(evaluateFormTriggers(Array.from({ length: 1000 }, () => ({ active: false })), {}).attach).toBe(true)
    expect(() => evaluateFormTriggers(Array.from({ length: 1001 }, () => ({ active: false })), {})).toThrow()
  })

  it.each(['conditionExpression', 'suppressExpression'] as const)('bounds %s even for Always whitespace', (field) => {
    expect(() => validateFormTriggerDefinition({ triggerType: 'Always', [field]: ' '.repeat(1001) })).toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression: 'true' + ' '.repeat(996) })).not.toThrow()
    expect(() => validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression: 'true' + ' '.repeat(997) })).toThrow()
  })

  it('rejects deeply nested parser inputs', () => {
    expect(() => holds('('.repeat(50) + 'true' + ')'.repeat(50))).toThrow()
  })

  it('bounds context depth without silent truncation', () => {
    let payload: any = { value: true }
    for (let i = 0; i < 70; i += 1) payload = { child: payload }
    expect(() => buildFormAttachmentContext({ payload })).toThrow(new FormAttachmentContextError('limits'))
  })

  it('bounds list and object property counts', () => {
    expect(() => buildFormAttachmentContext({ payload: { list: Array(100001).fill(1) } })).toThrow(new FormAttachmentContextError('limits'))
    expect(() => buildFormAttachmentContext({ payload: Object.fromEntries(Array.from({ length: 100001 }, (_, i) => [`field${i}`, i])) })).toThrow(new FormAttachmentContextError('limits'))
    expect(() => buildFormAttachmentContext({ payload: { list: Array(100000).fill(1) } })).not.toThrow()
  })

  it('fails fast on a request body of millions of tiny values', () => {
    const started = Date.now()
    expect(() => buildFormAttachmentContext({ payload: { rows: Array.from({ length: 100 }, () => Array.from({ length: 20000 }, () => ({}))) } }))
      .toThrow(new FormAttachmentContextError('limits'))
    expect(() => buildFormAttachmentContext({ payload: { rows: Array.from({ length: 50 }, () => Array(25000).fill(1)) } }))
      .toThrow(new FormAttachmentContextError('limits'))
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('copies a doubling structure in linear time, keeping its sharing', () => {
    let node: any = { leaf: true }
    for (let i = 0; i < 40; i += 1) node = { a: node, b: node }
    const value = buildFormAttachmentContext({ payload: { node } })
    const copied = (value.payload as any).node
    expect(copied.a).toBe(copied.b)
    expect(holds('isSet(payload.node.a.b.a.b.a)', value)).toBe(true)
  })

  it('copies a repeated non-cyclic reference once and keeps it shared', () => {
    const repeated = { units: 7 }
    const value = buildFormAttachmentContext({ payload: { rows: Array(100000).fill(repeated) } })
    const rows = (value.payload as any).rows
    expect(rows[0]).toBe(rows[99999])
    expect(rows[0]).not.toBe(repeated)
    expect(holds('payload.rows.99999.units == 7', value)).toBe(true)
  })

  it('evaluates a large commercial schedule without hitting the safety limits', () => {
    const location = (i: number) => Object.fromEntries([['id', `LOC-${i}`], ['tiv', 1000000 + i], ...Array.from({ length: 30 }, (_, f) => [`field${f}`, `value-${i}-${f}`])])
    const vehicles = Array.from({ length: 2000 }, (_, i) => ({ vin: `VIN${i}`, year: 2020, garageState: 'TX' }))
    const value = buildFormAttachmentContext({ transactionType: 'NB', payload: { locations: Array.from({ length: 5000 }, (_, i) => location(i)), vehicles, risks: [{ construction: 'Frame' }] } })
    expect(evaluateFormTriggers([{ triggerType: 'Expression', conditionExpression: "payload.locations.4999.tiv > 1000000 && payload.vehicles.1999.garageState == 'TX'" }], value).attach).toBe(true)
  })

  it('bounds individual strings and cumulative text', () => {
    expect(() => buildFormAttachmentContext({ payload: { text: 'x'.repeat(1000001) } })).toThrow(new FormAttachmentContextError('limits'))
    expect(() => buildFormAttachmentContext({ payload: { rows: Array(60).fill('x'.repeat(900000)) } })).toThrow(new FormAttachmentContextError('limits'))
    expect(() => buildFormAttachmentContext({ payload: { text: 'x'.repeat(1000000) } })).not.toThrow()
  })

  it('pins only the rule definition, not catalog audit columns', () => {
    expect(pinnedFormTriggerRules([{ trigger_id: 'r1', trigger_type: 'Expression', condition_expression: 'true', suppress_expression: null, priority: 5, active: true, created_by: 'user-1', updated_at: '2026-10-19' }]))
      .toEqual([{ triggerId: 'r1', triggerType: 'Expression', conditionExpression: 'true', suppressExpression: null, priority: 5, active: true }])
    expect(pinnedFormTriggerRules(null)).toEqual([])
  })

  it('rejects cycles, functions, symbols, bigint and nonfinite numeric values', () => {
    const cycle: any = {}
    cycle.self = cycle
    for (const value of [cycle, () => true, Symbol('private'), BigInt(1), Infinity, NaN, new Date(), new Map(), new Set(), new String('hidden')]) {
      expect(() => buildFormAttachmentContext({ payload: { value } })).toThrow()
    }
  })

  it('rejects malformed runtime rows and flags', () => {
    for (const row of [null, [], { active: 'false' }, { priority: '1' }, { triggerId: {} }, { triggerType: 'Always', conditionExpression: 1 }]) {
      expect(() => evaluateFormTriggers([row] as any, {})).toThrow()
    }
    expect(() => evaluateFormTriggers(null as any, {})).toThrow()
  })
})
