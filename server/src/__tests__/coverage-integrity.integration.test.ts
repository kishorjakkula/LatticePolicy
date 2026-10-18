import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createApp } from '../app.js'
import { issueToken } from '../auth.js'
import { createUser } from '../users.js'
import { ensureTenantRbacDefaults } from '../rbac.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy, renewPolicy, rewritePolicy } from '../services/lifecycle.service.js'
import { executeEndorsement } from '../services/endorsement.service.js'
import { coverageIntegrityReport } from '../services/coverage-integrity.service.js'

// WP-0002: coverage codes must belong to the product at every transaction, and
// administrators can find records that already carry foreign coverages.
const app = createApp()
const tenantId = `coverage-${crypto.randomUUID().slice(0, 8)}`
const otherTenant = `coverage-other-${crypto.randomUUID().slice(0, 8)}`
const actor = { id: crypto.randomUUID(), username: 'integration-test', roles: ['admin'], permissions: ['uw.referrals.decide'] }
let adminToken = ''
let agentToken = ''

function payload(coverages: string[]) {
  const lastName = `Cov${crypto.randomUUID().slice(0, 6)}`
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Cov', lastName, email: `cov.${lastName.toLowerCase()}@example.com` },
    insureds: { primary: { firstName: 'Cov', lastName, displayName: `Cov ${lastName}` } },
    risks: [{ type: 'autoVehicle', year: 2024, make: 'Honda', model: 'Accord', vin: `1HGCM82633A${Math.floor(Math.random() * 900000 + 100000)}`, garagingZip: '94105', symbol: 'A', usage: 'commute' }],
    coverages: coverages.map((code) => ({ code, selected: true, ...(code === 'BI' ? { limit: 100000 } : code === 'PD' ? { limit: 50000 } : {}) })),
  }
}

async function boundPolicy(tenant = tenantId) {
  const quote = await createOrRateQuote({} as any, tenant, payload(['BI', 'PD']), null, 'integration-test')
  const bound = await bindQuote({} as any, tenant, quote.quoteId, {}, 'integration-test', null)
  return { quote, policyId: bound.policyId }
}

/** An issued personal auto policy whose latest version also carries the given foreign codes. */
async function issuedPolicyCarrying(codes: string[], tenant = tenantId) {
  const { policyId } = await boundPolicy(tenant)
  await withTenantTx(tenant, (db) => issuePolicy(db, tenant, policyId, {}, actor))
  if (codes.length) await addVersionWithCoverages(tenant, policyId, codes)
  const current = (await getDb()!.query('SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1', [tenant, policyId])).rows[0].payload
  return { policyId, current }
}

/** Records a later policy version carrying extra coverage codes (models legacy data). */
async function addVersionWithCoverages(tenant: string, policyId: string, codes: string[]) {
  await getDb()!.query(
    `INSERT INTO policy_versions (version_id, tenant_id, policy_id, transaction_id, effective_date, processed_at, transaction_type, uw_decision, uw_override,
       override_reason, calc_trace, payload, premium_total, premium_fees, premium_taxes, currency, transaction_number, base_timeline_version, timeline_version)
     SELECT uuid_generate_v4(), tenant_id, policy_id, transaction_id, effective_date, processed_at + interval '1 second', transaction_type, uw_decision, uw_override,
       override_reason, calc_trace,
       jsonb_set(payload, '{coverages}', (payload->'coverages') || (SELECT jsonb_agg(jsonb_build_object('code', c, 'selected', true)) FROM unnest($3::text[]) c)),
       premium_total, premium_fees, premium_taxes, currency, transaction_number, base_timeline_version, timeline_version
       FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1`,
    [tenant, policyId, codes],
  )
}

