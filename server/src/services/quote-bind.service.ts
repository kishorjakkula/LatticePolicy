import { v4 as uuidv4 } from '../uuid.js'
import { mapProductRiskKind, requireProductCapability } from '../lib/product-registry.js'
import { withTenantTx, toRawQuery, type DrizzleDB } from '../db.js'
import {
  NotFoundError,
  BadRequestError,
  ValidationError,
} from '../errors/domain.errors.js'
import {
  insertPolicyProjection,
  insertPolicyTransaction,
  insertPolicyVersion,
  insertRating,
  persistRiskUnits,
  persistCoverageRecords,
  safeMoney,
  type RiskEntry,
} from '../persistence.js'
import { generatePolicyNumber } from '../policyNumbers.js'
import { checkQuoteExpiry, screenOfac } from '../policyCompliance.js'
import {
  defaultTenantPolicyNumberFormats,
  tenantPolicyNumberFormatsFromRow,
  type TenantPolicyNumberFormats,
} from '../tenantPreferences.js'
import { extractQuoteCustomerLinks } from '../lib/quote.utils.js'
import { isUuidLike } from '../lib/utils.js'
import { normalizeQuoteAuditHistory, upsertQuoteAuditHistory } from './quote.service.js'
import { addMonths } from '../lib/date.utils.js'
import {
  buildPolicyDocumentPacket,
  persistPolicyDocumentPacket,
  type PolicyDocumentPacket,
} from './document-generation.service.js'
import { createCommissionHandoffEvent } from './commission-handoff.service.js'
import { resolveReferralGateForActor } from './uw-referral.service.js'
import { maximumRequestedLimit, resolveAuthorityDecision } from './underwriting-authority.service.js'
import { computePlacementForTransactionSafely } from './reinsurance.service.js'
import { extractExposureDimensions, loadExposureRows } from './exposure.service.js'
import {
  runExternalVerification,
  type ExternalVerificationRequest,
} from './external-verification.service.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BindQuoteResult {
  policyId: string
  policyNumber: string
  status: 'Bound'
  transactionId: string
  versionId: string
  ratingId: string
  effectiveDate: string
  expirationDate: string
  premiumSummary: any
  riskSummary: any
}

// ── Pure helpers (no Express, no store) ──────────────────────────────────────

