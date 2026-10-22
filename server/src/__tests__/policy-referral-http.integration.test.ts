import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createUser } from '../users.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy } from '../services/lifecycle.service.js'

const app = createApp()
const tenant = 'sample-carrier'
let token: string
let actor: { id: string; username: string; roles: string[]; permissions: string[] }
const q = (sql: string, params?: unknown[]) => getDb()!.query(sql, params)
const auth = (method: 'get' | 'post' | 'patch', path: string) => request(app)[method](path)
  .set('Authorization', `Bearer ${token}`).set('X-Tenant', tenant)

function payload(driverAge = 35) {
  return {
    productCode: 'personal-auto', effectiveDate: '2026-07-01', termMonths: 12, state: 'CA',
    applicant: { firstName: 'Referral', lastName: 'HttpTest', email: 'synthetic@example.com' },
    uwAnswers: { driverAge },
    risks: [{ type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '94105', symbol: 'A', usage: 'commute', driverAge }],
    coverages: [{ code: 'BI', selected: true, limit: 100000 }, { code: 'PD', selected: true, limit: 50000 }],
  }
}

describe('policy referrals survive real HTTP transaction rollback', () => {
  beforeAll(async () => {
    if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true') throw new Error('Disposable test database required')
    await initDb()
    await q('INSERT INTO tenants (tenant_id,name) VALUES ($1,$1) ON CONFLICT DO NOTHING', [tenant])
    const username = `referral-http-${crypto.randomUUID()}`
    await createUser({ username, password: 'password', tenantId: tenant, roles: ['admin'] })
    const login = await request(app).post('/auth/login').send({ tenantId: tenant, username, password: 'password' }).expect(200)
    token = login.body.token
    actor = { id: login.body.user.id, username, roles: ['admin'], permissions: ['uw.referrals.decide', 'uw.authority.override'] }
  })
  afterAll(async () => { await closeDb() })

  it.each([
    ['endorse', 'Endorse'], ['renew', 'Renew'], ['rewrite', 'Rewrite'],
  ] as const)('%s preserves a reviewable referral, not rejected policy changes, then retries after explicit approval', async (action, type) => {
    const quote = await createOrRateQuote({} as any, tenant, payload(), null, actor.username)
    const bound = await bindQuote({} as any, tenant, quote.quoteId, {}, actor.username, actor.id, actor)
    await withTenantTx(tenant, db => issuePolicy(db, tenant, bound.policyId, {}, actor))
    if (action === 'rewrite') await withTenantTx(tenant, db => cancelPolicy(db, tenant, bound.policyId, {
      effectiveDate: '2026-07-15', reason: 'Synthetic rewrite setup',
    }, actor))
    const policyState = async () => ({
      policy: (await q('SELECT * FROM policies WHERE tenant_id=$1 AND policy_id=$2', [tenant, bound.policyId])).rows,
      versions: (await q('SELECT * FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY version_id', [tenant, bound.policyId])).rows,
      transactions: (await q('SELECT * FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY transaction_id', [tenant, bound.policyId])).rows,
    })
    const before = await policyState()
    const body = { payload: payload(17), ...(action === 'renew' ? {} : { effectiveDate: '2026-08-01' }), overrideReason: 'Must not authorize inline' }
    const attempt = () => auth('post', `/api/v1/policies/${bound.policyId}/${action}`).send(body)
    const [blocked, simultaneous] = await Promise.all([attempt().expect(400), attempt().expect(400)])
    expect(blocked.body.code).toBe('UW_REFERRAL_REQUIRED')
    expect(simultaneous.body.code).toBe('UW_REFERRAL_REQUIRED')
    const referralId = blocked.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(referralId).toBeTruthy()
    expect(simultaneous.body.message).toContain(referralId)
    expect(await policyState()).toEqual(before)
    const detail = await auth('get', `/api/v1/uw/referrals/${referralId}`).expect(200)
    expect(detail.body.data ?? detail.body).toMatchObject({ referralId, policyId: bound.policyId, transactionType: type, status: 'Open' })
    await attempt().expect(400)
    expect((await q('SELECT referral_id FROM underwriting_referrals WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type=$3', [tenant, bound.policyId, type])).rows)
      .toEqual([{ referral_id: referralId }])
    expect(await policyState()).toEqual(before)
    await auth('patch', `/api/v1/uw/referrals/${referralId}/decide`).send({ decision: 'Approved', reason: 'Reviewed separately through referral detail' }).expect(200)
    const grant = (await q(`INSERT INTO underwriting_authority_grants
      (tenant_id,subject_type,subject_id,product_code,state_code,transaction_types,max_limit,effective_date,expiration_date)
      VALUES ($1,'ROLE','admin','personal-auto','CA',$2,1,'2026-01-01','2028-12-31') RETURNING grant_id`, [tenant, [type]])).rows[0].grant_id
    let approvedId = referralId
    try {
      const escalated = await attempt().expect(400)
      expect(escalated.body.code).toBe('UW_REFERRAL_REQUIRED')
      approvedId = escalated.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
      expect(approvedId).toBeTruthy()
      expect(approvedId).not.toBe(referralId)
      const escalatedDetail = await auth('get', `/api/v1/uw/referrals/${approvedId}`).expect(200)
      const entry = escalatedDetail.body.data ?? escalatedDetail.body
      expect(entry.status).toBe('Open')
      expect(entry.reasons.some((reason: string) => reason.startsWith('AUTHORITY_'))).toBe(true)
      expect(entry.proposalHash).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.proposalSnapshot.payload.coverages[0].limit).toBe(100000)
      expect(entry.proposalSnapshot.baseVersion.versionId).toBeTruthy()
      expect(await policyState()).toEqual(before)
      await auth('patch', `/api/v1/uw/referrals/${approvedId}/decide`).send({ decision: 'Approved', reason: 'Senior authority review of the newly required override' }).expect(200)
      // Same reason and date, but materially greater exposure: the prior
      // decision is evidence for 100k, never an open-ended authority override.
      body.payload.coverages[0].limit = 1000000
      const changed = await attempt().expect(400)
      const changedId = changed.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
      expect(changedId).toBeTruthy()
      expect(changedId).not.toBe(approvedId)
      const changedDetail = await auth('get', `/api/v1/uw/referrals/${changedId}`).expect(200)
      const changedEntry = changedDetail.body.data ?? changedDetail.body
      expect(changedEntry.reasons).toEqual(entry.reasons)
      expect(changedEntry.proposalHash).not.toBe(entry.proposalHash)
      expect(changedEntry.proposalSnapshot.payload.coverages[0].limit).toBe(1000000)
      const original = await auth('get', `/api/v1/uw/referrals/${approvedId}`).expect(200)
      expect((original.body.data ?? original.body).proposalSnapshot).toEqual(entry.proposalSnapshot)
      await expect(q('UPDATE underwriting_referrals SET proposal_hash=$1 WHERE tenant_id=$2 AND referral_id=$3', ['a'.repeat(64), tenant, approvedId]))
        .rejects.toThrow('immutable')
      expect(await policyState()).toEqual(before)
      approvedId = changedId
      await auth('patch', `/api/v1/uw/referrals/${approvedId}/decide`).send({ decision: 'Approved', reason: 'Explicitly reviewed the increased exposure' }).expect(200)
      await attempt().expect(200)
    } finally {
      await q('UPDATE underwriting_authority_grants SET active=false WHERE grant_id=$1', [grant])
    }
    const after = await policyState()
    expect(after.versions).toHaveLength(before.versions.length + 1)
    expect(after.transactions).toHaveLength(before.transactions.length + 1)
    const linked = (await q('SELECT status,transaction_id,version_id FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2', [tenant, approvedId])).rows[0]
    expect(linked.status).toBe('Approved')
    expect(linked.transaction_id).toBeTruthy()
    expect(linked.version_id).toBeTruthy()
  })

  it('bind requires exact reviewed evidence and does not reuse a legacy approval', async () => {
    const quote = await createOrRateQuote({} as any, tenant, payload(17), null, actor.username)
    const legacy = crypto.randomUUID()
    await q(`INSERT INTO underwriting_referrals (referral_id,tenant_id,quote_id,transaction_type,status,reasons,effective_date)
      VALUES ($1,$2,$3,'NewBusiness','Approved',$4,'2026-07-01')`, [legacy, tenant, quote.quoteId, quote.underwriting.reasons])
    const attempt = () => auth('post', `/api/v1/quotes/${quote.quoteId}/bind`).send({ proposalHash: 'forged', proposalSnapshot: {} })
    const [first, concurrent] = await Promise.all([attempt().expect(400), attempt().expect(400)])
    const id = first.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(id).toBeTruthy()
    expect(id).not.toBe(legacy)
    expect(concurrent.body.message).toContain(id)
    const detail = await auth('get', `/api/v1/uw/referrals/${id}`).expect(200)
    const entry = detail.body.data ?? detail.body
    expect(entry.proposalHash).toMatch(/^[0-9a-f]{64}$/)
    expect(entry.proposalSnapshot.payload).toMatchObject({ uwAnswers: { driverAge: 17 } })
    await auth('patch', `/api/v1/uw/referrals/${id}/decide`).send({ decision: 'Approved', reason: 'Reviewed this specific new business proposal' }).expect(200)
    const revised = payload(17)
    revised.coverages[0].limit = 1000000
    await createOrRateQuote({} as any, tenant, revised, quote.quoteId, actor.username)
    const changed = await attempt().expect(400)
    const changedId = changed.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(changedId).not.toBe(id)
    const revisedDetail = await auth('get', `/api/v1/uw/referrals/${changedId}`).expect(200)
    const revisedEntry = revisedDetail.body.data ?? revisedDetail.body
    expect(revisedEntry.reasons).toEqual(entry.reasons)
    expect(revisedEntry.proposalSnapshot.payload.coverages[0].limit).toBe(1000000)
    // Returning to the already-reviewed A proposal must find A, not let the
    // newer B work item shadow it. Only one concurrent retry can spend A.
    await createOrRateQuote({} as any, tenant, payload(17), quote.quoteId, actor.username)
    const policyCount = Number((await q('SELECT count(*) FROM policies WHERE tenant_id=$1', [tenant])).rows[0].count)
    const retries = await Promise.all([attempt(), attempt()])
    expect(retries.map(result => result.status).sort()).toEqual([200, 400])
    const success = retries.find(result => result.status === 200)!
    expect(success.body.data?.status ?? success.body.status).toBe('Bound')
    expect(Number((await q('SELECT count(*) FROM policies WHERE tenant_id=$1', [tenant])).rows[0].count)).toBe(policyCount + 1)
    const spent = (await q('SELECT policy_id,transaction_id,version_id FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2', [tenant, id])).rows[0]
    expect(spent.policy_id).toBe(success.body.data?.policyId ?? success.body.policyId)
    expect(spent.transaction_id).toBeTruthy()
    expect(spent.version_id).toBeTruthy()
  })

  it('requires another review after the base policy changes, even for an unchanged endorsement payload', async () => {
    const quote = await createOrRateQuote({} as any, tenant, payload(), null, actor.username)
    const bound = await bindQuote({} as any, tenant, quote.quoteId, {}, actor.username, actor.id, actor)
    await withTenantTx(tenant, db => issuePolicy(db, tenant, bound.policyId, {}, actor))
    const path = `/api/v1/policies/${bound.policyId}/endorse`
    const proposed = { payload: payload(17), effectiveDate: '2026-08-01' }
    const first = await auth('post', path).send(proposed).expect(400)
    const firstId = first.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    await auth('patch', `/api/v1/uw/referrals/${firstId}/decide`).send({ decision: 'Approved', reason: 'Reviewed against original policy version' }).expect(200)
    const nonReferred = payload()
    nonReferred.coverages[1].limit = 75000
    await auth('post', path).send({ payload: nonReferred, effectiveDate: '2026-07-15' }).expect(200)
    const changedBase = await auth('post', path).send(proposed).expect(400)
    const nextId = changedBase.body.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(nextId).toBeTruthy()
    expect(nextId).not.toBe(firstId)
    const before = await auth('get', `/api/v1/uw/referrals/${firstId}`).expect(200)
    const after = await auth('get', `/api/v1/uw/referrals/${nextId}`).expect(200)
    expect((after.body.data ?? after.body).proposalSnapshot.baseVersion.versionId)
      .not.toBe((before.body.data ?? before.body).proposalSnapshot.baseVersion.versionId)
    await auth('patch', `/api/v1/uw/referrals/${nextId}/decide`).send({ decision: 'Approved', reason: 'Reviewed against updated policy version' }).expect(200)
    await auth('post', path).send(proposed).expect(200)
  })
})
