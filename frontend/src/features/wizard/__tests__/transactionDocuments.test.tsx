import { describe, expect, it } from 'vitest'
import { buildWizardQuotePayload, liveFormPreviewContext, pinnedTransactionWorkspace } from '../QuoteWizard'
import { archivedOutputFormat, canOpenArchivedDocument } from '../../../api/policies.api'
import { buildFormAttachmentContext, evaluateFormTriggers } from '@lattice-policy/rules'

describe('transaction Forms & Documents boundaries', () => {
  it.each([
    ['text/html; charset=utf-8', 'HTML'], ['APPLICATION/PDF; charset=binary', 'PDF'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
    ['application/octet-stream', 'Unknown format'],
  ])('labels archived content type %s', (type, expected) => {
    expect(archivedOutputFormat(type)).toBe(expected)
  })
  const details = {
    policyId: 'policy', versionId: 'v1', transactionId: 'tx1',
    forms: [{ formNumber: 'OLD-EDITION', editionDate: '2020-01', snapshotHash: 'pinned' }],
    documents: [
      { documentId: 'original', transactionId: 'tx1', versionId: 'v1' },
      { documentId: 'other-endorsement', transactionId: 'tx2', versionId: 'v2' },
      { documentId: 'other-version-same-transaction', transactionId: 'tx1', versionId: 'v2' },
      { documentId: 'wrong-owner', transactionId: 'tx2', versionId: 'v1' },
    ],
  }
  it('keeps pinned forms and only exact transaction/version document references', () => {
    expect(pinnedTransactionWorkspace(details, 'policy', 'v1')).toEqual({ forms: details.forms, documents: [details.documents[0]] })
  })
  it.each([null, {}, { ...details, policyId: 'other-policy' }, { ...details, versionId: 'v2' }])('fails closed for missing or stale loaded details', value => {
    expect(pinnedTransactionWorkspace(value, 'policy', 'v1')).toEqual({ forms: [], documents: [] })
  })
  it('does not substitute current forms/documents for legacy absent snapshots', () => {
    expect(pinnedTransactionWorkspace({ policyId: 'policy', versionId: 'v1' }, 'policy', 'v1')).toEqual({ forms: [], documents: [] })
  })
  it.each(['Quote', 'Bind', 'Issue'] as const)('sends the full live domain snapshot, with business type distinct from %s stage', stage => {
    const payload = { customFields: { wind: true }, risks: [{ roofAge: 20 }], additionalInterests: [{ name: 'Bank' }], qualificationAnswers: { priorLoss: true } }
    const facts = { type: 'Endorsement', number: 'END-2', effectiveDate: '2026-10-18', policy: { policyId: 'policy', status: 'Issued' }, premium: { total: { amount: 42 } }, uw: { decision: 'Refer' } }
    const context = liveFormPreviewContext(payload, stage, facts)
    expect(context).toEqual({ payload, coverages: [], transactionType: 'Endorsement', policy: facts.policy, premium: facts.premium, uw: facts.uw, transaction: { type: 'Endorsement', stage: stage === 'Quote' ? 'Bind' : stage, number: 'END-2', effectiveDate: facts.effectiveDate } })
    expect(context.payload).toBe(payload)
  })
  it.each(['Quote', 'Bind', 'Issue'] as const)('preserves new-business legacy %s prefilter separately from NB business type', stage => {
    expect(liveFormPreviewContext({}, stage, { type: 'NB', effectiveDate: '2026-10-18', policy: {}, premium: {}, uw: {} })).toMatchObject({
      // Quote previews what binding will attach; no documents are generated at Quote.
      transactionType: stage === 'Quote' ? 'Bind' : stage, transaction: { type: 'NB', stage: stage === 'Quote' ? 'Bind' : stage },
    })
  })
  it('matches generation evaluation for full-domain endorsement conditions and Money premium', () => {
    const payload = { productCode: 'homeowners', state: 'TX', risks: [{ customFields: { roofAge: 20 } }], customFields: { wind: true }, additionalInterests: [{ name: 'Bank' }], qualificationAnswers: { priorLoss: true }, coverages: [{ code: 'A', selected: true, limit: 500000 }], transaction: { reasonCode: 'CHANGE_ROOF' } }
    const policy = { policyId: 'policy', status: 'Issued' }
    const premium = { total: { amount: '1200.50', currency: 'USD' } }
    const preview = liveFormPreviewContext(payload, 'Issue', { type: 'Endorsement', number: 'END-2', effectiveDate: '2026-10-18', policy, premium, uw: { decision: 'Accept' } })
    expect(preview.transactionType).toBe('Endorsement') // applicability prefilter, before shared normalization
    const generated = { payload, productCode: 'homeowners', state: 'TX', effectiveDate: '2026-10-18', transactionType: 'Endorsement', transaction: { ...payload.transaction, type: 'Endorsement', stage: 'Issue' }, policy, premium }
    const rules = [{ triggerType: 'Expression', conditionExpression: "transaction.type == 'endorsement' && transaction.reasonCode == 'CHANGE_ROOF' && policy.status == 'Issued' && premium.total > 1000 && payload.customFields.wind && risk.customFields.roofAge == 20 && additionalInterests.0.name == 'Bank' && qualificationAnswers.priorLoss && coverages.A.limit == 500000" }]
    expect(evaluateFormTriggers(rules, buildFormAttachmentContext(preview)).attach).toBe(true)
    expect(evaluateFormTriggers(rules, buildFormAttachmentContext(generated)).attach).toBe(true)
    expect(evaluateFormTriggers(rules, buildFormAttachmentContext({ ...preview, payload: { ...payload, customFields: { wind: false } } })).attach).toBe(false)
    // An issuance-stage rule means new business only, in preview and generation alike.
    const issuance = [{ triggerType: 'Expression', conditionExpression: "transaction.stage == 'Issue'" }]
    expect(evaluateFormTriggers(issuance, buildFormAttachmentContext(preview)).attach).toBe(false)
    expect(evaluateFormTriggers(issuance, buildFormAttachmentContext(generated)).attach).toBe(false)
  })
  it.each([
    ['NB', 'Bind', 'Quoted', 'Bound'],
    ['NB', 'Issue', 'Bound', 'Issued'],
    ['Issue', 'Issue', 'Bound', 'Issued'],
    ['Cancellation', 'Issue', 'Issued', 'Cancelled'],
    ['Reinstatement', 'Issue', 'Cancelled', 'Issued'],
    ['Endorsement', 'Issue', 'Issued', 'Issued'],
    ['Renewal', 'Issue', 'Active', 'Active'],
    ['Rewrite', 'Issue', undefined, 'Issued'],
  ])('uses lifecycle resulting policy status for %s/%s, otherwise actual loaded status', (type, stage, status, expected) => {
    const policy = { policyId: 'p1', status, term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' }, metadata: { carrierField: 'value' } }
    const context = liveFormPreviewContext({}, stage as 'Bind' | 'Issue', { type, effectiveDate: '2026-10-18', policy, premium: null, uw: {} })
    expect(context.policy).toMatchObject({ policyId: policy.policyId, status: expected, metadata: policy.metadata })
    expect(policy.status).toBe(status)
  })
  it('uses stored status rather than time-dependent display status for endorsement and renewal', () => {
    for (const type of ['Endorsement', 'Renewal']) {
      const context = liveFormPreviewContext({ effectiveDate: '2027-01-01', termMonths: 12 }, 'Issue', {
        type, effectiveDate: '2027-01-01', policy: { status: 'Active', internalStatus: 'Issued' }, premium: null, uw: {},
      })
      expect(context.policy.status).toBe('Issued')
    }
  })
  it.each([
    { term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01', carrierTermId: 'TERM-1' } },
    { termEffectiveDate: '2026-01-01', termExpirationDate: '2027-01-01' },
  ])('normalizes both existing-term date aliases without using the midterm transaction date', dates => {
    const context = liveFormPreviewContext({ effectiveDate: '2026-01-01', termMonths: 12 }, 'Issue', {
      type: 'Endorsement', effectiveDate: '2026-10-18', policy: { ...dates, status: 'Active', internalStatus: 'Issued' }, premium: null, uw: {},
    })
    expect(context.policy).toMatchObject({ status: 'Issued', termEffectiveDate: '2026-01-01', termExpirationDate: '2027-01-01', term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' } })
    expect(context.transaction.effectiveDate).toBe('2026-10-18')
    if (dates.term) expect(context.policy.term.carrierTermId).toBe('TERM-1')
  })
  it.each(['Renewal', 'Rewrite'])('uses the authoritative %s transaction next-term dates for both aliases, not a stale payload date', type => {
    const policy = { status: 'Cancelled', internalStatus: 'Issued', termEffectiveDate: '2026-01-01', termExpirationDate: '2027-01-01', term: { effectiveDate: '2026-01-01', expirationDate: '2027-01-01' } }
    const context = liveFormPreviewContext({ effectiveDate: '2027-01-15', termMonths: 6 }, 'Issue', {
      type, effectiveDate: '2027-02-01', policy, premium: null, uw: {},
    })
    expect(context.policy).toMatchObject({ status: 'Issued', termEffectiveDate: '2027-02-01', termExpirationDate: '2027-08-01', term: { effectiveDate: '2027-02-01', expirationDate: '2027-08-01' } })
    expect(policy.term.effectiveDate).toBe('2026-01-01')
  })
  it('uses the same normalized insureds, coverage aliases, commission and derived UW payload as rating/binding', () => {
    const state = {
      productCode: 'personal-auto', effectiveDate: '2026-10-18', termMonths: 12,
      country: 'US', state: 'TX', agencyCommissionPct: '12.5',
      applicant: { firstName: 'Old', lastName: 'Applicant' },
      insureds: { primary: { firstName: 'Stale', lastName: 'Snapshot' } },
      risks: [{ type: 'autoVehicle', driverAge: 35 }],
      qualificationAnswers: { garagedAtResidence: 'yes' },
      coverages: [{ coverageCode: 'COVA', limitValue: 500000, deductible: 2500 }],
    }
    const insureds = { primary: { firstName: '  Current  ', lastName: ' Insured ', customerId: 'customer-1' }, secondary: {}, additional: [] }
    const payload = buildWizardQuotePayload(state as any, insureds as any)
    const context = liveFormPreviewContext(payload, 'Bind', { type: 'NB', effectiveDate: state.effectiveDate, policy: null, premium: null, uw: {} })
    expect(context.payload).toMatchObject({
      insureds: { primary: { firstName: 'Current', lastName: 'Insured', customerId: 'customer-1' } },
      agencyCommissionPct: 12.5,
      uwAnswers: { driverAge: 35, garagedAtResidence: true },
      coverages: [{ code: 'A', selected: true, limit: 500000, deductible: 2500 }],
    })
    const normalized = buildFormAttachmentContext(context)
    expect(evaluateFormTriggers([{ triggerType: 'Expression', conditionExpression: "insureds.primary.firstName == 'Current' && uwAnswers.driverAge == 35 && uwAnswers.garagedAtResidence && coverages.A.limit == 500000 && policy.termEffectiveDate == '2026-10-18'" }], normalized).attach).toBe(true)
    expect(state.insureds.primary.firstName).toBe('Stale')
    expect(state.agencyCommissionPct).toBe('12.5')
    expect(insureds.primary.firstName).toBe('  Current  ')
  })
  it('preserves full coverage values and explicit deselection in the actual preview body', () => {
    const coverages = [{ code: 'A', selected: true, limit: 500000, deductible: 2500, percent: 80 }, { code: 'WIND', selected: false, limit: 100000, deductible: 5000 }, { code: 'B', limit: 50000 }]
    const preview = liveFormPreviewContext({ coverages }, 'Issue', { type: 'Endorsement', effectiveDate: '2026-10-18', policy: { status: 'Issued' }, premium: null, uw: {} })
    expect(preview.coverages).toBe(coverages)
    const normalized = buildFormAttachmentContext(preview)
    expect(normalized.coverageCodes).toEqual(['A', 'B'])
    expect(normalized.coverages).toMatchObject({ A: { selected: true, limit: 500000, deductible: 2500, percent: 80 }, WIND: { selected: false, limit: 100000, deductible: 5000 } })
    expect(evaluateFormTriggers([{ triggerType: 'Expression', conditionExpression: 'coverages.A.limit == 500000 && coverages.A.deductible == 2500 && !coverages.WIND.selected' }], normalized).attach).toBe(true)
  })
  it('leaves attributes and UW stage defaults to the shared context builder', () => {
    const payload = { risks: [{ roofAge: 20 }], uwAnswers: { reviewed: true }, uw: { carrierFact: true } }
    const preview = liveFormPreviewContext(payload, 'Issue', { type: 'Endorsement', effectiveDate: '2026-10-18', policy: { status: 'Issued' }, premium: null, uw: { decision: 'Refer', overrideReason: 'Reviewed' } })
    expect(preview).not.toHaveProperty('attributes')
    expect(preview.uw).toEqual({ decision: 'Refer', overrideReason: 'Reviewed' })
    expect(preview.uw).not.toHaveProperty('isBound')
    expect(preview.uw).not.toHaveProperty('isIssued')
    expect(preview.payload).toBe(payload)
  })
  it.each(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])('requires ready, verified, available archived bytes for %s', contentType => {
    const doc = { status: 'READY', available: true, integrityStatus: 'VERIFIED', byteSize: 100, contentType }
    expect(canOpenArchivedDocument(doc)).toBe(true)
    expect(canOpenArchivedDocument({ ...doc, available: false })).toBe(false)
    expect(canOpenArchivedDocument({ ...doc, status: 'PENDING' })).toBe(false)
    expect(canOpenArchivedDocument({ ...doc, integrityStatus: 'UNVERIFIED' })).toBe(false)
    expect(canOpenArchivedDocument({ ...doc, byteSize: 0 })).toBe(false)
  })
})
