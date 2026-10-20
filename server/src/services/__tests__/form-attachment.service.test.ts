import { describe, expect, it } from 'vitest'
import { evaluateConfiguredFormAttachment, formAttachmentFields, lazyFormAttachmentContext } from '../form-attachment.service.js'
import { selectPolicyForms } from '../document-generation.service.js'

const enabled = { attachmentRulesVersion: 1 }
const rule = (condition: string, extra = {}) => ({ trigger_id: 'rule-1', trigger_type: 'Expression', condition_expression: condition, active: true, ...extra })
const input = { productCode: 'homeowners', state: 'CA', effectiveDate: '2026-11-01', transactionType: 'Endorsement', payload: { customFields: { needsNotice: true }, risks: [{ roofAgeYears: 25 }], coverages: [{ code: 'A', selected: true, limit: 450000 }] } }

describe('form attachment integration adapter', () => {
  it('keeps formerly disabled legacy rows inert without explicit opt-in', () => {
    expect(evaluateConfiguredFormAttachment({}, [rule('process.exit()')], input).attach).toBe(true)
    expect(evaluateConfiguredFormAttachment(null, [rule('false')], input).attach).toBe(true)
  })

  it('does not make an explicitly configured form universal after all rules are disabled', () => {
    expect(evaluateConfiguredFormAttachment(enabled, [], input).attach).toBe(false)
    expect(evaluateConfiguredFormAttachment(enabled, [rule('true', { active: false })], input).attach).toBe(false)
  })

  it.each([
    ['payload.customFields.needsNotice == true', true],
    ['risk.roofAgeYears >= 25 && coverages.A.limit >= 400000', true],
    ['transaction.type == "endorsement"', true],
    ['payload.customFields.needsNotice == false', false],
    ['risk.roofAgeYears > 25', false],
    ['isSet(payload.notAvailable)', false],
  ])('evaluates %s against the full transaction snapshot', (condition, attach) => {
    expect(evaluateConfiguredFormAttachment(enabled, [rule(condition)], input).attach).toBe(attach)
  })

  it('pins today to the transaction effective date', () => {
    expect(evaluateConfiguredFormAttachment(enabled, [rule('today() == "2026-11-01"')], input).attach).toBe(true)
  })

  it('checks later suppression rules even after an Always match', () => {
    const result = evaluateConfiguredFormAttachment(enabled, [
      { trigger_id: 'always', trigger_type: 'Always', active: true, priority: 1 },
      rule('true', { suppress_expression: 'payload.customFields.needsNotice == true', priority: 99 }),
    ], input)
    expect(result.attach).toBe(false)
  })

  it.each(['process.exit()', 'payload.__proto__.admin', 'payload.apiKey == "secret-value"', 'payload.password != null', 'risk.age >'])('rejects unsafe or broken stored rule %s without leaking it', condition => {
    try {
      evaluateConfiguredFormAttachment(enabled, [rule(condition)], input)
      throw new Error('Expected invalid rule error')
    } catch (error: any) {
      expect(error.code).toBe('FORM_ATTACHMENT_RULE_INVALID')
      expect(error.message).not.toContain(condition)
      expect(error.message).not.toContain('secret-value')
    }
  })
})

describe('lazy form attachment context', () => {
  it('builds once and reuses the same context', () => {
    const get = lazyFormAttachmentContext(input)
    expect(get()).toBe(get())
    expect(evaluateConfiguredFormAttachment(enabled, [rule('payload.customFields.needsNotice')], get).attach).toBe(true)
  })
})

describe('form attachment field catalog', () => {
  it('includes configured product fields, coverages, transaction, premium and custom paths without live data', () => {
    const catalog = formAttachmentFields('sample-carrier', 'homeowners')
    expect(catalog.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ expressionPath: 'payload.risks.0.roofAgeYears' }),
      expect.objectContaining({ expressionPath: 'coverages.A.selected', type: 'boolean' }),
      expect.objectContaining({ expressionPath: 'premium.total', type: 'number' }),
      expect.objectContaining({ expressionPath: 'payload.customFields' }),
      expect.objectContaining({ expressionPath: 'transaction.stage' }),
    ]))
    expect(new Set(catalog.fields.map(f => f.expressionPath)).size).toBe(catalog.fields.length)
    expect(JSON.stringify(catalog)).not.toContain('Maya Patel')
  })

  it('does not allow arbitrary product paths to reach a filesystem loader', () => {
    expect(() => formAttachmentFields('sample-carrier', '../../../etc/passwd')).not.toThrow()
    expect(formAttachmentFields('sample-carrier', '../../../etc/passwd').fields.some(f => f.group === 'Coverage')).toBe(false)
  })
})

