import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import * as productFiles from '../lib/products.js'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { createUser, findByUsername } from '../users.js'
import { ensureTenantRbacDefaults } from '../lib/rbac.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy, nonRenewPolicy, previewRenewal, reinstatePolicy, renewPolicy, rewritePolicy } from '../services/lifecycle.service.js'
import { executeEndorsement, previewEndorsement } from '../services/endorsement.service.js'
import { businessownersDemoPayload, seedBusinessownersDemo, type BusinessownersDemoResult } from '../services/businessowners-demo.service.js'

// Every transaction the BOP pack advertises (WP-0010 B27-B30), through the
// same domain services the routes use, on the explicit synthetic demo setup.

const tenantId = 'sample-carrier'
const effectiveDate = '2026-11-01'
let seeded: BusinessownersDemoResult
let agent: { id: string; username: string; roles: string[]; permissions: string[] }
// BOP has authority configured, so servicing needs an underwriter whose grant covers it.
let actor: { id: string; username: string; roles: string[]; permissions: string[] }
const unauthorized = { id: null, username: 'integration-test', roles: ['admin'], permissions: ['uw.referrals.decide'] }

function tx<T>(fn: Parameters<typeof withTenantTx<T>>[1]) {
  return withTenantTx(tenantId, fn)
}

async function customer(kind: 'owner' | 'tenant') {
  const row = (await getDb()!.query('SELECT customer_id, customer_key FROM customers WHERE tenant_id=$1 AND customer_id=$2', [tenantId, seeded.customers[kind]])).rows[0]
  return { customerId: row.customer_id, customerKey: row.customer_key }
}

async function quotePayload(kind: 'owner' | 'tenant') {
  const payload = businessownersDemoPayload(kind, effectiveDate, seeded, await customer(kind))
  delete payload.metadata
  return payload
}

async function issuedPolicy(kind: 'owner' | 'tenant') {
  const quote = await createOrRateQuote({} as any, tenantId, await quotePayload(kind), null, 'integration-test', { actorId: agent.id })
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', agent.id, agent)
  await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
  return { quote, policyId: bound.policyId as string }
}

async function latestPayload(policyId: string) {
  const result = await getDb()!.query(
    'SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1',
    [tenantId, policyId]
  )
  return JSON.parse(JSON.stringify(result.rows[0].payload))
}

const coverage = (payload: any, code: string) => payload.coverages.find((item: any) => item.code === code)
const packageRefusal = (transaction: string) => ({
  code: 'PRODUCT_RULES_NOT_MET',
  details: expect.objectContaining({ transaction, errors: expect.arrayContaining([expect.objectContaining({ keyword: 'package' })]) }),
})

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL || 'postgres://invalid/invalid')
  if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true' || process.env.TENANT_RLS_ENFORCED !== 'true' || url.pathname !== '/lattice_policy_integration') {
    throw new Error('An exact-name disposable RLS integration database is required')
  }
  process.env.DEPLOYMENT_ENV = 'local'
  await initDb()
  await getDb()!.query('INSERT INTO tenants(tenant_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [tenantId, 'Disposable BOP test carrier'])
  await ensureTenantRbacDefaults(tenantId)
  const operator = await findByUsername('bop-fixture-operator') || await createUser({ tenantId, username: 'bop-fixture-operator', password: 'disposable-test-only-password', roles: ['admin'] })
  const user = await findByUsername('bop-fixture-agent') || await createUser({ tenantId, username: 'bop-fixture-agent', password: 'disposable-test-only-password', roles: ['agent'] })
  agent = { id: user.id, username: user.username, roles: ['agent'], permissions: ['page.wizard.view', 'page.policy.view'] }
  const servicer = await findByUsername('bop-fixture-underwriter') || await createUser({ tenantId, username: 'bop-fixture-underwriter', password: 'disposable-test-only-password', roles: ['underwriter'] })
  actor = { id: servicer.id, username: servicer.username, roles: ['underwriter'], permissions: ['uw.referrals.decide'] }
  await tx((db) => toRawQuery(db)(`INSERT INTO underwriting_authority_grants
      (tenant_id, subject_type, subject_id, product_code, state_code, transaction_types, max_premium, max_limit, may_override, active, effective_date, created_by)
    SELECT $1, 'USER', $2, 'businessowners', 'OH', ARRAY['Endorse','Renew','Rewrite'], 10000, 5000000, false, true, $3::date, 'integration-test'
    WHERE NOT EXISTS (SELECT 1 FROM underwriting_authority_grants WHERE tenant_id=$1 AND subject_type='USER' AND subject_id=$2)`,
  [tenantId, servicer.id, effectiveDate]))
  seeded = await seedBusinessownersDemo({ enabled: true, tenantId, operatorUserId: operator.id, agentUserId: user.id, effectiveDate })
})
afterAll(closeDb)

