import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db.js', () => ({ toRawQuery: vi.fn() }))

import { toRawQuery } from '../db.js'
import { resolveReferralGateForActor, withPersistentPolicyReferral, type ReferralGateContext } from '../services/uw-referral.service.js'
import { BadRequestError } from '../errors/domain.errors.js'
import { referralProposalEvidence } from '../lib/referral-proposal.js'

const tenantId = 'referral-gate-test'
const id = '22222222-2222-4222-a222-222222222222'
const actors = [
  { roles: ['underwriter'], permissions: [] },
  { roles: ['admin'], permissions: [] },
  { roles: [], permissions: ['uw.referrals.decide'] },
  { roles: ['underwriter'], permissions: ['uw.referrals.decide', 'uw.authority.override'] },
]
function makeProposal() {
  return {
    payload: { risks: [{ territory: 'NY', value: 100000 }], coverages: [{ code: 'LIABILITY', limit: 1000000 }], effectiveDate: '2027-01-01' },
    premium: { total: 1200, fees: 20, taxes: 30, byCoverage: { LIABILITY: 1150 } },
    baseVersion: { versionId: 'base-v1', timelineVersion: 1, status: 'Issued' },
    underwriting: { decision: 'Refer', reasons: ['Risk requires review'] },
    authority: { configured: true, authorized: false, reasons: ['LIMIT_AUTHORITY_EXCEEDED'] },
  }
}

type TestGateContext = ReferralGateContext & {
  proposal: ReturnType<typeof makeProposal>
  effectiveDate: string
}

const contexts: TestGateContext[] = ['NewBusiness', 'Endorse', 'Renew', 'Rewrite'].map(transactionType => ({
  transactionType,
  ...(transactionType === 'NewBusiness' ? { quoteId: id } : { policyId: id }),
  reasons: ['Risk requires review'],
  effectiveDate: '2027-01-01',
  proposal: makeProposal(),
}))

beforeEach(() => vi.clearAllMocks())

function mockQueries(ctx: typeof contexts[number], existing: unknown, inserted?: unknown) {
  const query = vi.fn()
  if (ctx.quoteId) query.mockResolvedValueOnce({ rows: [], rowCount: 1 })
  query.mockResolvedValueOnce({ rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 })
  if (inserted) query.mockResolvedValueOnce({ rows: [inserted], rowCount: 1 })
  vi.mocked(toRawQuery).mockReturnValue(query as any)
  return query
}

function expectLookup(query: ReturnType<typeof vi.fn>, ctx: typeof contexts[number], writes = false) {
  const selectIndex = ctx.quoteId ? 1 : 0
  expect(query).toHaveBeenCalledTimes(selectIndex + 1 + Number(writes))
  if (ctx.quoteId) {
    expect(query.mock.calls[0]).toEqual([
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [JSON.stringify(['quote-referral', tenantId, ctx.quoteId])],
    ])
  }
  const [sql, params] = query.mock.calls[selectIndex]
  expect(sql).toMatch(/^SELECT \*, effective_date::text AS effective_date FROM underwriting_referrals/)
  expect(sql).toContain('ORDER BY created_at DESC, referral_id DESC LIMIT 1')
  expect(sql).toContain(ctx.quoteId ? 'tenant_id=$1 AND quote_id=$2' : 'tenant_id=$1 AND policy_id=$2 AND transaction_type=$3')
  expect(params.slice(0, -1)).toEqual(ctx.quoteId ? [tenantId, ctx.quoteId] : [tenantId, ctx.policyId, ctx.transactionType])
  expect(sql).toContain('proposal_hash=')
}

describe('rejected-policy referral boundary', () => {
  it('returns successful operations without another transaction', async () => {
    expect(await withPersistentPolicyReferral(tenantId, async () => 'committed')).toBe('committed')
    expect(toRawQuery).not.toHaveBeenCalled()
  })

  it('does not persist work for unrelated or merely similarly named errors', async () => {
    for (const error of [new Error('database failure'), new BadRequestError('UW_DECLINED', 'Declined'), new BadRequestError('UW_REFERRAL_REQUIRED', 'Not a server-evaluated policy referral')]) {
      await expect(withPersistentPolicyReferral(tenantId, async () => { throw error })).rejects.toBe(error)
    }
    expect(toRawQuery).not.toHaveBeenCalled()
  })
})