describe('coverage codes belong to the product', () => {
  beforeAll(async () => {
    await initDb()
    const db = getDb()!
    for (const id of [tenantId, otherTenant]) {
      await db.query(`INSERT INTO tenants (tenant_id, name, default_locale, default_currency, mfa_required) VALUES ($1,$1,'en-US','USD',false) ON CONFLICT DO NOTHING`, [id])
      await db.query(
        `INSERT INTO product_state_eligibility (tenant_id, product_code, state_code, admitted, surplus_lines, status)
         VALUES ($1,'personal-auto','CA',true,false,'ACTIVE') ON CONFLICT (tenant_id, product_code, state_code) DO UPDATE SET status='ACTIVE'`,
        [id],
      )
      await ensureTenantRbacDefaults(id)
    }
    const admin = await createUser({ username: `cov-admin-${tenantId}`, password: 'Coverage-Admin-9!', tenantId, roles: ['admin'] })
    const agent = await createUser({ username: `cov-agent-${tenantId}`, password: 'Coverage-Agent-9!', tenantId, roles: ['agent'] })
    adminToken = issueToken({ id: admin.id, username: admin.username, tenantId, roles: ['admin'], permissions: [] } as any)
    agentToken = issueToken({ id: agent.id, username: agent.username, tenantId, roles: ['agent'], permissions: [] } as any)
  })

  afterAll(async () => {
    const client = await (getDb() as any).connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.audit_purge', 'tenant-offboarding', true)")
      await client.query('DELETE FROM tenants WHERE tenant_id = ANY($1::text[])', [[tenantId, otherTenant]])
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    await closeDb()
  })

  it('refuses to rate homeowners coverages on a personal auto quote, naming them', async () => {
    await expect(createOrRateQuote({} as any, tenantId, payload(['BI', 'PD', 'END_WB', 'A']), null, 'integration-test')).rejects.toMatchObject({
      code: 'INVALID_QUOTE',
      details: expect.objectContaining({
        errors: expect.arrayContaining([
          expect.objectContaining({ keyword: 'coverage', code: 'END_WB', message: 'Coverage END_WB is not offered by Personal Auto.' }),
          expect.objectContaining({ keyword: 'coverage', code: 'A' }),
        ]),
      }),
    })
    const rated = await createOrRateQuote({} as any, tenantId, payload(['BI', 'PD', 'COMP', 'COLL']), null, 'integration-test')
    expect(rated.status).toBe('Rated')
  })

  it('binding re-checks a saved quote', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, payload(['BI', 'PD']), null, 'integration-test')
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{coverages}', (payload->'coverages') || '[{"code":"END_WB","selected":true}]'::jsonb) WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId],
    )
    await expect(bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)).rejects.toMatchObject({
      code: 'PRODUCT_RULES_NOT_MET',
      details: expect.objectContaining({ transaction: 'bind', errors: [expect.objectContaining({ code: 'END_WB' })] }),
    })
  })

  it('issuing refuses a bound policy that carries foreign coverages', async () => {
    const { policyId } = await boundPolicy()
    await addVersionWithCoverages(tenantId, policyId, ['END_WB'])
    await expect(withTenantTx(tenantId, (db) => issuePolicy(db, tenantId, policyId, {}, actor))).rejects.toMatchObject({
      code: 'PRODUCT_RULES_NOT_MET',
      details: expect.objectContaining({ transaction: 'issue' }),
    })
  })

  it('an endorsement may carry an existing foreign code but not introduce one', async () => {
    const { policyId } = await boundPolicy()
    await withTenantTx(tenantId, (db) => issuePolicy(db, tenantId, policyId, {}, actor))
    await addVersionWithCoverages(tenantId, policyId, ['A'])
    const current = (await getDb()!.query('SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1', [tenantId, policyId])).rows[0].payload
    const carried = { ...current, coverages: [...current.coverages, { code: 'COMP', selected: true }] }
    await withTenantTx(tenantId, (db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2026-09-01', payload: carried }, actor))
    const introduced = { ...current, coverages: [...current.coverages, { code: 'END_WB', selected: true }] }
    await expect(
      withTenantTx(tenantId, (db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2026-09-15', payload: introduced }, actor)),
    ).rejects.toMatchObject({ code: 'PRODUCT_RULES_NOT_MET', details: expect.objectContaining({ errors: [expect.objectContaining({ code: 'END_WB' })] }) })
  })

  it('renewal and rewrite carry codes already on the policy but refuse new ones', async () => {
    const renewal = await issuedPolicyCarrying(['A'])
    await expect(
      withTenantTx(tenantId, (db) => renewPolicy(db, tenantId, renewal.policyId, { payload: { ...renewal.current, coverages: [...renewal.current.coverages, { code: 'END_WB', selected: true }] } }, actor)),
    ).rejects.toMatchObject({ code: 'PRODUCT_RULES_NOT_MET', details: expect.objectContaining({ transaction: 'renewal', errors: [expect.objectContaining({ code: 'END_WB' })] }) })
    await withTenantTx(tenantId, (db) => renewPolicy(db, tenantId, renewal.policyId, { payload: renewal.current, overrideReason: 'integration' }, actor))

    const rewrite = await issuedPolicyCarrying(['A'])
    // A rewrite replaces a cancelled policy.
    await withTenantTx(tenantId, (db) => cancelPolicy(db, tenantId, rewrite.policyId, { effectiveDate: '2026-07-15', reason: 'rewrite' }, actor))
    await expect(
      withTenantTx(tenantId, (db) => rewritePolicy(db, tenantId, rewrite.policyId, { effectiveDate: '2026-08-01', payload: { ...rewrite.current, coverages: [...rewrite.current.coverages, { code: 'END_WB', selected: true }] } }, actor)),
    ).rejects.toMatchObject({ code: 'PRODUCT_RULES_NOT_MET', details: expect.objectContaining({ transaction: 'rewrite' }) })
    await withTenantTx(tenantId, (db) => rewritePolicy(db, tenantId, rewrite.policyId, { effectiveDate: '2026-08-01', payload: rewrite.current, overrideReason: 'integration' }, actor))
  })

  it('a policy carrying foreign codes can still be rated for cancellation in the wizard and cancelled', async () => {
    const { policyId, current } = await issuedPolicyCarrying(['A', 'END_WB'])
    const rate = (query: string) =>
      request(app).post(`/api/v1/quotes${query}`).set('Authorization', `Bearer ${adminToken}`).set('X-Tenant', tenantId).send(current)
    // Without the policy context the carried codes are refused; with it they are carried.
    await rate('?transaction=cancel').expect(422)
    await rate(`?transaction=cancel&policyId=${policyId}`).expect(200)
    // Adding a new foreign code during the transaction is still refused.
    await request(app)
      .post(`/api/v1/quotes?transaction=cancel&policyId=${policyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Tenant', tenantId)
      .send({ ...current, coverages: [...current.coverages, { code: 'DWELLING', selected: true }] })
      .expect(422)
    await withTenantTx(tenantId, (db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2026-09-01', reason: 'insured request', payload: current }, actor))
  })

  it('a policy id lends its carried codes only to a transaction on that policy of the same product', async () => {
    const { policyId, current } = await issuedPolicyCarrying(['A', 'END_WB'])
    const rate = (query: string, body: any) =>
      request(app).post(`/api/v1/quotes${query}`).set('Authorization', `Bearer ${adminToken}`).set('X-Tenant', tenantId).send(body)
    // New business is never a transaction on an existing policy.
    await rate(`?policyId=${policyId}`, current).expect(422)
    await rate(`?transaction=new_business&policyId=${policyId}`, current).expect(422)
    // A malformed id is ignored, not a database error.
    await rate(`?transaction=cancel&policyId=${'-'.repeat(36)}`, current).expect(422)
    // A personal auto rating cannot borrow the codes of another product's policy.
    const other = await issuedPolicyCarrying(['A', 'END_WB'])
    await getDb()!.query(`UPDATE policies SET product_code = 'homeowners' WHERE tenant_id=$1 AND policy_id=$2`, [tenantId, other.policyId])
    const refused = await rate(`?transaction=cancel&policyId=${other.policyId}`, current).expect(422)
    expect(JSON.stringify(refused.body)).toContain('END_WB')
  })

  it('reports records with foreign coverages to administrators only, per tenant, without changing them', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, payload(['BI', 'PD']), null, 'integration-test')
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{coverages}', (payload->'coverages') || '[{"code":"DWELLING","selected":true}]'::jsonb) WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId],
    )
    const own = await issuedPolicyCarrying(['END_ORD'])
    // The other tenant has bad records too; they must never appear for this tenant.
    const foreign = await issuedPolicyCarrying(['END_ERC'], otherTenant)
    const before = (await getDb()!.query('SELECT payload FROM quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].payload
    const report = await coverageIntegrityReport(tenantId)
    expect(report.items.find((item) => item.id === quote.quoteId)).toMatchObject({ kind: 'quote', productCode: 'personal-auto', unexpectedCodes: ['DWELLING'] })
    expect(report.items.find((item) => item.id === own.policyId)).toMatchObject({ kind: 'policy', unexpectedCodes: ['END_ORD'] })
    expect(report.items.some((item) => item.id === foreign.policyId)).toBe(false)
    expect((await coverageIntegrityReport(otherTenant)).items.map((item) => item.id)).toEqual([foreign.policyId])
    expect((await getDb()!.query('SELECT payload FROM quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].payload).toEqual(before)
    expect(report.total).toBe(report.items.length)

    const http = (token: string) =>
      request(app).get('/api/v1/admin/dashboard/coverage-integrity').set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
    await http(agentToken).expect(403)
    const listed = await http(adminToken).expect(200)
    expect(listed.body.items.some((item: any) => item.id === quote.quoteId)).toBe(true)
  })

  it('reports a record pinned to a product version that is no longer available, even with valid coverages', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, payload(['BI', 'PD']), null, 'integration-test')
    const pinned = (await getDb()!.query('SELECT payload FROM quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].payload
    expect(pinned.productSnapshot?.id).toBeTruthy()
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{productSnapshot,id}', to_jsonb($3::text)) WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId, '00000000-0000-4000-8000-000000000000'],
    )
    const report = await coverageIntegrityReport(tenantId)
    expect(report.items.find((item) => item.id === quote.quoteId)).toMatchObject({ kind: 'quote', unexpectedCodes: [], note: expect.stringContaining('not available') })
  })
})