describe('businessowners across the policy lifecycle (database path)', () => {
  it('rates owner and tenant at the documented baseline and persists derived package terms on the policy', async () => {
    const owner = await issuedPolicy('owner')
    const tenant = await issuedPolicy('tenant')
    // Owner pays for the building; the tenant package has no building charge.
    expect(owner.quote.premium.byCoverage.map((item: any) => item.code)).toContain('BOP_BUILDING')
    expect(tenant.quote.premium.byCoverage.map((item: any) => item.code)).not.toContain('BOP_BUILDING')
    expect(owner.quote.premium.total.amount).toBeGreaterThan(tenant.quote.premium.total.amount)
    const medical = tenant.quote.premium.byCoverage.find((item: any) => item.code === 'BOP_MED')
    expect(medical.amount.amount).toBe(0)
    const stored = await latestPayload(tenant.policyId)
    expect(coverage(stored, 'BOP_LIAB').packageTerms).toMatchObject({ generalAggregate: 2000000, productsCompletedOperationsAggregate: 2000000, personalAdvertisingInjuryLimit: 1000000 })
    expect(coverage(stored, 'BOP_BI_EE').packageTerms).toMatchObject({ waitingPeriodHours: 72, restorationMonths: 12 })
    expect(stored.risks[0].locationAddress).toMatchObject({ line1: '200 Synthetic Office Way', state: 'OH', country: 'US' })
  })

  it('endorses with re-derived terms and refuses endorsements that break the package', async () => {
    const { policyId } = await issuedPolicy('tenant')
    const stored = await latestPayload(policyId)

    // Raising liability re-derives the aggregates; the client sends no terms.
    const raised = structuredClone(stored)
    const { packageTerms: _old, ...liability } = coverage(raised, 'BOP_LIAB')
    raised.coverages = raised.coverages.map((item: any) => item.code === 'BOP_LIAB' ? { ...liability, limit: 2000000 } : item)
    const preview = await tx((db) => previewEndorsement(db, tenantId, policyId, { effectiveDate: '2027-02-01', payload: raised }))
    expect(preview.fullTerm.delta).toBeGreaterThan(0)
    const endorsed = await tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2027-02-01', payload: raised }, actor))
    expect(endorsed.transactionType).toBe('Endorse')
    expect(coverage(await latestPayload(policyId), 'BOP_LIAB').packageTerms.generalAggregate).toBe(4000000)
    // The endorsement charges the prorated increase for the rest of the term.
    expect(endorsed.premium.total.amount).toBeGreaterThan(0)
    expect(endorsed.premium.total.amount).toBeLessThan(preview.fullTerm.delta + 0.01)

    // Dropping a required part, claiming terms the definition does not give, or
    // adding a second premises is refused, and the policy keeps its last version.
    const current = await latestPayload(policyId)
    const withoutLiability = structuredClone(current)
    coverage(withoutLiability, 'BOP_LIAB').selected = false
    const inflated = structuredClone(current)
    coverage(inflated, 'BOP_LIAB').packageTerms.generalAggregate = 9000000
    const twoPremises = structuredClone(current)
    twoPremises.risks.push(structuredClone(current.risks[0]))
    for (const payload of [withoutLiability, inflated, twoPremises]) {
      await expect(tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2027-03-01', payload }, actor)))
        .rejects.toMatchObject(packageRefusal('endorsement'))
    }
    expect(await latestPayload(policyId)).toEqual(current)

    // Without servicing authority the same kind of change waits for an underwriter.
    const again = structuredClone(current)
    coverage(again, 'BOP_BPP').limit = 150000
    await expect(tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2027-03-01', payload: again }, unauthorized)))
      .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
  })

  it('cancels and reinstates without changing the package', async () => {
    const { policyId } = await issuedPolicy('owner')
    const before = await latestPayload(policyId)
    const cancelled = await tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2027-01-01', reason: 'insured request' }, actor))
    expect(cancelled.transactionType).toBe('Cancel')
    const reinstated = await tx((db) => reinstatePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-10', reason: 'paid' }, actor))
    expect(reinstated.transactionType).toBe('Reinstate')
    const after = await latestPayload(policyId)
    expect(after.coverages).toEqual(before.coverages)
    expect(after.risks).toEqual(before.risks)
  })

  it('renews on the pinned package and refuses a renewal that drops owned building coverage', async () => {
    const { policyId, quote } = await issuedPolicy('owner')
    const preview = await tx((db) => previewRenewal(db, tenantId, policyId, {}))
    expect(preview.nextEffectiveDate).toBe('2027-11-01')
    expect(preview.premium.total.amount).toBe(quote.premium.total.amount)

    const noBuilding = await latestPayload(policyId)
    noBuilding.coverages = noBuilding.coverages.filter((item: any) => item.code !== 'BOP_BUILDING')
    await expect(tx((db) => renewPolicy(db, tenantId, policyId, { payload: noBuilding }, actor)))
      .rejects.toMatchObject(packageRefusal('renewal'))

    const renewed = await tx((db) => renewPolicy(db, tenantId, policyId, {}, actor))
    expect(renewed.transactionType).toBe('Renew')
    expect(renewed.premium.total.amount).toBe(quote.premium.total.amount)
  })

  it('rewrites a cancelled policy only with a valid package', async () => {
    const { policyId } = await issuedPolicy('tenant')
    await tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2027-01-01', reason: 'insured request' }, actor))
    const payload = await latestPayload(policyId)
    const outOfState = structuredClone(payload)
    outOfState.risks[0].locationAddress.state = 'TX'
    await expect(tx((db) => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-15', payload: outOfState }, actor)))
      .rejects.toMatchObject(packageRefusal('rewrite'))
    const rewritten = await tx((db) => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-15', payload }, actor))
    expect(rewritten.transactionType).toBe('Rewrite')
    expect(rewritten.premium.total.amount).toBeGreaterThan(0)
  })

  it('non-renews through the existing servicing rules', async () => {
    const { policyId } = await issuedPolicy('tenant')
    const nonRenewed = await tx((db) => nonRenewPolicy(db, tenantId, policyId, { noticeDate: '2027-08-01', reasonCode: 'UNDERWRITING' }, actor))
    expect(nonRenewed).toMatchObject({ ok: true, policyId, reasonCode: 'UNDERWRITING' })
  })

  it('refuses a directly submitted second premises at quote', async () => {
    const payload = await quotePayload('tenant')
    payload.risks.push(structuredClone(payload.risks[0]))
    await expect(createOrRateQuote({} as any, tenantId, payload, null, 'integration-test', { actorId: agent.id }))
      .rejects.toMatchObject({ code: expect.stringMatching(/^(INVALID_QUOTE|PRODUCT_RULES_NOT_MET)$/) })
  })

  it('keeps the demo dependencies tenant-scoped', async () => {
    const hidden = await withTenantTx('other-bop-tenant', async (db) =>
      toRawQuery(db)('SELECT policy_id FROM policies WHERE product_code=$1', ['businessowners']))
    expect(hidden.rows).toHaveLength(0)
  })

  it.each(['endorse', 'renew', 'rewrite'] as const)('rechecks distribution on direct %s at the transaction effective date', async action => {
    const { policyId } = await issuedPolicy('tenant')
    if (action === 'rewrite') {
      await tx(db => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2027-01-01', reason: 'insured request' }, actor))
    }
    const original = await latestPayload(policyId)
    await tx(db => toRawQuery(db)(`UPDATE onboarding_appointments SET termination_date='2027-01-01'
      WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2 AND product_code='businessowners'`, [tenantId, seeded.agencyId]))
    try {
      const mutation = action === 'endorse'
        ? () => tx(db => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2027-02-01', payload: original }, actor))
        : action === 'renew'
          ? () => tx(db => renewPolicy(db, tenantId, policyId, {}, actor))
          : () => tx(db => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-15', payload: original }, actor))
      await expect(mutation()).rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
      expect(await latestPayload(policyId)).toEqual(original)
    } finally {
      await tx(db => toRawQuery(db)(`UPDATE onboarding_appointments SET termination_date=NULL
        WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2 AND product_code='businessowners'`, [tenantId, seeded.agencyId]))
    }
  })
  it.each(['renew', 'rewrite'] as const)('refuses to bypass BOP checks by changing the product on %s', async action => {
    const { policyId } = await issuedPolicy('tenant')
    if (action === 'rewrite') await tx(db => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2027-01-01', reason: 'insured request' }, actor))
    const original = await latestPayload(policyId)
    const payload = { ...original, productCode: 'personal-auto',
      risks: [{ type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '43215', driverAge: 40, symbol: '10', usage: 'pleasure', annualMiles: 9000 }],
      coverages: [{ code: 'BI', selected: true, limit: '100000/300000' }, { code: 'PD', selected: true, limit: 100000 }] }
    const mutation = action === 'renew'
      ? () => tx(db => renewPolicy(db, tenantId, policyId, { payload }, actor))
      : () => tx(db => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-15', payload }, actor))
    await expect(mutation()).rejects.toMatchObject({ code: 'POLICY_PRODUCT_MISMATCH' })
    expect(await latestPayload(policyId)).toEqual(original)
  })
  it.each(['renew', 'rewrite'] as const)('refreshes trusted copied terms on %s into a new edition without changing history', async action => {
    const { policyId } = await issuedPolicy('tenant')
    if (action === 'rewrite') await tx(db => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2027-01-01', reason: 'insured request' }, actor))
    const historical = (await getDb()!.query('SELECT version_id,payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2', [tenantId, policyId])).rows
    const originalLoad = productFiles.loadProductConfig
    const edition = structuredClone(originalLoad('businessowners'))
    edition.version = '1.1.0'
    edition.coverages.find((item: any) => item.code === 'BOP_LIAB').aggregateMultiplier = 3
    edition.coverages.find((item: any) => item.code === 'BOP_BI_EE').packageTerms.waitingPeriodHours = 96
    const spy = vi.spyOn(productFiles, 'loadProductConfig').mockImplementation(code => code === 'businessowners' ? edition : originalLoad(code))
    try {
      if (action === 'renew') {
        const preview = await tx(db => previewRenewal(db, tenantId, policyId, {}))
        expect(preview.premium.byCoverage.find((item: any) => item.code === 'BOP_LIAB').packageTerms.generalAggregate).toBe(3000000)
        await tx(db => renewPolicy(db, tenantId, policyId, {}, actor))
      } else {
        await tx(db => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2027-01-15' }, actor))
      }
      const next = await latestPayload(policyId)
      expect(coverage(next, 'BOP_LIAB').packageTerms.generalAggregate).toBe(3000000)
      expect(coverage(next, 'BOP_BI_EE').packageTerms.waitingPeriodHours).toBe(96)
      for (const old of historical) {
        const stored = (await getDb()!.query('SELECT payload FROM policy_versions WHERE tenant_id=$1 AND version_id=$2', [tenantId, old.version_id])).rows[0]
        expect(stored.payload).toEqual(old.payload)
        expect(coverage(stored.payload, 'BOP_LIAB').packageTerms.generalAggregate).toBe(2000000)
      }
    } finally { spy.mockRestore() }
  })
})