describe.each(contexts)('$transactionType referral gate', (ctx) => {
  it.each(['Open', 'InfoRequested'])('never mutates an existing %s referral, regardless of actor or override reason', async (status) => {
    for (const actor of actors) {
      for (const authority of [false, true]) {
        const row = {
          referral_id: id, status, decision: status === 'InfoRequested' ? status : null,
          reasons: authority ? ['AUTHORITY_LIMIT_AUTHORITY_EXCEEDED'] : ctx.reasons,
          comments: [{ text: 'Existing review history' }], decision_reason: null,
          effective_date: ctx.effectiveDate,
          proposal_hash: referralProposalEvidence(tenantId, { ...ctx, reasons: authority ? ['AUTHORITY_LIMIT_AUTHORITY_EXCEEDED'] : ctx.reasons }).proposalHash,
        }
        const before = structuredClone(row)
        const query = mockQueries(ctx, row)
        const result = await resolveReferralGateForActor(
          {} as any, tenantId, { ...ctx, reasons: row.reasons, authorityOverrideRequired: authority },
          { id, ...actor }, 'Reviewed, approve this override'
        )
        expect(result).toMatchObject({ blocked: true, referral: { referralId: id, status } })
        expect(row).toEqual(before)
        expectLookup(query, ctx)
      }
    }
  })

  it('opens a referral without recording a decision even for an authority override actor', async () => {
    const query = mockQueries(ctx, null, { referral_id: id, status: 'Open', decision: null, comments: [] })
    const result = await resolveReferralGateForActor(
      {} as any, tenantId, ctx, { id, ...actors[3] }, 'Approved inline'
    )
    expect(result).toMatchObject({ blocked: true, referral: { status: 'Open', decision: null, comments: [] } })
    expectLookup(query, ctx, true)
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1]
    expect(sql).toMatch(/INSERT INTO underwriting_referrals/)
    expect(sql).toContain("'Open','Normal'")
    const evidence = referralProposalEvidence(tenantId, ctx)
    expect(params.slice(-2)).toEqual([evidence.proposalHash, JSON.stringify(evidence.proposalSnapshot)])
  })

  it('allows an already approved referral without an actor or override reason and without writes', async () => {
    const query = mockQueries(ctx, { referral_id: id, status: 'Approved', reasons: ctx.reasons,
      effective_date: ctx.effectiveDate, proposal_hash: referralProposalEvidence(tenantId, ctx).proposalHash })
    await expect(resolveReferralGateForActor({} as any, tenantId, ctx)).resolves.toMatchObject({
      blocked: false, referral: { referralId: id, status: 'Approved' },
    })
    expectLookup(query, ctx)
  })

  it.each(['new authority', 'increased limit with same reason', 'changed risk', 'changed premium', 'changed baseVersion',
    'changed coverage', 'changed date', 'consumed approval', 'consumed version', 'latest decline', 'legacy missing hash', 'legacy null hash',
    'missing current proposal'])('does not reuse a %s context', async change => {
    const existing = { referral_id: id, status: change === 'latest decline' ? 'Declined' : 'Approved', reasons: ctx.reasons,
      effective_date: ctx.effectiveDate, transaction_id: change === 'consumed approval' ? id : null,
      version_id: change === 'consumed version' ? id : null,
      proposal_hash: change === 'legacy missing hash' ? undefined : change === 'legacy null hash' ? null : referralProposalEvidence(tenantId, ctx).proposalHash }
    const before = structuredClone(existing)
    const freshContext = structuredClone(ctx)
    switch (change) {
      case 'new authority': freshContext.reasons.push('AUTHORITY_LIMIT_AUTHORITY_EXCEEDED'); break
      case 'increased limit with same reason': freshContext.proposal.payload.coverages[0].limit *= 10; break
      case 'changed risk': freshContext.proposal.payload.risks[0].value *= 2; break
      case 'changed premium': freshContext.proposal.premium.total += 100; break
      case 'changed baseVersion': freshContext.proposal.baseVersion.timelineVersion += 1; break
      case 'changed coverage': freshContext.proposal.payload.coverages[0].code = 'PROPERTY'; break
      case 'changed date': freshContext.effectiveDate = '2027-02-01'; freshContext.proposal.payload.effectiveDate = freshContext.effectiveDate; break
    }
    const attempt = change === 'missing current proposal' ? { ...freshContext, proposal: undefined } : freshContext
    const query = mockQueries(ctx, existing, { referral_id: 'new-referral', status: 'Open', reasons: freshContext.reasons })
    expect(await resolveReferralGateForActor({} as any, tenantId, attempt, actors[3], 'Must not bypass')).toMatchObject({ blocked: true, referral: { referralId: 'new-referral', status: 'Open' } })
    expectLookup(query, ctx, true)
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1]
    expect(sql).toContain('INSERT INTO underwriting_referrals')
    expect(params).toContainEqual(freshContext.reasons)
    const evidence = referralProposalEvidence(tenantId, attempt)
    expect(params.slice(-2)).toEqual([evidence.proposalHash, evidence.proposalSnapshot ? JSON.stringify(evidence.proposalSnapshot) : null])
    expect(existing).toEqual(before)
  })
})
