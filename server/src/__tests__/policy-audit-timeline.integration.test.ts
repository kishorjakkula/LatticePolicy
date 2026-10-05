import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy } from '../services/lifecycle.service.js'
import { getPolicyTimeline, getPolicyVersions, getPolicyState } from '../services/policy.service.js'

// Issue #53: policy audit and replay UI. These assertions cover the small
// backend correlation change (policy_versions.transaction_id surfaced on
// getPolicyVersions rows) that lets the frontend join a version row to its
// timeline transaction for rating/UW/forms/documents/ledger detail, plus the
// existing as-of state lookup the audit UI now exposes.

const tenantId = 'sample-carrier'
const actor = { id: null, username: 'integration-test', roles: ['admin'], permissions: [] }

function quotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    producer: {
      producerKey: 'PROD-001',
      npn: '1234567',
      firstName: 'Pat',
      lastName: 'Producer',
      agency: { agencyCode: 'AGY-001', legalName: 'Demo Agency LLC' },
    },
    risks: [
      { type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '94105', symbol: 'A', usage: 'commute' },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD'],
  )
}

function tx<T>(fn: Parameters<typeof withTenantTx<T>>[1]) {
  return withTenantTx(tenantId, fn)
}

describe('policy audit timeline correlation', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('links each version row to its timeline transaction via transactionId', async () => {
    await initDb()
    await ensureTenant()
    const db = getDb()
    expect(db).toBeTruthy()

    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
    await tx((db) =>
      cancelPolicy(db, tenantId, bound.policyId, { effectiveDate: '2026-10-01', reason: 'insured request' }, actor),
    )

    const versions = await getPolicyVersions(db as any, tenantId, bound.policyId)
    const timeline = await getPolicyTimeline(db as any, tenantId, bound.policyId)

    expect(versions.length).toBeGreaterThanOrEqual(2)
    for (const version of versions) {
      expect(version.transactionId).toBeTruthy()
      const matched = timeline.transactions.find((t: any) => t.transactionId === version.transactionId)
      expect(matched).toBeTruthy()
    }

    const cancelVersion = versions[versions.length - 1]
    const cancelTransaction = timeline.transactions.find((t: any) => t.transactionId === cancelVersion?.transactionId)
    expect(cancelTransaction).toBeTruthy()
    expect(String(cancelTransaction?.type || '').toUpperCase()).toBe('CANCEL')
  })

  it('exposes as-of state for point-in-time audit inspection', async () => {
    await initDb()
    await ensureTenant()
    const db = getDb()

    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))

    const asOfState = await getPolicyState(db as any, tenantId, bound.policyId, '2026-07-01')
    expect(asOfState.policyId).toBe(bound.policyId)
    expect(asOfState.asOf).toBe('2026-07-01')
  })
})
