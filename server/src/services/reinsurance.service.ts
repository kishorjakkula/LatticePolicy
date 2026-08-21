import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { BadRequestError, NotFoundError } from '../errors/domain.errors.js'

// ---------------------------------------------------------------------------
// Layer / participant share validation (pure — no DB access).
// ---------------------------------------------------------------------------

export interface ParticipantShareInput {
  participationPercent: number
}

export interface ParticipantShareValidation {
  valid: boolean
  totalPercent: number
  error?: string
}

/**
 * Validates that market participant shares for a single layer or facultative
 * certificate are individually positive and do not sum to more than 100%.
 * Under-placement (total < 100%) is allowed — a syndicate may not be fully
 * subscribed yet — but over-placement is rejected outright.
 */
export function validateParticipantShares(participants: ParticipantShareInput[]): ParticipantShareValidation {
  if (participants.length === 0) {
    return { valid: true, totalPercent: 0 }
  }
  for (const p of participants) {
    if (!(p.participationPercent > 0) || p.participationPercent > 100) {
      return { valid: false, totalPercent: 0, error: 'Each participation percent must be greater than 0 and at most 100' }
    }
  }
  const totalPercent = Math.round(participants.reduce((sum, p) => sum + p.participationPercent, 0) * 1000) / 1000
  if (totalPercent > 100.001) {
    return { valid: false, totalPercent, error: `Participation percentages sum to ${totalPercent}%, which exceeds 100%` }
  }
  return { valid: true, totalPercent }
}

// ---------------------------------------------------------------------------
// Treaty applicability matching (pure — no DB access).
// ---------------------------------------------------------------------------

export interface TreatyApplicabilityInput {
  status: string
  effectiveDate: string
  expirationDate: string
  productCodes: string[] | null
  stateCodes: string[] | null
}

export interface PlacementLookupQuery {
  tenantId: string
  productCode: string
  stateCode: string | null
  asOfDate: string
}

/**
 * True when a treaty (by its applicability fields) covers the given product,
 * state, and as-of date. Null/empty product_codes or state_codes means the
 * treaty applies to all products/states.
 */
export function treatyApplies(treaty: TreatyApplicabilityInput, query: Pick<PlacementLookupQuery, 'productCode' | 'stateCode' | 'asOfDate'>): boolean {
  if (treaty.status !== 'Active') return false
  if (query.asOfDate < treaty.effectiveDate || query.asOfDate >= treaty.expirationDate) return false
  const products = treaty.productCodes
  if (products && products.length > 0 && !products.includes(query.productCode)) return false
  const states = treaty.stateCodes
  if (states && states.length > 0 && query.stateCode && !states.includes(query.stateCode)) return false
  return true
}

// ---------------------------------------------------------------------------
// Placement lookup / compute (DB-backed).
// ---------------------------------------------------------------------------

export interface PlacementLayerMatch {
  placementType: 'TREATY'
  treatyId: string
  treatyName: string
  layerId: string
  layerNumber: number
  cededPercent: number
  retainedPercent: number
  participants: Array<{ participantId: string; reinsurerName: string; participationPercent: number }>
}

export interface PlacementFacultativeMatch {
  placementType: 'FACULTATIVE'
  certificateId: string
  certificateNumber: string | null
  cededPercent: number
  retainedPercent: number
  participants: Array<{ participantId: string; reinsurerName: string; participationPercent: number }>
}

export type PlacementMatch = PlacementLayerMatch | PlacementFacultativeMatch

/**
 * Resolves applicable reinsurance placement(s) for a policy transaction as of
 * a given date. A facultative certificate covering the policy takes
 * precedence over treaty matches (facultative placements are risk-specific
 * overrides of the standard treaty program). When no facultative certificate
 * applies, every matching Active treaty layer is returned — this function
 * does not attempt to model excess-of-loss attachment stacking order; each
 * matched layer is reported independently for the caller/downstream
 * bordereaux process to interpret.
 *
 * This is the stable lookup interface future reinsurance-adjacent work
 * (ACORD/GRLC mapping, bordereaux generation, exposure aggregation, large
 * commercial placement) is expected to call rather than re-deriving treaty
 * matching logic. See docs/REINSURANCE_MODEL.md.
 */
export async function lookupPlacementMatches(
  db: DrizzleDB,
  query: PlacementLookupQuery,
  policyId: string
): Promise<PlacementMatch[]> {
  const q = toRawQuery(db)

  const facResult = await q(
    `SELECT certificate_id, certificate_number, ceded_percent, retained_percent
       FROM reinsurance_facultative_certificates
      WHERE tenant_id = $1 AND policy_id = $2 AND status = 'Active'
        AND $3 >= effective_date AND $3 < expiration_date
      ORDER BY created_at DESC`,
    [query.tenantId, policyId, query.asOfDate]
  )

  if (facResult.rows.length > 0) {
    const matches: PlacementFacultativeMatch[] = []
    for (const cert of facResult.rows) {
      const participants = await loadParticipants(q, query.tenantId, null, cert.certificate_id)
      matches.push({
        placementType: 'FACULTATIVE',
        certificateId: cert.certificate_id,
        certificateNumber: cert.certificate_number,
        cededPercent: Number(cert.ceded_percent),
        retainedPercent: Number(cert.retained_percent),
        participants
      })
    }
    return matches
  }

  const treatyResult = await q(
    `SELECT treaty_id, treaty_name, status, effective_date, expiration_date, product_codes, state_codes
       FROM reinsurance_treaties
      WHERE tenant_id = $1 AND status = 'Active'
        AND $2 >= effective_date AND $2 < expiration_date`,
    [query.tenantId, query.asOfDate]
  )

  const applicableTreaties = treatyResult.rows.filter((t: any) =>
    treatyApplies(
      {
        status: t.status,
        effectiveDate: toIsoDate(t.effective_date),
        expirationDate: toIsoDate(t.expiration_date),
        productCodes: t.product_codes,
        stateCodes: t.state_codes
      },
      { productCode: query.productCode, stateCode: query.stateCode, asOfDate: query.asOfDate }
    )
  )
  if (applicableTreaties.length === 0) return []

  const matches: PlacementLayerMatch[] = []
  for (const treaty of applicableTreaties) {
    const layerResult = await q(
      `SELECT layer_id, layer_number, ceded_percent, retained_percent
         FROM reinsurance_treaty_layers
        WHERE tenant_id = $1 AND treaty_id = $2
        ORDER BY layer_number ASC`,
      [query.tenantId, treaty.treaty_id]
    )
    for (const layer of layerResult.rows) {
      const participants = await loadParticipants(q, query.tenantId, layer.layer_id, null)
      matches.push({
        placementType: 'TREATY',
        treatyId: treaty.treaty_id,
        treatyName: treaty.treaty_name,
        layerId: layer.layer_id,
        layerNumber: layer.layer_number,
        cededPercent: Number(layer.ceded_percent),
        retainedPercent: Number(layer.retained_percent),
        participants
      })
    }
  }
  return matches
}

