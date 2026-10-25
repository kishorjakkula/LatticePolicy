import { describe, expect, it } from 'vitest'
import { normalizeCustomerInput } from '../routes/customers.routes.js'

describe('normalizeCustomerInput optional numbers', () => {
  const input = (address: Record<string, unknown>, ownership: unknown) => ({
    entityType: 'COMPANY',
    identity: { company: { legalName: 'Synthetic Co' } },
    addresses: [{ addressType: 'BUSINESS', line1: '1 Synthetic Way', city: 'Columbus', state: 'OH', postalCode: '43215', country: 'US', ...address }],
    relationships: [{ relationshipType: 'OWNER', relatedCustomerId: '11111111-1111-4111-8111-111111111111', percentOwnership: ownership }],
  })

  it('keeps a missing coordinate or ownership share missing instead of zero', () => {
    for (const blank of [null, undefined, '']) {
      const normalized = normalizeCustomerInput(input({ geocodeLat: blank, geocodeLng: blank }, blank))
      expect(normalized.addresses[0]).toMatchObject({ geocodeLat: null, geocodeLng: null })
      expect(normalized.relationships?.[0]?.percentOwnership ?? null).toBeNull()
    }
  })

  it('keeps real zero and numeric strings', () => {
    const normalized = normalizeCustomerInput(input({ geocodeLat: 0, geocodeLng: '-82.99' }, '50'))
    expect(normalized.addresses[0]).toMatchObject({ geocodeLat: 0, geocodeLng: -82.99 })
    expect(normalized.relationships?.[0]?.percentOwnership).toBe(50)
  })
})
