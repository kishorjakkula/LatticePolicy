import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import express from 'express'
import request from 'supertest'
import { adminRoutes } from '../routes/admin.routes.js'
import { tenancyMiddleware, requireTenant } from '../tenancy.js'
import { brandingSchema, defaultBranding, loadCarrierBranding, saveCarrierBranding } from '../services/carrier-branding.service.js'
import { renderPolicyPacketHtml } from '../services/document-storage.service.js'

const brand = { ...defaultBranding('Acme Mutual'), primaryColor: '#155e75', documentFooter: 'Acme carrier terms apply.' }
function app(permissions?: string[], userTenant = 'brand-a') {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { if (permissions) req.user = { id: 'admin', username: 'admin', tenantId: userTenant, roles: [], permissions } as any; next() })
  app.use(tenancyMiddleware)
  app.get('/brand', requireTenant, async (req, res) => res.json(await loadCarrierBranding(req.tenant!.tenantId)))
  app.use('/admin', requireTenant, adminRoutes)
  return app
}
describe('carrier branding', () => {
  it('validates logos and colors without allowing network URLs or SVG', () => {
    expect(brandingSchema.safeParse(brand).success).toBe(true)
    const logo = fs.readFileSync(new URL('../../../deploy/pilot/acme-mutual-logo.png', import.meta.url))
    expect(brandingSchema.safeParse({ ...brand, logoDataUrl: `data:image/png;base64,${logo.toString('base64')}` }).success).toBe(true)
    const oversized = Buffer.from(logo)
    oversized.writeUInt32BE(10000, 16)
    expect(brandingSchema.safeParse({ ...brand, logoDataUrl: `data:image/png;base64,${oversized.toString('base64')}` }).success).toBe(false)
    for (const logoDataUrl of ['https://example.com/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA']) {
      expect(brandingSchema.safeParse({ ...brand, logoDataUrl }).success).toBe(false)
    }
    expect(brandingSchema.safeParse({ ...brand, primaryColor: 'red;display:none' }).success).toBe(false)
    expect(brandingSchema.safeParse({ ...brand, logoDataUrl: 'data:image/png;base64,' + 'A'.repeat(700004) }).success).toBe(false)
  })
  it('exposes only public identity and isolates tenant updates', async () => {
    const admin = app(['menu.admin.view', 'admin.tenant.read', 'admin.tenant.manage'])
    expect((await request(admin).patch('/admin/branding').set('X-Tenant', 'brand-a').send(brand)).status).toBe(200)
    const publicRead = await request(app()).get('/brand').set('X-Tenant', 'brand-a')
    expect(publicRead.body).toEqual(brand)
    expect((await request(app()).get('/brand').set('X-Tenant', 'brand-b')).body.name).toBe('brand-b')
    expect((await request(admin).patch('/admin/branding').set('X-Tenant', 'brand-b').send(brand)).status).toBe(403)
    expect((await request(app()).patch('/admin/branding').set('X-Tenant', 'brand-a').send(brand)).status).toBe(401)
    expect((await request(app(['menu.admin.view', 'admin.tenant.read'])).patch('/admin/branding').set('X-Tenant', 'brand-a').send(brand)).status).toBe(403)
    expect((await request(admin).patch('/admin/branding').set('X-Tenant', 'brand-a').send({ ...brand, primaryColor: 'bad' })).status).toBe(400)
  })
  it('prints escaped carrier identity and preserves a document branding snapshot', async () => {
    const metadata = { branding: { ...brand, name: '<Acme & Mutual>' }, policyId: 'p', transactionId: 't', transactionType: 'NB', productCode: 'homeowners', effectiveDate: '2026-10-11', generatedAt: '2026-10-11', forms: [] }
    const html = renderPolicyPacketHtml(metadata)
    expect(html).toContain('&lt;Acme &amp; Mutual&gt;')
    expect(html).toContain('Acme carrier terms apply.')
    expect(html).not.toMatch(/Lattice\s*Policy/i)
    await saveCarrierBranding('brand-a', { ...brand, name: 'Changed carrier' })
    expect(renderPolicyPacketHtml(metadata)).toBe(html)
    expect(renderPolicyPacketHtml({ ...metadata, branding: undefined })).not.toMatch(/Lattice\s*Policy/i)
  })
})
