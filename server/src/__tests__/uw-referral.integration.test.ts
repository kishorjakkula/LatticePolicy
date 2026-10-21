import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy, renewPolicy, rewritePolicy } from '../services/lifecycle.service.js'
import { executeEndorsement } from '../services/endorsement.service.js'
import { decideReferral, getReferral, listReferrals } from '../services/uw-referral.service.js'

// Services that take a db handle run inside a tenant transaction, as the routes do.
function decideReferralTx(tenant: string, referralId: string, input: Parameters<typeof decideReferral>[3]) {
  return withTenantTx(tenant, (db) => decideReferral(db, tenant, referralId, input))
}

const UW_USER_ID = '22222222-2222-4222-a222-222222222222'

function referQuotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: {
      firstName: 'Remy',
      lastName: 'Referral',
      email: 'remy@example.com',
    },
    uwAnswers: { driverAge: 17 },
    risks: [
      {
        type: 'autoVehicle',
        year: 2023,
        make: 'Toyota',
        model: 'Camry',
        garagingZip: '94105',
        symbol: 'A',
        usage: 'commute',
        driverAge: 17,
      },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

describe('underwriting referral workflow', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('quote refer -> referral created -> blocked -> approve -> bind succeeds', async () => {
    await initDb()
    const db = getDb()
    expect(db).toBeTruthy()

    const tenantId = 'sample-carrier'
    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD']
    )

    const quote = await createOrRateQuote({} as any, tenantId, referQuotePayload(), null, 'integration-test')
    expect(quote.underwriting?.decision).toBe('Refer')

    // Agent (no UW permission, no override) is blocked and a referral is opened.
    await expect(
      bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, { roles: ['agent'], permissions: [] })
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    const referralRow = await db!.query(
      `SELECT referral_id, status, reasons, quote_id, product_code FROM underwriting_referrals
        WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referralRow.rowCount).toBe(1)
    expect(referralRow.rows[0].status).toBe('Open')
    expect(referralRow.rows[0].product_code).toBe('personal-auto')
    const referralId = referralRow.rows[0].referral_id

    // Same agent retrying with a free-text reason but no UW permission is still blocked
    // (this is the vulnerability the referral workflow closes).
    await expect(
      bindQuote({} as any, tenantId, quote.quoteId, { overrideReason: 'trust me' }, 'agent1', null, {
        roles: ['agent'],
        permissions: [],
      })
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    // A non-underwriter cannot decide the referral directly either.
    await expect(
      decideReferralTx(tenantId, referralId, {
        decision: 'Approved',
        reason: 'not allowed',
        decidedBy: 'agent1',
        isUnderwriter: false,
      })
    ).rejects.toMatchObject({ code: 'REFERRAL_DECISION_FORBIDDEN' })

    // An underwriter approves the referral through the decision API.
    const decided = await decideReferralTx(tenantId, referralId, {
      decision: 'Approved',
      reason: 'Reviewed driving history, acceptable risk',
      decidedBy: UW_USER_ID,
      isUnderwriter: true,
    })
    expect(decided.status).toBe('Approved')
    expect(decided.decidedBy).toBe(UW_USER_ID)
    expect(decided.comments.length).toBeGreaterThanOrEqual(1)

    // Deciding again is rejected — a referral can't be re-decided.
    await expect(
      decideReferralTx(tenantId, referralId, {
        decision: 'Approved',
        reason: 'again',
        decidedBy: UW_USER_ID,
        isUnderwriter: true,
      })
    ).rejects.toMatchObject({ code: 'REFERRAL_NOT_DECIDABLE' })

    // Bind now succeeds because the referral is Approved.
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, {
      roles: ['agent'],
      permissions: [],
    })
    expect(bound.status).toBe('Bound')

    const linked = await db!.query(
      `SELECT policy_id, transaction_id, version_id FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
      [tenantId, referralId]
    )
    expect(linked.rows[0].policy_id).toBe(bound.policyId)
    expect(linked.rows[0].transaction_id).toBe(bound.transactionId)
    expect(linked.rows[0].version_id).toBe(bound.versionId)
  })

  it('underwriter bind override cannot decide a referral; explicit approval unblocks bind', async () => {
    await initDb()
    const db = getDb()
    const tenantId = 'sample-carrier'

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      referQuotePayload({ applicant: { firstName: 'Sam', lastName: 'SelfApprove', email: 'sam@example.com' } }),
      null,
      'integration-test'
    )
    expect(quote.underwriting?.decision).toBe('Refer')

    const attempt = () => bindQuote(
      {} as any,
      tenantId,
      quote.quoteId,
      { overrideReason: 'Underwriter reviewed and approved inline' },
      'uw1',
      UW_USER_ID,
      { roles: ['underwriter'], permissions: ['uw.referrals.decide'] }
    )
    await expect(attempt()).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    const referralRow = await db!.query(
      `SELECT * FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referralRow.rowCount).toBe(1)
    expect(referralRow.rows[0]).toMatchObject({
      status: 'Open', decision: null, decided_by: null, decided_at: null, decision_reason: null, comments: [],
    })
    await expect(attempt()).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    const retried = await db!.query(
      `SELECT * FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(retried.rows).toEqual(referralRow.rows)

    await decideReferralTx(tenantId, referralRow.rows[0].referral_id, {
      decision: 'Approved', reason: 'Reviewed on referral detail', decidedBy: UW_USER_ID, isUnderwriter: true,
    })
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'uw1', UW_USER_ID, {
      roles: ['underwriter'], permissions: ['uw.referrals.decide'],
    })
    expect(bound.status).toBe('Bound')
  })

  it('enforces configured authority and requires explicit override permission and reason', async () => {
    await initDb()
    const db = getDb()
    const tenantId = 'sample-carrier'

    await db!.query(
      `INSERT INTO underwriting_authority_grants
         (tenant_id,subject_type,subject_id,product_code,state_code,transaction_types,max_limit,effective_date,expiration_date)
       VALUES ($1,'ROLE','agent','personal-auto','CA',ARRAY['NewBusiness'],50000,'2028-01-01','2028-12-31')`,
      [tenantId]
    )
    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      referQuotePayload({
        effectiveDate: '2028-06-01',
        applicant: { firstName: 'Avery', lastName: 'Authority', email: 'avery@example.com' },
        uwAnswers: { driverAge: 35 },
        risks: [{
          type: 'autoVehicle', year: 2024, make: 'Toyota', model: 'Camry',
          garagingZip: '94105', symbol: 'A', usage: 'commute', driverAge: 35,
        }],
      }),
      null,
      'integration-test'
    )
    expect(quote.underwriting?.decision).toBe('Eligible')

    await expect(
      bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent-authority', null, {
        roles: ['agent'], permissions: [],
      })
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    const opened = await db!.query(
      `SELECT referral_id,reasons FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(opened.rows[0].reasons).toContain('AUTHORITY_LIMIT_AUTHORITY_EXCEEDED')

    await expect(
      bindQuote(
        {} as any, tenantId, quote.quoteId, { overrideReason: 'Reviewed' },
        'uw-without-authority-override', UW_USER_ID,
        { roles: ['underwriter'], permissions: ['uw.referrals.decide'] }
      )
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    await expect(bindQuote(
      {} as any, tenantId, quote.quoteId,
      { overrideReason: 'Senior underwriting review approved the requested limit' },
      'uw-authority-override', UW_USER_ID,
      { roles: ['underwriter'], permissions: ['uw.referrals.decide', 'uw.authority.override'] }
    )).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    const referralId = opened.rows[0].referral_id
    const unchanged = await db!.query(
      `SELECT status,decision,decided_by,decided_at,decision_reason,comments
         FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
      [tenantId, referralId]
    )
    expect(unchanged.rows[0]).toMatchObject({
      status: 'Open', decision: null, decided_by: null, decided_at: null, decision_reason: null, comments: [],
    })
    for (const input of [
      { canOverrideAuthority: false, reason: 'Reviewed' },
      { canOverrideAuthority: true, reason: '   ' },
    ]) {
      await expect(decideReferralTx(tenantId, referralId, {
        decision: 'Approved', decidedBy: UW_USER_ID, isUnderwriter: true, ...input,
      })).rejects.toMatchObject({ code: 'AUTHORITY_OVERRIDE_REQUIRED' })
    }
    // The intervening underwriter attempt evaluated a different authority
    // requirement. Re-evaluate the agent's actual bind context before review.
    const agentAttempt = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent-authority', null, {
      roles: ['agent'], permissions: [],
    }).catch(error => error)
    expect(agentAttempt).toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    const currentReferral = agentAttempt.message.match(/Referral ([0-9a-f-]{36})/)?.[1]
    expect(currentReferral).toBe(referralId)
    await decideReferralTx(tenantId, currentReferral, {
      decision: 'Approved', reason: 'Senior underwriting review approved the requested limit',
      decidedBy: UW_USER_ID, isUnderwriter: true, canOverrideAuthority: true,
    })
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent-authority', null, {
      roles: ['agent'], permissions: [],
    })
    expect(bound.status).toBe('Bound')

    const linked = await db!.query(
      `SELECT status,decision_reason,policy_id,transaction_id,version_id
         FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
      [tenantId, currentReferral]
    )
    expect(linked.rows[0]).toMatchObject({
      status: 'Approved',
      decision_reason: 'Senior underwriting review approved the requested limit',
      policy_id: bound.policyId,
      transaction_id: bound.transactionId,
      version_id: bound.versionId,
    })
  })

  it('reports the full filtered referral total across pages', async () => {
    await initDb()
    const db = getDb()
    const tenantId = 'sample-carrier'

    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD']
    )

    await db!.query(
      `INSERT INTO underwriting_referrals
         (tenant_id, transaction_type, status, product_code, insured_name, reasons, created_at)
       VALUES
         ($1, 'NewBusiness', 'Open', 'personal-auto', 'Paged One', ARRAY['age'], now() - interval '3 seconds'),
         ($1, 'Renew', 'Open', 'personal-auto', 'Paged Two', ARRAY['losses'], now() - interval '2 seconds'),
         ($1, 'Rewrite', 'Open', 'personal-auto', 'Paged Three', ARRAY['vehicle'], now() - interval '1 second')`,
      [tenantId]
    )

    const page = await withTenantTx(tenantId, (txDb) => listReferrals(txDb, tenantId, { status: 'Open', page: 1, pageSize: 2 }))

    expect(page.items).toHaveLength(2)
    expect(page.total).toBeGreaterThanOrEqual(3)
    expect(page.total).toBe(
      Number(
        (
          await db!.query(
            `SELECT count(*) AS total
               FROM underwriting_referrals
              WHERE tenant_id = $1 AND status = 'Open'`,
            [tenantId]
          )
        ).rows[0].total
      )
    )
  })

  it.each(['Endorse', 'Renew', 'Rewrite'] as const)('%s override stays blocked without a separate referral decision', async (transactionType) => {
    await initDb()
    const db = getDb()!
    const tenantId = 'sample-carrier'
    const actor = { id: UW_USER_ID, username: 'uw1', roles: ['underwriter'], permissions: ['uw.referrals.decide', 'uw.authority.override'] }
    const cleanPayload = referQuotePayload({
      uwAnswers: { driverAge: 35 },
      risks: [{ ...referQuotePayload().risks[0], driverAge: 35 }],
    })
    const quote = await createOrRateQuote({} as any, tenantId, cleanPayload, null, 'integration-test')
    expect(quote.underwriting?.decision).toBe('Eligible')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'uw1', UW_USER_ID, actor)
    await withTenantTx(tenantId, tx => issuePolicy(tx, tenantId, bound.policyId, {}, actor))
    if (transactionType === 'Rewrite') {
      await withTenantTx(tenantId, tx => cancelPolicy(tx, tenantId, bound.policyId, {
        effectiveDate: '2026-07-15', reason: 'Rewrite requested',
      }, actor))
    }
    const current = await db.query(
      `SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1`,
      [tenantId, bound.policyId]
    )
    const payload = { ...current.rows[0].payload, uwAnswers: { driverAge: 17 }, risks: referQuotePayload().risks }
    const execute = transactionType === 'Endorse' ? executeEndorsement : transactionType === 'Renew' ? renewPolicy : rewritePolicy
    const body = { payload, ...(transactionType !== 'Renew' ? { effectiveDate: '2026-08-01' } : {}) }
    const override = { ...body, overrideReason: 'Underwriter override must not approve' }
    // Catch the domain rejection inside the transaction to retain the newly
    // opened referral for explicit review, without changing the service caller.
    await withTenantTx(tenantId, async tx => {
      await expect(execute(tx, tenantId, bound.policyId, override, actor)).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    })
    const referrals = () => db.query(
      `SELECT * FROM underwriting_referrals WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type=$3`,
      [tenantId, bound.policyId, transactionType]
    )
    const opened = await referrals()
    expect(opened.rowCount).toBe(1)
    expect(opened.rows[0]).toMatchObject({ status: 'Open', decision: null, decided_by: null, decided_at: null, decision_reason: null, comments: [] })
    await expect(withTenantTx(tenantId, tx => execute(tx, tenantId, bound.policyId, override, actor)))
      .rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    expect((await referrals()).rows).toEqual(opened.rows)
    await decideReferralTx(tenantId, opened.rows[0].referral_id, {
      decision: 'Approved', reason: 'Reviewed transaction referral detail', decidedBy: UW_USER_ID, isUnderwriter: true,
    })
    const result = await withTenantTx(tenantId, tx => execute(tx, tenantId, bound.policyId, body, actor))
    expect(result.versionId).toBeTruthy()
    const version = await db.query(
      `SELECT transaction_id FROM policy_versions WHERE tenant_id=$1 AND version_id=$2`,
      [tenantId, result.versionId]
    )
    expect(version.rows[0].transaction_id).toBeTruthy()
    expect((await referrals()).rows[0]).toMatchObject({
      status: 'Approved', decision_reason: 'Reviewed transaction referral detail',
      transaction_id: version.rows[0].transaction_id, version_id: result.versionId,
    })
  })

  // WP-0004 REQ-1 / REQ-17: queue sort, premium, decision reason rule and
  // tenant isolation, on two dedicated tenants so other suites' rows do not
  // change the ordering.
  describe('referral queue and decision rules (WP-0004)', () => {
    const run = Date.now().toString(36)
    const tenantA = `wp4-ref-a-${run}`
    const tenantB = `wp4-ref-b-${run}`

    async function ensureTenants() {
      await initDb()
      const db = getDb()!
      for (const tenant of [tenantA, tenantB]) {
        await db.query(
          `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
           VALUES ($1,$2,'en-US','USD') ON CONFLICT (tenant_id) DO NOTHING`,
          [tenant, `WP-0004 ${tenant}`]
        )
      }
      return db
    }

    async function insertReferral(tenant: string, fields: Record<string, any>) {
      const db = getDb()!
      const r = await db.query(
        `INSERT INTO underwriting_referrals
           (tenant_id, quote_id, policy_id, transaction_type, status, product_code, insured_name, reasons, created_at)
         VALUES ($1,$2,$3,$4,$5,'personal-auto',$6,$7,$8)
         RETURNING referral_id`,
        [
          tenant,
          fields.quoteId ?? null,
          fields.policyId ?? null,
          fields.transactionType ?? 'NewBusiness',
          fields.status ?? 'Open',
          fields.insuredName,
          fields.reasons ?? ['Annual miles > 35k (refer)'],
          fields.createdAt,
        ]
      )
      return r.rows[0].referral_id as string
    }

    async function referralState(tenant: string, referralId: string) {
      const r = await getDb()!.query(
        `SELECT status, decision, decision_reason, comments FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
        [tenant, referralId]
      )
      return r.rows[0]
    }

    it('lists Open oldest first by default, newest first on request, and pages consistently', async () => {
      await ensureTenants()
      const oldest = await insertReferral(tenantA, { insuredName: 'Age Ten', createdAt: new Date(Date.now() - 10 * 86400000) })
      const middle = await insertReferral(tenantA, { insuredName: 'Age Five', createdAt: new Date(Date.now() - 5 * 86400000) })
      const newest = await insertReferral(tenantA, { insuredName: 'Age One', createdAt: new Date(Date.now() - 1 * 86400000) })
      await insertReferral(tenantA, { insuredName: 'Decided Old', status: 'Approved', createdAt: new Date(Date.now() - 20 * 86400000) })

      const defaultOrder = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { status: 'Open', page: 1, pageSize: 20 }))
      expect(defaultOrder.sort).toBe('oldest')
      expect(defaultOrder.items.map((item: any) => item.referralId)).toEqual([oldest, middle, newest])
      expect(defaultOrder.total).toBe(3)

      const newestFirst = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { status: 'Open', sort: 'newest', page: 1, pageSize: 20 }))
      expect(newestFirst.items.map((item: any) => item.referralId)).toEqual([newest, middle, oldest])

      const page1 = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { status: 'Open', page: 1, pageSize: 2 }))
      const page2 = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { status: 'Open', page: 2, pageSize: 2 }))
      expect([...page1.items, ...page2.items].map((item: any) => item.referralId)).toEqual([oldest, middle, newest])
      expect(page2.total).toBe(3)

      // No status filter keeps the existing newest-first behaviour.
      const all = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { page: 1, pageSize: 20 }))
      expect(all.sort).toBe('newest')
      expect(all.items[0].referralId).toBe(newest)
    })

    it("returns premium from the policy's latest version, else the rated quote, else null", async () => {
      const db = await ensureTenants()
      const policy = await db.query(
        `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
         VALUES ($1,$2,'Issued','personal-auto','CA','2026-01-01','2027-01-01') RETURNING policy_id`,
        [tenantA, `WP4-${run}`]
      )
      const policyId = policy.rows[0].policy_id
      await db.query(
        `INSERT INTO policy_versions (tenant_id, policy_id, effective_date, transaction_type, premium_total, currency, processed_at)
         VALUES ($1,$2,'2026-01-01','NB',1000.00,'USD', now() - interval '2 days'),
                ($1,$2,'2026-03-01','ENDORSE',1250.40,'USD', now() - interval '1 day')`,
        [tenantA, policyId]
      )
      const quote = await db.query(
        `INSERT INTO quotes (tenant_id, product_code, effective_date, term_months, payload, premium)
         VALUES ($1,'personal-auto','2026-07-01',12,'{}'::jsonb,$2::jsonb) RETURNING quote_id`,
        [tenantA, JSON.stringify({ total: { amount: 775.21, currency: 'USD' } })]
      )
      // A quote in tenant B with the same id would never be visible; the join
      // is tenant-scoped, so a referral pointing at it gets no premium.
      const foreignQuote = await db.query(
        `INSERT INTO quotes (tenant_id, product_code, effective_date, term_months, payload, premium)
         VALUES ($1,'personal-auto','2026-07-01',12,'{}'::jsonb,$2::jsonb) RETURNING quote_id`,
        [tenantB, JSON.stringify({ total: { amount: 99999, currency: 'USD' } })]
      )

      const created = new Date(Date.now() - 30 * 86400000)
      const onPolicy = await insertReferral(tenantA, { insuredName: 'Premium Policy', policyId, transactionType: 'Renew', status: 'InfoRequested', createdAt: created })
      const onQuote = await insertReferral(tenantA, { insuredName: 'Premium Quote', quoteId: quote.rows[0].quote_id, status: 'InfoRequested', createdAt: created })
      const unrated = await insertReferral(tenantA, { insuredName: 'Premium None', status: 'InfoRequested', createdAt: created })
      const crossTenant = await insertReferral(tenantA, { insuredName: 'Premium Foreign', quoteId: foreignQuote.rows[0].quote_id, status: 'InfoRequested', createdAt: created })

      const listed = await withTenantTx(tenantA, (tx) => listReferrals(tx, tenantA, { status: 'InfoRequested', page: 1, pageSize: 50 }))
      const byId = new Map<string, any>(listed.items.map((item: any) => [item.referralId, item]))
      expect(byId.get(onPolicy)!.premium).toEqual({ amount: 1250.4, currency: 'USD' })
      expect(byId.get(onPolicy)!.policyNumber).toBe(`WP4-${run}`)
      expect(byId.get(onQuote)!.premium).toEqual({ amount: 775.21, currency: 'USD' })
      expect(byId.get(unrated)!.premium).toBeNull()
      expect(byId.get(crossTenant)!.premium).toBeNull()

      // The detail view returns the same premium as the list.
      const detail = await withTenantTx(tenantA, (tx) => getReferral(tx, tenantA, onQuote))
      expect(detail.premium).toEqual({ amount: 775.21, currency: 'USD' })

      // The latest-version lookup can use the (tenant_id, policy_id, processed_at DESC)
      // index. Sequential scans are disabled only inside this transaction so the
      // plan check does not depend on the size of the test tables.
      await withTenantTx(tenantA, async (tx) => {
        const q = toRawQuery(tx)
        await q('SET LOCAL enable_seqscan = off')
        const plan = await q(
          `EXPLAIN SELECT v.premium_total FROM policy_versions v
            WHERE v.tenant_id = $1 AND v.policy_id = $2 ORDER BY v.processed_at DESC LIMIT 1`,
          [tenantA, policyId]
        )
        expect(plan.rows.map((row: any) => row['QUERY PLAN']).join('\n')).toContain('idx_policy_versions_policy')
      })
    })

    it('requires a reason to approve or decline, keeps Request info optional, and records the trimmed reason', async () => {
      await ensureTenants()
      const created = new Date(Date.now() - 2 * 86400000)
      const toApprove = await insertReferral(tenantA, { insuredName: 'Reason Approve', createdAt: created })
      const toDecline = await insertReferral(tenantA, { insuredName: 'Reason Decline', createdAt: created })
      const toInfo = await insertReferral(tenantA, { insuredName: 'Reason Info', createdAt: created })

      for (const [referralId, decision] of [[toApprove, 'Approved'], [toDecline, 'Declined']] as const) {
        for (const reason of [undefined, '', '   \n\t ']) {
          await expect(
            withTenantTx(tenantA, (db) => decideReferral(db, tenantA, referralId, { decision, reason, decidedBy: UW_USER_ID, isUnderwriter: true }))
          ).rejects.toMatchObject({ code: 'REASON_REQUIRED', statusCode: 400 })
        }
        const unchanged = await referralState(tenantA, referralId)
        expect(unchanged).toMatchObject({ status: 'Open', decision: null, decision_reason: null })
        expect(unchanged.comments).toEqual([])
      }

      const approved = await withTenantTx(tenantA, (db) => decideReferral(db, tenantA, toApprove, {
        decision: 'Approved', reason: '  Clean MVR, mileage verified  ', decidedBy: UW_USER_ID, isUnderwriter: true,
      }))
      expect(approved).toMatchObject({ status: 'Approved', decisionReason: 'Clean MVR, mileage verified' })
      expect(approved.comments.at(-1)).toMatchObject({ text: 'Clean MVR, mileage verified', decision: 'Approved' })

      const declined = await withTenantTx(tenantA, (db) => decideReferral(db, tenantA, toDecline, {
        decision: 'Declined', reason: 'Outside appetite', decidedBy: UW_USER_ID, isUnderwriter: true,
      }))
      expect(declined).toMatchObject({ status: 'Declined', decisionReason: 'Outside appetite' })

      const info = await withTenantTx(tenantA, (db) => decideReferral(db, tenantA, toInfo, {
        decision: 'InfoRequested', decidedBy: UW_USER_ID, isUnderwriter: true,
      }))
      expect(info).toMatchObject({ status: 'InfoRequested', decisionReason: null })
    })

    it('keeps AUTHORITY_OVERRIDE_REQUIRED for an authority referral without override permission', async () => {
      await ensureTenants()
      const referralId = await insertReferral(tenantA, {
        insuredName: 'Authority Limit', reasons: ['AUTHORITY_LIMIT_AUTHORITY_EXCEEDED'], createdAt: new Date(),
      })
      await expect(
        withTenantTx(tenantA, (db) => decideReferral(db, tenantA, referralId, {
          decision: 'Approved', reason: 'Looks fine', decidedBy: UW_USER_ID, isUnderwriter: true, canOverrideAuthority: false,
        }))
      ).rejects.toMatchObject({ code: 'AUTHORITY_OVERRIDE_REQUIRED', statusCode: 403 })
      expect((await referralState(tenantA, referralId)).status).toBe('Open')
    })

    it("returns 404 for another tenant's referral and leaves it unchanged", async () => {
      await ensureTenants()
      const foreign = await insertReferral(tenantB, { insuredName: 'Other Tenant', createdAt: new Date(Date.now() - 40 * 86400000) })

      for (const decision of ['Approved', 'Declined', 'InfoRequested'] as const) {
        await expect(
          withTenantTx(tenantA, (db) => decideReferral(db, tenantA, foreign, { decision, reason: 'Cross-tenant attempt', decidedBy: UW_USER_ID, isUnderwriter: true }))
        ).rejects.toMatchObject({ code: 'REFERRAL_NOT_FOUND', statusCode: 404 })
      }
      await expect(withTenantTx(tenantA, (db) => getReferral(db, tenantA, foreign))).rejects.toMatchObject({ code: 'REFERRAL_NOT_FOUND' })

      const listedA = await withTenantTx(tenantA, (db) => listReferrals(db, tenantA, { page: 1, pageSize: 100 }))
      expect(listedA.items.map((item: any) => item.referralId)).not.toContain(foreign)

      const state = await referralState(tenantB, foreign)
      expect(state).toMatchObject({ status: 'Open', decision: null, decision_reason: null })
      expect(state.comments).toEqual([])
    })
  })
})
