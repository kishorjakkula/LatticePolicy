import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, TENANT_RLS_ROLE, toRawQuery, withTenantTx } from '../db.js'
import { createUser, findByUsername } from '../users.js'
import { ensureTenantRbacDefaults } from '../lib/rbac.js'
import { evaluateUW } from '../services/uw.service.js'
import { applicableValidationRules } from '../services/validation-rules.service.js'
import { evaluateValidationRules } from '@lattice-policy/rules'
import { BUSINESSOWNERS_DEMO_KEY, assertBusinessownersDemoOptIn, seedBusinessownersDemo, type BusinessownersDemoOptions } from '../services/businessowners-demo.service.js'

const tenantId = 'sample-carrier'
let options: BusinessownersDemoOptions

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
  const agent = await findByUsername('bop-fixture-agent') || await createUser({ tenantId, username: 'bop-fixture-agent', password: 'disposable-test-only-password', roles: ['agent'] })
  options = { enabled: true, tenantId, operatorUserId: operator.id, agentUserId: agent.id, effectiveDate: '2026-11-01' }
})
afterAll(closeDb)

describe('explicit synthetic businessowners demo setup', () => {
  it('refuses absent opt-in, other tenants, production and missing existing identities before writes', () => {
    expect(() => assertBusinessownersDemoOptIn({ ...options, enabled: false })).toThrow('BOP_DEMO_OPT_IN_REQUIRED')
    expect(() => assertBusinessownersDemoOptIn({ ...options, tenantId: 'other' })).toThrow('BOP_DEMO_TENANT_NOT_ALLOWED')
    expect(() => assertBusinessownersDemoOptIn({ ...options, agentUserId: '' })).toThrow('BOP_DEMO_EXISTING_USER_REQUIRED')
    const previous = process.env.DEPLOYMENT_ENV
    try { process.env.DEPLOYMENT_ENV = 'production'; expect(() => assertBusinessownersDemoOptIn(options)).toThrow('BOP_DEMO_LOCAL_OR_TEST_ONLY') }
    finally { process.env.DEPLOYMENT_ENV = previous }
  })

  it('serializes concurrent setup and reruns without duplicate customers, quotes, credentials or audits', async () => {
    const before = await getDb()!.query('SELECT user_id,password_hash FROM users WHERE tenant_id=$1 ORDER BY user_id', [tenantId])
    const [first, second] = await Promise.all([seedBusinessownersDemo(options), seedBusinessownersDemo(options)])
    expect(second).toEqual(first)
    expect(first.blockers).toEqual([])
    expect(first.policyId).toBeNull()
    expect(Object.keys(first.quotes).sort()).toEqual(['owner', 'tenant'])
    const snapshot = () => withTenantTx(tenantId, async db => {
      const q = toRawQuery(db)
      expect((await q('SELECT current_user AS role')).rows[0].role).toBe(TENANT_RLS_ROLE)
      const counts = await q(`SELECT
        (SELECT count(*) FROM customers WHERE tenant_id=$1 AND metadata->>'demoSetup'=$2) AS customers,
        (SELECT count(*) FROM quotes WHERE tenant_id=$1 AND payload->'metadata'->>'demoSetup'=$2 AND payload->'metadata'->>'demoKey' IN ('quote-owner','quote-tenant')) AS quotes,
        (SELECT count(*) FROM underwriting_rules WHERE tenant_id=$1 AND reason_code LIKE 'BOP_DEMO_%') AS uw,
        (SELECT count(*) FROM validation_rule_audit WHERE tenant_id=$1 AND rule_code LIKE 'BOP_DEMO_%') AS validation_audit,
        (SELECT count(*) FROM customer_audit_events WHERE tenant_id=$1 AND actor LIKE 'automation:WP-0010-BOP-DEMO-V1:%') AS customer_audit`, [tenantId, BUSINESSOWNERS_DEMO_KEY])
      return counts.rows[0]
    })
    const seeded = await snapshot()
    expect(seeded).toMatchObject({ customers: '2', quotes: '2', uw: '5' })
    await seedBusinessownersDemo(options)
    expect(await snapshot()).toEqual(seeded)
    expect((await getDb()!.query('SELECT user_id,password_hash FROM users WHERE tenant_id=$1 ORDER BY user_id', [tenantId])).rows).toEqual(before.rows)
    const hidden = await withTenantTx('other-bop-tenant', async db => toRawQuery(db)('SELECT agency_id FROM agencies WHERE agency_key=$1', ['BOP-DEMO-AGENCY-V1']))
    expect(hidden.rows).toHaveLength(0)
  })

  it('seeds editable, effective-dated referral/decline rules and required-field checks', async () => {
    const seeded = await seedBusinessownersDemo(options)
    const payload = await withTenantTx(tenantId, async db => (await toRawQuery(db)('SELECT payload FROM quotes WHERE tenant_id=$1 AND quote_id=$2', [tenantId, seeded.quotes.owner])).rows[0].payload)
    expect((await evaluateUW(tenantId, payload)).decision).toBe('Eligible')
    for (const [field, value, decision] of [['vacancyDays', 31, 'Decline'], ['hazardousOperations', true, 'Decline'], ['priorLossCount', 1, 'Refer'], ['roofAgeYears', 21, 'Refer'], ['protectionClass', 9, 'Refer']] as const) {
      const changed = structuredClone(payload); changed.risks[0][field] = value
      expect((await evaluateUW(tenantId, changed)).decision).toBe(decision)
    }
    const rules = await applicableValidationRules(tenantId, { productCode: 'businessowners', state: 'OH' })
    const changed = structuredClone(payload); delete changed.risks[0].annualRevenue
    const outcome = evaluateValidationRules(rules, changed, { level: 'rate', transactionType: 'new_business', productCode: 'businessowners', stateCode: 'OH', asOf: options.effectiveDate })
    expect(outcome.errors.some(error => error.ruleCode === 'BOP_DEMO_ANNUALREVENUE')).toBe(true)
  })

  it('rejects an unrelated user and never overwrites a carrier-edited dependency', async () => {
    await expect(seedBusinessownersDemo({ ...options, operatorUserId: options.agentUserId })).rejects.toThrow('BOP_DEMO_OPERATOR_NOT_AUTHORIZED')
    const seeded = await seedBusinessownersDemo(options)
    await withTenantTx(tenantId, db => toRawQuery(db)('UPDATE agencies SET legal_name=$3 WHERE tenant_id=$1 AND agency_id=$2', [tenantId, seeded.agencyId, 'Carrier edited name']))
    await expect(seedBusinessownersDemo(options)).rejects.toThrow('BOP_DEMO_CONFLICT:agencies')
    const row = await withTenantTx(tenantId, async db => (await toRawQuery(db)('SELECT legal_name FROM agencies WHERE tenant_id=$1 AND agency_id=$2', [tenantId, seeded.agencyId])).rows[0])
    expect(row.legal_name).toBe('Carrier edited name')
    // Restore only this test's deliberate edit for the following lifecycle check.
    await withTenantTx(tenantId, db => toRawQuery(db)('UPDATE agencies SET legal_name=$3 WHERE tenant_id=$1 AND agency_id=$2', [tenantId, seeded.agencyId, 'Lattice Demo Business Agency']))
  })

  it('issues only through the real domain flow or reports the blocker without fabricated policy records', async () => {
    const result = await seedBusinessownersDemo({ ...options, issueExample: true })
    expect(result.blockers).toEqual([])
    expect(result.policyId).toBeTruthy()
    const policy = await withTenantTx(tenantId, async db => (await toRawQuery(db)('SELECT status FROM policies WHERE tenant_id=$1 AND policy_id=$2', [tenantId, result.policyId])).rows[0])
    expect(policy.status).toBe('Issued')
    const rerun = await seedBusinessownersDemo({ ...options, issueExample: true })
    expect(rerun.policyId).toBe(result.policyId)
    expect(rerun.blockers).toEqual([])
  })
})
