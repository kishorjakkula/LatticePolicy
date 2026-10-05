import { describe, expect, it } from 'vitest'
import { computeSearchMatchScore, normalizeContactIdentity, normalizeLast4, textSimilarity } from '../customer-matching.js'

describe('customer matching contract', () => {
  it('normalizes stable customer identifiers', () => {
    expect(normalizeContactIdentity(' USER@Example.COM ')).toBe('user@example.com')
    expect(normalizeContactIdentity('+1 (212) 555-1212')).toBe('2125551212')
    expect(normalizeLast4('12-3456789')).toBe('6789')
  })
  it('keeps search scoring bounded and deterministic', () => {
    const row = { customer_key: 'CUST-100', display_name: 'Ada Lovelace' }
    expect(computeSearchMatchScore(row, { qText: '', customerKey: 'CUST', name: 'Ada', phone: '', email: '', taxId: '', externalId: '', address: '' })).toBe(100)
    expect(textSimilarity('lattice', 'lattices')).toBeGreaterThan(0.8)
  })
})
