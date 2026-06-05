import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'

function quotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    },
    risks: [
      {
        type: 'autoVehicle',
        year: 2023,
        make: 'Toyota',
        model: 'Camry',
        garagingZip: '94105',
        symbol: 'A',
        usage: 'commute',
      },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

describe('quote-to-bind persistence', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('rates a quote, binds it, and persists policy supporting records', async () => {
    await initDb()
    const db = getDb()
    expect(db).toBeTruthy()

    const tenantId = 'sample-carrier'
    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD'],
    )

    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      quotePayload(),
      null,
      'integration-test',
    )

    expect(quote.status).toBe('Rated')
    expect(quote.quoteId).toBeTruthy()
    expect(quote.premium.total.amount).toBeGreaterThan(0)

    const bound = await bindQuote(
      {} as any,
      tenantId,
      quote.quoteId,
      {},
      'integration-test',
      null,
    )

    expect(bound.status).toBe('Bound')
    expect(bound.policyId).toBeTruthy()
    expect(bound.transactionId).toBeTruthy()
    expect(bound.versionId).toBeTruthy()
    expect(bound.ratingId).toBeTruthy()
    expect(bound.premiumSummary.total.amount).toBeGreaterThan(0)

    const persisted = await db!.query(
      `SELECT
          (SELECT status FROM quotes WHERE tenant_id=$1 AND quote_id=$2) AS quote_status,
          (SELECT converted_policy_id::text FROM quotes WHERE tenant_id=$1 AND quote_id=$2) AS converted_policy_id,
          (SELECT status FROM policies WHERE tenant_id=$1 AND policy_id=$3) AS policy_status,
          (SELECT product_code FROM policies WHERE tenant_id=$1 AND policy_id=$3) AS product_code,
          (SELECT count(*)::int FROM policy_versions WHERE tenant_id=$1 AND policy_id=$3) AS version_count,
          (SELECT count(*)::int FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$3 AND type='NB' AND status='Bound') AS transaction_count,
          (SELECT count(*)::int FROM ratings WHERE tenant_id=$1 AND policy_id=$3) AS rating_count,
          (SELECT count(*)::int FROM risk_units WHERE tenant_id=$1 AND policy_id=$3) AS risk_count,
          (SELECT count(*)::int FROM coverages WHERE tenant_id=$1 AND policy_id=$3) AS coverage_count,
          (SELECT premium_total::numeric FROM policy_versions WHERE tenant_id=$1 AND policy_id=$3 LIMIT 1) AS premium_total`,
      [tenantId, quote.quoteId, bound.policyId],
    )
    const row = persisted.rows[0]

    expect(row.quote_status).toBe('Converted')
    expect(row.converted_policy_id).toBe(bound.policyId)
    expect(row.policy_status).toBe('Bound')
    expect(row.product_code).toBe('personal-auto')
    expect(row.version_count).toBe(1)
    expect(row.transaction_count).toBe(1)
    expect(row.rating_count).toBe(1)
    expect(row.risk_count).toBe(1)
    expect(row.coverage_count).toBe(2)
    expect(Number(row.premium_total)).toBeGreaterThan(0)

    const crossTenant = await db!.query(
      'SELECT count(*)::int AS count FROM policies WHERE tenant_id=$1 AND policy_id=$2',
      [`${tenantId}-other`, bound.policyId],
    )
    expect(crossTenant.rows[0].count).toBe(0)
  })
})
