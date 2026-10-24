import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ratingFingerprint } from '../../lib/rating-fingerprint.js'

const state = vi.hoisted(() => ({ appointed: true, writes: 0, reads: [] as string[] }))
const actorId = '11111111-1111-4111-8111-111111111111'
const payload = () => ({ productCode: 'businessowners', state: 'OH', effectiveDate: '2026-10-23', termMonths: 12,
  underwritingCompanyId: '22222222-2222-4222-8222-222222222222',
  agency: { agencyId: '33333333-3333-4333-8333-333333333333' },
  producer: { producerId: '44444444-4444-4444-8444-444444444444' } })

vi.mock('../../db.js', () => ({
  withTenantTx: vi.fn(async (_tenant: string, fn: any) => fn({})),
  toRawQuery: () => async (sql: string) => {
    state.reads.push(sql)
    if (sql.includes('INSERT INTO quotes') || sql.includes('UPDATE quotes SET')) state.writes++
    if (sql.includes('FROM user_roles')) return { rows: [{ role_code: 'agent' }], rowCount: 1 }
    if (sql.includes('FROM onboarding_appointments')) return {
      rows: state.appointed ? [{ entity_type: 'AGENCY' }, { entity_type: 'PRODUCER' }] : [], rowCount: state.appointed ? 2 : 0,
    }
    // A current rating, so bind reaches the distribution check (WP-0008 refuses stale ratings first).
    if (sql.includes('FROM quotes')) return { rows: [{ payload: payload(), quote_number: 'Q-TEST', status: 'Rated',
      underwriting: { decision: 'Accept', reasons: [], ratedFingerprint: ratingFingerprint(payload()) },
      premium: { total: { amount: 800, currency: 'USD' } } }], rowCount: 1 }
    return { rows: [{}], rowCount: 1 }
  },
}))
vi.mock('../../contracts.js', () => ({ validateQuoteDetailed: () => ({ valid: true }) }))
vi.mock('../../lib/product-registry.js', () => ({ requireProductCapability: vi.fn(), mapProductRiskKind: vi.fn() }))
vi.mock('../../lib/product-snapshot.js', () => ({ pinToCurrentProduct: vi.fn(), ensureProductSnapshots: vi.fn() }))
vi.mock('../product-rules.service.js', () => ({ productRuleViolations: () => [], assertProductRules: vi.fn() }))
vi.mock('../product-governance.service.js', () => ({ resolveGovernanceRelease: () => null }))
vi.mock('../../rating.js', () => ({ rate: vi.fn(() => ({ total: { amount: 800, currency: 'USD' } })) }))
vi.mock('../../uw.js', () => ({ evaluateUW: () => ({ decision: 'Accept', reasons: [] }) }))
vi.mock('../../tenantAi.js', () => ({ loadTenantAiMlConfig: () => ({}) }))
vi.mock('../../aiMl.js', () => ({ inferQuoteAiInsights: () => ({ provider: 'test' }) }))

import { rate } from '../../rating.js'
import { createOrRateQuote } from '../quote.service.js'
import { bindQuote } from '../quote-bind.service.js'

beforeEach(() => {
  state.appointed = true
  state.writes = 0
  state.reads = []
  vi.mocked(rate).mockReset().mockReturnValue({ total: { amount: 800, currency: 'USD' } } as any)
})

describe('BOP domain service guard invocation', () => {
  it('checks before pricing and again before the final quote insert', async () => {
    await createOrRateQuote({} as any, 'synthetic-bop', payload(), null, 'audit-only', { actorId })
    expect(state.writes).toBe(1)
    expect(state.reads.filter(sql => sql.includes('FROM onboarding_appointments'))).toHaveLength(2)
  })
  it('checks before the final existing-quote update too', async () => {
    await createOrRateQuote({} as any, 'synthetic-bop', payload(), 'quote-id', 'audit-only', { actorId })
    expect(state.writes).toBe(1)
    expect(state.reads.filter(sql => sql.includes('FROM onboarding_appointments'))).toHaveLength(2)
  })
  it('does not accept the audit username in place of authenticated actor context', async () => {
    await expect(createOrRateQuote({} as any, 'synthetic-bop', payload(), null, actorId))
      .rejects.toMatchObject({ code: 'BOP_ACTOR_NOT_AUTHORIZED' })
    expect(rate).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })
  it('rejects revoked appointments before pricing', async () => {
    state.appointed = false
    await expect(createOrRateQuote({} as any, 'synthetic-bop', payload(), null, 'audit-only', { actorId }))
      .rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
    expect(rate).not.toHaveBeenCalled()
    expect(state.writes).toBe(0)
  })
  it('does not persist when the appointment is revoked between initial evaluation and the final transaction', async () => {
    vi.mocked(rate).mockImplementation(() => { state.appointed = false; return { total: { amount: 800, currency: 'USD' } } as any })
    await expect(createOrRateQuote({} as any, 'synthetic-bop', payload(), null, 'audit-only', { actorId }))
      .rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
    expect(state.writes).toBe(0)
    expect(state.reads.filter(sql => sql.includes('FROM onboarding_appointments'))).toHaveLength(2)
  })
  it('rejects bind before other processing when the persisted quote distribution is no longer appointed', async () => {
    state.appointed = false
    await expect(bindQuote({} as any, 'synthetic-bop', 'quote-id', {}, 'audit-only', actorId, { roles: ['admin'] }))
      .rejects.toMatchObject({ code: 'BOP_APPOINTMENT_REQUIRED' })
    expect(state.writes).toBe(0)
  })
})
