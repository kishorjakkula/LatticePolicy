import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { executeEndorsement } from '../services/endorsement.service.js'
import { cancelPolicy, issuePolicy, nonRenewPolicy, reinstatePolicy, renewPolicy } from '../services/lifecycle.service.js'
import { loadPolicyContext } from '../persistence.js'
import {
  createScenarioPolicy, ensureScenarioTenant, expectTransactionInvariants,
  scenarioActor, scenarioQuotePayload, seedScenarioForms, transactionIdFor,
} from './fixtures/policy-scenarios.js'

const tenantId = 'policy-scenario-matrix'
const otherTenantId = 'scenario-matrix-other'
const tx = <T>(fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(tenantId, fn)

beforeAll(async () => {
  await initDb()
  await ensureScenarioTenant(tenantId)
  await ensureScenarioTenant(otherTenantId)
  await seedScenarioForms(tenantId)
})

afterAll(async () => { await closeDb() })

describe('production policy scenario matrix', () => {
  it('new business: deterministically blocks declined and referred risks before bind', async () => {
    const declined = await createOrRateQuote({} as any, tenantId, scenarioQuotePayload({
      applicant: { firstName: 'Declined', lastName: 'Risk', email: 'declined@example.com' },
      uwAnswers: { driverAge: 15 },
      risks: [{ ...scenarioQuotePayload().risks[0], driverAge: 15 }],
    }), null, 'scenario-matrix')
    expect(declined.underwriting?.decision, 'declined NB: underwriting must return Decline').toBe('Decline')
    await expect(bindQuote({} as any, tenantId, declined.quoteId, {}, 'agent1', null, { roles: ['agent'], permissions: [] }))
      .rejects.toMatchObject({ code: 'UW_DECLINED' })

    const referred = await createOrRateQuote({} as any, tenantId, scenarioQuotePayload({
      applicant: { firstName: 'Referred', lastName: 'Risk', email: 'referred@example.com' },
      uwAnswers: { driverAge: 17 },
      risks: [{ ...scenarioQuotePayload().risks[0], driverAge: 17 }],
    }), null, 'scenario-matrix')
    expect(referred.underwriting?.decision, 'referred NB: underwriting must return Refer').toBe('Refer')
    await expect(bindQuote({} as any, tenantId, referred.quoteId, {}, 'agent1', null, { roles: ['agent'], permissions: [] }))
      .rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    const referral = await getDb()!.query(`SELECT status FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`, [tenantId, referred.quoteId])
    expect(referral.rows[0]?.status, 'referred NB: an open referral must be durable').toBe('Open')
  })

  it('endorsement: preserves premium/version/forms/events for backdated and out-of-sequence changes', async () => {
    const policy = await createScenarioPolicy(tenantId)
    const base = await getDb()!.query(`SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1`, [tenantId, policy.policyId])
    const laterPayload = structuredClone(base.rows[0].payload)
    laterPayload.coverages[0].limit = 250000
    const later = await tx((db) => executeEndorsement(db, tenantId, policy.policyId, {
      effectiveDate: '2026-09-01', payload: laterPayload, transactionNumber: 'EN-MATRIX-LATER',
    }, scenarioActor))
    await expectTransactionInvariants(tenantId, policy.policyId, later.transactionId, 'later endorsement')

    const earlierPayload = structuredClone(base.rows[0].payload)
    earlierPayload.coverages[1].limit = 100000
    const earlier = await tx((db) => executeEndorsement(db, tenantId, policy.policyId, {
      effectiveDate: '2026-08-01', payload: earlierPayload, transactionNumber: 'EN-MATRIX-OOS',
    }, scenarioActor))
    await expectTransactionInvariants(tenantId, policy.policyId, earlier.transactionId, 'out-of-sequence endorsement')
    const metadata = await getDb()!.query(`SELECT metadata FROM policy_transactions WHERE transaction_id=$1`, [earlier.transactionId])
    expect(metadata.rows[0].metadata.outOfSequence, 'OOS endorsement: metadata flag must be true').toBe(true)
    expect(metadata.rows[0].metadata.rebasedTransactions, 'OOS endorsement: later transaction must be rebased')
      .toEqual(expect.arrayContaining([expect.objectContaining({ transactionType: 'ENDORSE' })]))
  })

  it.each([
    ['flat', 'FLAT_CANCEL', '2026-07-01', 'FLAT'],
    ['pro-rata', 'DECEASED', '2027-01-01', 'PRO_RATA'],
    ['short-rate', 'INSURED_REQUEST', '2026-08-01', 'SHORT_RATE'],
  ])('cancellation: %s basis is persisted with transaction invariants', async (_name, reasonCode, effectiveDate, expectedMethod) => {
    const policy = await createScenarioPolicy(tenantId)
    const cancelled = await tx((db) => cancelPolicy(db, tenantId, policy.policyId, {
      effectiveDate, cancellationReasonCode: reasonCode, reason: `${_name} matrix`,
    }, scenarioActor))
    const transactionId = await transactionIdFor(tenantId, policy.policyId, cancelled.transactionNumber)
    const invariant = await expectTransactionInvariants(tenantId, policy.policyId, transactionId, `${_name} cancellation`)
    const row = await getDb()!.query(`SELECT metadata FROM policy_transactions WHERE transaction_id=$1`, [transactionId])
    expect(row.rows[0].metadata.returnPremiumMethod, `${_name} cancellation: return-premium method`).toBe(expectedMethod)
    expect(Number(invariant.premium_total), `${_name} cancellation: premium must be non-positive`).toBeLessThanOrEqual(0)
  })

  it('reinstatement and retry: restores coverage and keeps repeated issue idempotent', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, scenarioQuotePayload(), null, 'scenario-matrix')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'scenario-matrix', null, scenarioActor)
    const firstIssue = await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, scenarioActor))
    const retriedIssue = await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, scenarioActor))
    expect(retriedIssue.idempotent, 'issue retry: repeated command must be idempotent').toBe(true)
    const issueCount = await getDb()!.query(`SELECT count(*)::int count FROM notification_intents WHERE tenant_id=$1 AND policy_id=$2 AND event_type='POLICY_ISSUED'`, [tenantId, bound.policyId])
    expect(issueCount.rows[0].count, 'issue retry: side effects must not duplicate').toBe(1)

    await tx((db) => cancelPolicy(db, tenantId, bound.policyId, { effectiveDate: '2026-10-01', cancellationReasonCode: 'DECEASED' }, scenarioActor))
    const reinstated = await tx((db) => reinstatePolicy(db, tenantId, bound.policyId, { effectiveDate: '2026-10-15', reason: 'matrix restore' }, scenarioActor))
    const reinstatementId = await transactionIdFor(tenantId, bound.policyId, reinstated.transactionNumber)
    await expectTransactionInvariants(tenantId, bound.policyId, reinstatementId, 'reinstatement')
    expect(firstIssue.status).toBe('Issued')
    expect(reinstated.premium.total.amount, 'reinstatement: premium impact must not be negative').toBeGreaterThanOrEqual(0)
  })

  it('renewal and non-renewal: rates changed inputs and enforces notice deadlines', async () => {
    const policy = await createScenarioPolicy(tenantId)
    const current = await getDb()!.query(`SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1`, [tenantId, policy.policyId])
    const renewalPayload = structuredClone(current.rows[0].payload)
    renewalPayload.coverages[0].limit = 500000
    const renewed = await tx((db) => renewPolicy(db, tenantId, policy.policyId, { payload: renewalPayload, transactionNumber: 'RN-MATRIX-CHANGED' }, scenarioActor))
    const renewalId = await transactionIdFor(tenantId, policy.policyId, renewed.transactionNumber)
    await expectTransactionInvariants(tenantId, policy.policyId, renewalId, 'changed-input renewal')
    const renewedVersion = await getDb()!.query(`SELECT payload FROM policy_versions WHERE transaction_id=$1`, [renewalId])
    expect(renewedVersion.rows[0].payload.coverages[0].limit, 'renewal: changed limit must be snapshotted').toBe(500000)

    await getDb()!.query(`DELETE FROM servicing_compliance_rules WHERE tenant_id=$1 AND transaction_type='NON_RENEWAL'`, [tenantId])
    await getDb()!.query(
      `INSERT INTO servicing_compliance_rules (tenant_id,product_code,state_code,transaction_type,allowed_reason_codes,minimum_notice_days,return_premium_method,effective_date)
       VALUES ($1,'personal-auto','CA','NON_RENEWAL',ARRAY['UNDERWRITING'],60,'NONE','2026-01-01')`, [tenantId]
    )
    await expect(tx((db) => nonRenewPolicy(db, tenantId, policy.policyId, { noticeDate: '2028-06-15', reasonCode: 'UNDERWRITING' }, scenarioActor)))
      .rejects.toMatchObject({ code: 'SERVICING_NOTICE_PERIOD_INVALID' })
    const nonRenewed = await tx((db) => nonRenewPolicy(db, tenantId, policy.policyId, { noticeDate: '2028-04-01', reasonCode: 'UNDERWRITING' }, scenarioActor))
    const nonRenewTx = await getDb()!.query(`SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='NON_RENEWAL' AND metadata->>'transactionNumber'=$3`, [tenantId, policy.policyId, nonRenewed.transactionNumber])
    await expectTransactionInvariants(tenantId, policy.policyId, nonRenewTx.rows[0].transaction_id, 'compliant non-renewal')
  })

  it('concurrency and tenant isolation: permits one timeline writer and hides policy cross-tenant', async () => {
    const policy = await createScenarioPolicy(tenantId)
    const current = await getDb()!.query(`SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1`, [tenantId, policy.policyId])
    const payloadA = structuredClone(current.rows[0].payload)
    const payloadB = structuredClone(current.rows[0].payload)
    payloadA.coverages[0].limit = 250000
    payloadB.coverages[0].limit = 500000
    const writes = await Promise.allSettled([
      tx((db) => executeEndorsement(db, tenantId, policy.policyId, { effectiveDate: '2026-11-01', payload: payloadA, expectedTimelineVersion: 0 }, scenarioActor)),
      tx((db) => executeEndorsement(db, tenantId, policy.policyId, { effectiveDate: '2026-11-01', payload: payloadB, expectedTimelineVersion: 0 }, scenarioActor)),
    ])
    expect(writes.filter((result) => result.status === 'fulfilled'), 'concurrency: exactly one writer must win').toHaveLength(1)
    const rejected = writes.find((result) => result.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason, 'concurrency: loser must receive stale-version invariant').toMatchObject({ code: 'STALE_POLICY_VERSION' })
    const crossTenant = await withTenantTx(otherTenantId, (db) => loadPolicyContext(db, otherTenantId, policy.policyId))
    expect(crossTenant, 'tenant isolation: foreign policy must not be visible').toBeNull()
  })
})
