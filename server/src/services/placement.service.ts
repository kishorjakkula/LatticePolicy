import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { BadRequestError, NotFoundError } from '../errors/domain.errors.js'

export type PlacementStatus =
  | 'Submission'
  | 'Indication'
  | 'Quoted'
  | 'BindOrder'
  | 'Bound'
  | 'Issued'
  | 'Declined'
  | 'Withdrawn'

export type ParticipantRole = 'Lead' | 'Following'
export type SecurityStatus = 'Provisional' | 'Confirmed' | 'Withdrawn'
export type SubjectivityStatus = 'Open' | 'Satisfied' | 'Waived'

// Large commercial / reinsurance-style placements use a subscription market
// workflow rather than the simple single-carrier quote/bind flow. This is
// additive: it does not replace or gate the standard quote/bind path.
const ALLOWED_TRANSITIONS: Record<PlacementStatus, PlacementStatus[]> = {
  Submission: ['Indication', 'Declined', 'Withdrawn'],
  Indication: ['Quoted', 'Declined', 'Withdrawn'],
  Quoted: ['BindOrder', 'Declined', 'Withdrawn'],
  BindOrder: ['Bound', 'Declined', 'Withdrawn'],
  Bound: ['Issued'],
  Issued: [],
  Declined: [],
  Withdrawn: [],
}

