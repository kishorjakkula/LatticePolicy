import { describe, expect, it } from 'vitest'
import { canonicalProposal, referralProposalEvidence } from '../lib/referral-proposal.js'

function context() {
  return {
    quoteId: 'quote-1', policyId: 'policy-1', transactionType: 'NewBusiness',
    productCode: 'AUTO', agencyId: 'agency-1', insuredName: 'Test Insured',
    effectiveDate: '2027-01-01', reasons: ['Risk review', 'Authority review'],
    proposal: {
      payload: { risks: [{ value: 100000, state: 'NY' }], coverages: [{ code: 'BI', limit: 1000000 }] },
      premium: { total: 1200, fees: 20, taxes: 30, byCoverage: { BI: 1150 }, discounts: [10], surcharges: [5], calcTrace: { elapsedMs: 1 } },
      baseVersion: { versionId: 'v1', timelineVersion: 1 },
      underwriting: { decision: 'Refer', ruleId: 'rule-1' },
      authority: { configured: true, authorized: false, limit: 1000000 },
    },
  }
}

describe('canonicalProposal', () => {
  it('sorts keys recursively, including objects inside arrays, and omits undefined fields', () => {
    expect(canonicalProposal({ z: [{ b: 2, a: { d: 4, c: 3 } }], a: true, omitted: undefined }))
      .toBe('{"a":true,"z":[{"a":{"c":3,"d":4},"b":2}]}')
    expect(canonicalProposal({ z: [{ b: 2, a: { d: 4, c: 3 } }], a: true }))
      .toBe(canonicalProposal({ a: true, z: [{ a: { c: 3, d: 4 }, b: 2 }] }))
  })

  it('preserves array order and distinguishes scalar types', () => {
    expect(canonicalProposal([1, 2])).not.toBe(canonicalProposal([2, 1]))
    expect(new Set([null, false, 0, '', '0'].map(canonicalProposal)).size).toBe(5)
  })
})

