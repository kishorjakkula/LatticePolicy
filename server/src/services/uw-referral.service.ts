import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/domain.errors.js'
import { isUuidLike } from '../lib/utils.js'

export type ReferralStatus = 'Open' | 'Approved' | 'Declined' | 'InfoRequested' | 'Withdrawn'
export type ReferralDecision = 'Approved' | 'Declined' | 'InfoRequested'

export interface ReferralGateContext {
  quoteId?: string | null
  policyId?: string | null
  transactionId?: string | null
  versionId?: string | null
  productCode?: string | null
  agencyId?: string | null
  insuredName?: string | null
  effectiveDate?: string | null
  transactionType: string
  reasons: string[]
  createdBy?: string | null
}

export interface ReferralGateResult {
  blocked: boolean
  referral: any | null
}

function mapRow(row: any) {
  if (!row) return null
  return {
    referralId: row.referral_id,
    quoteId: row.quote_id,
    policyId: row.policy_id,
    transactionId: row.transaction_id,
    versionId: row.version_id,
    productCode: row.product_code,
    agencyId: row.agency_id,
    insuredName: row.insured_name,
    effectiveDate: row.effective_date,
    transactionType: row.transaction_type,
    status: row.status,
    priority: row.priority,
    reasons: row.reasons || [],
    assignedTo: row.assigned_to,
    comments: row.comments || [],
    decision: row.decision,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionReason: row.decision_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Finds an existing referral that would already authorize this attempt (an
 * Approved decision for the same quote, or the same policy+transactionType
 * pending re-attempt), or the most recent open/in-review referral so callers
 * don't spawn duplicate rows on repeated attempts.
 */
async function findExistingReferral(
  db: DrizzleDB,
  tenantId: string,
  ctx: ReferralGateContext
): Promise<any | null> {
  const q = toRawQuery(db)
  if (ctx.quoteId) {
    const r = await q(
      `SELECT * FROM underwriting_referrals
        WHERE tenant_id=$1 AND quote_id=$2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ctx.quoteId]
    )
    return r.rows[0] || null
  }
  if (ctx.policyId) {
    const r = await q(
      `SELECT * FROM underwriting_referrals
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type=$3
          AND status IN ('Open','InfoRequested','Approved')
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, ctx.policyId, ctx.transactionType]
    )
    return r.rows[0] || null
  }
  return null
}

/**
 * Ensures a referral row exists for a Refer decision, and reports whether the
 * caller should be blocked from proceeding (no Approved decision yet).
 * Declined/Withdrawn referrals also block — the caller must not silently
 * re-submit; a new referral is opened so the underwriter sees a fresh attempt.
 */
export async function resolveReferralGate(
  db: DrizzleDB,
  tenantId: string,
  ctx: ReferralGateContext
): Promise<ReferralGateResult> {
  const q = toRawQuery(db)
  const existing = await findExistingReferral(db, tenantId, ctx)

  if (existing && existing.status === 'Approved') {
    return { blocked: false, referral: mapRow(existing) }
  }

  if (existing && (existing.status === 'Open' || existing.status === 'InfoRequested')) {
    return { blocked: true, referral: mapRow(existing) }
  }

  // No open/approved referral (none exists, or the last one was
  // Declined/Withdrawn) — open a fresh one for underwriter review.
  const referralId = uuidv4()
  const r = await q(
    `INSERT INTO underwriting_referrals
       (referral_id, tenant_id, quote_id, policy_id, transaction_id, version_id,
        product_code, agency_id, insured_name, effective_date, transaction_type,
        status, priority, reasons, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Open','Normal',$12,$13)
     RETURNING *`,
    [
      referralId,
      tenantId,
      ctx.quoteId || null,
      ctx.policyId || null,
      ctx.transactionId || null,
      ctx.versionId || null,
      ctx.productCode || null,
      ctx.agencyId || null,
      ctx.insuredName || null,
      ctx.effectiveDate || null,
      ctx.transactionType,
      ctx.reasons || [],
      ctx.createdBy || null,
    ]
  )
  return { blocked: true, referral: mapRow(r.rows[0]) }
}

export interface ReferralActor {
  id?: string | null
  username?: string | null
  roles?: string[]
  permissions?: string[]
}

function isUnderwriterActor(actor?: ReferralActor | null): boolean {
  const roles = actor?.roles || []
  const permissions = actor?.permissions || []
  return roles.includes('underwriter') || roles.includes('admin') || permissions.includes('uw.referrals.decide')
}

/**
 * Resolves the referral gate for a transaction attempt, allowing an
 * underwriter-permission actor to self-decide (Approve) inline when they
 * supply a reason — this preserves the existing "UW overrides at
 * submit-time" UX while still recording a real referral + decision instead
 * of trusting a client-supplied override flag. Non-underwriter actors are
 * always blocked until a separate underwriter approves the open referral.
 */
export async function resolveReferralGateForActor(
  db: DrizzleDB,
  tenantId: string,
  ctx: ReferralGateContext,
  actor?: ReferralActor | null,
  overrideReason?: string
): Promise<ReferralGateResult> {
  const gate = await resolveReferralGate(db, tenantId, ctx)
  const isUw = isUnderwriterActor(actor)
  const reason = (overrideReason || '').trim()
  if (gate.blocked && isUw && reason) {
    const decidedBy = actor?.id && isUuidLike(actor.id) ? actor.id : null
    const decided = await decideReferral(db, tenantId, gate.referral.referralId, {
      decision: 'Approved',
      reason,
      decidedBy,
      isUnderwriter: true,
    })
    return { blocked: false, referral: decided }
  }
  return gate
}

export async function listReferrals(
  db: DrizzleDB,
  tenantId: string,
  opts: { status?: string; page: number; pageSize: number }
) {
  const q = toRawQuery(db)
  const page = Math.max(1, opts.page)
  const pageSize = Math.max(1, Math.min(100, opts.pageSize))
  const offset = (page - 1) * pageSize
  const statusFilter = opts.status ? opts.status : null
  const r = await q(
    `SELECT r.*, p.policy_number
       FROM underwriting_referrals r
       LEFT JOIN policies p ON p.policy_id = r.policy_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1
        AND ($2::text IS NULL OR r.status = $2)
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}`,
    [tenantId, statusFilter]
  )
  const items = r.rows.map((row: any) => ({ ...mapRow(row), policyNumber: row.policy_number || null }))
  return { items, total: items.length, page, pageSize }
}

export async function getReferral(db: DrizzleDB, tenantId: string, referralId: string) {
  const q = toRawQuery(db)
  const r = await q(
    `SELECT r.*, p.policy_number
       FROM underwriting_referrals r
       LEFT JOIN policies p ON p.policy_id = r.policy_id AND p.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1 AND r.referral_id = $2`,
    [tenantId, referralId]
  )
  if (!r.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  return { ...mapRow(r.rows[0]), policyNumber: r.rows[0].policy_number || null }
}

export async function assignReferral(
  db: DrizzleDB,
  tenantId: string,
  referralId: string,
  assignedTo: string
) {
  const q = toRawQuery(db)
  const r = await q(
    `UPDATE underwriting_referrals SET assigned_to=$1, updated_at=now()
      WHERE tenant_id=$2 AND referral_id=$3 RETURNING *`,
    [assignedTo, tenantId, referralId]
  )
  if (!r.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  return mapRow(r.rows[0])!
}

export async function addReferralComment(
  db: DrizzleDB,
  tenantId: string,
  referralId: string,
  comment: { by: string; text: string }
) {
  const q = toRawQuery(db)
  const text = (comment.text || '').trim()
  if (!text) throw new BadRequestError('COMMENT_REQUIRED', 'Comment text is required')
  const entry = { by: comment.by, text, at: new Date().toISOString() }
  const r = await q(
    `UPDATE underwriting_referrals
        SET comments = comments || $1::jsonb, updated_at = now()
      WHERE tenant_id=$2 AND referral_id=$3 RETURNING *`,
    [JSON.stringify([entry]), tenantId, referralId]
  )
  if (!r.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  return mapRow(r.rows[0])!
}

const DECIDABLE_STATUSES: ReferralStatus[] = ['Open', 'InfoRequested']

export async function decideReferral(
  db: DrizzleDB,
  tenantId: string,
  referralId: string,
  input: { decision: ReferralDecision; reason?: string; decidedBy: string | null; isUnderwriter: boolean }
) {
  if (!input.isUnderwriter) {
    throw new ForbiddenError('REFERRAL_DECISION_FORBIDDEN')
  }
  const q = toRawQuery(db)
  const existing = await q(
    `SELECT * FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2`,
    [tenantId, referralId]
  )
  if (!existing.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  const current = existing.rows[0] as { status: ReferralStatus }
  if (!DECIDABLE_STATUSES.includes(current.status)) {
    throw new BadRequestError(
      'REFERRAL_NOT_DECIDABLE',
      `Referral is already ${current.status} and cannot be decided again`
    )
  }
  const nextStatus: ReferralStatus = input.decision
  const reason = (input.reason || '').trim()
  const commentEntry = reason
    ? [{ by: input.decidedBy, text: reason, at: new Date().toISOString(), decision: input.decision }]
    : []
  const r = await q(
    `UPDATE underwriting_referrals
        SET status=$1, decision=$1, decided_by=$2, decided_at=now(), decision_reason=$3,
            comments = comments || $4::jsonb, updated_at = now()
      WHERE tenant_id=$5 AND referral_id=$6 RETURNING *`,
    [nextStatus, input.decidedBy, reason || null, JSON.stringify(commentEntry), tenantId, referralId]
  )
  return mapRow(r.rows[0])!
}
