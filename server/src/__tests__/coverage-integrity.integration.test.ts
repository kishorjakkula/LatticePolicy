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
import { issuePolicy } from '../services/lifecycle.service.js'
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

  it('reports records with foreign coverages to administrators only, per tenant, without changing them', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, payload(['BI', 'PD']), null, 'integration-test')
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{coverages}', (payload->'coverages') || '[{"code":"DWELLING","selected":true}]'::jsonb) WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId],
    )
    const before = (await getDb()!.query('SELECT payload FROM quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].payload
    const report = await coverageIntegrityReport(tenantId)
    const entry = report.items.find((item) => item.id === quote.quoteId)
    expect(entry).toMatchObject({ kind: 'quote', productCode: 'personal-auto', unexpectedCodes: ['DWELLING'] })
    expect(report.items.some((item) => item.kind === 'policy' && item.unexpectedCodes.includes('A'))).toBe(true)
    expect((await getDb()!.query('SELECT payload FROM quotes WHERE quote_id=$1', [quote.quoteId])).rows[0].payload).toEqual(before)
    expect((await coverageIntegrityReport(otherTenant)).items).toEqual([])

    const http = (token: string) =>
      request(app).get('/api/v1/admin/dashboard/coverage-integrity').set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
    await http(agentToken).expect(403)
    const listed = await http(adminToken).expect(200)
    expect(listed.body.items.some((item: any) => item.id === quote.quoteId)).toBe(true)
  })
})
