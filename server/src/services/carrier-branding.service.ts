import { imageSize } from 'image-size'
import { z } from 'zod'
import { getDb, withTenantTx, toRawQuery } from '../db.js'

// Only embedded raster images: no remote renderer requests or executable SVG.
export function isSafeLogo(value: string): boolean {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length > 700000) return false
  const bytes = Buffer.from(match[2], 'base64')
  if (bytes.length > 500000 || bytes.toString('base64') !== match[2]) return false
  try {
    const image = imageSize(bytes)
    const expectedType = match[1] === 'jpeg' ? 'jpg' : match[1]
    return image.type === expectedType && image.width > 0 && image.height > 0 && image.width <= 4096 && image.height <= 4096
  } catch { return false }
}
export const brandingSchema = z.object({
  name: z.string().trim().min(1).max(100),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoDataUrl: z.string().refine(isSafeLogo, 'Use a PNG, JPEG or WebP logo under 500 KB').nullable(),
  documentFooter: z.string().trim().max(500),
}).strict()
export type CarrierBranding = z.infer<typeof brandingSchema>
export function defaultBranding(name = 'Insurance carrier'): CarrierBranding {
  return { name, primaryColor: '#1f3a8a', logoDataUrl: null, documentFooter: "Coverage is governed by the policy's terms and conditions." }
}
const memoryBrands = new Map<string, CarrierBranding>()
type BrandingQuery = (text: string, params?: any[]) => Promise<any>
export async function carrierBrandingSettings(tenantId: string, query?: BrandingQuery): Promise<{ branding: CarrierBranding; configured: boolean }> {
  if (!getDb()) return { branding: memoryBrands.get(tenantId) || defaultBranding(tenantId), configured: memoryBrands.has(tenantId) }
  const sql = 'SELECT name, branding FROM tenants WHERE tenant_id=$1'
  const result = query ? await query(sql, [tenantId]) : await withTenantTx(tenantId, db => toRawQuery(db)(sql, [tenantId]))
  const row = result.rows[0]
  const parsed = brandingSchema.safeParse(row?.branding)
  return { branding: parsed.success ? parsed.data : defaultBranding(row?.name || tenantId), configured: parsed.success }
}
export async function loadCarrierBranding(tenantId: string, query?: BrandingQuery): Promise<CarrierBranding> {
  return (await carrierBrandingSettings(tenantId, query)).branding
}
export async function saveCarrierBranding(tenantId: string, branding: CarrierBranding): Promise<void> {
  const validated = brandingSchema.parse(branding)
  if (!getDb()) { memoryBrands.set(tenantId, validated); return }
  await withTenantTx(tenantId, db => toRawQuery(db)('UPDATE tenants SET branding=$2::jsonb WHERE tenant_id=$1', [tenantId, JSON.stringify(validated)]))
}
