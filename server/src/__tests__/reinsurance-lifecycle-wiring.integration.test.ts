import crypto from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { executeEndorsement } from '../services/endorsement.service.js'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

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

describe('reinsurance placement auto-compute wiring', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('computes a real (non-Unplaced) placement automatically on bind, with no manual admin call', async () => {
    await initDb()
    const db = getDb()
    expect(db).toBeTruthy()

    const tenantId = 'sample-carrier'
    const run = suffix()
    await db!.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD'],
    )

    // A treaty covering personal-auto/CA for the quote's effective date window.
    const treatyResult = await db!.query(
      `INSERT INTO reinsurance_treaties
         (tenant_id, treaty_name, treaty_type, status, effective_date, expiration_date, product_codes, state_codes)
       VALUES ($1,$2,'QUOTA_SHARE','Active','2026-01-01','2027-01-01',ARRAY['personal-auto']::text[],ARRAY['CA']::text[])
       RETURNING treaty_id`,
      [tenantId, `Auto Wiring Treaty ${run}`],
    )
    const treatyId = treatyResult.rows[0].treaty_id
    await db!.query(
      `INSERT INTO reinsurance_treaty_layers (tenant_id, treaty_id, layer_number, ceded_percent, retained_percent)
       VALUES ($1,$2,1,35,65)`,
      [tenantId, treatyId],
    )

    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    expect(quote.status).toBe('Rated')

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    expect(bound.status).toBe('Bound')
    expect(bound.policyId).toBeTruthy()
    expect(bound.transactionId).toBeTruthy()

    // No call to the on-demand compute API here — this asserts the automatic wiring.
    const placements = await db!.query(
      `SELECT placement_type, treaty_id, ceded_percent, retained_percent
         FROM policy_reinsurance_placements
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3`,
      [tenantId, bound.policyId, bound.transactionId],
    )
    expect(placements.rows).toHaveLength(1)
    expect(placements.rows[0]).toMatchObject({
      placement_type: 'TREATY',
      treaty_id: treatyId,
      ceded_percent: '35.000',
      retained_percent: '65.000',
    })
  })

  it('leaves a policy with no applicable treaty explicitly Unplaced (zero placement rows, bind still succeeds)', async () => {
    await initDb()
    const db = getDb()!
    const tenantId = 'sample-carrier'

    await db.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD'],
    )

    // No treaty at all applies to homeowners in this test's data set.
    const quote = await createOrRateQuote(
      {} as any,
      tenantId,
      {
        productCode: 'homeowners',
        effectiveDate: '2026-07-01',
        termMonths: 12,
        state: 'TX',
        applicant: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' },
        risks: [
          {
            type: 'dwelling',
            yearBuilt: 2005,
            construction: 'frame',
            address: '1 Elm St, Austin, TX 78701',
          },
        ],
        coverages: [{ code: 'A', selected: true, limit: 300000 }],
      },
      null,
      'integration-test',
    )
    expect(quote.status).toBe('Rated')

    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    expect(bound.status).toBe('Bound')

    const placements = await db.query(
      `SELECT count(*)::int AS count FROM policy_reinsurance_placements
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3`,
      [tenantId, bound.policyId, bound.transactionId],
    )
    expect(placements.rows[0].count).toBe(0)
  })

  it('recomputes placement on an endorsement without duplicating rows for the bind transaction', async () => {
    await initDb()
    const db = getDb()!
    const tenantId = 'sample-carrier'
    const run = suffix()

    await db.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
      [tenantId, 'Sample Carrier', 'en-US', 'USD'],
    )

    // Uses TX rather than CA (the quotePayload() default and the state the
    // earlier "computes a real placement" test's treaty covers) so this
    // test's own treaty is the only one matching its quote. sample-carrier
    // is a shared tenant across this file's sequential tests with no
    // cleanup between them, so a CA/personal-auto treaty from an earlier
    // test would otherwise also match here and inflate the placement count.
    const treatyResult = await db.query(
      `INSERT INTO reinsurance_treaties
         (tenant_id, treaty_name, treaty_type, status, effective_date, expiration_date, product_codes, state_codes)
       VALUES ($1,$2,'QUOTA_SHARE','Active','2026-01-01','2027-01-01',ARRAY['personal-auto']::text[],ARRAY['TX']::text[])
       RETURNING treaty_id`,
      [tenantId, `Endorsement Wiring Treaty ${run}`],
    )
    const treatyId = treatyResult.rows[0].treaty_id
    await db.query(
      `INSERT INTO reinsurance_treaty_layers (tenant_id, treaty_id, layer_number, ceded_percent, retained_percent)
       VALUES ($1,$2,1,20,80)`,
      [tenantId, treatyId],
    )

    const quote = await createOrRateQuote({} as any, tenantId, quotePayload({ state: 'TX' }), null, 'integration-test')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)

    // Scoped to this test's own treaty_id, not just transaction_id: another
    // integration test file (exposure.integration.test.ts) seeds a treaty
    // with no product_codes/state_codes set, which treatyApplies() treats as
    // a wildcard matching every product/state. sample-carrier is a shared
    // tenant across the whole suite with no cross-file cleanup, so an
    // aggregate count here would be fragile to that (and any other) treaty's
    // existence. Scoping by treaty_id tests what this test actually intends:
    // binding creates exactly one row for THIS treaty's layer.
    const bindPlacementsBefore = await db.query(
      `SELECT count(*)::int AS count FROM policy_reinsurance_placements
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3 AND treaty_id=$4`,
      [tenantId, bound.policyId, bound.transactionId, treatyId],
    )
    expect(bindPlacementsBefore.rows[0].count).toBe(1)

    const endorsed = await withTenantTx(tenantId, (txDb) =>
      executeEndorsement(
        txDb,
        tenantId,
        bound.policyId,
        {
          effectiveDate: '2026-08-01',
          changes: [{ op: 'replace', path: '/applicant/lastName', value: 'Lovelace-Byron' }],
        },
        { id: null, username: 'integration-test' },
      ),
    )
    expect(endorsed.transactionId).toBeTruthy()
    expect(endorsed.transactionId).not.toBe(bound.transactionId)

    const endorsementPlacements = await db.query(
      `SELECT count(*)::int AS count FROM policy_reinsurance_placements
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3 AND treaty_id=$4`,
      [tenantId, bound.policyId, endorsed.transactionId, treatyId],
    )
    expect(endorsementPlacements.rows[0].count).toBe(1)

    // The original bind transaction's placement row is untouched by the endorsement's own compute.
    const bindPlacementsAfter = await db.query(
      `SELECT count(*)::int AS count FROM policy_reinsurance_placements
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=$3 AND treaty_id=$4`,
      [tenantId, bound.policyId, bound.transactionId, treatyId],
    )
    expect(bindPlacementsAfter.rows[0].count).toBe(1)
  })
})