describe('actual policy form selection uses the same condition engine', () => {
  const context = { tenantId: 'sample-carrier', policyId: 'policy-1', policyNumber: 'HO-TEST-001', transactionId: 'tx-1', transactionType: 'Endorse' as const, transactionNumber: 'END-1', productCode: 'homeowners', state: 'CA', effectiveDate: '2026-11-01', versionId: 'version-1', inputSnapshot: input.payload }
  const form = { form_id: '11111111-1111-4111-8111-111111111111', form_number: 'HO-NOTICE', form_title: 'Notice', edition_date: '2026-01-01', transaction_types: ['Endorsement'], endorsement_change_criteria: { alwaysAttachOnEndorsement: true }, visibility: ['internal'], metadata: enabled, attachment_triggers: [rule('payload.customFields.needsNotice == true')] }
  const query = (record: unknown) => async (sql: string, params?: unknown[]) => {
    expect(params?.[0]).toBe('sample-carrier')
    return sql.includes('FROM forms_admin_forms') ? { rows: [record], rowCount: 1 } : { rows: [], rowCount: 0 }
  }

  it('selects and records the exact configured rules alongside the form source', async () => {
    const result = await selectPolicyForms(query(form) as any, context)
    expect(result).toHaveLength(1)
    expect(result[0].metadata).toMatchObject({ attachmentRulesVersion: 1, attachmentRuleIds: ['rule-1'] })
    expect(result[0].metadata.attachmentRules).toEqual([{ triggerId: 'rule-1', triggerType: 'Expression', conditionExpression: 'payload.customFields.needsNotice == true', suppressExpression: null, priority: null, active: true }])
  })

  it('does not attach a conditional form when the custom field is false', async () => {
    const result = await selectPolicyForms(query(form) as any, { ...context, inputSnapshot: { customFields: { needsNotice: false } } })
    expect(result).toEqual([])
  })

  it.each([
    ['NB', 'Bind', 'new_business', 'Bound', 1200],
    ['Issue', 'Issue', 'new_business', 'Issued', 1200],
    ['Cancel', null, 'cancellation', 'Cancelled', -300],
    ['Reinstate', null, 'reinstatement', 'Issued', 300],
    ['Renew', null, 'renewal', 'Issued', 1500],
    ['Rewrite', null, 'rewrite', 'Issued', 1600],
    ['NonRenewal', null, 'non_renewal', 'Issued', 0],
  ] as const)('uses %s premium, policy facts and a new-business-only stage', async (type, stage, businessType, status, amount) => {
    const stageCondition = stage ? `transaction.stage == '${stage}'` : '!isSet(transaction.stage)'
    const selected = { ...form, transaction_types: [], attachment_triggers: [rule(`transaction.type == '${businessType}' && ${stageCondition} && policy.status == '${status}' && premium.total == ${amount}`)] }
    const result = await selectPolicyForms(query(selected) as any, { ...context, transactionType: type, premium: { total: { amount, currency: 'USD' } }, policy: { status } })
    expect(result).toHaveLength(1)
    expect(await selectPolicyForms(query(selected) as any, { ...context, transactionType: type, premium: { total: { amount: amount + 1, currency: 'USD' } }, policy: { status } })).toEqual([])
  })

  it('fails generation on an invalid configured rule rather than silently omitting a form', async () => {
    await expect(selectPolicyForms(query({ ...form, attachment_triggers: [rule('new Function()')] }) as any, context)).rejects.toMatchObject({ code: 'FORM_ATTACHMENT_RULE_INVALID' })
  })

  it('evaluates each form once although the joins return a row per jurisdiction', async () => {
    let reads = 0
    // Every evaluation reads the row's rules; a form whose rule does not match is the case the cache serves.
    const row = (state: string) => Object.defineProperty({ ...form, state_code: state, regulatory_status: 'Approved' }, 'attachment_triggers', {
      get: () => { reads += 1; return [rule('payload.customFields.needsNotice == false')] }, enumerable: true,
    })
    const rows = [row('CA'), row('CA'), row('NV')]
    const q = async (sql: string) => sql.includes('FROM forms_admin_forms') ? { rows, rowCount: rows.length } : { rows: [], rowCount: 0 }
    expect(await selectPolicyForms(q as any, context)).toEqual([])
    expect(reads).toBe(1)
  })

  it('blames oversized policy data, not the form configuration', async () => {
    const huge = { ...input.payload, list: Array(100001).fill(1) }
    await expect(selectPolicyForms(query(form) as any, { ...context, inputSnapshot: huge })).rejects.toMatchObject({ code: 'FORM_ATTACHMENT_CONTEXT_TOO_LARGE', statusCode: 422 })
  })

  it('does not build a rule context when no form is opted into attachment rules', async () => {
    const huge = { ...input.payload, list: Array(100001).fill(1) }
    expect(await selectPolicyForms(query({ ...form, metadata: {} }) as any, { ...context, inputSnapshot: huge })).toHaveLength(1)
  })

  it('rejects an unrecognized transaction type instead of treating it as new business', async () => {
    const selected = { ...form, transaction_types: [] }
    await expect(selectPolicyForms(query(selected) as any, { ...context, transactionType: 'Audit' as any })).rejects.toMatchObject({ code: 'FORM_ATTACHMENT_CONTEXT_INVALID' })
  })
})
