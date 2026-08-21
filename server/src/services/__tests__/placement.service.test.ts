import { describe, expect, it } from 'vitest'
import {
  addMarketParticipant,
  transitionPlacementStatus,
} from '../placement.service.js'
import type { DrizzleDB } from '../../db.js'

const PLACEMENT_ID = '11111111-1111-1111-1111-111111111111'
const TENANT_ID = 'sample-carrier'

function fakeDb(handlers: {
  onSelectPlacement?: () => any
  onSelectExistingTotal?: () => any
  onInsertParticipant?: (params: any[]) => any
  onUpdateStatus?: (params: any[]) => any
}): DrizzleDB {
  const query = async (text: string, params?: any[]) => {
    if (text.includes('SELECT placement_id FROM commercial_placements')) {
      return handlers.onSelectPlacement?.() ?? { rows: [{ placement_id: PLACEMENT_ID }], rowCount: 1 }
    }
    if (text.includes('coalesce(sum(subscription_percent')) {
      return handlers.onSelectExistingTotal?.() ?? { rows: [{ total: 0 }], rowCount: 1 }
    }
    if (text.startsWith('INSERT INTO placement_market_participants')) {
      return handlers.onInsertParticipant?.(params!) ?? {
        rows: [
          {
            participant_id: 'p-1',
            placement_id: PLACEMENT_ID,
            market_name: params![3],
            role: params![4],
            subscription_percent: params![5],
            security_status: params![6],
            broker_intermediary: params![7],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        rowCount: 1,
      }
    }
    if (text.includes('SELECT * FROM commercial_placements WHERE tenant_id')) {
      return { rows: [{ placement_id: PLACEMENT_ID, tenant_id: TENANT_ID, status: 'Submission', status_history: [] }], rowCount: 1 }
    }
    if (text.startsWith('UPDATE commercial_placements')) {
      return handlers.onUpdateStatus?.(params!) ?? {
        rows: [{ placement_id: PLACEMENT_ID, tenant_id: TENANT_ID, status: params![0], status_history: JSON.parse(params![1]) }],
        rowCount: 1,
      }
    }
    return { rows: [], rowCount: 0 }
  }
  return { __pgClient: { query } } as any
}

describe('placement.service subscription share validation', () => {
  it('rejects a share that is not between 0 (exclusive) and 100', async () => {
    const db = fakeDb({})
    await expect(
      addMarketParticipant(db, TENANT_ID, PLACEMENT_ID, { marketName: 'Market A', subscriptionPercent: 0 })
    ).rejects.toMatchObject({ code: 'INVALID_SUBSCRIPTION_PERCENT' })
    await expect(
      addMarketParticipant(db, TENANT_ID, PLACEMENT_ID, { marketName: 'Market A', subscriptionPercent: 101 })
    ).rejects.toMatchObject({ code: 'INVALID_SUBSCRIPTION_PERCENT' })
  })

  it('rejects a share that would push total subscription over 100%', async () => {
    const db = fakeDb({ onSelectExistingTotal: () => ({ rows: [{ total: 70 }], rowCount: 1 }) })
    await expect(
      addMarketParticipant(db, TENANT_ID, PLACEMENT_ID, { marketName: 'Market B', subscriptionPercent: 40 })
    ).rejects.toMatchObject({ code: 'PLACEMENT_OVERSUBSCRIBED' })
  })

  it('accepts a share that keeps total subscription at or under 100%', async () => {
    const db = fakeDb({ onSelectExistingTotal: () => ({ rows: [{ total: 60 }], rowCount: 1 }) })
    const participant = await addMarketParticipant(db, TENANT_ID, PLACEMENT_ID, {
      marketName: 'Market C',
      subscriptionPercent: 40,
      role: 'Lead',
    })
    expect(participant.marketName).toBe('Market C')
    expect(participant.subscriptionPercent).toBe(40)
  })

  it('rejects a blank market name', async () => {
    const db = fakeDb({})
    await expect(
      addMarketParticipant(db, TENANT_ID, PLACEMENT_ID, { marketName: '   ', subscriptionPercent: 10 })
    ).rejects.toMatchObject({ code: 'MARKET_NAME_REQUIRED' })
  })

  it('rejects participants on a placement that does not exist', async () => {
    const db = fakeDb({ onSelectPlacement: () => ({ rows: [], rowCount: 0 }) })
    await expect(
      addMarketParticipant(db, TENANT_ID, 'missing', { marketName: 'Market D', subscriptionPercent: 10 })
    ).rejects.toMatchObject({ code: 'PLACEMENT_NOT_FOUND' })
  })
})

describe('placement.service status transitions', () => {
  it('allows the standard Submission -> Indication -> Quoted -> BindOrder -> Bound -> Issued progression', async () => {
    const sequence: Array<[string, string]> = [
      ['Submission', 'Indication'],
      ['Indication', 'Quoted'],
      ['Quoted', 'BindOrder'],
      ['BindOrder', 'Bound'],
      ['Bound', 'Issued'],
    ]
    for (const [from, to] of sequence) {
      const db = fakeDb({
        onUpdateStatus: (params) => ({
          rows: [{ placement_id: PLACEMENT_ID, tenant_id: TENANT_ID, status: params[0], status_history: JSON.parse(params[1]) }],
          rowCount: 1,
        }),
      })
      // Override the placement lookup to report the "from" status for this iteration.
      const dbWithFrom = {
        __pgClient: {
          query: async (text: string, params?: any[]) => {
            if (text.includes('SELECT * FROM commercial_placements WHERE tenant_id')) {
              return { rows: [{ placement_id: PLACEMENT_ID, tenant_id: TENANT_ID, status: from, status_history: [] }], rowCount: 1 }
            }
            return (db as any).__pgClient.query(text, params)
          },
        },
      } as any
      const result = await transitionPlacementStatus(dbWithFrom, TENANT_ID, PLACEMENT_ID, { toStatus: to as any })
      expect(result!.status).toBe(to)
    }
  })

  it('rejects skipping ahead in the workflow (Submission -> Bound)', async () => {
    const db = fakeDb({})
    await expect(
      transitionPlacementStatus(db, TENANT_ID, PLACEMENT_ID, { toStatus: 'Bound' })
    ).rejects.toMatchObject({ code: 'INVALID_PLACEMENT_TRANSITION' })
  })

  it('rejects any transition out of a terminal status', async () => {
    const dbIssued = {
      __pgClient: {
        query: async (text: string) => {
          if (text.includes('SELECT * FROM commercial_placements WHERE tenant_id')) {
            return { rows: [{ placement_id: PLACEMENT_ID, tenant_id: TENANT_ID, status: 'Issued', status_history: [] }], rowCount: 1 }
          }
          return { rows: [], rowCount: 0 }
        },
      },
    } as any
    await expect(
      transitionPlacementStatus(dbIssued, TENANT_ID, PLACEMENT_ID, { toStatus: 'Withdrawn' })
    ).rejects.toMatchObject({ code: 'INVALID_PLACEMENT_TRANSITION' })
  })

  it('rejects transitioning a placement that does not exist', async () => {
    const db = {
      __pgClient: { query: async () => ({ rows: [], rowCount: 0 }) },
    } as any
    await expect(
      transitionPlacementStatus(db, TENANT_ID, 'missing', { toStatus: 'Indication' })
    ).rejects.toMatchObject({ code: 'PLACEMENT_NOT_FOUND' })
  })
})