function generateTransactionNumber(prefix = 'NB-'): string {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${prefix}${stamp}-${rand}`
}

function mapRiskKind(productCode: string | undefined, risk: any): string {
  return mapProductRiskKind(productCode, risk)
}

function summarizeRisk(risk: any): string {
  if (!risk || typeof risk !== 'object') return ''
  if (risk.type === 'autoVehicle') {
    return [risk.year, risk.make, risk.model].filter(Boolean).join(' ').trim()
  }
  if (risk.type === 'dwelling') {
    return [risk.address, risk.construction, risk.yearBuilt].filter(Boolean).join(', ').trim()
  }
  return risk.type || 'risk'
}

// ── Task A: aggregation / catastrophe-exposure appetite check ────────────────
//
// See migrations/056_aggregation_appetite_limits.sql. A tenant may
// optionally configure a maximum total TIV and/or policy count for a given
// (productCode, stateCode). When nothing is configured for that
// combination, this check is a complete no-op — mirroring
// underwriting-authority.service.ts's `resolveAuthorityDecision` convention
// (zero configured grants => `configured: false, authorized: true`).

export interface AggregationLimitConfig {
  maxTotalTiv: number | null
  maxPolicyCount: number | null
}

export interface AggregationAppetiteEvaluation {
  configured: boolean
  exceeded: boolean
  reasons: string[]
  projectedTotalTiv: number
  projectedPolicyCount: number
}

/**
 * Pure comparison (no DB access): given an optionally-configured
 * aggregation-appetite limit and the book's CURRENT aggregate exposure for
 * this (productCode, stateCode) — as already computed by
 * exposure.service.ts's existing aggregation query — decide whether adding
 * one more policy with `newPolicyTiv` would push the book over the limit.
 */
export function evaluateAggregationAppetite(
  limit: AggregationLimitConfig | null,
  currentAggregate: { policyCount: number; totalTiv: number },
  newPolicyTiv: number | null
): AggregationAppetiteEvaluation {
  const projectedTotalTiv = (currentAggregate.totalTiv || 0) + (newPolicyTiv || 0)
  const projectedPolicyCount = (currentAggregate.policyCount || 0) + 1

  if (!limit || (limit.maxTotalTiv == null && limit.maxPolicyCount == null)) {
    return { configured: false, exceeded: false, reasons: [], projectedTotalTiv, projectedPolicyCount }
  }

  const reasons: string[] = []
  if (limit.maxTotalTiv != null && projectedTotalTiv > limit.maxTotalTiv) {
    reasons.push('AGGREGATION_TIV_LIMIT_EXCEEDED')
  }
  if (limit.maxPolicyCount != null && projectedPolicyCount > limit.maxPolicyCount) {
    reasons.push('AGGREGATION_POLICY_COUNT_LIMIT_EXCEEDED')
  }
  return { configured: true, exceeded: reasons.length > 0, reasons, projectedTotalTiv, projectedPolicyCount }
}

/** Loads the active aggregation-appetite limit row, if any, for this tenant/product/state. */
async function loadAggregationLimit(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  productCode: string,
  stateCode: string
): Promise<AggregationLimitConfig | null> {
  if (!productCode || !stateCode) return null
  let result: any
  try {
    result = await q(
      `SELECT max_total_tiv, max_policy_count FROM aggregation_appetite_limits
        WHERE tenant_id=$1 AND active=true AND LOWER(product_code)=LOWER($2) AND UPPER(state_code)=UPPER($3)
        LIMIT 1`,
      [tenantId, productCode, stateCode]
    )
  } catch {
    // Table not present (e.g. migration not yet applied) — treat as unconfigured.
    return null
  }
  if (!result?.rowCount) return null
  const row = result.rows[0]
  return {
    maxTotalTiv: row.max_total_tiv == null ? null : Number(row.max_total_tiv),
    maxPolicyCount: row.max_policy_count == null ? null : Number(row.max_policy_count),
  }
}

// ── Task B: internal-record consistency check ────────────────────────────────
//
// Self-reported qualification answers (frontend/src/features/wizard/QuoteWizard.tsx,
// QUALIFICATION_QUESTIONS) are never cross-checked against anything today.
// This system has no external data-vendor integration (see
// external-verification.service.ts for the honest, inert extension point for
// that), but it DOES have its own prior-policy records for a matched
// customer, which is real data worth checking.
//
// What this checks, precisely, and why:
//   - The 'personal-auto' qualification question `continuousInsurance6Months`
//     ("Continuous auto insurance for last 6 months?") is self-reported as
//     `true` in the submission's uwAnswers.
//   - AND this system's OWN records show a `Cancel` transaction for a PRIOR
//     policy belonging to the SAME matched customer (via policy_customer_links),
//     with `cancellation_type = 'NON_PAYMENT'` (an exact, unambiguous field
//     value — not an inference), whose cancellation effective date falls
//     within the same 6-month window the question itself asks about.
// That is a direct contradiction between two concrete facts, not a
// speculative inference — exactly the kind of thing an underwriter can
// verify by pulling up the two records side by side.

const CONTINUOUS_INSURANCE_LOOKBACK_MONTHS = 6
const INTERNAL_CONSISTENCY_PRIOR_NONPAYMENT_REASON =
  'INTERNAL_RECORD_PRIOR_NONPAYMENT_CANCELLATION_CONTRADICTS_QUALIFICATION'

export interface PriorCancellationRecord {
  policyId: string
  /** The cancellation's effective date (YYYY-MM-DD), i.e. when coverage ended. */
  effectiveDate: string
  cancellationType: string | null
}

export interface InternalConsistencyFinding {
  discrepancy: boolean
  reason: string | null
}

/**
 * Pure comparison (no DB access). See the block comment above for exactly
 * what this does and does not check.
 */
export function detectPriorNonpaymentDiscrepancy(input: {
  qualificationAnswers: Record<string, unknown> | null | undefined
  newPolicyEffectiveDate: string
  priorCancellations: PriorCancellationRecord[]
}): InternalConsistencyFinding {
  const claimedContinuousInsurance = input.qualificationAnswers?.continuousInsurance6Months === true
  if (!claimedContinuousInsurance) return { discrepancy: false, reason: null }

  const effective = new Date(input.newPolicyEffectiveDate)
  if (Number.isNaN(effective.getTime())) return { discrepancy: false, reason: null }
  const cutoff = new Date(effective)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CONTINUOUS_INSURANCE_LOOKBACK_MONTHS)

  const hit = input.priorCancellations.some((record) => {
    if (record.cancellationType !== 'NON_PAYMENT') return false
    const cancelDate = new Date(record.effectiveDate)
    if (Number.isNaN(cancelDate.getTime())) return false
    return cancelDate >= cutoff && cancelDate <= effective
  })

  return hit
    ? { discrepancy: true, reason: INTERNAL_CONSISTENCY_PRIOR_NONPAYMENT_REASON }
    : { discrepancy: false, reason: null }
}

/**
 * Loads this customer's prior `Cancel` policy-version rows (any policy
 * linked to them via policy_customer_links), narrowed to rows that carry a
 * cancellation_type at all. Filtering down to NON_PAYMENT specifically, and
 * to the lookback window, happens in the pure `detectPriorNonpaymentDiscrepancy`
 * above so that logic stays unit-testable without a DB.
 */
async function loadPriorCancellationsForCustomer(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  customerId: string
): Promise<PriorCancellationRecord[]> {
  const result = await q(
    `SELECT pv.policy_id, pv.effective_date, pv.cancellation_type
       FROM policy_customer_links pcl
       JOIN policy_versions pv
         ON pv.tenant_id = pcl.tenant_id AND pv.policy_id = pcl.policy_id
      WHERE pcl.tenant_id = $1
        AND pcl.customer_id = $2
        AND pv.transaction_type = 'CANCEL'
        AND pv.cancellation_type IS NOT NULL`,
    [tenantId, customerId]
  )
  return (result.rows as any[]).map((row) => ({
    policyId: String(row.policy_id),
    effectiveDate: row.effective_date ? new Date(row.effective_date).toISOString().slice(0, 10) : '',
    cancellationType: row.cancellation_type || null,
  }))
}

async function upsertPolicyCustomerLinks(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  links: any[]
) {
  if (!Array.isArray(links) || !links.length) return
  const q = toRawQuery(db)
  for (const link of links) {
    await q(
      `INSERT INTO policy_customer_links (
        policy_customer_link_id, tenant_id, policy_id, customer_id, role_code, is_primary, source, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now(), now())
      ON CONFLICT (tenant_id, policy_id, customer_id, role_code)
      DO UPDATE SET
        is_primary = EXCLUDED.is_primary,
        metadata = EXCLUDED.metadata,
        updated_at = now()`,
      [
        uuidv4(),
        tenantId,
        policyId,
        link.customerId,
        link.relationshipType || link.roleCode,
        link.isPrimary,
        'quote',
        JSON.stringify({
          customerKey: link.customerKey || null,
          displayName: link.displayName || null,
        }),
      ]
    )
  }
}

async function loadPolicyNumberFormats(tenantId: string): Promise<TenantPolicyNumberFormats> {
  try {
    const result: any = await withTenantTx(tenantId, (db) =>
      toRawQuery(db)(
        'SELECT policy_number_formats_by_product FROM tenants WHERE tenant_id=$1 LIMIT 1',
        [tenantId]
      )
    )
    if ((result?.rowCount ?? 0) > 0) {
      return tenantPolicyNumberFormatsFromRow(result.rows[0])
    }
  } catch {
    // Fall back to defaults when tenant settings are unavailable.
  }
  return defaultTenantPolicyNumberFormats()
}

// ── Service function ──────────────────────────────────────────────────────────

/**
 * Bind a quote: validate compliance, create a new policy with all supporting
 * records (projection, transaction, version, rating, risk-units, coverages,
 * ledger event) and mark the quote as Converted.
 *
 * This function handles ONLY the DB path (no in-memory fallback).
 */
export async function bindQuote(
  db: DrizzleDB,
  tenantId: string,
  quoteId: string,
  body: any,
  updatedBy: string,
  actorId?: string | null,
  actor?: { roles?: string[]; permissions?: string[] } | null
): Promise<BindQuoteResult> {
  const overrideReason =
    body && typeof body.overrideReason === 'string'
      ? body.overrideReason.trim()
      : ''
  const actorIdValue = String(actorId || '').trim()
  const normalizedActorId = isUuidLike(actorIdValue) ? actorIdValue : null

  // ── 1. Fetch quote from DB ──────────────────────────────────────────────────
  const r: any = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      'SELECT payload, underwriting, premium, status_history, step_history FROM quotes WHERE tenant_id=$1 AND quote_id=$2',
      [tenantId, quoteId]
    )
  )

  if (!r.rowCount) {
    throw new NotFoundError('QUOTE_NOT_FOUND')
  }

  const row = r.rows[0]
  const quote = { payload: row.payload, uw: row.underwriting, premium: row.premium }
  requireProductCapability(String(quote.payload?.productCode || ''), 'bind')
  const existingStatusHistory = normalizeQuoteAuditHistory(row.status_history)
  const existingStepHistory = normalizeQuoteAuditHistory(row.step_history)

  // ── 2. Expiry check ─────────────────────────────────────────────────────────
  const expiryCheck = checkQuoteExpiry(quote as any)
  if (expiryCheck.expired) {
    throw new ValidationError('QUOTE_EXPIRED', {
      message: `This quote expired on ${expiryCheck.expiryDate}. Please create a new quote.`,
      expiryDate: expiryCheck.expiryDate,
    })
  }

  // ── 3. UW validation ────────────────────────────────────────────────────────
  const insuredDisplayName = (
    (quote.payload?.insureds?.primary?.firstName || '') +
    ' ' +
    (quote.payload?.insureds?.primary?.lastName ||
      quote.payload?.applicant?.firstName ||
      '')
  ).trim()

  let referralId: string | null = null
  const bindProductCode = quote.payload?.productCode || ''
  const bindStateCode = quote.payload?.state || quote.payload?.jurisdiction?.code || ''
  const bindEffectiveDate = quote.payload?.effectiveDate || new Date().toISOString().slice(0, 10)

  const authority = await withTenantTx(tenantId, innerDb => resolveAuthorityDecision(toRawQuery(innerDb), {
    tenantId,
    actorId: normalizedActorId,
    roles: actor?.roles || [],
    producerId: quote.payload?.producer?.producerId || quote.payload?.producer?.producerKey || null,
    productCode: bindProductCode,
    stateCode: bindStateCode,
    effectiveDate: bindEffectiveDate,
    transactionType: 'NewBusiness',
    premium: Number(quote.premium?.total?.amount || 0),
    requestedLimit: maximumRequestedLimit(quote.payload),
  }))

  if (quote.uw && quote.uw.decision === 'Decline') {
    throw new BadRequestError(
      'UW_DECLINED',
      `Underwriting decision: Decline. Reasons: ${quote.uw.reasons?.join('; ')}`
    )
  }

  // Task A: real-time aggregation/catastrophe-exposure appetite check.
  // No-op unless the tenant has configured a limit for this product+state
  // (see loadAggregationLimit / migrations/056_aggregation_appetite_limits.sql).
  const aggregationLimit = await withTenantTx(tenantId, innerDb =>
    loadAggregationLimit(toRawQuery(innerDb), tenantId, bindProductCode, bindStateCode)
  )
  let aggregationEvaluation: AggregationAppetiteEvaluation = {
    configured: false,
    exceeded: false,
    reasons: [],
    projectedTotalTiv: 0,
    projectedPolicyCount: 0,
  }
  if (aggregationLimit) {
    const currentExposureRows = await loadExposureRows(db, tenantId, {
      productCode: bindProductCode,
      state: bindStateCode,
    })
    const currentAggregate = {
      policyCount: currentExposureRows.length,
      totalTiv: currentExposureRows.reduce((sum, row) => sum + (row.tiv || 0), 0),
    }
    const newPolicyDimensions = extractExposureDimensions(bindProductCode, quote.payload)
    aggregationEvaluation = evaluateAggregationAppetite(aggregationLimit, currentAggregate, newPolicyDimensions.tiv)
  }

  // Customer link extraction (hoisted ahead of its original §7 spot so the
  // Task B internal-consistency check below can reuse the same matched
  // customer the bind already links the policy to).
  const quoteCustomerLinks = extractQuoteCustomerLinks(quote.payload)
  const primaryCustomerLink =
    quoteCustomerLinks.find((item: any) => item.isPrimary) ||
    quoteCustomerLinks[0] ||
    null

  // Task B: internal-data consistency check against this system's own
  // records for the matched customer (see detectPriorNonpaymentDiscrepancy
  // above for exactly what is and is not checked).
  let internalConsistency: InternalConsistencyFinding = { discrepancy: false, reason: null }
  if (primaryCustomerLink?.customerId) {
    const priorCancellations = await withTenantTx(tenantId, innerDb =>
      loadPriorCancellationsForCustomer(toRawQuery(innerDb), tenantId, primaryCustomerLink.customerId)
    )
    internalConsistency = detectPriorNonpaymentDiscrepancy({
      qualificationAnswers: quote.payload?.uwAnswers || null,
      newPolicyEffectiveDate: bindEffectiveDate,
      priorCancellations,
    })
  }

  // Task B (extension point): pluggable external-verification hook. No
  // provider is configured anywhere in this codebase, so this always
  // resolves to an empty findings list — see external-verification.service.ts.
  const externalVerificationRequest: ExternalVerificationRequest = {
    tenantId,
    productCode: bindProductCode,
    stateCode: bindStateCode || null,
    effectiveDate: bindEffectiveDate,
    insuredDisplayName: insuredDisplayName || null,
    customerId: primaryCustomerLink?.customerId || null,
    qualificationAnswers: quote.payload?.uwAnswers || null,
  }
  const externalVerification = await runExternalVerification(externalVerificationRequest)
  const externalVerificationReasons = externalVerification.findings.map(
    (finding) => `EXTERNAL_VERIFICATION_${finding.code}`
  )

  const uwReferReasons = quote.uw?.decision === 'Refer' ? quote.uw.reasons || [] : []
  const authorityReasons = authority.configured && !authority.authorized
    ? authority.reasons.map(reason => `AUTHORITY_${reason}`)
    : []
  const aggregationReasons = aggregationEvaluation.exceeded ? aggregationEvaluation.reasons : []
  const internalConsistencyReasons = internalConsistency.discrepancy && internalConsistency.reason
    ? [internalConsistency.reason]
    : []

  const allReferralReasons = [
    ...uwReferReasons,
    ...authorityReasons,
    ...aggregationReasons,
    ...internalConsistencyReasons,
    ...externalVerificationReasons,
  ]

  if (allReferralReasons.length > 0) {
    const gate = await withTenantTx(tenantId, (innerDb) =>
      resolveReferralGateForActor(
        innerDb,
        tenantId,
        {
          quoteId,
          transactionType: 'NewBusiness',
          productCode: bindProductCode || null,
          insuredName: insuredDisplayName || null,
          effectiveDate: quote.payload?.effectiveDate || null,
          reasons: allReferralReasons,
          authorityOverrideRequired: authorityReasons.length > 0,
          createdBy: normalizedActorId,
        },
        { id: normalizedActorId, username: updatedBy, roles: actor?.roles, permissions: actor?.permissions },
        overrideReason
      )
    )

    if (gate.blocked) {
      throw new BadRequestError(
        'UW_REFERRAL_REQUIRED',
        `This transaction requires underwriter approval before bind. Referral ${gate.referral.referralId} is open.`
      )
    }
    referralId = gate.referral.referralId
  }

  // ── 4. OFAC screening ───────────────────────────────────────────────────────
  if (insuredDisplayName) {
    try {
      const ofacResult = await withTenantTx(tenantId, (innerDb) =>
        screenOfac(toRawQuery(innerDb), tenantId, insuredDisplayName, { quoteId })
      )
      if (ofacResult.result === 'CONFIRMED_HIT') {
        throw new ValidationError('OFAC_BLOCKED', {
          message: 'Bind blocked: OFAC confirmed match. Contact compliance.',
          screenId: ofacResult.screenId,
        })
      }
      if (ofacResult.result === 'POTENTIAL_HIT') {
        throw new ValidationError('OFAC_REVIEW_REQUIRED', {
          message:
            'Bind held for OFAC review: potential SDN match detected. Contact compliance to clear.',
          screenId: ofacResult.screenId,
          matches: (ofacResult as any).matchDetails,
        })
      }
    } catch (err: any) {
      // Re-throw domain errors; swallow OFAC-table-not-found errors
      if (err?.code && typeof err.statusCode === 'number') throw err
    }
  }

  // ── 5. ID / number generation ───────────────────────────────────────────────
  const policyId = uuidv4()
  let policyNumber = ''
  const productCode = quote.payload?.productCode || 'unknown'
  const effectiveDate =
    quote.payload?.effectiveDate || new Date().toISOString().slice(0, 10)
  const months = Number(quote.payload?.termMonths || 12)
  const expirationDate = addMonths(effectiveDate, months)
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const transactionNumber = generateTransactionNumber('NB-')
  const currency = quote.premium?.total?.currency || 'USD'
  const nowIso = new Date().toISOString()
  const policyNumberFormats = await loadPolicyNumberFormats(tenantId)

  // ── 6. Term / premium / risk data structures ────────────────────────────────
  const termType =
    quote.payload?.termType || (months === 12 ? 'Annual' : `${months}Month`)
  const lifecycle = {
    createdAt: nowIso,
    createdBy: updatedBy,
    boundAt: nowIso,
  }
  const premiumSummary = quote.premium
    ? {
        total: quote.premium.total || null,
        fees: quote.premium.fees || null,
        taxes: quote.premium.taxes || null,
        byCoverage: quote.premium.byCoverage || [],
      }
    : null
  const riskList = Array.isArray(quote.payload?.risks) ? quote.payload.risks : []
  const riskEntries: RiskEntry[] = riskList.map((risk: any) => ({
    id: uuidv4(),
    kind: mapRiskKind(quote.payload?.productCode, risk),
    attributes: risk,
  }))
  const riskSummary = riskEntries.length
    ? {
        risks: riskEntries.map((r) => ({
          kind: r.kind,
          summary: summarizeRisk(r.attributes),
        })),
      }
    : null

  // ── 7. Customer link extraction (quoteCustomerLinks/primaryCustomerLink were
  //      hoisted to §3 above so the Task B internal-consistency check could
  //      reuse them) ───────────────────────────────────────────────────────
  const transactionMetadata: any = {
    sourceQuoteId: quoteId,
    transactionNumber,
    ...(quote.payload?.governanceLineage
      ? { governanceLineage: quote.payload.governanceLineage }
      : {}),
    ...(referralId ? { uwReferralId: referralId } : {}),
    authority: {
      configured: authority.configured,
      grantId: authority.grantId,
      authorized: authority.authorized,
      reasons: authority.reasons,
    },
    aggregation: {
      configured: aggregationEvaluation.configured,
      exceeded: aggregationEvaluation.exceeded,
      reasons: aggregationEvaluation.reasons,
    },
    ...(internalConsistency.discrepancy
      ? { internalConsistencyReason: internalConsistency.reason }
      : {}),
    ...(externalVerificationReasons.length
      ? { externalVerificationReasons }
      : {}),
    ...(primaryCustomerLink?.customerId
      ? { customerId: primaryCustomerLink.customerId }
      : {}),
    ...(primaryCustomerLink?.customerKey
      ? { customerKey: primaryCustomerLink.customerKey }
      : {}),
    ...(primaryCustomerLink?.displayName
      ? { customerName: primaryCustomerLink.displayName }
      : {}),
  }
  const coverages = Array.isArray(quote.payload?.coverages)
    ? quote.payload.coverages
    : []
  const defaultRiskRef = riskEntries.length === 1 ? riskEntries[0].id : null
  const jurisdiction =
    quote.payload?.jurisdiction ||
    (quote.payload?.state ? { code: quote.payload.state } : null)
  const uwDecision = quote.uw?.decision || null
  const uwOverride = allReferralReasons.length > 0 && !!referralId
  const termDetails: any = { effectiveDate, expirationDate, termMonths: months }
  let documentPacket: PolicyDocumentPacket = { forms: [], documents: [] }

  // ── 8. Big transaction block ────────────────────────────────────────────────
  await withTenantTx(tenantId, async (txDb) => {
    const q = toRawQuery(txDb)

    // Policy number generation
    policyNumber = await generatePolicyNumber({
      policyId,
      productCode,
      formatsByProduct: policyNumberFormats,
      isUnique: async (candidate: string) => {
        const existing = await q(
          'SELECT 1 FROM policies WHERE tenant_id=$1 AND policy_number=$2 LIMIT 1',
          [tenantId, candidate]
        )
        return !((existing as any).rowCount > 0)
      },
    })

    // Insert policy projection
    await insertPolicyProjection(txDb, {
      tenantId,
      policyId,
      policyNumber,
      productCode,
      productVersion: quote.payload?.productVersion || null,
      status: 'Bound',
      termEffectiveDate: effectiveDate,
      termExpirationDate: expirationDate,
      termType,
      currencyCode: currency,
      premiumSummary,
      riskSummary,
      lifecycle,
      externalIds: quote.payload?.externalIds || null,
      metadata: transactionMetadata,
    })

    // Customer links
    await upsertPolicyCustomerLinks(txDb, tenantId, policyId, quoteCustomerLinks)

    // Policy transaction
    documentPacket = await buildPolicyDocumentPacket(q, {
      tenantId,
      policyId,
      policyNumber,
      transactionId,
      transactionType: 'NB',
      transactionNumber,
      productCode,
      state: quote.payload?.state || jurisdiction?.code || null,
      effectiveDate,
      versionId,
      generatedAt: nowIso,
      inputSnapshot: quote.payload,
      generatedBy: normalizedActorId,
      correlationId: transactionNumber,
    })

    await insertPolicyTransaction(txDb, {
      tenantId,
      transactionId,
      policyId,
      type: 'NB',
      status: 'Bound',
      jurisdiction,
      term: termDetails,
      requestedChanges: [],
      snapshot: quote.payload,
      ratingId,
      uw: quote.uw || null,
      notes: [],
      forms: documentPacket.forms,
      documents: documentPacket.documents,
      createdBy: normalizedActorId,
      metadata: transactionMetadata,
    })

    // Policy version
    await insertPolicyVersion(txDb, {
      tenantId,
      policyId,
      versionId,
      transactionId,
      effectiveDate,
      transactionType: 'Issue',
      premiumTotal: safeMoney(quote.premium?.total?.amount),
      premiumFees: safeMoney(quote.premium?.fees?.amount),
      premiumTaxes: safeMoney(quote.premium?.taxes?.amount),
      currency,
      uwDecision,
      uwOverride,
      overrideReason: overrideReason || null,
      payload: quote.payload,
      transactionNumber,
    })

    if (referralId) {
      await q(
        'UPDATE underwriting_referrals SET policy_id=$1, transaction_id=$2, version_id=$3, updated_at=now() WHERE tenant_id=$4 AND referral_id=$5',
        [policyId, transactionId, versionId, tenantId, referralId]
      )
    }

    // Rating
    await insertRating(txDb, {
      tenantId,
      ratingId,
      policyId,
      transactionId,
      inputs: { payload: quote.payload, factors: quote.payload?.uwAnswers || {} },
      components: quote.premium?.byCoverage || [],
      discounts: quote.premium?.discounts || [],
      surcharges: quote.premium?.surcharges || [],
      taxes: quote.premium?.taxes || [],
      totalPremium: safeMoney(quote.premium?.total?.amount),
      currency,
      calcTrace: quote.premium?.calcTrace || null,
    })

    // Risk units
    await persistRiskUnits({
      q: txDb,
      tenantId,
      policyId,
      versionId,
      entries: riskEntries,
      productCode: quote.payload?.productCode,
      transactionId,
      effectiveDate,
      expirationDate,
      uwAnswers: quote.payload?.uwAnswers || null,
    })

    // Coverages
    if (coverages.length) {
      await persistCoverageRecords({
        q: txDb,
        tenantId,
        policyId,
        versionId,
        coverages,
        transactionId,
        effectiveDate,
        expirationDate,
        fallbackRiskRef: defaultRiskRef,
      })
    }

    // Generated policy packet metadata
    await persistPolicyDocumentPacket(txDb, {
      tenantId,
      policyId,
      policyNumber,
      transactionId,
      transactionType: 'NB',
      transactionNumber,
      productCode,
      state: quote.payload?.state || jurisdiction?.code || null,
      effectiveDate,
      generatedBy: normalizedActorId,
      correlationId: transactionNumber,
    }, documentPacket)

    // Ledger event
    await q(
      'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        tenantId,
        'Policy',
        policyId,
        'STATUS_CHANGE',
        'Quote',
        'Bound',
        { transactionId, quoteId },
        normalizedActorId,
      ]
    )

    await createCommissionHandoffEvent(txDb, {
      tenantId,
      policyId,
      policyNumber,
      transactionId,
      transactionNumber,
      transactionType: 'QuoteBind',
      sourceEvent: 'QUOTE_BOUND',
      effectiveDate,
      expirationDate,
      processedAt: nowIso,
      productCode,
      state: quote.payload?.state || jurisdiction?.code || null,
      premiumImpact: safeMoney(quote.premium?.total?.amount),
      currency,
      payload: quote.payload,
      policyMetadata: transactionMetadata,
      actorId: normalizedActorId,
      correlationId: transactionNumber,
    })

    await computePlacementForTransactionSafely(txDb, tenantId, policyId, transactionId)

    // Update quote status to Converted
    const quoteUpdatedAt = new Date().toISOString()
    const quoteStatusHistory = upsertQuoteAuditHistory(
      existingStatusHistory,
      'Converted',
      quoteUpdatedAt,
      updatedBy
    )
    const quoteStepHistory = upsertQuoteAuditHistory(
      existingStepHistory,
      5,
      quoteUpdatedAt,
      updatedBy
    )
    await q(
      'UPDATE quotes SET status=$1, progress_step=$2, converted_policy_id=$3, updated_at=$4, updated_by=$5, status_history=$6, step_history=$7 WHERE tenant_id=$8 AND quote_id=$9',
      [
        'Converted',
        5,
        policyId,
        quoteUpdatedAt,
        updatedBy,
        JSON.stringify(quoteStatusHistory),
        JSON.stringify(quoteStepHistory),
        tenantId,
        quoteId,
      ]
    )
  })

  return {
    policyId,
    policyNumber,
    status: 'Bound',
    transactionId,
    versionId,
    ratingId,
    effectiveDate,
    expirationDate,
    premiumSummary,
    riskSummary,
  }
}
