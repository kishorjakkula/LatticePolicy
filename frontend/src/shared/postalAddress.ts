import type { PostalAddress } from '@lattice-policy/types'

export type ContactAddress = PostalAddress & {
  addressId?: string
  addressType?: string
  primary?: boolean
  effectiveFrom?: string
  effectiveTo?: string
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export function postalAddress(raw: any = {}): PostalAddress {
  return {
    line1: String(raw.line1 ?? raw.street ?? ''), line2: String(raw.line2 ?? raw.street2 ?? ''),
    line3: String(raw.line3 ?? ''), city: String(raw.city ?? ''), state: String(raw.state ?? ''),
    postalCode: String(raw.postalCode ?? raw.zip ?? ''), country: String(raw.country || 'US'),
    county: String(raw.county ?? ''),
  }
}

export function legacyAddress(raw: any = {}) {
  const a = postalAddress(raw)
  return { street: a.line1, line2: a.line2, line3: a.line3, city: a.city, state: a.state, zip: a.postalCode, country: a.country, county: a.county }
}

export function ratingZip(address: PostalAddress): string {
  return address.country === 'US' && /^\d{5}-\d{4}$/.test(address.postalCode) ? address.postalCode.slice(0, 5) : address.postalCode
}

export function contactAddresses(raw: any[] | undefined, fallback?: any): ContactAddress[] {
  const hasFallback = fallback && ['line1', 'street', 'city', 'state', 'postalCode', 'zip'].some(key => fallback[key])
  const source = Array.isArray(raw) ? raw : hasFallback ? [postalAddress(fallback)] : []
  const primary = Math.max(0, source.findIndex(a => a.primary))
  return source.map((a, i) => {
    const { email: _email, phone: _phone, mobile: _mobile, ...rest } = a
    return { ...rest, ...postalAddress(a), addressType: a.addressType || 'mailing', primary: i === primary }
  })
}

export function primaryAddress(addresses: ContactAddress[]) {
  return addresses.find(a => a.primary) || addresses[0] || postalAddress()
}

export function formatPostalAddress(raw: any): string {
  const a = postalAddress(raw)
  return [a.line1, a.line2, a.line3, a.city, [a.state, a.postalCode].filter(Boolean).join(' '), a.country !== 'US' ? a.country : ''].filter(Boolean).join(', ')
}
