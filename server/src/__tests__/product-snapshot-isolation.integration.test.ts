import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../app.js'
import { issueToken } from '../auth.js'
import { closeDb, getDb, initDb } from '../db.js'
import { captureProductSnapshot, clearProductSnapshotCache, ensureProductSnapshots, snapshotRef } from '../lib/product-snapshot.js'
import { rate } from '../services/rating.service.js'

const owner = 'snapshot-owner'
const other = 'snapshot-other'
const payload = () => ({ productCode: 'personal-auto', state: 'CA', termMonths: 12, risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute' }], uwAnswers: { driverAge: 34 }, coverages: [{ code: 'BI', selected: true, limit: 100000 }] })

describe('product snapshot ownership through the API', () => {
  beforeAll(async () => {
    await initDb()
    for (const tenantId of [owner, other]) {
      await getDb()!.query('INSERT INTO tenants (tenant_id, name) VALUES ($1, $1) ON CONFLICT DO NOTHING', [tenantId])
    }
  })
  afterAll(async () => {
    clearProductSnapshotCache()
    await closeDb()
  })

  it('rejects foreign and wrong-product pins with both warm and cold caches', async () => {
    const snapshot = await captureProductSnapshot(owner, 'personal-auto', 'CA')
    const quote = { ...payload(), productSnapshot: snapshotRef(snapshot!) }
    const app = createApp()
    const insights = (tenantId: string, body: any) => request(app)
      .post('/api/v1/ai/quotes/insights')
      .set('X-Tenant', tenantId)
      .set('Authorization', `Bearer ${issueToken({ id: '11111111-1111-4111-a111-111111111111', username: 'snapshot-review', tenantId, roles: [], permissions: ['page.wizard.view'] })}`)
      .send({ payload: body })

    for (const cold of [false, true]) {
      if (cold) clearProductSnapshotCache()
      const foreign = await insights(other, quote)
      expect(foreign.status).toBe(400)
      expect(foreign.body.code).toBe('PRODUCT_VERSION_NOT_LOADED')
      const wrongProduct = await insights(owner, { ...quote, productCode: 'homeowners' })
      expect(wrongProduct.status).toBe(400)
      expect(wrongProduct.body.code).toBe('PRODUCT_VERSION_NOT_LOADED')
      // Rejection must not evict or corrupt the owner's usable definition.
      await ensureProductSnapshots(owner, [quote])
      expect(rate(owner, quote).total.amount).toBeGreaterThan(0)
      expect((await insights(owner, quote)).status).toBe(200)
    }
  })
})
