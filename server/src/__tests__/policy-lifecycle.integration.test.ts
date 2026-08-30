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
import { executeEndorsement } from '../services/endorsement.service.js'
import { getPolicyState } from '../services/policy.service.js'

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
    producer: {
      producerKey: 'PROD-001',
      npn: '1234567',
      firstName: 'Pat',
      lastName: 'Producer',
      agency: {
        agencyCode: 'AGY-001',
        legalName: 'Demo Agency LLC',
      },
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

const servicingFormId = '11111111-1111-1111-1111-111111111189'

// Issue #89: servicing transaction document hooks. Seeds a form applicable to
// Cancel and NonRenewal so cancelPolicy/nonRenewPolicy exercise the same
// document-generation.service.ts form-selection path bind already uses.
async function ensureServicingForm() {
  const db = getDb()
  await db!.query(
    `INSERT INTO forms_admin_forms (
        form_id, tenant_id, carrier_code, authority, form_number, form_title,
        edition_date, form_type, line_of_business, workflow_status, active
      )
     VALUES ($1,$2,'SAMPLE','ISO','PA-NOTICE','Personal Auto Servicing Notice',
        '2026-01-01','Notice','personal-auto','Approved',true
      )
     ON CONFLICT (tenant_id, carrier_code, authority, form_number, edition_date)
     DO UPDATE SET workflow_status = 'Approved', active = true`,
    [servicingFormId, tenantId],
  )
  await db!.query(
    `INSERT INTO forms_admin_applicability (
        tenant_id, form_id, line_of_business, product_code, transaction_types, active
      )
     VALUES ($1,$2,'personal-auto','personal-auto',ARRAY['Cancel','NonRenewal','Reinstate','Renew','Rewrite']::text[],true)
     ON CONFLICT DO NOTHING`,
    [tenantId, servicingFormId],
  )
  await db!.query(
    `INSERT INTO forms_admin_jurisdictions (
        tenant_id, form_id, state_code, regulatory_status, effective_date
      )
     VALUES ($1,$2,'CA','Approved','2026-01-01')
     ON CONFLICT DO NOTHING`,
    [tenantId, servicingFormId],
  )
  await db!.query(
    `INSERT INTO forms_admin_delivery (
        tenant_id, form_id, delivery_methods, visibility, active
      )
     VALUES ($1,$2,ARRAY['portal']::text[],ARRAY['internal','customer']::text[],true)
     ON CONFLICT (tenant_id, form_id)
     DO UPDATE SET visibility = ARRAY['internal','customer']::text[], active = true`,
    [tenantId, servicingFormId],
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
    await ensureServicingForm()
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
          (SELECT count(*)::int FROM ledger_events WHERE tenant_id=$1 AND entity_id=$2::uuid) AS ledger_count,
          (SELECT count(*)::int FROM notification_intents WHERE tenant_id=$1 AND policy_id=$2 AND event_type IN ('POLICY_ISSUED', 'POLICY_CANCELLED')) AS notification_count,
          (SELECT count(*)::int FROM async_message_outbox WHERE tenant_id=$1 AND source_table='notification_intents') AS notification_outbox_count,
          (SELECT jsonb_agg(payload ORDER BY occurred_at) FROM ledger_events WHERE tenant_id=$1 AND entity_id=$2::uuid AND event='COMMISSION_HANDOFF') AS commission_payloads,
          (SELECT count(*)::int FROM policy_forms WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=(SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='CANCEL' LIMIT 1)) AS cancel_form_count,
          (SELECT documents FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='CANCEL' LIMIT 1) AS cancel_transaction_documents,
          (SELECT count(*)::int FROM policy_forms WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=(SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='REINSTATE' LIMIT 1)) AS reinstate_form_count,
          (SELECT documents FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='REINSTATE' LIMIT 1) AS reinstate_transaction_documents`,
      [tenantId, bound.policyId],
    )
    const row = persisted.rows[0]

    // Issue #89: cancellation and reinstatement should attach the servicing
    // notice form/packet the same way bind attaches NB forms.
    expect(row.cancel_form_count).toBeGreaterThanOrEqual(1)
    expect(row.cancel_transaction_documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_PACKET',
          metadata: expect.objectContaining({ transactionType: 'Cancel' }),
        }),
      ]),
    )
    expect(row.reinstate_form_count).toBeGreaterThanOrEqual(1)
    expect(row.reinstate_transaction_documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_PACKET',
          metadata: expect.objectContaining({ transactionType: 'Reinstate' }),
        }),
      ]),
    )
    const commissionPayloads = row.commission_payloads || []
    const bindHandoff = commissionPayloads.find((payload: any) => payload.transaction?.transactionType === 'QuoteBind')
    const cancelHandoff = commissionPayloads.find((payload: any) => payload.transaction?.transactionType === 'Cancel')
    expect(row.policy_status).toBe('Issued')
    expect(row.transaction_count).toBeGreaterThanOrEqual(3)
    expect(row.version_count).toBeGreaterThanOrEqual(3)
    expect(row.rating_count).toBeGreaterThanOrEqual(3)
    expect(row.ledger_count).toBeGreaterThanOrEqual(3)
    expect(row.notification_count).toBeGreaterThanOrEqual(2)
    expect(row.notification_outbox_count).toBeGreaterThanOrEqual(2)
    expect(bindHandoff).toMatchObject({
      schemaVersion: 'commission-handoff.v1',
      eventType: 'COMMISSION_HANDOFF',
      tenantId,
      policy: {
        policyId: bound.policyId,
        productCode: 'personal-auto',
        state: 'CA',
      },
      producer: {
        producerKey: 'PROD-001',
        producerNpn: '1234567',
        agencyCode: 'AGY-001',
      },
    })
    expect(bindHandoff.idempotencyKey).toContain(bound.policyId)
    expect(bindHandoff.premiumImpact.amount).toBeGreaterThan(0)
    expect(cancelHandoff).toMatchObject({
      schemaVersion: 'commission-handoff.v1',
      eventType: 'COMMISSION_HANDOFF',
      tenantId,
      policy: {
        policyId: bound.policyId,
      },
      transaction: {
        transactionType: 'Cancel',
      },
    })
    expect(cancelHandoff.premiumImpact.amount).toBeLessThanOrEqual(0)
  })

  it('persists an external claim reference on a cancellation (issue #225)', async () => {
    await initDb()
    await ensureTenant()
    await ensureServicingForm()
    const db = getDb()
    expect(db).toBeTruthy()

    const bound = await createBoundPolicy()
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))

    const cancelled = await tx((db) =>
      cancelPolicy(
        db,
        tenantId,
        bound.policyId,
        { effectiveDate: '2026-10-01', reason: 'total loss', claimReference: 'CLM-2026-000456' },
        actor,
      ),
    )
    expect(cancelled.transactionType).toBe('Cancel')

    const persisted = await db!.query(
      `SELECT claim_reference, metadata FROM policy_versions
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type='Cancel'`,
      [tenantId, bound.policyId],
    )
    expect(persisted.rows[0].claim_reference).toBe('CLM-2026-000456')
    expect(persisted.rows[0].metadata.claimReference).toBe('CLM-2026-000456')
  })

  it('previews and renews policies, records non-renewal, and rejects rewrite before cancellation', async () => {
    await initDb()
    await ensureTenant()
    await ensureServicingForm()
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
          (SELECT count(*)::int FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type IN ('RENEW', 'NON_RENEWAL')) AS renewal_version_count,
          (SELECT count(*)::int FROM notification_intents WHERE tenant_id=$1 AND policy_id=$2 AND event_type='POLICY_NON_RENEWAL') AS nonrenewal_notice_count,
          (SELECT count(*)::int FROM policy_forms WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=(SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='RENEW' LIMIT 1)) AS renew_form_count,
          (SELECT documents FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='RENEW' LIMIT 1) AS renew_transaction_documents,
          (SELECT count(*)::int FROM policy_forms WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id=(SELECT transaction_id FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='NON_RENEWAL' LIMIT 1)) AS nonrenewal_form_count,
          (SELECT documents FROM policy_transactions WHERE tenant_id=$1 AND policy_id=$2 AND type='NON_RENEWAL' LIMIT 1) AS nonrenewal_transaction_documents`,
      [tenantId, bound.policyId],
    )
    const row = persisted.rows[0]
    expect(row.term_effective_date).toBe('2027-07-01')
    expect(row.term_expiration_date).toBe('2028-07-01')
    expect(row.renewal_transaction_count).toBeGreaterThanOrEqual(2)
    expect(row.renewal_version_count).toBeGreaterThanOrEqual(2)
    expect(row.nonrenewal_notice_count).toBeGreaterThanOrEqual(1)

    // Issue #89: renewal and non-renewal should attach the servicing
    // notice form/packet the same way bind attaches NB forms.
    expect(row.renew_form_count).toBeGreaterThanOrEqual(1)
    expect(row.renew_transaction_documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_PACKET',
          metadata: expect.objectContaining({ transactionType: 'Renew' }),
        }),
      ]),
    )
    expect(row.nonrenewal_form_count).toBeGreaterThanOrEqual(1)
    expect(row.nonrenewal_transaction_documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'POLICY_PACKET',
          metadata: expect.objectContaining({ transactionType: 'NonRenewal' }),
        }),
      ]),
    )
  })

  // Issue #52: out-of-sequence handling beyond endorsements. A cancellation
  // with an effective date before an already-processed later endorsement must
  // (a) record rebase/audit metadata the same way endorsement OOS does, and
  // (b) refresh the persisted timeline segments cache so getPolicyState(asOf)
  // does not silently return stale pre-cancellation state.
  it('records rebase metadata and keeps as-of state correct for an out-of-sequence cancellation', async () => {
    await initDb()
    await ensureTenant()
    await ensureServicingForm()
    const db = getDb()
    expect(db).toBeTruthy()

    const bound = await createBoundPolicy()
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))

    const currentPayloadRow = await db!.query(
      `SELECT payload FROM policy_versions
        WHERE tenant_id=$1 AND policy_id=$2
        ORDER BY processed_at DESC LIMIT 1`,
      [tenantId, bound.policyId],
    )
    const endorsedPayload = JSON.parse(JSON.stringify(currentPayloadRow.rows[0].payload))
    endorsedPayload.coverages = (endorsedPayload.coverages || []).map((c: any) =>
      c.code === 'PD' ? { ...c, limit: 100000 } : c,
    )

    // A later, in-sequence endorsement. This is what first populates the
    // persisted policy_timeline_segments cache (timelineVersion 1).
    const endorsed = await tx((db) =>
      executeEndorsement(
        db,
        tenantId,
        bound.policyId,
        {
          effectiveDate: '2026-08-01',
          payload: endorsedPayload,
          transactionNumber: 'EN-OOS-BASE',
        },
        actor,
      ),
    )
    expect(endorsed.transactionType).toBe('Endorse')

    const postEndorseSeg = await db!.query(
      `SELECT count(*)::int AS segment_count, max(timeline_version)::int AS max_timeline_version
         FROM policy_timeline_segments WHERE tenant_id=$1 AND policy_id=$2`,
      [tenantId, bound.policyId],
    )
    // The endorsement must actually persist segments against the policy's
    // real term window, not silently fall back to today's date.
    expect(postEndorseSeg.rows[0].segment_count).toBeGreaterThan(0)
    expect(postEndorseSeg.rows[0].max_timeline_version).toBe(1)

    // A cancellation dated before the endorsement above: out-of-sequence.
    const cancelled = await tx((db) =>
      cancelPolicy(
        db,
        tenantId,
        bound.policyId,
        { effectiveDate: '2026-07-15', reason: 'backdated OOS cancel' },
        actor,
      ),
    )
    expect(cancelled.transactionType).toBe('Cancel')

    const cancelTxRow = await db!.query(
      `SELECT metadata FROM policy_transactions
        WHERE tenant_id=$1 AND policy_id=$2 AND type='CANCEL'
        ORDER BY processed_at DESC LIMIT 1`,
      [tenantId, bound.policyId],
    )
    const cancelMetadata = cancelTxRow.rows[0]?.metadata
    expect(cancelMetadata.outOfSequence).toBe(true)
    expect(cancelMetadata.rebasedTransactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ transactionType: 'ENDORSE' })]),
    )
    expect(cancelMetadata.retroAdjustment).toBeTruthy()

    // Before issue #52's fix, getPolicyState would still be reading the
    // endorsement-only persisted segment cache here and would not reflect
    // the backdated cancellation at all.
    const asOfState = await getPolicyState(null as any, tenantId, bound.policyId, '2026-07-20')
    expect(asOfState.timelineVersion).toBeGreaterThanOrEqual(2)
    expect(asOfState.segmentStart).toBe('2026-07-15')
  })
})
