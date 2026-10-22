import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/domain.errors.js'
import { asDateOnly } from '../lib/date.utils.js'
import { referralProposalEvidence, type ReferralProposalInput } from '../lib/referral-proposal.js'

export type ReferralStatus = 'Open' | 'Approved' | 'Declined' | 'InfoRequested' | 'Withdrawn'
export type ReferralDecision = 'Approved' | 'Declined' | 'InfoRequested'
const RETAINED_EVIDENCE = Symbol('server-evaluated referral evidence')

export interface ReferralGateContext {
  [RETAINED_EVIDENCE]?: ReturnType<typeof referralProposalEvidence>
  proposal?: ReferralProposalInput
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
  authorityOverrideRequired?: boolean
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
    proposalHash: row.proposal_hash || null,
    proposalSnapshot: row.proposal_snapshot || null,
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
  ctx: ReferralGateContext,
  proposalHash: string | null
): Promise<any | null> {
  const q = toRawQuery(db)
  if (ctx.quoteId) {
    const r = await q(
      `SELECT *, effective_date::text AS effective_date FROM underwriting_referrals
        WHERE tenant_id=$1 AND quote_id=$2 AND ($3::text IS NULL OR proposal_hash=$3)
        ORDER BY created_at DESC, referral_id DESC LIMIT 1`,
      [tenantId, ctx.quoteId, proposalHash]
    )
    return r.rows[0] || null
  }
  if (ctx.policyId) {
    const r = await q(
      `SELECT *, effective_date::text AS effective_date FROM underwriting_referrals
        WHERE tenant_id=$1 AND policy_id=$2 AND transaction_type=$3 AND ($4::text IS NULL OR proposal_hash=$4)
        ORDER BY created_at DESC, referral_id DESC LIMIT 1`,
      [tenantId, ctx.policyId, ctx.transactionType, proposalHash]
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
  if (ctx.authorityOverrideRequired && !ctx.reasons.some(reason => reason.startsWith('AUTHORITY_'))) {
    ctx = { ...ctx, reasons: [...ctx.reasons, 'AUTHORITY_OVERRIDE_REQUIRED'] }
  }
  // Quote gates have no surrounding policy lock. Policy gates serialize on the
  // policy row; their rollback-retention path takes its own advisory lock later.
  if (ctx.quoteId) await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    JSON.stringify(['quote-referral', tenantId, ctx.quoteId]),
  ])
  const evidence = ctx[RETAINED_EVIDENCE] || referralProposalEvidence(tenantId, ctx)
  const existing = await findExistingReferral(db, tenantId, ctx, evidence.proposalHash)
  const sameDate = asDateOnly(existing?.effective_date) === asDateOnly(ctx.effectiveDate)
  const coversReasons = ctx.reasons.every(reason => (existing?.reasons || []).includes(reason))
  const exactProposal = !!evidence.proposalHash && existing?.proposal_hash === evidence.proposalHash
  const reusable = existing && exactProposal && sameDate && coversReasons && !existing.transaction_id && !existing.version_id

  if (reusable && existing.status === 'Approved') {
    return { blocked: false, referral: mapRow(existing) }
  }

  if (reusable && (existing.status === 'Open' || existing.status === 'InfoRequested')) {
    return { blocked: true, referral: mapRow(existing) }
  }

  // No open/approved referral (none exists, or the last one was
  // Declined/Withdrawn) — open a fresh one for underwriter review.
  const referralId = uuidv4()
  const r = await q(
    `INSERT INTO underwriting_referrals
       (referral_id, tenant_id, quote_id, policy_id, transaction_id, version_id,
        product_code, agency_id, insured_name, effective_date, transaction_type,
        status, priority, reasons, created_by, proposal_hash, proposal_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Open','Normal',$12,$13,$14,$15::jsonb)
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
      evidence.proposalHash,
      evidence.proposalSnapshot ? JSON.stringify(evidence.proposalSnapshot) : null,
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

/**
 * Transaction attempts never decide referrals. Approval must be recorded by
 * the explicit referral decision endpoint after review (WP-0004 REQ-1).
 * Retain the actor/reason arguments for caller compatibility only.
 */
export async function resolveReferralGateForActor(
  db: DrizzleDB,
  tenantId: string,
  ctx: ReferralGateContext,
  _actor?: ReferralActor | null,
  _overrideReason?: string
): Promise<ReferralGateResult> {
  return resolveReferralGate(db, tenantId, ctx)
}

/** Carries only server-evaluated context across the rejected policy transaction. */
export class PolicyReferralRequiredError extends BadRequestError {
  readonly referralContext: ReferralGateContext
  constructor(referral: NonNullable<ReturnType<typeof mapRow>>) {
    super('UW_REFERRAL_REQUIRED', `Referral ${referral.referralId} requires underwriter approval before this transaction can proceed.`)
    this.referralContext = {
      policyId: referral.policyId,
      transactionType: referral.transactionType,
      productCode: referral.productCode,
      insuredName: referral.insuredName,
      effectiveDate: referral.effectiveDate,
      reasons: referral.reasons,
      agencyId: referral.agencyId,
      createdBy: referral.createdBy,
      [RETAINED_EVIDENCE]: { proposalHash: referral.proposalHash, proposalSnapshot: referral.proposalSnapshot },
    }
  }
}

/** Roll back all policy writes first; then retain only the underwriting work item. */
export async function withPersistentPolicyReferral<T>(tenantId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof PolicyReferralRequiredError)) throw error
    const context = error.referralContext
    const gate = await withTenantTx(tenantId, async db => {
      const q = toRawQuery(db)
      // Serialize rejected retries without holding the rolled-back policy lock.
      await q('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify(['policy-referral', tenantId, context.policyId, context.transactionType]),
      ])
      return resolveReferralGate(db, tenantId, context)
    })
    throw new BadRequestError('UW_REFERRAL_REQUIRED',
      `Referral ${gate.referral.referralId} ${gate.blocked ? 'requires underwriter approval' : 'has been approved; retry this transaction'}.`)
  }
}

export type ReferralSort = 'oldest' | 'newest'
export const REFERRAL_SORTS: readonly ReferralSort[] = ['oldest', 'newest']

/** Open referrals are a work queue, so they default to oldest first. */
export function defaultReferralSort(status?: string | null): ReferralSort {
  return status === 'Open' ? 'oldest' : 'newest'
}

export interface ReferralMoney {
  amount: number
  currency: string
}

function toMoney(amount: unknown, currency: unknown): ReferralMoney | null {
  if (amount === null || amount === undefined || amount === '') return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null
  const code = typeof currency === 'string' && currency.trim().length === 3 ? currency.trim().toUpperCase() : 'USD'
  return { amount: value, currency: code }
}

/**
 * Premium shown in the referral queue: the latest version of the referral's
 * policy when it has one (renewal, endorsement, rewrite, or a new-business
 * referral already bound), otherwise the rated quote's total for pre-bind
 * referrals. Null when neither has been rated.
 */
function referralPremium(row: any): ReferralMoney | null {
  const fromPolicy = toMoney(row.latest_premium_amount, row.latest_premium_currency)
  if (fromPolicy) return fromPolicy
  const total = row.quote_premium?.total
  return total ? toMoney(total.amount, total.currency) : null
}

// Referral plus its policy number and premium. Every join is tenant-scoped;
// the lateral picks the policy's latest version through
// idx_policy_versions_policy (tenant_id, policy_id, processed_at DESC).
const REFERRAL_VIEW_SELECT = `SELECT r.*, p.policy_number,
            lv.premium_total AS latest_premium_amount, lv.currency AS latest_premium_currency,
            qt.premium AS quote_premium
       FROM underwriting_referrals r
       LEFT JOIN policies p ON p.policy_id = r.policy_id AND p.tenant_id = r.tenant_id
       LEFT JOIN LATERAL (
         SELECT v.premium_total, v.currency
           FROM policy_versions v
          WHERE v.tenant_id = r.tenant_id AND v.policy_id = r.policy_id
          ORDER BY v.processed_at DESC, v.version_id DESC
          LIMIT 1
       ) lv ON true
       LEFT JOIN quotes qt ON qt.quote_id = r.quote_id AND qt.tenant_id = r.tenant_id`

function mapViewRow(row: any) {
  return { ...mapRow(row), policyNumber: row.policy_number || null, premium: referralPremium(row) }
}

export async function listReferrals(
  db: DrizzleDB,
  tenantId: string,
  opts: { status?: string; sort?: ReferralSort; page: number; pageSize: number }
) {
  const q = toRawQuery(db)
  const page = Math.max(1, opts.page)
  const pageSize = Math.max(1, Math.min(100, opts.pageSize))
  const offset = (page - 1) * pageSize
  const statusFilter = opts.status ? opts.status : null
  const sort: ReferralSort = opts.sort && REFERRAL_SORTS.includes(opts.sort) ? opts.sort : defaultReferralSort(statusFilter)
  // Fixed SQL fragments only; the sort value never reaches the query text.
  const orderBy = sort === 'oldest' ? 'r.created_at ASC, r.referral_id ASC' : 'r.created_at DESC, r.referral_id DESC'
  const r = await q(
    `${REFERRAL_VIEW_SELECT}
      WHERE r.tenant_id = $1
        AND ($2::text IS NULL OR r.status = $2)
      ORDER BY ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}`,
    [tenantId, statusFilter]
  )
  const totalResult = await q(
    `SELECT count(*)::int AS total
       FROM underwriting_referrals
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR status = $2)`,
    [tenantId, statusFilter]
  )
  const items = r.rows.map(mapViewRow)
  return { items, total: Number(totalResult.rows[0]?.total || 0), page, pageSize, sort }
}

export async function getReferral(db: DrizzleDB, tenantId: string, referralId: string) {
  const q = toRawQuery(db)
  const r = await q(
    `${REFERRAL_VIEW_SELECT}
      WHERE r.tenant_id = $1 AND r.referral_id = $2`,
    [tenantId, referralId]
  )
  if (!r.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  return mapViewRow(r.rows[0])
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
  input: { decision: ReferralDecision; reason?: string; decidedBy: string | null; isUnderwriter: boolean; canOverrideAuthority?: boolean }
) {
  if (!input.isUnderwriter) {
    throw new ForbiddenError('REFERRAL_DECISION_FORBIDDEN')
  }
  const q = toRawQuery(db)
  const existing = await q(
    `SELECT * FROM underwriting_referrals WHERE tenant_id=$1 AND referral_id=$2 FOR UPDATE`,
    [tenantId, referralId]
  )
  if (!existing.rowCount) throw new NotFoundError('REFERRAL_NOT_FOUND')
  const current = existing.rows[0] as { status: ReferralStatus; reasons?: string[] }
  if (!DECIDABLE_STATUSES.includes(current.status)) {
    throw new BadRequestError(
      'REFERRAL_NOT_DECIDABLE',
      `Referral is already ${current.status} and cannot be decided again`
    )
  }
  const nextStatus: ReferralStatus = input.decision
  const reason = (input.reason || '').trim()
  const authorityReferral = (current.reasons || []).some(value => String(value).startsWith('AUTHORITY_'))
  if (input.decision === 'Approved' && authorityReferral && (!input.canOverrideAuthority || !reason)) {
    throw new ForbiddenError('AUTHORITY_OVERRIDE_REQUIRED')
  }
  // Approve and Decline are recorded underwriting decisions and always carry a
  // reason (WP-0004 REQ-1); Request info keeps an optional comment. Enforced
  // here so /decide, /approve and /decline cannot diverge. Checked after the
  // authority rule so an authority referral keeps its existing 403.
  if ((input.decision === 'Approved' || input.decision === 'Declined') && !reason) {
    throw new BadRequestError('REASON_REQUIRED', 'A reason is required to approve or decline a referral')
  }
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
