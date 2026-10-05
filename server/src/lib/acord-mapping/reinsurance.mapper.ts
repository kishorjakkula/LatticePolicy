/**
 * Reinsurance/large-commercial flow mapper: ACORD GRLC-style treaty/cession
 * payload <-> LatticePolicy's reinsurance model (issue #61,
 * docs/REINSURANCE_MODEL.md, server/src/services/reinsurance.service.ts).
 */
import type { PlacementMatch } from '../../services/reinsurance.service.js'
import type { MappingError, MappingResult } from './errors.js'
import { mappingFail, mappingOk, requireField, requirePercent, requireString } from './errors.js'
import type { CanonicalReinsuranceParticipant, CanonicalReinsurancePlacement } from './types.js'

/** What reinsurance.service.ts's treaty/facultative create inputs need. */
export interface InternalTreatyIntake {
  treatyName: string
  treatyType: 'QUOTA_SHARE' | 'SURPLUS' | 'EXCESS_OF_LOSS' | 'FACULTATIVE_OBLIGATORY'
  effectiveDate: string
  expirationDate: string
  productCodes?: string[]
  stateCodes?: string[]
  layers: Array<{
    layerNumber: number
    cededPercent: number
    retainedPercent: number
    retentionAmount?: number
    limitAmount?: number
    participants: Array<{ reinsurerName: string; participationPercent: number; isLead?: boolean }>
  }>
}

/**
 * Inbound: an ACORD GRLC-style TreatyInfo/ReinsuranceCession payload ->
 * internal treaty creation intake (server/src/services/reinsurance.service.ts
 * / reinsurance-admin.routes.ts POST /treaties body shape).
 */
export function mapGrlcTreatyToInternal(payload: unknown): MappingResult<InternalTreatyIntake> {
  const errors: MappingError[] = []
  if (typeof payload !== 'object' || payload === null) {
    return mappingFail([{ field: '$', code: 'INVALID_TYPE', message: 'payload must be an object', expected: 'object' }])
  }
  const p = payload as Record<string, unknown>

  const treatyName = p['TreatyName'] ?? p['treatyName']
  const treatyType = p['TreatyTypeCd'] ?? p['treatyType']
  const effectiveDate = p['ContractTerm.EffectiveDt'] ?? p['effectiveDate']
  const expirationDate = p['ContractTerm.ExpirationDt'] ?? p['expirationDate']
  const layersRaw = (p['TreatyLayer'] ?? p['layers']) as unknown[] | undefined

  requireString(errors, treatyName, 'TreatyName')
  const validTypes = ['QUOTA_SHARE', 'SURPLUS', 'EXCESS_OF_LOSS', 'FACULTATIVE_OBLIGATORY']
  if (!requireString(errors, treatyType, 'TreatyTypeCd')) {
    // already recorded
  } else if (!validTypes.includes(treatyType as string)) {
    errors.push({
      field: 'TreatyTypeCd',
      code: 'INVALID_VALUE',
      message: `TreatyTypeCd must be one of ${validTypes.join(', ')}`,
      expected: validTypes.join('|'),
      actual: treatyType,
    })
  }
  requireField(errors, effectiveDate, 'ContractTerm.EffectiveDt', 'ISO date string')
  requireField(errors, expirationDate, 'ContractTerm.ExpirationDt', 'ISO date string')
  requireField(errors, layersRaw, 'TreatyLayer', 'array with at least one layer')

  const layers: InternalTreatyIntake['layers'] = []
  if (Array.isArray(layersRaw)) {
    layersRaw.forEach((rawLayer, index) => {
      if (typeof rawLayer !== 'object' || rawLayer === null) {
        errors.push({ field: `TreatyLayer[${index}]`, code: 'INVALID_TYPE', message: 'layer must be an object', expected: 'object' })
        return
      }
      const l = rawLayer as Record<string, unknown>
      const layerNumber = (l['LayerNumber'] ?? l['layerNumber'] ?? index + 1) as number
      const cededPercent = l['CededPct'] ?? l['cededPercent']
      const retainedPercent = l['RetainedPct'] ?? l['retainedPercent']
      const participantsRaw = (l['SecurityInfo'] ?? l['participants']) as unknown[] | undefined

      requirePercent(errors, cededPercent, `TreatyLayer[${index}].CededPct`)
      requirePercent(errors, retainedPercent, `TreatyLayer[${index}].RetainedPct`)
      if (!Array.isArray(participantsRaw) || participantsRaw.length === 0) {
        errors.push({
          field: `TreatyLayer[${index}].SecurityInfo`,
          code: 'REQUIRED',
          message: `TreatyLayer[${index}].SecurityInfo must have at least one participant`,
          expected: 'array with at least one participant',
          actual: participantsRaw,
        })
      }

      const participants: InternalTreatyIntake['layers'][number]['participants'] = []
      if (Array.isArray(participantsRaw)) {
        participantsRaw.forEach((rawParticipant, pIndex) => {
          if (typeof rawParticipant !== 'object' || rawParticipant === null) {
            errors.push({
              field: `TreatyLayer[${index}].SecurityInfo[${pIndex}]`,
              code: 'INVALID_TYPE',
              message: 'participant must be an object',
              expected: 'object',
            })
            return
          }
          const participant = rawParticipant as Record<string, unknown>
          const reinsurerName = participant['ReinsurerName'] ?? participant['reinsurerName']
          const participationPercent = participant['ParticipationPct'] ?? participant['participationPercent']
          requireString(errors, reinsurerName, `TreatyLayer[${index}].SecurityInfo[${pIndex}].ReinsurerName`)
          requirePercent(errors, participationPercent, `TreatyLayer[${index}].SecurityInfo[${pIndex}].ParticipationPct`)
          if (typeof reinsurerName === 'string' && typeof participationPercent === 'number') {
            participants.push({
              reinsurerName,
              participationPercent,
              isLead: Boolean(participant['IsLead'] ?? participant['isLead']),
            })
          }
        })
      }

      if (typeof cededPercent === 'number' && typeof retainedPercent === 'number') {
        layers.push({
          layerNumber: Number(layerNumber),
          cededPercent,
          retainedPercent,
          retentionAmount: l['RetentionAmt'] ? Number(l['RetentionAmt']) : undefined,
          limitAmount: l['LimitAmt'] ? Number(l['LimitAmt']) : undefined,
          participants,
        })
      }
    })
  }

  if (errors.length > 0) return mappingFail(errors)

  return mappingOk({
    treatyName: treatyName as string,
    treatyType: treatyType as InternalTreatyIntake['treatyType'],
    effectiveDate: effectiveDate as string,
    expirationDate: expirationDate as string,
    productCodes: (p['LOBCd'] as string[] | undefined) ?? undefined,
    stateCodes: (p['StateProvCd'] as string[] | undefined) ?? undefined,
    layers,
  })
}