describe('referralProposalEvidence', () => {
  it('fails closed without proposal evidence', () => {
    const { proposal: _proposal, ...legacy } = context()
    expect(referralProposalEvidence('tenant-1', legacy)).toEqual({ proposalHash: null, proposalSnapshot: null })
  })

  it('produces stable evidence for reordered nested keys, reasons and equivalent dates without mutating inputs', () => {
    const original = context()
    const before = structuredClone(original)
    const reordered = context()
    reordered.proposal.payload = {
      coverages: [{ limit: 1000000, code: 'BI' }], risks: [{ state: 'NY', value: 100000 }],
    }
    reordered.proposal.baseVersion = { timelineVersion: 1, versionId: 'v1' }
    reordered.reasons = ['Authority review', 'Risk review', 'Risk review']
    reordered.effectiveDate = '2027-01-01T00:00:00Z'
    const evidence = referralProposalEvidence('tenant-1', original)
    expect(evidence.proposalHash).toMatch(/^[a-f0-9]{64}$/)
    expect(evidence).toEqual(referralProposalEvidence('tenant-1', reordered))
    expect(evidence.proposalSnapshot).toMatchObject({ schemaVersion: 1, tenantId: 'tenant-1', effectiveDate: '2027-01-01' })
    expect(original).toEqual(before)
  })

  it('ignores calcTrace timing and diagnostics but retains reviewable premium', () => {
    const original = context()
    const changed = context()
    changed.proposal.premium.calcTrace = { elapsedMs: 999999 }
    const evidence = referralProposalEvidence('tenant-1', original)
    expect(referralProposalEvidence('tenant-1', changed)).toEqual(evidence)
    const { calcTrace: _trace, ...premium } = changed.proposal.premium
    expect(referralProposalEvidence('tenant-1', { ...changed, proposal: { ...changed.proposal, premium } })).toEqual(evidence)
    expect(evidence.proposalSnapshot?.premium).toEqual(premium)
    expect(JSON.stringify(evidence)).not.toContain('calcTrace')
  })

  it.each(['total', 'fees', 'taxes', 'byCoverage', 'discounts', 'surcharges'] as const)('changes the hash for premium %s', field => {
    const original = context()
    const premium = { ...original.proposal.premium, [field]: field === 'byCoverage' ? { BI: 9999 } : field === 'discounts' || field === 'surcharges' ? [9999] : 9999 }
    expect(referralProposalEvidence('tenant-1', { ...original, proposal: { ...original.proposal, premium } }).proposalHash)
      .not.toBe(referralProposalEvidence('tenant-1', original).proposalHash)
  })

  it.each(['quoteId', 'policyId', 'transactionType', 'productCode', 'agencyId', 'insuredName', 'effectiveDate'] as const)
    ('binds evidence to %s', field => {
      const original = context()
      const changed = { ...original, [field]: field === 'effectiveDate' ? '2027-02-01' : 'different-identity' }
      expect(referralProposalEvidence('tenant-1', changed).proposalHash)
        .not.toBe(referralProposalEvidence('tenant-1', original).proposalHash)
    })

  it('binds evidence to tenant identity', () => {
    const original = context()
    const first = referralProposalEvidence('tenant-1', original)
    const other = referralProposalEvidence('tenant-2', original)
    expect(other.proposalHash).not.toBe(first.proposalHash)
    expect(other.proposalSnapshot?.tenantId).toBe('tenant-2')
  })

  it.each(['payload', 'baseVersion', 'underwriting', 'authority'] as const)('changes the hash when %s changes', field => {
    const original = context()
    const changed = { ...original, proposal: { ...original.proposal, [field]: { ...original.proposal[field], changed: true } } }
    expect(referralProposalEvidence('tenant-1', changed).proposalHash)
      .not.toBe(referralProposalEvidence('tenant-1', original).proposalHash)
  })

  it('changes the hash for a new referral reason', () => {
    const original = context()
    expect(referralProposalEvidence('tenant-1', { ...original, reasons: [...original.reasons, 'New reason'] }).proposalHash)
      .not.toBe(referralProposalEvidence('tenant-1', original).proposalHash)
  })

  it.each(['password', 'secret', 'accessToken', 'authorization', 'cookie', 'apiKey', 'buffer', 'base64',
    'fileContent', 'documentContent', 'modelInput', 'prompt', 'documents', 'attachments'])
    ('redacts nested %s without leaking values while hashing changes to private data', field => {
      const original = context()
      const privateValue = 'PRIVATE-SENTINEL-DO-NOT-STORE'
      const payload = { ...original.proposal.payload, nested: [{ [field]: { raw: privateValue } }], businessField: 'reviewable' }
      const input = { ...original, proposal: { ...original.proposal, payload } }
      const before = structuredClone(input)
      const evidence = referralProposalEvidence('tenant-1', input)
      expect(evidence.proposalSnapshot?.payload).toEqual({
        ...original.proposal.payload, nested: [{ [field]: { redactedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) } }], businessField: 'reviewable',
      })
      expect(JSON.stringify(evidence)).not.toContain(privateValue)
      expect(input).toEqual(before)
      const changed = { ...input, proposal: { ...input.proposal, payload: { ...payload, nested: [{ [field]: { raw: 'changed-private-value' } }] } } }
      expect(referralProposalEvidence('tenant-1', changed).proposalHash).not.toBe(evidence.proposalHash)
    })

  it('redacts buffers even under ordinary business keys and detects changed bytes', () => {
    const original = context()
    const evidenceFor = (value: string) => referralProposalEvidence('tenant-1', {
      ...original, proposal: { ...original.proposal, payload: { nested: [Buffer.from(value)] } },
    })
    const evidence = evidenceFor('PRIVATE-BUFFER-SENTINEL')
    expect(evidence.proposalSnapshot?.payload).toEqual({ nested: [{ redactedSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] })
    expect(JSON.stringify(evidence)).not.toContain('PRIVATE-BUFFER-SENTINEL')
    expect(JSON.stringify(evidence)).not.toContain('"data"')
    expect(evidenceFor('changed-bytes').proposalHash).not.toBe(evidence.proposalHash)
  })

  it.each(['baseVersion', 'underwriting', 'authority', 'premium'] as const)('redacts private fields in %s as well as payload', field => {
    const original = context()
    const value = 'PRIVATE-OTHER-INPUT-SENTINEL'
    const replacement = field === 'premium' ? { ...original.proposal.premium, byCoverage: { apiKey: value } } : { ...original.proposal[field], apiKey: value }
    const input = { ...original, proposal: { ...original.proposal, [field]: replacement } }
    const evidence = referralProposalEvidence('tenant-1', input)
    expect(JSON.stringify(evidence)).not.toContain(value)
    expect(JSON.stringify(evidence)).toContain('redactedSha256')
    const changed = field === 'premium' ? { ...replacement, byCoverage: { apiKey: 'changed-secret' } } : { ...replacement, apiKey: 'changed-secret' }
    expect(referralProposalEvidence('tenant-1', { ...input, proposal: { ...input.proposal, [field]: changed } }).proposalHash)
      .not.toBe(evidence.proposalHash)
  })
})
