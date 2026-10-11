import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureProductSnapshot, clearProductSnapshotCache, ensureProductSnapshots, snapshotRef } from '../product-snapshot.js'
import { rate } from '../../services/rating.service.js'
import { productRuleViolations } from '../../services/product-rules.service.js'
import { getDb, toRawQuery, withTenantTx } from '../../db.js'

vi.mock('../../db.js', () => ({ getDb: vi.fn(() => null), toRawQuery: vi.fn(), withTenantTx: vi.fn() }))

const payload = () => ({ productCode: 'personal-auto', state: 'CA', termMonths: 12, risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute' }], uwAnswers: { driverAge: 34 }, coverages: [{ code: 'BI', selected: true, limit: 100000 }] })

beforeEach(() => {
  clearProductSnapshotCache()
  vi.clearAllMocks()
  vi.mocked(getDb).mockReturnValue(null)
})

describe('product snapshot isolation', () => {
  it('rejects another tenant’s cached snapshot in rating and rule checks', async () => {
    const snapshot = await captureProductSnapshot('sample-carrier', 'personal-auto', 'CA')
    const quote = { ...payload(), productSnapshot: snapshotRef(snapshot!) }
    expect(() => rate('another-carrier', quote)).toThrow()
    expect(() => productRuleViolations('another-carrier', quote)).toThrow()
    await expect(ensureProductSnapshots('another-carrier', [quote])).rejects.toThrow()
  })

  it('rejects a cached snapshot for a different product', async () => {
    const snapshot = await captureProductSnapshot('sample-carrier', 'personal-auto', 'CA')
    const quote = { ...payload(), productCode: 'homeowners', productSnapshot: snapshotRef(snapshot!) }
    expect(() => rate('sample-carrier', quote)).toThrow()
    expect(() => productRuleViolations('sample-carrier', quote)).toThrow()
    await expect(ensureProductSnapshots('sample-carrier', [quote])).rejects.toThrow()
  })

  it('keeps identical in-memory definitions available for each tenant', async () => {
    const first = await captureProductSnapshot('carrier-one', 'personal-auto', 'CA')
    const second = await captureProductSnapshot('carrier-two', 'personal-auto', 'CA')
    const again = await captureProductSnapshot('carrier-one', 'personal-auto', 'CA')
    expect(again!.tenantId).toBe('carrier-one')
    expect(first!.id).not.toBe(second!.id)
    for (const snapshot of [first!, second!]) {
      const quote = { ...payload(), productSnapshot: snapshotRef(snapshot) }
      await ensureProductSnapshots(snapshot.tenantId, [quote])
      expect(rate(snapshot.tenantId, quote).total.amount).toBeGreaterThan(0)
      expect(productRuleViolations(snapshot.tenantId, quote)).toEqual([])
    }
  })

  it('rejects a foreign database snapshot after the owning tenant warms the cache', async () => {
    const id = '11111111-1111-4111-a111-111111111111'
    const snapshot = await captureProductSnapshot('sample-carrier', 'personal-auto', 'CA')
    clearProductSnapshotCache()
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(withTenantTx).mockImplementation(async (_tenantId, fn) => fn({} as any))
    const query = vi.fn(async (_sql: string, params?: any[]) => ({ rows: params?.[0] === 'sample-carrier' ? [{ snapshot_id: id, product_code: 'personal-auto', content_hash: snapshot!.hash, source: snapshot!.source, definition: snapshot!.definition }] : [], rowCount: 0 }))
    vi.mocked(toRawQuery).mockReturnValue(query)
    const quote = { ...payload(), productSnapshot: { id } }
    await ensureProductSnapshots('sample-carrier', [quote])
    expect(rate('sample-carrier', quote).total.amount).toBeGreaterThan(0)
    await expect(ensureProductSnapshots('another-carrier', [quote])).rejects.toThrow()
    expect(query.mock.calls.some(([, params]) => params?.[0] === 'another-carrier')).toBe(true)
    expect(() => rate('another-carrier', quote)).toThrow()
  })

  it('rejects missing or invalid pins instead of falling back to current rules', async () => {
    const quote = { ...payload(), productSnapshot: { id: 'missing' } }
    await expect(ensureProductSnapshots('sample-carrier', [quote])).rejects.toThrow()
    expect(() => productRuleViolations('sample-carrier', quote)).toThrow()
    expect(() => rate('sample-carrier', quote)).toThrow()
    await expect(ensureProductSnapshots('sample-carrier', [payload()])).resolves.toBeUndefined()
  })
})
