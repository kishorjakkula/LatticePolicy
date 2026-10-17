import crypto from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { initDb, closeDb, getDb, withTenantTx, toRawQuery } from '../db.js'
import { defaultBranding, loadCarrierBranding, saveCarrierBranding } from '../services/carrier-branding.service.js'
import { storeRatingWorksheet, retrieveStoredDocument } from '../services/document-storage.service.js'

describe('persisted carrier identity', () => {
  afterAll(async () => { await closeDb() })
  it('isolates tenant branding and retains the printed snapshot after an admin change', async () => {
    await initDb()
    const a = `brand-${crypto.randomUUID()}`, b = `brand-${crypto.randomUUID()}`
    await getDb()!.query('INSERT INTO tenants (tenant_id,name) VALUES ($1,$2),($3,$4)', [a, 'Alpha', b, 'Beta'])
    try {
      const brand = { ...defaultBranding('Alpha Mutual'), primaryColor: '#155e75' }
      await saveCarrierBranding(a, brand)
      expect(await loadCarrierBranding(a)).toEqual(brand)
      expect((await loadCarrierBranding(b)).name).toBe('Beta')
      const scoped = await withTenantTx(a, db => loadCarrierBranding(a, toRawQuery(db)))
      expect(scoped).toEqual(brand)
      const metadata = { branding: scoped, snapshot: { context: { policyNumber: 'HO-123' } } }
      const artifact = await storeRatingWorksheet({ tenantId: a, documentId: crypto.randomUUID(), metadata })
      await saveCarrierBranding(a, { ...brand, name: 'Updated carrier' })
      const text = (await retrieveStoredDocument(artifact.storageUri))!.toString()
      expect(text).toContain('Alpha Mutual')
      expect(text).not.toContain('Updated carrier')
      expect(text).not.toMatch(/Lattice\s*Policy/i)
    } finally { await getDb()!.query('DELETE FROM tenants WHERE tenant_id IN ($1,$2)', [a, b]) }
  })
})
