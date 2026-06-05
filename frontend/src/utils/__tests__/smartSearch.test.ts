import { describe, expect, it } from 'vitest'
import {
  fallbackSearchModeHint,
  normalizeDigits,
  normalizeSearchText,
  scoreCustomerResult,
  scorePolicyResult,
  scoreQuoteResult,
  scoreTextMatch,
} from '../smartSearch'

describe('smartSearch', () => {
  it('normalizes text and digits', () => {
    expect(normalizeSearchText('  Policy Holder  ')).toBe('policy holder')
    expect(normalizeDigits('(415) 555-1212')).toBe('4155551212')
  })

  it('scores exact, prefix, contains, and missing text matches', () => {
    expect(scoreTextMatch('abc', 'abc')).toBe(100)
    expect(scoreTextMatch('abc', 'abcdef')).toBe(70)
    expect(scoreTextMatch('abc', 'xxabcxx')).toBe(35)
    expect(scoreTextMatch('abc', 'def')).toBe(0)
  })

  it('scores policy results by policy, product, and customer fields', () => {
    const item = {
      policyNumber: 'PC-2026-0001',
      productCode: 'personal-auto',
      customer: { customerKey: 'CUST-2026-000001', name: 'Ada Lovelace' },
    }

    expect(scorePolicyResult(item, 'PC-2026-0001')).toBe(240)
    expect(scorePolicyResult(item, 'personal')).toBeGreaterThan(0)
    expect(scorePolicyResult(item, 'Ada')).toBeGreaterThan(0)
  })

  it('scores quote and customer results by their strongest identifiers', () => {
    expect(scoreQuoteResult({ quoteNumber: 'Q-2026-0001', productCode: 'homeowners' }, 'Q-2026-0001')).toBe(240)
    expect(scoreCustomerResult({
      customerKey: 'CUST-2026-000001',
      name: 'Grace Hopper',
      email: 'grace@example.com',
      phone: '(415) 555-1212',
    }, '4155551212')).toBe(180)
  })

  it('infers fallback search modes from strong query patterns', () => {
    expect(fallbackSearchModeHint('customer@example.com', true)).toBe('customers')
    expect(fallbackSearchModeHint('CUST-2026-000001', true)).toBe('customers')
    expect(fallbackSearchModeHint('Q-2026-0001', true)).toBe('quotes')
    expect(fallbackSearchModeHint('PC-2026-0001', true)).toBe('policies')
    expect(fallbackSearchModeHint('Ada Lovelace', true)).toBe('customers')
    expect(fallbackSearchModeHint('Ada Lovelace', false)).toBe('policies')
    expect(fallbackSearchModeHint('', true)).toBe('policies')
  })
})
