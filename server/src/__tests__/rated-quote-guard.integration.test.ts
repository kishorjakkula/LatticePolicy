import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createOrRateQuote, updateDraftQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'

// WP-0008: a quote binds only on the risk it was rated for.

const tenantId = 'sample-carrier'
const otherTenant = `rated-guard-other-${Date.now()}`

function quotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
    risks: [{
      type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry',
      garagingZip: '94105', symbol: 'A', usage: 'commute', driverAge: 30,
    }],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    paymentPlan: 'monthly',
    billingMethod: 'direct',
    ...overrides,
  }
}

async function rate(overrides: Record<string, any> = {}, quoteId: string | null = null) {
  return createOrRateQuote({} as any, tenantId, quotePayload(overrides), quoteId, 'wp-0008-test')
}

async function stored(quoteId: string) {
  const r = await getDb()!.query('SELECT status, underwriting, premium, payload, status_history FROM quotes WHERE tenant_id=$1 AND quote_id=$2', [tenantId, quoteId])
  return r.rows[0]
}

async function policiesFor(quoteId: string) {
  const r = await getDb()!.query("SELECT count(*)::int AS n FROM quotes WHERE tenant_id=$1 AND quote_id=$2 AND converted_policy_id IS NOT NULL", [tenantId, quoteId])
  return r.rows[0].n as number
}

/** What the wizard sends on autosave: same risk, keys reordered, its own quoteId, no server-added fields. */
function wizardDraftPayload(quoteId: string, overrides: Record<string, any> = {}) {
  const { coverages, risks, ...rest } = quotePayload(overrides)
  return { quoteId, coverages, ...rest, risks }
}