function mapPlacement(row: any) {
  if (!row) return null
  return {
    placementId: row.placement_id,
    tenantId: row.tenant_id,
    quoteId: row.quote_id,
    policyId: row.policy_id,
    productCode: row.product_code,
    insuredName: row.insured_name,
    effectiveDate: row.effective_date,
    facilityReference: row.facility_reference,
    status: row.status,
    terms: row.terms || [],
    documents: row.documents || [],
    statusHistory: row.status_history || [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapParticipant(row: any) {
  if (!row) return null
  return {
    participantId: row.participant_id,
    placementId: row.placement_id,
    marketName: row.market_name,
    role: row.role,
    subscriptionPercent: Number(row.subscription_percent),
    securityStatus: row.security_status,
    brokerIntermediary: row.broker_intermediary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapSubjectivity(row: any) {
  if (!row) return null
  return {
    subjectivityId: row.subjectivity_id,
    placementId: row.placement_id,
    description: row.description,
    status: row.status,
    dueDate: row.due_date,
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export interface CreatePlacementInput {
  quoteId?: string | null
  productCode?: string | null
  insuredName: string
  effectiveDate?: string | null
  facilityReference?: string | null
  terms?: string[]
  createdBy?: string | null
}

export async function createPlacement(db: DrizzleDB, tenantId: string, input: CreatePlacementInput) {
  const insuredName = (input.insuredName || '').trim()
  if (!insuredName) throw new BadRequestError('INSURED_NAME_REQUIRED', 'insuredName is required')
  const q = toRawQuery(db)
  const placementId = uuidv4()
  const r = await q(
    `INSERT INTO commercial_placements
       (placement_id, tenant_id, quote_id, product_code, insured_name, effective_date,
        facility_reference, status, terms, status_history, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Submission',$8,$9,$10)
     RETURNING *`,
    [
      placementId,
      tenantId,
      input.quoteId || null,
      input.productCode || null,
      insuredName,
      input.effectiveDate || null,
      input.facilityReference || null,
      JSON.stringify(input.terms || []),
      JSON.stringify([{ from: null, to: 'Submission', at: new Date().toISOString(), by: input.createdBy || null }]),
      input.createdBy || null,
    ]
  )
  return mapPlacement(r.rows[0])!
}

export async function getPlacement(db: DrizzleDB, tenantId: string, placementId: string) {
  const q = toRawQuery(db)
  const placementResult = await q(
    `SELECT * FROM commercial_placements WHERE tenant_id=$1 AND placement_id=$2`,
    [tenantId, placementId]
  )
  if (!placementResult.rowCount) throw new NotFoundError('PLACEMENT_NOT_FOUND')
  const participantsResult = await q(
    `SELECT * FROM placement_market_participants WHERE tenant_id=$1 AND placement_id=$2 ORDER BY created_at ASC`,
    [tenantId, placementId]
  )
  const subjectivitiesResult = await q(
    `SELECT * FROM placement_subjectivities WHERE tenant_id=$1 AND placement_id=$2 ORDER BY created_at ASC`,
    [tenantId, placementId]
  )
  return {
    ...mapPlacement(placementResult.rows[0]),
    participants: participantsResult.rows.map(mapParticipant),
    subjectivities: subjectivitiesResult.rows.map(mapSubjectivity),
  }
}

export async function listPlacements(
  db: DrizzleDB,
  tenantId: string,
  opts: { status?: string; page: number; pageSize: number }
) {
  const q = toRawQuery(db)
  const page = Math.max(1, opts.page)
  const pageSize = Math.max(1, Math.min(100, opts.pageSize))
  const offset = (page - 1) * pageSize
  const statusFilter = opts.status || null
  const r = await q(
    `SELECT * FROM commercial_placements
      WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    [tenantId, statusFilter]
  )
  const totalResult = await q(
    `SELECT count(*)::int AS total FROM commercial_placements
      WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)`,
    [tenantId, statusFilter]
  )
  return {
    items: r.rows.map(mapPlacement),
    total: Number(totalResult.rows[0]?.total || 0),
    page,
    pageSize,
  }
}

/**
 * Subscription shares are validated per-add rather than only at bind time so
 * brokers get immediate feedback: a placement's participants must never sum
 * to more than 100% (over-subscription is rejected, not silently truncated).
 */
export async function addMarketParticipant(
  db: DrizzleDB,
  tenantId: string,
  placementId: string,
  input: {
    marketName: string
    role?: ParticipantRole
    subscriptionPercent: number
    securityStatus?: SecurityStatus
    brokerIntermediary?: string | null
  }
) {
  const q = toRawQuery(db)
  const placement = await q(
    `SELECT placement_id FROM commercial_placements WHERE tenant_id=$1 AND placement_id=$2`,
    [tenantId, placementId]
  )
  if (!placement.rowCount) throw new NotFoundError('PLACEMENT_NOT_FOUND')

  const marketName = (input.marketName || '').trim()
  if (!marketName) throw new BadRequestError('MARKET_NAME_REQUIRED', 'marketName is required')
  const share = Number(input.subscriptionPercent)
  if (!Number.isFinite(share) || share <= 0 || share > 100) {
    throw new BadRequestError('INVALID_SUBSCRIPTION_PERCENT', 'subscriptionPercent must be between 0 (exclusive) and 100')
  }

  const existingResult = await q(
    `SELECT coalesce(sum(subscription_percent), 0)::numeric AS total
       FROM placement_market_participants
      WHERE tenant_id=$1 AND placement_id=$2`,
    [tenantId, placementId]
  )
  const existingTotal = Number(existingResult.rows[0]?.total || 0)
  if (existingTotal + share > 100.0001) {
    throw new BadRequestError(
      'PLACEMENT_OVERSUBSCRIBED',
      `Adding ${share}% would bring total subscription to ${(existingTotal + share).toFixed(2)}%, exceeding 100%`
    )
  }

  const participantId = uuidv4()
  const r = await q(
    `INSERT INTO placement_market_participants
       (participant_id, tenant_id, placement_id, market_name, role, subscription_percent, security_status, broker_intermediary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      participantId,
      tenantId,
      placementId,
      marketName,
      input.role || 'Following',
      share,
      input.securityStatus || 'Provisional',
      input.brokerIntermediary || null,
    ]
  )
  return mapParticipant(r.rows[0])!
}

export async function addSubjectivity(
  db: DrizzleDB,
  tenantId: string,
  placementId: string,
  input: { description: string; dueDate?: string | null }
) {
  const q = toRawQuery(db)
  const placement = await q(
    `SELECT placement_id FROM commercial_placements WHERE tenant_id=$1 AND placement_id=$2`,
    [tenantId, placementId]
  )
  if (!placement.rowCount) throw new NotFoundError('PLACEMENT_NOT_FOUND')

  const description = (input.description || '').trim()
  if (!description) throw new BadRequestError('SUBJECTIVITY_DESCRIPTION_REQUIRED', 'description is required')

  const subjectivityId = uuidv4()
  const r = await q(
    `INSERT INTO placement_subjectivities (subjectivity_id, tenant_id, placement_id, description, status, due_date)
     VALUES ($1,$2,$3,$4,'Open',$5)
     RETURNING *`,
    [subjectivityId, tenantId, placementId, description, input.dueDate || null]
  )
  return mapSubjectivity(r.rows[0])!
}

export async function resolveSubjectivity(
  db: DrizzleDB,
  tenantId: string,
  placementId: string,
  subjectivityId: string,
  input: { status: 'Satisfied' | 'Waived'; resolvedBy?: string | null }
) {
  if (input.status !== 'Satisfied' && input.status !== 'Waived') {
    throw new BadRequestError('INVALID_SUBJECTIVITY_STATUS', 'status must be Satisfied or Waived')
  }
  const q = toRawQuery(db)
  const r = await q(
    `UPDATE placement_subjectivities
        SET status=$1, resolved_by=$2, resolved_at=now(), updated_at=now()
      WHERE tenant_id=$3 AND placement_id=$4 AND subjectivity_id=$5 AND status='Open'
      RETURNING *`,
    [input.status, input.resolvedBy || null, tenantId, placementId, subjectivityId]
  )
  if (!r.rowCount) throw new NotFoundError('SUBJECTIVITY_NOT_FOUND_OR_ALREADY_RESOLVED')
  return mapSubjectivity(r.rows[0])!
}

/**
 * Associates a document reference with the placement workflow. Placements
 * commonly exist pre-bind (before a policy/transaction row exists to hang a
 * `documents` row off of), so references are kept as a lightweight jsonb
 * array on the placement itself, mirroring the existing
 * `policy_transactions.documents` jsonb convention in this codebase.
 */
export async function addPlacementDocument(
  db: DrizzleDB,
  tenantId: string,
  placementId: string,
  input: { documentId?: string | null; name: string; uri?: string | null; uploadedBy?: string | null }
) {
  const name = (input.name || '').trim()
  if (!name) throw new BadRequestError('DOCUMENT_NAME_REQUIRED', 'name is required')
  const q = toRawQuery(db)
  const entry = {
    documentId: input.documentId || null,
    name,
    uri: input.uri || null,
    uploadedBy: input.uploadedBy || null,
    uploadedAt: new Date().toISOString(),
  }
  const r = await q(
    `UPDATE commercial_placements
        SET documents = documents || $1::jsonb, updated_at = now()
      WHERE tenant_id=$2 AND placement_id=$3
      RETURNING *`,
    [JSON.stringify([entry]), tenantId, placementId]
  )
  if (!r.rowCount) throw new NotFoundError('PLACEMENT_NOT_FOUND')
  return mapPlacement(r.rows[0])!
}

/**
 * Enforces the Submission -> Indication -> Quoted -> BindOrder -> Bound ->
 * Issued progression (with Declined/Withdrawn as early exits). Bound also
 * accepts an optional policyId to connect the placement to the resulting
 * policy once the standard bind flow has run.
 */
export async function transitionPlacementStatus(
  db: DrizzleDB,
  tenantId: string,
  placementId: string,
  input: { toStatus: PlacementStatus; reason?: string | null; actorId?: string | null; policyId?: string | null }
) {
  const q = toRawQuery(db)
  const existing = await q(
    `SELECT * FROM commercial_placements WHERE tenant_id=$1 AND placement_id=$2`,
    [tenantId, placementId]
  )
  if (!existing.rowCount) throw new NotFoundError('PLACEMENT_NOT_FOUND')
  const current = existing.rows[0] as { status: PlacementStatus; status_history: any[] }
  const allowed = ALLOWED_TRANSITIONS[current.status] || []
  if (!allowed.includes(input.toStatus)) {
    throw new BadRequestError(
      'INVALID_PLACEMENT_TRANSITION',
      `Cannot transition placement from ${current.status} to ${input.toStatus}`
    )
  }
  const historyEntry = {
    from: current.status,
    to: input.toStatus,
    at: new Date().toISOString(),
    by: input.actorId || null,
    reason: input.reason || null,
  }
  // policyId is only meaningful on the Bound transition; COALESCE keeps the
  // existing value (typically still null) for every other transition.
  const policyId = input.toStatus === 'Bound' ? input.policyId || null : null
  const r = await q(
    `UPDATE commercial_placements
        SET status=$1, status_history = status_history || $2::jsonb, updated_at = now(),
            policy_id = COALESCE($3, policy_id)
      WHERE tenant_id=$4 AND placement_id=$5
      RETURNING *`,
    [input.toStatus, JSON.stringify([historyEntry]), policyId, tenantId, placementId]
  )
  return mapPlacement(r.rows[0])!
}
