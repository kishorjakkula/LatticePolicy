import { describe, expect, it } from 'vitest'
import {
  computeRetroResult,
  deriveTimelineSegments,
  findRebasedTransactions,
  findTimelineStateAtDate,
  sortTimelineVersions,
  type TimelineVersionInput,
} from '../policy-timeline.js'

function autoPayload(limit = 50000) {
  return {
    productCode: 'personal-auto',
    state: 'CA',
    termMonths: 12,
    risks: [{ garagingZip: '94105', symbol: 'A', usage: 'commute' }],
    uwAnswers: { driverAge: 40 },
    coverages: [
      { code: 'BI', selected: true, limit },
      { code: 'PD', selected: true, limit: 25000 },
    ],
  }
}

const baseVersion: TimelineVersionInput = {
  versionId: 'v1',
  transactionId: 't1',
  transactionType: 'Issue',
  transactionNumber: 'NB-1',
  effectiveDate: '2026-01-01',
  processedAt: '2026-01-01T10:00:00.000Z',
  payload: autoPayload(50000),
}

describe('policy-timeline', () => {
  it('sorts versions by effective date, processed time, then version id', () => {
    const versions: TimelineVersionInput[] = [
      { ...baseVersion, versionId: 'v3', effectiveDate: '2026-03-01', processedAt: '2026-03-01T10:00:00.000Z' },
      { ...baseVersion, versionId: 'v2', effectiveDate: '2026-01-01', processedAt: '2026-01-01T12:00:00.000Z' },
      { ...baseVersion, versionId: 'v1', effectiveDate: '2026-01-01', processedAt: '2026-01-01T10:00:00.000Z' },
    ]

    expect(sortTimelineVersions(versions).map((item) => item.versionId)).toEqual(['v1', 'v2', 'v3'])
  })

  it('derives dated segments and applies endorsement change sets', () => {
    const segments = deriveTimelineSegments({
      tenantId: 'sample-carrier',
      termEffectiveDate: '2026-01-01',
      termExpirationDate: '2027-01-01',
      versions: [
        baseVersion,
        {
          versionId: 'v2',
          transactionId: 't2',
          transactionType: 'Endorse',
          transactionNumber: 'EN-1',
          effectiveDate: '2026-04-01',
          processedAt: '2026-04-02T10:00:00.000Z',
          payload: autoPayload(50000),
          changes: [{ path: '/coverages/0/limit', newValue: 100000 }],
        },
      ],
    })

    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      sourceVersionId: 'v1',
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      endExclusiveDate: '2026-04-01',
    })
    expect(segments[1]).toMatchObject({
      sourceVersionId: 'v2',
      startDate: '2026-04-01',
      endDate: '2026-12-31',
      endExclusiveDate: '2027-01-01',
    })
    expect(segments[1].payload.coverages[0].limit).toBe(100000)
    expect(segments[1].premiumTotal).toBeGreaterThan(segments[0].premiumTotal)
  })

  it('finds the effective timeline state for in-range, pre-range, and post-range dates', () => {
    const segments = deriveTimelineSegments({
      tenantId: 'sample-carrier',
      termEffectiveDate: '2026-01-01',
      termExpirationDate: '2027-01-01',
      versions: [
        baseVersion,
        {
          ...baseVersion,
          versionId: 'v2',
          transactionType: 'Endorse',
          effectiveDate: '2026-06-01',
          processedAt: '2026-06-02T10:00:00.000Z',
          changes: [{ path: '/coverages/0/limit', newValue: 150000 }],
        },
      ],
    })

    expect(findTimelineStateAtDate(segments, '2025-12-15')?.sourceVersionId).toBe('v1')
    expect(findTimelineStateAtDate(segments, '2026-06-15')?.sourceVersionId).toBe('v2')
    expect(findTimelineStateAtDate(segments, '2027-02-01')?.sourceVersionId).toBe('v2')
  })

  it('computes prorated retro deltas between old and new segment sets', () => {
    const oldSegments = deriveTimelineSegments({
      tenantId: 'sample-carrier',
      termEffectiveDate: '2026-01-01',
      termExpirationDate: '2027-01-01',
      versions: [baseVersion],
    })
    const newSegments = deriveTimelineSegments({
      tenantId: 'sample-carrier',
      termEffectiveDate: '2026-01-01',
      termExpirationDate: '2027-01-01',
      versions: [
        baseVersion,
        {
          ...baseVersion,
          versionId: 'v-oos',
          transactionType: 'Endorse',
          effectiveDate: '2026-03-01',
          processedAt: '2026-08-01T10:00:00.000Z',
          changes: [{ path: '/coverages/0/limit', newValue: 250000 }],
        },
      ],
    })

    const retro = computeRetroResult({
      oldSegments,
      newSegments,
      fromDate: '2026-03-01',
      termEffectiveDate: '2026-01-01',
      termExpirationDate: '2027-01-01',
    })

    expect(retro.totalDelta).toBeGreaterThan(0)
    expect(retro.impactedSegments.length).toBeGreaterThan(0)
    expect(retro.impactedSegments[0].startDate).toBe('2026-03-01')
  })

  it('finds later effective-dated transactions that must be rebased', () => {
    const rebased = findRebasedTransactions([
      baseVersion,
      { ...baseVersion, versionId: 'v2', transactionId: 't2', transactionType: 'Endorse', transactionNumber: 'EN-1', effectiveDate: '2026-04-01' },
      { ...baseVersion, versionId: 'v3', transactionId: 't3', transactionType: 'Cancel', transactionNumber: 'CN-1', effectiveDate: '2026-10-01' },
    ], '2026-03-01')

    expect(rebased).toEqual([
      { versionId: 'v2', transactionId: 't2', transactionType: 'ENDORSE', transactionNumber: 'EN-1', effectiveDate: '2026-04-01' },
      { versionId: 'v3', transactionId: 't3', transactionType: 'CANCEL', transactionNumber: 'CN-1', effectiveDate: '2026-10-01' },
    ])
  })
})
