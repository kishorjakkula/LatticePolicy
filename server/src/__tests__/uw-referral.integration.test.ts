import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { decideReferral, listReferrals } from '../services/uw-referral.service.js'

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
      decideReferral({} as any, tenantId, referralId, {
        decision: 'Approved',
        reason: 'not allowed',
        decidedBy: 'agent1',
        isUnderwriter: false,
      })
    ).rejects.toMatchObject({ code: 'REFERRAL_DECISION_FORBIDDEN' })

    // An underwriter approves the referral through the decision API.
    const decided = await decideReferral({} as any, tenantId, referralId, {
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
      decideReferral({} as any, tenantId, referralId, {
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

  it('underwriter can self-approve inline at bind time with a reason', async () => {
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

    const bound = await bindQuote(
      {} as any,
      tenantId,
      quote.quoteId,
      { overrideReason: 'Underwriter reviewed and approved inline' },
      'uw1',
      UW_USER_ID,
      { roles: ['underwriter'], permissions: ['uw.referrals.decide'] }
    )
    expect(bound.status).toBe('Bound')

    const referralRow = await db!.query(
      `SELECT status, decided_by, decision_reason FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referralRow.rowCount).toBe(1)
    expect(referralRow.rows[0].status).toBe('Approved')
    expect(referralRow.rows[0].decided_by).toBe(UW_USER_ID)
    expect(referralRow.rows[0].decision_reason).toBe('Underwriter reviewed and approved inline')
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

    const bound = await bindQuote(
      {} as any, tenantId, quote.quoteId,
      { overrideReason: 'Senior underwriting review approved the requested limit' },
      'uw-authority-override', UW_USER_ID,
      { roles: ['underwriter'], permissions: ['uw.referrals.decide', 'uw.authority.override'] }
    )
    expect(bound.status).toBe('Bound')

    const linked = await db!.query(
      `SELECT status,decision_reason,policy_id,transaction_id,version_id
         FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
      [tenantId, opened.rows[0].referral_id]
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

    const page = await listReferrals(db! as any, tenantId, { status: 'Open', page: 1, pageSize: 2 })

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
})
