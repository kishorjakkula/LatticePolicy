import { z } from 'zod'
import { getPinnedTenantId } from '../config.js'

const text = (max: number) => z.string().trim().max(max).refine(v => !/[\x00-\x1f\x7f]/.test(v))
export const addressCheckInput = z.object({ address: z.object({
  line1: text(200).min(1), line2: text(100).optional(), line3: text(100).optional(),
  city: text(100).min(1), state: text(100).min(1), postalCode: text(20).min(1),
  country: z.string().regex(/^[A-Z]{2}$/), county: text(100).optional(),
}).strict() }).strict()
const states = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '))
const components = z.object({
  fromAddress: text(30).optional(), streetName: text(100).min(1), city: text(100).min(1), state: z.string().regex(/^[A-Z]{2}$/), zip: z.string().regex(/^\d{5}$/),
  preDirection: text(20).optional(), preType: text(30).optional(), suffixType: text(30).optional(), suffixDirection: text(20).optional(),
})

export function addressCapabilities(tenant: string) {
  const pinned = getPinnedTenantId()
  const allowed = (process.env.ADDRESS_CHECK_ALLOWED_TENANTS || '').split(',').map(s => s.trim()).filter(s => s && s !== '*')
  const enabled = process.env.ADDRESS_CHECK_PROVIDER === 'census' && allowed.includes(tenant) && (!pinned || pinned === tenant)
  return { enabled, provider: enabled ? 'census' : null, kind: 'address_range_match' }
}

export async function checkAddress(tenant: string, address: z.infer<typeof addressCheckInput>['address']) {
  const base = { provider: 'census', checkedAt: new Date().toISOString(), candidates: [] as any[] }
  if (!addressCapabilities(tenant).enabled) return { ...base, outcome: 'disabled' }
  if (address.country !== 'US' || ['AA', 'AE', 'AP', 'PR'].includes(address.state.toUpperCase()) || /\bP\.?\s*O\.?\s*BOX\b|\b(?:APO|FPO|DPO)\b/i.test(address.line1)) {
    return { ...base, outcome: 'unsupported' }
  }
  if (!states.has(address.state) || !/^\d{5}(?:-\d{4})?$/.test(address.postalCode)) return { ...base, outcome: 'unsupported' }
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/address')
  for (const [key, value] of Object.entries({ street: address.line1, city: address.city, state: address.state, zip: address.postalCode.slice(0, 5), benchmark: 'Public_AR_Current', format: 'json' })) url.searchParams.set(key, value)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } })
    if (!response.ok || !response.body) throw new Error('PROVIDER_UNAVAILABLE')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.length
        if (size > 256 * 1024) throw new Error('RESPONSE_TOO_LARGE')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const matches = data?.result?.addressMatches
    if (!Array.isArray(matches) || matches.length > 5) throw new Error('INVALID_RESPONSE')
    const candidates = matches.map((match: any) => {
      const c = components.parse(match?.addressComponents)
      const line1 = [c?.fromAddress, c?.preDirection, c?.preType, c?.streetName, c?.suffixType, c?.suffixDirection].filter(Boolean).join(' ')
      // TIGER matches ranges, not individual delivery points. Preserve the
      // entered house number instead of replacing it with the range endpoint.
      const number = address.line1.match(/^\s*(\d+[A-Za-z]?(?:-\d+)?)/)?.[1]
      const street = number && c?.streetName ? [number, c.preDirection, c.preType, c.streetName, c.suffixType, c.suffixDirection].filter(Boolean).join(' ') : ''
      if (!line1 || !street || typeof c?.city !== 'string' || typeof c?.state !== 'string' || !/^\d{5}$/.test(c?.zip || '') || c.state !== address.state || c.zip !== address.postalCode.slice(0, 5)) throw new Error('INVALID_MATCH')
      return { address: { ...address, line1: street, city: c.city, state: c.state, postalCode: address.postalCode }, precision: 'address_range' }
    })
    return { ...base, outcome: candidates.length > 1 ? 'ambiguous' : candidates.length ? 'matched' : 'unmatched', candidates }
  } catch {
    // Never log an outbound URL, provider error or response containing addresses.
    return { ...base, outcome: 'unavailable' }
  } finally { clearTimeout(timer) }
}
