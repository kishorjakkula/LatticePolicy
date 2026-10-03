import { describe, expect, it } from 'vitest'
import { evaluateAuthority, maximumRequestedLimit } from '../underwriting-authority.service.js'

const baseGrant = {
  grantId: 'grant-1',
  transactionTypes: ['NewBusiness'],
  maxPremium: 1500,
  maxLimit: 100000,
  mayOverride: false,
}

describe('underwriting authority', () => {
  it('authorizes a matching transaction within premium and limit authority', () => {
    expect(evaluateAuthority([baseGrant], {
      transactionType: 'NewBusiness',
      premium: 1200,
      requestedLimit: 100000,
    })).toMatchObject({ authorized: true, grantId: 'grant-1', reasons: [] })
  })

  it('reports stable reasons when configured authority is exceeded', () => {
    expect(evaluateAuthority([baseGrant], {
      transactionType: 'NewBusiness',
      premium: 1600,
      requestedLimit: 250000,
    })).toMatchObject({
      authorized: false,
      reasons: ['PREMIUM_AUTHORITY_EXCEEDED', 'LIMIT_AUTHORITY_EXCEEDED'],
    })
  })

  it('supports wildcard grants and rejects unmatched transaction types', () => {
    const wildcard = { ...baseGrant, transactionTypes: ['*'], maxPremium: null, maxLimit: null }
    expect(evaluateAuthority([wildcard], {
      transactionType: 'Renew', premium: 999999, requestedLimit: 999999,
    }).authorized).toBe(true)
    expect(evaluateAuthority([baseGrant], {
      transactionType: 'Endorse', premium: 0, requestedLimit: 0,
    })).toMatchObject({ authorized: false, reasons: ['NO_AUTHORITY_GRANT'] })
  })

  it('derives the highest requested coverage limit', () => {
    expect(maximumRequestedLimit({ coverages: [
      { limit: 50000 },
      { perOccurrenceLimit: 100000, aggregateLimit: 300000 },
      { limit: '250000' },
    ] })).toBe(300000)
  })
})