describe('WP-0008 rated quote guard', () => {
  beforeAll(async () => {
    await initDb()
    await getDb()!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,$2,'en-US','USD')
       ON CONFLICT (tenant_id) DO NOTHING`, [tenantId, 'Sample Carrier'])
  }, 120_000)

  afterAll(async () => {
    await closeDb()
  })

  it('keeps the rating for an unchanged autosave and a billing-only change, and binds', async () => {
    const quote = await rate()
    expect(quote.status).toBe('Rated')
    const before = await stored(quote.quoteId)
    expect(before.underwriting.ratedFingerprint).toMatch(/^[a-f0-9]{64}$/)

    const same = await updateDraftQuote({} as any, tenantId, quote.quoteId, { payload: wizardDraftPayload(quote.quoteId), progressStep: 7 }, 'wp-0008-test')
    expect(same).toMatchObject({ status: 'Rated', ratingReset: false })

    const billing = await updateDraftQuote({} as any, tenantId, quote.quoteId, { payload: wizardDraftPayload(quote.quoteId, { paymentPlan: 'quarterly', billingMethod: 'agency' }) }, 'wp-0008-test')
    expect(billing).toMatchObject({ status: 'Rated', ratingReset: false })
    const after = await stored(quote.quoteId)
    expect(after.premium).toEqual(before.premium)
    expect(after.payload.paymentPlan).toBe('quarterly')

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null)
    expect(bound.status).toBe('Bound')
  })

  it('resets the rating when risk data changes, and bind refuses until it is rated again', async () => {
    const quote = await rate()
    const changed = await updateDraftQuote({} as any, tenantId, quote.quoteId, {
      payload: wizardDraftPayload(quote.quoteId, { coverages: [{ code: 'BI', selected: true, limit: 500000 }, { code: 'PD', selected: true, limit: 50000 }] }),
    }, 'wp-0008-test')
    expect(changed).toMatchObject({ status: 'Draft', ratingReset: true })
    const row = await stored(quote.quoteId)
    expect(row).toMatchObject({ status: 'Draft', underwriting: null, premium: null })
    expect(row.status_history.at(-1)).toMatchObject({ value: 'Draft' })

    await expect(bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null))
      .rejects.toMatchObject({ code: 'QUOTE_RERATE_REQUIRED', statusCode: 409 })
    expect(await policiesFor(quote.quoteId)).toBe(0)
  })

  it('refers the bind after a risky change is rated again', async () => {
    const quote = await rate()
    await updateDraftQuote({} as any, tenantId, quote.quoteId, {
      payload: wizardDraftPayload(quote.quoteId, { risks: [{ ...quotePayload().risks[0], driverAge: 17 }] }),
    }, 'wp-0008-test')
    const rerated = await rate({ risks: [{ ...quotePayload().risks[0], driverAge: 17 }] }, quote.quoteId)
    expect(rerated.underwriting.decision).toBe('Refer')
    await expect(bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null))
      .rejects.toMatchObject({ code: 'UW_REFERRAL_REQUIRED' })
    expect(await policiesFor(quote.quoteId)).toBe(0)
  })

  it('refuses a payload changed directly in storage after rating', async () => {
    const quote = await rate()
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{risks,0,driverAge}', '17'::jsonb) WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId])
    await expect(bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null))
      .rejects.toMatchObject({ code: 'QUOTE_RERATE_REQUIRED' })
    expect(await policiesFor(quote.quoteId)).toBe(0)
    const referrals = await getDb()!.query('SELECT count(*)::int AS n FROM underwriting_referrals WHERE tenant_id=$1 AND quote_id=$2', [tenantId, quote.quoteId])
    expect(referrals.rows[0].n).toBe(0)
  })

  it('accepts a rating from before WP-0008 (no fingerprint) as it stands', async () => {
    const quote = await rate()
    await getDb()!.query(`UPDATE quotes SET underwriting = underwriting - 'ratedFingerprint' WHERE tenant_id=$1 AND quote_id=$2`, [tenantId, quote.quoteId])
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null)
    expect(bound.status).toBe('Bound')
  })

  it('resets a pre-WP-0008 rating on its first risk change', async () => {
    const quote = await rate()
    await getDb()!.query(`UPDATE quotes SET underwriting = underwriting - 'ratedFingerprint' WHERE tenant_id=$1 AND quote_id=$2`, [tenantId, quote.quoteId])
    const changed = await updateDraftQuote({} as any, tenantId, quote.quoteId, { payload: wizardDraftPayload(quote.quoteId, { termMonths: 6 }) }, 'wp-0008-test')
    expect(changed).toMatchObject({ status: 'Draft', ratingReset: true })
  })

  it.each(['Rated', 'Bound', 'Converted', 'rated', 'Issued'])('refuses a client status %s on an unbound quote', async (status) => {
    const quote = await rate()
    await expect(updateDraftQuote({} as any, tenantId, quote.quoteId, { status }, 'wp-0008-test'))
      .rejects.toMatchObject({ code: 'INVALID_STATUS', statusCode: 400 })
    expect((await stored(quote.quoteId)).status).toBe('Rated')
  })

  it('refuses a non-string client status without a server error', async () => {
    const quote = await rate()
    await expect(updateDraftQuote({} as any, tenantId, quote.quoteId, { status: 42 }, 'wp-0008-test'))
      .rejects.toMatchObject({ code: 'INVALID_STATUS' })
  })

  it('allows the post-issue audit status on a bound quote, and a client Draft never reopens it', async () => {
    const quote = await rate()
    await bindQuote({} as any, tenantId, quote.quoteId, {}, 'wp-0008-test', null)
    const draft = await updateDraftQuote({} as any, tenantId, quote.quoteId, { status: 'Draft' }, 'wp-0008-test')
    expect(draft.status).toBe('Converted')
    const issued = await updateDraftQuote({} as any, tenantId, quote.quoteId, { status: 'Issued' }, 'wp-0008-test')
    expect(issued.status).toBe('Issued')
  })

  it("does not let another tenant change or see the quote", async () => {
    const quote = await rate()
    await getDb()!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,$2,'en-US','USD') ON CONFLICT DO NOTHING`,
      [otherTenant, 'Other tenant'])
    await expect(updateDraftQuote({} as any, otherTenant, quote.quoteId, { payload: wizardDraftPayload(quote.quoteId, { termMonths: 6 }) }, 'wp-0008-test'))
      .rejects.toMatchObject({ code: 'QUOTE_NOT_FOUND' })
    expect((await stored(quote.quoteId)).status).toBe('Rated')
  })
})
