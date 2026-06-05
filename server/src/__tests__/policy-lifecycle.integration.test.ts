import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import {
  cancelPolicy,
  issuePolicy,
  nonRenewPolicy,
  previewRenewal,
  reinstatePolicy,
  renewPolicy,
  rewritePolicy,
} from '../services/lifecycle.service.js'

const tenantId = 'sample-carrier'
const actor = {
  id: null,
  username: 'integration-test',
  roles: ['admin'],
  permissions: ['uw.referrals.decide'],
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

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD'],
  )
}

async function createBoundPolicy() {
  const quote = await createOrRateQuote(
    {} as any,
    tenantId,
    quotePayload(),
    null,
    'integration-test',
  )
  return bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
}

function tx<T>(fn: Parameters<typeof withTenantTx<T>>[1]) {
  return withTenantTx(tenantId, fn)
}

describe('policy transaction lifecycle persistence', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('issues, cancels, rejects duplicate cancel, and reinstates an issued policy', async () => {
    await initDb()
    await ensureTenant()
    const db = getDb()
    expect(db).toBeTruthy()

    const bound = await createBoundPolicy()
    const issued = await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
    expect(issued.status).toBe('Issued')

    const cancelled = await tx((db) =>
      cancelPolicy(
        db,
        tenantId,
        bound.policyId,
        { effectiveDate: '2026-10-01', reason: 'insured request' },
        actor,
      ),
    )
    expect(cancelled.transactionType).toBe('Cancel')
    expect(cancelled.transactionNumber).toMatch(/^CN-/)
    expect(cancelled.premium.total.amount).toBeLessThanOrEqual(0)

    await expect(
      tx((db) =>
        cancelPolicy(
          db,
          tenantId,
          bound.policyId,
          { effectiveDate: '2026-10-15', reason: 'duplicate' },
          actor,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })

    const reinstated = await tx((db) =>
      reinstatePolicy(
        db,
        tenantId,
        bound.policyId,
        { effectiveDate: '2026-10-15', reason: 'payment restored' },
        actor,
      ),
    )
    expect(reinstated.transactionType).toBe('Reinstate')
    expect(reinstated.transactionNumber).toMatch(/^RI-/)
    expect(reinstated.premium.total.amount).toBeGreaterThanOrEqual(0)

    const persisted = await db!.query(
      `SELECT
          (SELECT status FROM policies WHERE tenant_id=$1 AND policy_id=$2) AS policy_status,
          (SELECT count(*)::int FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2) AS transaction_count,
          (SELECT count(*)::int FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2) AS version_count,
          (SELECT count(*)::int FROM ratings WHERE tenant_id=$1 AND policy_id=$2) AS rating_count,
          (SELECT count(*)::int FROM ledger_events WHERE tenant_id=$1 AND entity_id=$2::uuid) AS ledger_count`,
      [tenantId, bound.policyId],
    )
    const row = persisted.rows[0]
    expect(row.policy_status).toBe('Issued')
    expect(row.transaction_count).toBeGreaterThanOrEqual(3)
    expect(row.version_count).toBeGreaterThanOrEqual(3)
    expect(row.rating_count).toBeGreaterThanOrEqual(3)
    expect(row.ledger_count).toBeGreaterThanOrEqual(3)
  })

  it('previews and renews policies, records non-renewal, and rejects rewrite before cancellation', async () => {
    await initDb()
    await ensureTenant()
    const db = getDb()
    expect(db).toBeTruthy()

    const bound = await createBoundPolicy()
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))

    await expect(
      tx((db) =>
        rewritePolicy(
          db,
          tenantId,
          bound.policyId,
          { effectiveDate: '2026-11-01', transactionNumber: 'RW-BEFORE-CANCEL' },
          actor,
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })

    const renewalPreview = await tx((db) => previewRenewal(db, tenantId, bound.policyId, {}))
    expect(renewalPreview.nextEffectiveDate).toBe('2027-07-01')
    expect(renewalPreview.nextExpirationDate).toBe('2028-07-01')
    expect(renewalPreview.premium.total.amount).toBeGreaterThan(0)

    const renewed = await tx((db) =>
      renewPolicy(
        db,
        tenantId,
        bound.policyId,
        { transactionNumber: 'RN-INTEGRATION' },
        actor,
      ),
    )
    expect(renewed.transactionType).toBe('Renew')
    expect(renewed.transactionNumber).toBe('RN-INTEGRATION')
    expect(renewed.premium.total.amount).toBeGreaterThan(0)

    const nonRenewed = await tx((db) =>
      nonRenewPolicy(
        db,
        tenantId,
        bound.policyId,
        { noticeDate: '2027-01-01', reasonCode: 'UNDERWRITING' },
        actor,
      ),
    )
    expect(nonRenewed).toMatchObject({
      ok: true,
      policyId: bound.policyId,
      reasonCode: 'UNDERWRITING',
    })

    const persisted = await db!.query(
      `SELECT
          (SELECT term_effective_date::text FROM policies WHERE tenant_id=$1 AND policy_id=$2) AS term_effective_date,
          (SELECT term_expiration_date::text FROM policies WHERE tenant_id=$1 AND policy_id=$2) AS term_expiration_date,
          (SELECT count(*)::int FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type IN ('RENEW', 'NON_RENEWAL')) AS renewal_transaction_count,
          (SELECT count(*)::int FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type IN ('RENEW', 'NON_RENEWAL')) AS renewal_version_count`,
      [tenantId, bound.policyId],
    )
    const row = persisted.rows[0]
    expect(row.term_effective_date).toBe('2027-07-01')
    expect(row.term_expiration_date).toBe('2028-07-01')
    expect(row.renewal_transaction_count).toBeGreaterThanOrEqual(2)
    expect(row.renewal_version_count).toBeGreaterThanOrEqual(2)
  })
})
