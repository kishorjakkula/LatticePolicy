import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { cancelPolicy, issuePolicy, previewRenewal, reinstatePolicy, renewPolicy, rewritePolicy } from '../services/lifecycle.service.js'
import { executeEndorsement, previewEndorsement } from '../services/endorsement.service.js'

// A product that exists only in a carrier pack (examples/carrier-pack) taken
// through every policy transaction: its table rating, its custom fields, and
// its screen rules have to hold at each one, not only on the first quote.

const tenantId = 'acme-mutual'
const productCode = 'condo-unit-owners'
const actor = { id: null, username: 'integration-test', roles: ['admin'], permissions: ['uw.referrals.decide'] }
const originalPackDir = process.env.CARRIER_PACK_DIR
let packDir = ''

const risk = {
  type: 'dwelling', address: '1 Main St #4, Austin TX', construction: 'masonry', protectionClass: 3, roofAgeYears: 5,
  yearBuilt: 2005, floorLevel: 4, buildingFloors: 10, hasElevator: true, elevatorCount: 2, occupancy: 'OwnerOccupied',
  associationName: 'Main St HOA',
}

function quotePayload(riskOverrides: Record<string, unknown> = {}) {
  return {
    productCode,
    state: 'TX',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    applicant: { firstName: 'Pat', lastName: `Condo${Math.random().toString(36).slice(2, 8)}`, email: `pat.${Date.now()}@example.com` },
    risks: [{ ...risk, ...riskOverrides }],
    coverages: [
      { code: 'A', selected: true, limit: 150000, deductible: 2500 },
      { code: 'E', selected: true, limit: 300000 },
      { code: 'LOSS_ASSESS', selected: true, limit: 10000 },
    ],
  }
}

function tx<T>(fn: Parameters<typeof withTenantTx<T>>[1]) {
  return withTenantTx(tenantId, fn)
}

async function latestPayload(policyId: string) {
  const result = await getDb()!.query(
    'SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1',
    [tenantId, policyId]
  )
  return JSON.parse(JSON.stringify(result.rows[0].payload))
}

async function issuedPolicy(legacy = false) {
  const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
  // Model a quote written before snapshot pinning without rewriting immutable policy history.
  if (legacy) await getDb()!.query("UPDATE quotes SET payload = payload - 'productSnapshot' WHERE tenant_id=$1 AND quote_id=$2", [tenantId, quote.quoteId])
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
  await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
  return { quote, policyId: bound.policyId }
}

const rulesNotMet = (transaction: string, paths: string[]) => ({
  code: 'PRODUCT_RULES_NOT_MET',
  statusCode: 422,
  details: expect.objectContaining({
    transaction,
    errors: paths.map((errorPath) => expect.objectContaining({ path: errorPath, keyword: 'screen' })),
  }),
})

