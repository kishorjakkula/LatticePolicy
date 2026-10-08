import crypto from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { decideReferral } from '../services/uw-referral.service.js'

// Task B integration coverage: the internal-record consistency check wired
// into bindQuote (server/src/services/quote-bind.service.ts). Mirrors the
// existing uw-referral.integration.test.ts conventions: real DB, real
// bindQuote call, assert on the underwriting_referrals row it creates.

const UW_USER_ID = '44444444-4444-4444-a444-444444444444'
const tenantId = 'sample-carrier'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant() {
  await getDb()!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD']
  )
}

async function createCustomer(displayName: string): Promise<string> {
  const result = await getDb()!.query(
    `INSERT INTO customers (tenant_id, customer_key, entity_type, status, display_name)
     VALUES ($1,$2,'INDIVIDUAL','ACTIVE',$3)
     RETURNING customer_id`,
    [tenantId, `CUST-${suffix()}`, displayName]
  )
  return result.rows[0].customer_id
}

/** Seeds a prior (already-cancelled) policy linked to `customerId`, with a
 * `Cancel` policy_versions row carrying the given cancellation_type and
 * effective (cancellation) date. */
async function seedPriorCancelledPolicy(
  customerId: string,
  cancellationType: string,
  cancellationEffectiveDate: string
) {
  const db = getDb()!
  const policyResult = await db.query(
    `INSERT INTO policies (tenant_id, policy_number, status, product_code, jurisdiction_code, term_effective_date, term_expiration_date)
     VALUES ($1,$2,'Cancelled','personal-auto','CA','2025-01-01','2026-01-01')
     RETURNING policy_id`,
    [tenantId, `IC-${suffix()}`]
  )
  const policyId = policyResult.rows[0].policy_id

  await db.query(
    `INSERT INTO policy_versions (tenant_id, policy_id, effective_date, transaction_type, premium_total, cancellation_type)
     VALUES ($1,$2,$3,'CANCEL',0,$4)`,
    [tenantId, policyId, cancellationEffectiveDate, cancellationType]
  )

  await db.query(
    `INSERT INTO policy_customer_links (tenant_id, policy_id, customer_id, role_code, is_primary, source, metadata)
     VALUES ($1,$2,$3,'PRIMARY_NAMED_INSURED', true, 'quote', '{}'::jsonb)`,
    [tenantId, policyId, customerId]
  )

  return policyId
}

function autoQuotePayload(opts: {
  lastName: string
  customerId?: string
  continuousInsurance6Months?: boolean
}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    insureds: {
      primary: {
        firstName: 'Internal',
        lastName: opts.lastName,
        ...(opts.customerId ? { customerId: opts.customerId } : {}),
      },
    },
    applicant: { firstName: 'Internal', lastName: opts.lastName, email: `${opts.lastName.toLowerCase()}@example.com` },
    uwAnswers: {
      driverAge: 35,
      ...(opts.continuousInsurance6Months !== undefined
        ? { continuousInsurance6Months: opts.continuousInsurance6Months }
        : {}),
    },
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
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
  }
}

describe('internal-record consistency check at bind', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('regression: no referral when the submission does not match an existing customer', async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      autoQuotePayload({ lastName: `Unmatched-${suffix()}`, continuousInsurance6Months: true }),
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

  it('regression: no referral when the matched customer has a prior cancellation that is NOT non-payment', async () => {
    await initDb()
    const customerId = await createCustomer(`Clean-${suffix()}`)
    await seedPriorCancelledPolicy(customerId, 'SHORT_RATE', '2026-03-15')

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      autoQuotePayload({ lastName: 'CleanHistory', customerId, continuousInsurance6Months: true }),
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

  it('creates a referral when a matched customer has a prior NON_PAYMENT cancellation contradicting the qualification answer', async () => {
    await initDb()
    const customerId = await createCustomer(`Discrepancy-${suffix()}`)
    // Cancellation effective 2026-03-15 is inside the 6-month lookback window
    // ending on the new policy's 2026-07-01 effective date.
    await seedPriorCancelledPolicy(customerId, 'NON_PAYMENT', '2026-03-15')

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      autoQuotePayload({ lastName: 'Discrepancy', customerId, continuousInsurance6Months: true }),
      null,
      'integration-test'
    )

    await expect(
      bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, { roles: ['agent'], permissions: [] })
    ).rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })

    const referralRow = await getDb()!.query(
      `SELECT referral_id, status, reasons FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    expect(referralRow.rowCount).toBe(1)
    expect(referralRow.rows[0].reasons).toContain(
      'INTERNAL_RECORD_PRIOR_NONPAYMENT_CANCELLATION_CONTRADICTS_QUALIFICATION'
    )
    const referralId = referralRow.rows[0].referral_id

    const decided = await decideReferral({} as any, tenantId, referralId, {
      decision: 'Approved',
      reason: 'Confirmed with insured; approved with updated premium basis',
      decidedBy: UW_USER_ID,
      isUnderwriter: true,
    })
    expect(decided.status).toBe('Approved')

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'agent1', null, {
      roles: ['agent'],
      permissions: [],
    })
    expect(bound.status).toBe('Bound')
  })
})