async function loadParticipants(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  layerId: string | null,
  facultativeCertificateId: string | null
) {
  const column = layerId ? 'layer_id' : 'facultative_certificate_id'
  const id = layerId ?? facultativeCertificateId
  const r = await q(
    `SELECT participant_id, reinsurer_name, participation_percent
       FROM reinsurance_market_participants
      WHERE tenant_id = $1 AND ${column} = $2
      ORDER BY is_lead DESC, participation_percent DESC`,
    [tenantId, id]
  )
  return r.rows.map((row: any) => ({
    participantId: row.participant_id,
    reinsurerName: row.reinsurer_name,
    participationPercent: Number(row.participation_percent)
  }))
}

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

/**
 * Computes and persists placement rows for a specific policy transaction,
 * using the policy's product/state and the transaction's effective date.
 * Idempotent per (tenant, transaction): re-computing replaces prior rows for
 * that transaction rather than accumulating duplicates.
 *
 * This is called on demand (via the compute API), not automatically hooked
 * into bind/issue/endorsement/etc. lifecycle services — see
 * docs/REINSURANCE_MODEL.md for why that wiring is deliberately deferred.
 */
export async function computePlacementForTransaction(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  transactionId: string
): Promise<PlacementMatch[]> {
  const q = toRawQuery(db)

  const policyResult = await q(
    `SELECT policy_id, product_code, jurisdiction_code FROM policies WHERE tenant_id = $1 AND policy_id = $2`,
    [tenantId, policyId]
  )
  const policy = policyResult.rows[0]
  if (!policy) throw new NotFoundError('REINSURANCE_NOT_FOUND', 'Policy not found')

  const txnResult = await q(
    `SELECT transaction_id, effective_date, created_at FROM policy_transactions
      WHERE tenant_id = $1 AND transaction_id = $2 AND policy_id = $3`,
    [tenantId, transactionId, policyId]
  )
  const txn = txnResult.rows[0]
  if (!txn) throw new NotFoundError('REINSURANCE_NOT_FOUND', 'Policy transaction not found')

  const asOfDate = toIsoDate(txn.effective_date || txn.created_at)

  const matches = await lookupPlacementMatches(
    db,
    { tenantId, productCode: policy.product_code, stateCode: policy.jurisdiction_code, asOfDate },
    policyId
  )

  const versionResult = await q(
    `SELECT premium_total FROM policy_versions
      WHERE tenant_id = $1 AND transaction_id = $2
      ORDER BY processed_at DESC LIMIT 1`,
    [tenantId, transactionId]
  )
  const premiumTotal = versionResult.rows[0]?.premium_total != null ? Number(versionResult.rows[0].premium_total) : null

  await q(`DELETE FROM policy_reinsurance_placements WHERE tenant_id = $1 AND transaction_id = $2`, [tenantId, transactionId])

  for (const match of matches) {
    const cededPremium = premiumTotal != null ? Math.round(premiumTotal * (match.cededPercent / 100) * 100) / 100 : null
    const retainedPremium = premiumTotal != null && cededPremium != null ? Math.round((premiumTotal - cededPremium) * 100) / 100 : null
    await q(
      `INSERT INTO policy_reinsurance_placements
         (placement_id, tenant_id, policy_id, transaction_id, placement_type, treaty_id, layer_id,
          facultative_certificate_id, retained_percent, ceded_percent, retained_premium, ceded_premium, basis)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
      [
        uuidv4(),
        tenantId,
        policyId,
        transactionId,
        match.placementType,
        match.placementType === 'TREATY' ? match.treatyId : null,
        match.placementType === 'TREATY' ? match.layerId : null,
        match.placementType === 'FACULTATIVE' ? match.certificateId : null,
        match.retainedPercent,
        match.cededPercent,
        retainedPremium,
        cededPremium,
        JSON.stringify(match)
      ]
    )
  }

  return matches
}

export function assertValidTreatyType(value: string) {
  const allowed = ['QUOTA_SHARE', 'SURPLUS', 'EXCESS_OF_LOSS', 'FACULTATIVE_OBLIGATORY']
  if (!allowed.includes(value)) {
    throw new BadRequestError('REINSURANCE_INVALID_TREATY_TYPE', `treatyType must be one of ${allowed.join(', ')}`)
  }
}