describe('carrier pack product across the policy lifecycle (database path)', () => {
  beforeAll(async () => {
    packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrier-lifecycle-'))
    fs.cpSync(path.resolve(__dirname, '../../../examples/carrier-pack'), packDir, { recursive: true })
    process.env.CARRIER_PACK_DIR = packDir
    await initDb()
    const pool = getDb()!
    await pool.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,'Acme Mutual','en-US','USD')
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId]
    )
    await pool.query(
      `INSERT INTO product_state_eligibility (tenant_id, product_code, state_code, admitted, surplus_lines, status)
       VALUES ($1,$2,'TX',true,false,'ACTIVE')
       ON CONFLICT (tenant_id, product_code, state_code) DO UPDATE SET status = 'ACTIVE'`,
      [tenantId, productCode]
    )
  })

  afterAll(async () => {
    if (originalPackDir === undefined) delete process.env.CARRIER_PACK_DIR
    else process.env.CARRIER_PACK_DIR = originalPackDir
    await closeDb()
    fs.rmSync(packDir, { recursive: true, force: true })
  })

  it('quotes with the pack rating and rejects a quote that breaks the pack rules', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    expect(quote.status).toBe('Rated')
    expect(quote.premium.calcTrace.source).toBe('rate-table')
    // A 161.01 + E 48.59 + LOSS_ASSESS 22 = 231.60, fee 25, tax 4.63.
    expect(quote.premium.total.amount).toBe(261.23)

    await expect(
      createOrRateQuote({} as any, tenantId, quotePayload({ floorLevel: 12 }), null, 'integration-test')
    ).rejects.toMatchObject({ code: 'INVALID_QUOTE', details: expect.objectContaining({ errors: [expect.objectContaining({ path: '/risks/0/floorLevel' })] }) })
  })

  it('binds, issues, endorses, cancels, and reinstates the pack product', async () => {
    const { policyId } = await issuedPolicy()
    const stored = await latestPayload(policyId)
    // The pack's own fields are carried on the policy.
    expect(stored.risks[0]).toMatchObject({ floorLevel: 4, buildingFloors: 10, hasElevator: true, associationName: 'Main St HOA' })

    // Endorsement that changes a pack field used in rating: frame construction costs more.
    const changed = JSON.parse(JSON.stringify(stored))
    changed.risks[0].construction = 'frame'
    changed.risks[0].associationName = 'Renamed HOA'
    const preview = await tx((db) => previewEndorsement(db, tenantId, policyId, { effectiveDate: '2026-10-01', payload: changed }))
    // Full-term A premium moves from masonry 0.90 to frame 1.05: 161.01 -> 187.84.
    expect(preview.fullTerm.delta).toBeGreaterThan(0)
    expect(preview.premium.total.amount).toBeGreaterThan(0)
    const endorsed = await tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2026-10-01', payload: changed }, actor))
    expect(endorsed.transactionType).toBe('Endorse')
    expect((await latestPayload(policyId)).risks[0]).toMatchObject({ construction: 'frame', associationName: 'Renamed HOA' })

    // Endorsements that break a pack rule are refused, at preview and at execution.
    const tooHigh = JSON.parse(JSON.stringify(changed))
    tooHigh.risks[0].floorLevel = 12
    await expect(tx((db) => previewEndorsement(db, tenantId, policyId, { effectiveDate: '2026-11-01', payload: tooHigh })))
      .rejects.toMatchObject(rulesNotMet('endorsement', ['/risks/0/floorLevel']))
    const rented = JSON.parse(JSON.stringify(changed))
    rented.risks[0].occupancy = 'TenantOccupied'
    await expect(tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2026-11-01', payload: rented }, actor)))
      .rejects.toMatchObject(rulesNotMet('endorsement', ['/risks/0/monthlyRent']))
    expect((await latestPayload(policyId)).risks[0].occupancy).toBe('OwnerOccupied')

    // A plain cancellation is never blocked. One that also changes the risk must meet the rules,
    // so cancellation cannot be used to store data the rules reject.
    await expect(tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2026-12-01', reason: 'insured request', payload: tooHigh }, actor)))
      .rejects.toMatchObject(rulesNotMet('cancellation', ['/risks/0/floorLevel']))
    const unchanged = await latestPayload(policyId)
    const cancelled = await tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2026-12-01', reason: 'insured request', payload: unchanged }, actor))
    expect(cancelled.transactionType).toBe('Cancel')
    expect((await latestPayload(policyId)).risks[0].floorLevel).toBe(4)

    // Reinstating as it was is allowed; changing the risk while reinstating must meet the rules.
    await expect(tx((db) => reinstatePolicy(db, tenantId, policyId, { effectiveDate: '2026-12-10', reason: 'paid', payload: tooHigh }, actor)))
      .rejects.toMatchObject(rulesNotMet('reinstatement', ['/risks/0/floorLevel']))
    const reinstated = await tx((db) => reinstatePolicy(db, tenantId, policyId, { effectiveDate: '2026-12-10', reason: 'paid' }, actor))
    expect(reinstated.transactionType).toBe('Reinstate')
  })

  it('services pinned and legacy policies after the product is closed to new business', async () => {
    const pinned = await issuedPolicy()
    const legacy = await issuedPolicy(true)
    const configPath = path.join(packDir, 'config.yaml')
    const originalConfig = fs.readFileSync(configPath, 'utf8')
    try {
      fs.writeFileSync(configPath, 'enabledProducts: [personal-auto]\n')
      await expect(createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test'))
        .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' })
      for (const { policyId } of [pinned, legacy]) {
        const changed = await latestPayload(policyId)
        changed.risks[0].construction = 'frame'
        const preview = await tx((db) => previewEndorsement(db, tenantId, policyId, { effectiveDate: '2026-10-01', payload: changed }))
        expect(preview.premium.total.amount).toBeGreaterThan(0)
        const endorsed = await tx((db) => executeEndorsement(db, tenantId, policyId, { effectiveDate: '2026-10-01', payload: changed }, actor))
        expect(endorsed.transactionType).toBe('Endorse')
        const cancelled = await tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2026-12-01', reason: 'insured request' }, actor))
        expect(cancelled.transactionType).toBe('Cancel')
        const reinstated = await tx((db) => reinstatePolicy(db, tenantId, policyId, { effectiveDate: '2026-12-10', reason: 'paid' }, actor))
        expect(reinstated.transactionType).toBe('Reinstate')
        await expect(tx((db) => previewRenewal(db, tenantId, policyId, {})))
          .rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' })
      }
    } finally {
      fs.writeFileSync(configPath, originalConfig)
    }
  })

  it('renews on the pack rating and rules', async () => {
    const { quote, policyId } = await issuedPolicy()

    const preview = await tx((db) => previewRenewal(db, tenantId, policyId, {}))
    expect(preview.nextEffectiveDate).toBe('2027-07-01')
    expect(preview.premium.calcTrace.source).toBe('rate-table')
    expect(preview.premium.total.amount).toBe(quote.premium.total.amount)

    const broken = await latestPayload(policyId)
    broken.risks[0].hasElevator = false
    delete broken.risks[0].elevatorCount
    await expect(tx((db) => renewPolicy(db, tenantId, policyId, { payload: broken }, actor)))
      .rejects.toMatchObject(rulesNotMet('renewal', ['/risks/0']))

    const renewed = await tx((db) => renewPolicy(db, tenantId, policyId, {}, actor))
    expect(renewed.transactionType).toBe('Renew')
    expect(renewed.premium.total.amount).toBe(quote.premium.total.amount)
  })

  it('rewrites a cancelled pack policy only with data that meets the rules', async () => {
    const { policyId } = await issuedPolicy()
    await tx((db) => cancelPolicy(db, tenantId, policyId, { effectiveDate: '2026-09-01', reason: 'insured request' }, actor))

    const payload = await latestPayload(policyId)
    const invalid = JSON.parse(JSON.stringify(payload))
    invalid.risks[0].yearBuilt = 1850
    await expect(tx((db) => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2026-09-15', payload: invalid }, actor)))
      .rejects.toMatchObject(rulesNotMet('rewrite', ['/risks/0/yearBuilt']))

    const rewritten = await tx((db) => rewritePolicy(db, tenantId, policyId, { effectiveDate: '2026-09-15', payload }, actor))
    expect(rewritten.transactionType).toBe('Rewrite')
    expect(rewritten.premium.total.amount).toBeGreaterThan(0)
  })

  it('refuses to bind a quote whose data no longer meets the rules', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    // Simulate the stored quote falling out of line with the pack, as after a pack change.
    await getDb()!.query(
      `UPDATE quotes SET payload = jsonb_set(payload, '{risks,0,floorLevel}', '12') WHERE tenant_id=$1 AND quote_id=$2`,
      [tenantId, quote.quoteId]
    )
    await expect(bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null))
      .rejects.toMatchObject(rulesNotMet('bind', ['/risks/0/floorLevel']))
  })
})
