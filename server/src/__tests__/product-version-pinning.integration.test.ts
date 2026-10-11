import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { closeDb, getDb, initDb, withTenantTx } from '../db.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { issuePolicy, previewRenewal, renewPolicy } from '../services/lifecycle.service.js'
import { executeEndorsement, previewEndorsement } from '../services/endorsement.service.js'
import { clearProductSnapshotCache } from '../lib/product-snapshot.js'

// A policy in force keeps the product version it was written on. The carrier
// then changes its pack (higher rate, a new rule); new business and the
// renewal pick the change up, a mid-term endorsement does not.

const tenantId = 'acme-mutual'
const productCode = 'condo-unit-owners'
const actor = { id: null, username: 'integration-test', roles: ['admin'], permissions: ['uw.referrals.decide'] }
const originalPackDir = process.env.CARRIER_PACK_DIR
let packDir = ''

function quotePayload() {
  return {
    productCode,
    state: 'TX',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    applicant: { firstName: 'Pin', lastName: `Holder${Math.random().toString(36).slice(2, 8)}`, email: `pin.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com` },
    risks: [{
      type: 'dwelling', address: '9 Pin St #4, Austin TX', construction: 'masonry', protectionClass: 3, roofAgeYears: 5, yearBuilt: 2005,
      floorLevel: 4, buildingFloors: 10, hasElevator: true, elevatorCount: 2, occupancy: 'OwnerOccupied',
    }],
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

function editPackFile(file: string, edit: (text: string) => string) {
  const target = path.join(packDir, file)
  fs.writeFileSync(target, edit(fs.readFileSync(target, 'utf8')))
}

/** The carrier releases pack 1.1.0: masonry costs far more, and units above the third floor are no longer written. */
function releaseChangedPack() {
  editPackFile('pack.yaml', (text) => text.replace('version: 1.0.0', 'version: 1.1.0'))
  editPackFile('products/condo-unit-owners/rates.yaml', (text) => text.replace('masonry: 0.90', 'masonry: 1.50'))
  editPackFile('screens/condo-unit-owners.yaml', (text) => text.replace(
    '  validations:\n',
    '  validations:\n    - rule: risk.floorLevel <= 3\n      field: floorLevel\n      message: Units above the third floor are no longer written\n'
  ))
}

describe('product version pinning (database path)', () => {
  beforeAll(async () => {
    packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carrier-pack-pin-'))
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
    fs.rmSync(packDir, { recursive: true, force: true })
    await closeDb()
  })

  it('keeps an in-force policy on the rates and rules it was written on', async () => {
    // --- Written on pack 1.0.0 -------------------------------------------------
    const quote = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    expect(quote.premium.total.amount).toBe(261.23)
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
    const written = await latestPayload(bound.policyId)
    const originalPin = written.productSnapshot
    expect(originalPin).toMatchObject({ packVersion: '1.0.0' })
    expect(originalPin.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(quote.premium.calcTrace.productSnapshotId).toBe(originalPin.id)

    // Rating the same product again while nothing has changed reuses the snapshot.
    const second = await createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test')
    expect(second.premium.calcTrace.productSnapshotId).toBe(originalPin.id)

    // --- The carrier changes the product --------------------------------------
    releaseChangedPack()
    // As after a restart or in another process: nothing is cached.
    clearProductSnapshotCache()

    // New business is written on the changed product.
    await expect(createOrRateQuote({} as any, tenantId, quotePayload(), null, 'integration-test'))
      .rejects.toMatchObject({ code: 'INVALID_QUOTE', details: expect.objectContaining({ errors: [expect.objectContaining({ message: 'Floor Level: Units above the third floor are no longer written' })] }) })
    const lowFloor = quotePayload()
    lowFloor.risks[0].floorLevel = 3
    const newBusiness = await createOrRateQuote({} as any, tenantId, lowFloor, null, 'integration-test')
    expect(newBusiness.premium.calcTrace.productSnapshotId).not.toBe(originalPin.id)
    // Masonry is now 1.50 instead of 0.90 (and floor 3 is 1.00 instead of 0.97).
    expect(newBusiness.premium.total.amount).toBeGreaterThan(400)

    // --- Mid-term endorsement on the in-force policy --------------------------
    // Raise Coverage A to 200,000. On the 1.0.0 tables the full-term premium moves
    // from 261.23 to 315.98; on the 1.1.0 tables it would be far higher.
    const endorsedPayload = JSON.parse(JSON.stringify(written))
    endorsedPayload.coverages[0].limit = 200000
    // A client cannot move a policy to another product version by sending a different pin.
    endorsedPayload.productSnapshot = { id: newBusiness.premium.calcTrace.productSnapshotId }

    const preview = await tx((db) => previewEndorsement(db, tenantId, bound.policyId, { effectiveDate: '2026-10-01', payload: endorsedPayload }))
    expect(preview.fullTerm).toMatchObject({ old: 261.23, new: 315.98 })

    // The policy is on floor 4, which the new rule forbids; the rule does not reach back into this term.
    const endorsed = await tx((db) => executeEndorsement(db, tenantId, bound.policyId, { effectiveDate: '2026-10-01', payload: endorsedPayload }, actor))
    expect(endorsed.transactionType).toBe('Endorse')
    const afterEndorsement = await latestPayload(bound.policyId)
    expect(afterEndorsement.productSnapshot).toEqual(originalPin)
    expect(afterEndorsement.coverages[0].limit).toBe(200000)

    // The original term's own rules still apply to it.
    const tooHigh = JSON.parse(JSON.stringify(afterEndorsement))
    tooHigh.risks[0].floorLevel = 12
    await expect(tx((db) => previewEndorsement(db, tenantId, bound.policyId, { effectiveDate: '2026-11-01', payload: tooHigh })))
      .rejects.toMatchObject({ code: 'PRODUCT_RULES_NOT_MET' })

    // --- Renewal starts a new term on the changed product ----------------------
    const renewalPreview = await tx((db) => previewRenewal(db, tenantId, bound.policyId, {}))
    expect(renewalPreview.premium.calcTrace.productSnapshotId).toBe(newBusiness.premium.calcTrace.productSnapshotId)
    expect(renewalPreview.premium.total.amount).toBeGreaterThan(400)

    // The renewal has to meet the new rule: floor 4 is refused, floor 3 is accepted.
    await expect(tx((db) => renewPolicy(db, tenantId, bound.policyId, {}, actor)))
      .rejects.toMatchObject({ code: 'PRODUCT_RULES_NOT_MET', details: expect.objectContaining({ transaction: 'renewal' }) })
    const renewalPayload = JSON.parse(JSON.stringify(afterEndorsement))
    renewalPayload.risks[0].floorLevel = 3
    const renewed = await tx((db) => renewPolicy(db, tenantId, bound.policyId, { payload: renewalPayload }, actor))
    expect(renewed.transactionType).toBe('Renew')
    const renewedPayload = await latestPayload(bound.policyId)
    expect(renewedPayload.productSnapshot).toMatchObject({ packVersion: '1.1.0', id: newBusiness.premium.calcTrace.productSnapshotId })

    // Two definitions of the product are on record, one per pack version.
    const snapshots = await getDb()!.query(
      `SELECT source->>'packVersion' AS pack_version FROM product_snapshots WHERE tenant_id=$1 AND product_code=$2 ORDER BY created_at`,
      [tenantId, productCode]
    )
    expect(snapshots.rows.map((row: any) => row.pack_version)).toEqual(['1.0.0', '1.1.0'])
  })

  it('serves the wizard the screen of the product version a policy term was written on', async () => {
    // Runs after the first test, so the pack is at 1.1.0 with seven validation rules.
    const low = quotePayload()
    low.risks[0].floorLevel = 3
    const quote = await createOrRateQuote({} as any, tenantId, low, null, 'integration-test')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))

    // The carrier changes the screen again: a new section label and one more rule.
    editPackFile('screens/condo-unit-owners.yaml', (text) => text
      .replace('    - title: Association\n', '    - title: Homeowners Association\n')
      .replace('  validations:\n', '  validations:\n    - rule: risk.roofAgeYears <= 40\n      field: roofAgeYears\n      message: Roof is too old\n'))

    const app = createApp()
    const username = `pin-admin-${Date.now()}`
    await createUser({ username, password: 'password', tenantId, roles: ['admin'] })
    const login = await request(app).post('/auth/login').send({ tenantId, username, password: 'password' }).expect(200)
    const form = (query: string) => request(app)
      .get(`/api/v1/products/${productCode}/form${query}`)
      .set('Authorization', `Bearer ${login.body.token}`)
      .set('X-Tenant', tenantId)
      .expect(200)

    const current = await form('')
    expect(current.body.screen.validations).toHaveLength(8)
    expect(current.body.screen.sections.map((section: any) => section.title)).toContain('Homeowners Association')

    const pinned = await form(`?policyId=${bound.policyId}`)
    expect(pinned.body.screen.validations).toHaveLength(7)
    expect(pinned.body.screen.sections.map((section: any) => section.title)).toContain('Association')
    expect(pinned.body.productSnapshotId).toBe(quote.premium.calcTrace.productSnapshotId)
    expect(pinned.body.fields.find((field: any) => field.key === 'floorLevel')).toMatchObject({ label: 'Floor Level', type: 'number', required: true, group: 'Unit' })

    // An unknown or malformed policy id falls back to the current screen rather than failing.
    expect((await form('?policyId=not-a-uuid')).body.screen.validations).toHaveLength(8)
    expect((await form('?policyId=00000000-0000-4000-8000-000000000000')).body.screen.validations).toHaveLength(8)
  })

  it('refuses to rate a policy whose product version cannot be found rather than use today\'s rates', async () => {
    const quote = await createOrRateQuote({} as any, tenantId, { ...quotePayload(), risks: [{ ...quotePayload().risks[0], floorLevel: 3 }] }, null, 'integration-test')
    const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
    await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
    const payload = await latestPayload(bound.policyId)
    // Policy versions are immutable, so simulate the loss by removing the snapshot itself.
    await getDb()!.query('DELETE FROM product_snapshots WHERE tenant_id=$1 AND snapshot_id=$2', [tenantId, payload.productSnapshot.id])
    clearProductSnapshotCache()
    await expect(tx((db) => previewEndorsement(db, tenantId, bound.policyId, { effectiveDate: '2026-10-01', payload })))
      .rejects.toMatchObject({ code: 'PRODUCT_VERSION_NOT_LOADED' })
  })

  it('keeps core base fields alongside the original additive screen and pins an absent screen', async () => {
    const fieldsPath = path.join(packDir, 'fields/homeowners.json')
    const screenPath = path.join(packDir, 'screens/homeowners.yaml')
    const fields = [{ path: 'risks.0.customerNote', type: 'string', required: true, ui: { label: 'Customer note' } }]
    fs.writeFileSync(fieldsPath, JSON.stringify(fields))
    const screen = 'product: homeowners\nrisk:\n  sections:\n    - title: Carrier extras\n      fields: [customerNote]\n'
    const configPath = path.join(packDir, 'config.yaml')
    const config = fs.readFileSync(configPath, 'utf8')
    fs.writeFileSync(configPath, 'enabledProducts: [homeowners, condo-unit-owners]\n')
    await getDb()!.query(`INSERT INTO product_state_eligibility (tenant_id, product_code, state_code, admitted, surplus_lines, status)
      VALUES ($1,'homeowners','TX',true,false,'ACTIVE') ON CONFLICT DO NOTHING`, [tenantId])
    const payload = {
      ...quotePayload(), productCode: 'homeowners',
      risks: [{ type: 'dwelling', address: '10 Original Ln', construction: 'frame', yearBuilt: 2000,
        protectionClass: 3, roofAgeYears: 5, squareFeet: 1500, customerNote: 'Original note' }],
      coverages: [{ code: 'A', selected: true, limit: 300000, deductible: 1000 }],
    }
    const app = createApp()
    const username = `core-pin-${Date.now()}`
    await createUser({ username, password: 'password', tenantId, roles: ['admin'] })
    const login = await request(app).post('/auth/login').send({ tenantId, username, password: 'password' }).expect(200)
    const form = (policyId?: string) => request(app).get(`/api/v1/products/homeowners/form${policyId ? `?policyId=${policyId}` : ''}`)
      .set('Authorization', `Bearer ${login.body.token}`).set('X-Tenant', tenantId).expect(200)
    const writePolicy = async () => {
      const quote = await createOrRateQuote({} as any, tenantId, payload, null, 'integration-test')
      const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
      await tx((db) => issuePolicy(db, tenantId, bound.policyId, {}, actor))
      return bound.policyId
    }
    try {
      // No custom screen when this term starts, even though field metadata exists.
      const noScreenPolicy = await writePolicy()
      fs.writeFileSync(screenPath, screen)
      const additivePolicy = await writePolicy()
      fs.writeFileSync(screenPath, screen.replace('Carrier extras', 'New extras'))
      clearProductSnapshotCache()
      const absent = await form(noScreenPolicy)
      expect(absent.body.screen).toBeNull()
      expect(absent.body.fields.map((f: any) => f.key)).toContain('address')
      const pinned = await form(additivePolicy)
      expect(pinned.body.screen.sections[0].title).toBe('Carrier extras')
      expect(pinned.body.fields.map((f: any) => f.key)).toEqual(expect.arrayContaining(['address', 'yearBuilt', 'construction', 'customerNote']))
      expect(new Set(pinned.body.fields.map((f: any) => f.path)).size).toBe(pinned.body.fields.length)
      expect((await form()).body.screen.sections[0].title).toBe('New extras')
      const changed = await latestPayload(noScreenPolicy)
      delete changed.risks[0].customerNote
      await expect(tx((db) => previewEndorsement(db, tenantId, noScreenPolicy, { effectiveDate: '2026-10-01', payload: changed }))).resolves.toBeDefined()
      const wrongProduct = await request(app).get(`/api/v1/products/condo-unit-owners/form?policyId=${additivePolicy}`)
        .set('Authorization', `Bearer ${login.body.token}`).set('X-Tenant', tenantId)
      expect(wrongProduct.status).toBe(400)
      expect(wrongProduct.body.code).toBe('PRODUCT_VERSION_NOT_LOADED')
    } finally {
      fs.writeFileSync(configPath, config)
      fs.rmSync(fieldsPath, { force: true })
      fs.rmSync(screenPath, { force: true })
    }
  })
})
