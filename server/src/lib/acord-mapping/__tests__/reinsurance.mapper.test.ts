import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { mapGrlcTreatyToInternal, mapPlacementMatchToGrlcCanonical } from '../reinsurance.mapper.js'
import type { PlacementLayerMatch, PlacementFacultativeMatch } from '../../../services/reinsurance.service.js'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesDir, name), 'utf8'))
}

describe('mapGrlcTreatyToInternal', () => {
  it('maps a valid GRLC treaty submission to internal treaty intake', () => {
    const payload = loadFixture('grlc-treaty-submission.inbound.json')
    const result = mapGrlcTreatyToInternal(payload)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.treatyName).toBe('2026 Property Quota Share')
    expect(result.data.treatyType).toBe('QUOTA_SHARE')
    expect(result.data.layers).toHaveLength(1)
    expect(result.data.layers[0].cededPercent).toBe(40)
    expect(result.data.layers[0].participants).toHaveLength(2)
    expect(result.data.layers[0].participants[0]).toMatchObject({ reinsurerName: 'Meridian Re', isLead: true })
  })

  it('returns structured errors for an invalid treaty type, out-of-range percent, and empty participants', () => {
    const payload = loadFixture('grlc-treaty-submission.invalid.json')
    const result = mapGrlcTreatyToInternal(payload)

    expect(result.ok).toBe(false)
    if (result.ok) return
    const fields = result.errors.map((e) => e.field)
    expect(fields).toContain('TreatyTypeCd')
    expect(fields).toContain('TreatyLayer[0].CededPct')
    expect(fields).toContain('TreatyLayer[0].SecurityInfo')
    const cededError = result.errors.find((e) => e.field === 'TreatyLayer[0].CededPct')
    expect(cededError?.code).toBe('OUT_OF_RANGE')
  })

  it('rejects a non-object payload', () => {
    const result = mapGrlcTreatyToInternal(null)
    expect(result.ok).toBe(false)
  })
})

describe('mapPlacementMatchToGrlcCanonical', () => {
  it('maps a treaty layer match to a canonical GRLC cession payload', () => {
    const match: PlacementLayerMatch = {
      placementType: 'TREATY',
      treatyId: 't1',
      treatyName: '2026 Property Quota Share',
      layerId: 'l1',
      layerNumber: 1,
      cededPercent: 40,
      retainedPercent: 60,
      participants: [{ participantId: 'p1', reinsurerName: 'Meridian Re', participationPercent: 25 }],
    }
    const canonical = mapPlacementMatchToGrlcCanonical(match, { retainedPremium: 6000, cededPremium: 4000 })

    expect(canonical.placementType).toBe('TREATY')
    expect(canonical.treatyName).toBe('2026 Property Quota Share')
    expect(canonical.layerNumber).toBe(1)
    expect(canonical.cededPremium).toBe(4000)
    expect(canonical.marketParticipants[0].reinsurerName).toBe('Meridian Re')
  })

  it('maps a facultative match to a canonical GRLC cession payload', () => {
    const match: PlacementFacultativeMatch = {
      placementType: 'FACULTATIVE',
      certificateId: 'c1',
      certificateNumber: 'FAC-2026-001',
      cededPercent: 50,
      retainedPercent: 50,
      participants: [],
    }
    const canonical = mapPlacementMatchToGrlcCanonical(match)

    expect(canonical.placementType).toBe('FACULTATIVE')
    expect(canonical.certificateNumber).toBe('FAC-2026-001')
    expect(canonical.marketParticipants).toHaveLength(0)
  })
})
