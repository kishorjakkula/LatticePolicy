import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { decideReferral } from '../services/uw-referral.service.js'

// Task A integration coverage: the real-time aggregation/catastrophe-exposure
// appetite check wired into bindQuote (server/src/services/quote-bind.service.ts).
// Mirrors the existing uw-referral.integration.test.ts conventions: real DB,
// real bindQuote call, assert on the underwriting_referrals row it creates.

const UW_USER_ID = '33333333-3333-4333-a333-333333333333'
const tenantId = 'sample-carrier'

function eligibleAutoQuotePayload(stateCode: string, coverages: Array<{ code: string; limit: number }>) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: stateCode,
    applicant: {
      firstName: 'Aggregation',
      lastName: `Test-${stateCode}`,
      email: `aggregation-${stateCode.toLowerCase()}@example.com`,
    },
    uwAnswers: { driverAge: 35 },
    risks: [
      {
        type: 'autoVehicle',
        year: 2024,
        make: 'Toyota',
        model: 'Camry',
        garagingZip: '94105',
        symbol: 'A',
        usage: 'commute',
        driverAge: 35,
      },
    ],
    coverages: coverages.map((c) => ({ code: c.code, selected: true, limit: c.limit })),
  }
}

async function ensureTenant() {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD']
  )
}

/** Seeds one "Issued" in-force policy with a given total TIV, matching the
 * same dimension exposure.service.ts's loadExposureRows already aggregates. */
async function seedIssuedPolicyWithTiv(productCode: string, stateCode: string, tiv: number) {
  const db = getDb()!
  const policyResult = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,'Issued',$3,$4,'2026-01-01','2027-01-01')
     RETURNING policy_id`,
    [tenantId, `AGG-${productCode}-${stateCode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, productCode, stateCode]
  )
  const policyId = policyResult.rows[0].policy_id

  const txnResult = await db.query(
    `INSERT INTO policy_transactions (tenant_id, policy_id, type, status, effective_date)
     VALUES ($1,$2,'NB','Issued','2026-01-01')
     RETURNING transaction_id`,
    [tenantId, policyId]
  )
  const transactionId = txnResult.rows[0].transaction_id

  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, transaction_id, effective_date, transaction_type, premium_total, payload)
     VALUES ($1,$2,$3,'2026-01-01','NB',0,$4::jsonb)`,
    [
      tenantId,
      policyId,
      transactionId,
      JSON.stringify({ state: stateCode, coverages: [{ code: 'SEED', selected: true, limit: tiv }] }),
    ]
  )

  return policyId
}

async function setAggregationLimit(
  productCode: string,
  stateCode: string,
  limits: { maxTotalTiv?: number; maxPolicyCount?: number }
) {
  await getDb()!.query(
    `INSERT INTO aggregation_appetite_limits (tenant_id, product_code, state_code, max_total_tiv, max_policy_count, created_by)
     VALUES ($1,$2,$3,$4,$5,'integration-test')`,
    [tenantId, productCode, stateCode, limits.maxTotalTiv ?? null, limits.maxPolicyCount ?? null]
  )
}

describe('aggregation/catastrophe-exposure appetite check at bind', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('regression: never triggers a referral when no limit is configured, even with a large existing book', async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()

    const stateCode = 'TX'
    await seedIssuedPolicyWithTiv('personal-auto', stateCode, 50_000_000)

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      eligibleAutoQuotePayload(stateCode, [{ code: 'BI', limit: 100000 }, { code: 'PD', limit: 50000 }]),
      null,
      'integration-test'
    )
    expect(quote.underwriting?.decision).not.toBe('Decline')

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, {
      roles: ['agent'],
      permissions: [],
    })
    expect(bound.status).toBe('Bound')

    const referral = await getDb()!.query(
      `SELECT 1 FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referral.rowCount).toBe(0)
  })

  it('does not create a referral when a configured limit is not exceeded', async () => {
    await initDb()
    const stateCode = 'NY'
    await setAggregationLimit('personal-auto', stateCode, { maxTotalTiv: 2_000_000 })
    await seedIssuedPolicyWithTiv('personal-auto', stateCode, 900_000)

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      eligibleAutoQuotePayload(stateCode, [{ code: 'BI', limit: 100000 }, { code: 'PD', limit: 50000 }]),
      null,
      'integration-test'
    )

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, {
      roles: ['agent'],
      permissions: [],
    })
    expect(bound.status).toBe('Bound')

    const referral = await getDb()!.query(
      `SELECT 1 FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referral.rowCount).toBe(0)
  })

  it('creates an AGGREGATION_TIV_LIMIT_EXCEEDED referral when the bind would push the book over the configured limit, and still completes the bind once approved', async () => {
    await initDb()
    const stateCode = 'FL'
    await setAggregationLimit('personal-auto', stateCode, { maxTotalTiv: 1_000_000 })
    await seedIssuedPolicyWithTiv('personal-auto', stateCode, 900_000)

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      eligibleAutoQuotePayload(stateCode, [{ code: 'BI', limit: 100000 }, { code: 'PD', limit: 50000 }]),
      null,
      'integration-test'
    )

    // Agent (no UW permission) is blocked, same as every other referral path.
    await expect(
      bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, { roles: ['agent'], permissions: [] })
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    const referralRow = await getDb()!.query(
      `SELECT referral_id, status, reasons FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referralRow.rowCount).toBe(1)
    expect(referralRow.rows[0].status).toBe('Open')
    expect(referralRow.rows[0].reasons).toContain('AGGREGATION_TIV_LIMIT_EXCEEDED')
    const referralId = referralRow.rows[0].referral_id

    // Underwriter approves the referral through the normal decision API —
    // the same mechanism as every other UW-referral reason.
    const decided = await decideReferral({} as any, tenantId, referralId, {
      decision: 'Approved',
      reason: 'Reviewed accumulation in this territory, acceptable within treaty capacity',
      decidedBy: UW_USER_ID,
      isUnderwriter: true,
    })
    expect(decided.status).toBe('Approved')

    // Bind now completes, exactly like any other previously-referred bind.
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, {
      roles: ['agent'],
      permissions: [],
    })
    expect(bound.status).toBe('Bound')

    const linked = await getDb()!.query(
      `SELECT policy_id FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
      [tenantId, referralId]
    )
    expect(linked.rows[0].policy_id).toBe(bound.policyId)
  })
})
