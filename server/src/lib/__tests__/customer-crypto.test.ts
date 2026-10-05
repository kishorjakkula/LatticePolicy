import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashSensitiveValue, normalizeSensitiveValue } from '../customer-crypto.js'

describe('customer sensitive lookup hashing', () => {
  it('normalizes formatting before hashing', () => {
    expect(normalizeSensitiveValue(' 123-45-6789 ')).toBe('123456789')
    expect(hashSensitiveValue('123-45-6789')).toBe(hashSensitiveValue('123456789'))
  })

  it('uses a keyed HMAC instead of a deterministic plain digest', () => {
    const normalized = normalizeSensitiveValue('123-45-6789')
    const plainDigest = crypto.createHash('sha256').update(normalized).digest('hex')
    expect(hashSensitiveValue(normalized)).not.toBe(plainDigest)
  })
})