/**
 * Outbound: a resolved placement match (from
 * reinsurance.service.ts#lookupPlacementMatches /
 * #computePlacementForTransaction) -> ACORD GRLC-style canonical cession
 * payload, suitable for bordereaux or downstream reinsurance system export.
 */
export function mapPlacementMatchToGrlcCanonical(
  match: PlacementMatch,
  extras?: { retainedPremium?: number; cededPremium?: number }
): CanonicalReinsurancePlacement {
  // reinsurance.service.ts's PlacementMatch participants only carry
  // participantId/reinsurerName/participationPercent today — broker name and
  // lead-market flag exist on the underlying market_participants row but are
  // not (yet) surfaced through lookupPlacementMatches, so they're omitted
  // here rather than guessed.
  const marketParticipants: CanonicalReinsuranceParticipant[] = match.participants.map((participant) => ({
    reinsurerName: participant.reinsurerName,
    reinsurerReference: participant.participantId,
    participationPercent: participant.participationPercent,
  }))

  if (match.placementType === 'TREATY') {
    return {
      placementType: 'TREATY',
      treatyName: match.treatyName,
      layerNumber: match.layerNumber,
      retainedPercent: match.retainedPercent,
      cededPercent: match.cededPercent,
      retainedPremium: extras?.retainedPremium,
      cededPremium: extras?.cededPremium,
      marketParticipants,
    }
  }

  return {
    placementType: 'FACULTATIVE',
    certificateNumber: match.certificateNumber ?? undefined,
    retainedPercent: match.retainedPercent,
    cededPercent: match.cededPercent,
    retainedPremium: extras?.retainedPremium,
    cededPremium: extras?.cededPremium,
    marketParticipants,
  }
}
