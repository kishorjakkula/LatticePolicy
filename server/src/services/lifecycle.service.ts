import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { NotFoundError, BadRequestError, ConflictError } from '../errors/domain.errors.js'
import {
  insertPolicyTransaction,
  insertPolicyVersion,
  insertRating,
  persistRiskUnits,
  persistCoverageRecords,
  loadPolicyContext,
  updatePolicyProjection,
  safeMoney,
  type RiskEntry,
} from '../persistence.js'
import {
  getCancellationReasonCode,
  loadShortRateTable,
  computeReturnPremium,
} from '../policyCompliance.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { today, coerceDateOnly, asDateOnly, addMonths, diffMonths, round2, proRataFactor } from '../lib/date.utils.js'
import { validatePolicyTransactionState, type PolicyTransactionAction } from '../lib/transaction-state.js'
import { createPolicyNotificationIntent } from './notification.service.js'
import { createCommissionHandoffEvent } from './commission-handoff.service.js'
import { computePlacementForTransactionSafely } from './reinsurance.service.js'
import {
  buildPolicyDocumentPacket,
  persistPolicyDocumentPacket,
} from './document-generation.service.js'
import { resolveReferralGateForActor } from './uw-referral.service.js'
import {
  deriveTimelineSegments,
  findTimelineStateAtDate,
  findRebasedTransactions,
  computeRetroResult,
  type TimelineVersionInput,
} from '../policyTimeline.js'
import {
  loadPolicyTimelineVersions,
  loadCurrentTimelineVersion,
  nextPolicyTransactionSequence,
  persistPolicyTimelineSegments,
} from './endorsement.service.js'

// ── Out-of-sequence helpers (shared by cancel/reinstate) ───────────────────────

/**
 * Detect whether an effective date lands before an already-processed later
 * transaction, and if so, compute the corrected historical premium basis and
 * the segment set that must be persisted so `getPolicyState` (asOf) stays
 * correct. Mirrors the same rebase detection endorsement.service.ts performs,
 * so cancellation/reinstatement interact correctly with existing/later
 * transactions the same way endorsements do (issue #52).
 */
async function computeOutOfSequenceContext(params: {
  q: ReturnType<typeof toRawQuery>
  tenantId: string
  policyId: string
  termEffective: string
  termExpiration: string
  eff: string
  currentFullPremium: number
}) {
  const { q, tenantId, policyId, termEffective, termExpiration, eff, currentFullPremium } = params
  const timelineVersionsBefore = await loadPolicyTimelineVersions(q, tenantId, policyId)
  const rebasedTransactions = findRebasedTransactions(timelineVersionsBefore, eff)
  const isOutOfSequence = rebasedTransactions.length > 0
  const oldSegments = deriveTimelineSegments({
    tenantId,
    versions: timelineVersionsBefore,
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  let effectiveFullPremium = currentFullPremium
  if (isOutOfSequence) {
    const stateAtEffective = findTimelineStateAtDate(oldSegments, eff)
    if (stateAtEffective) effectiveFullPremium = stateAtEffective.premiumTotal
  }
  return { timelineVersionsBefore, rebasedTransactions, isOutOfSequence, oldSegments, effectiveFullPremium }
}

async function nextTimelineVersion(q: ReturnType<typeof toRawQuery>, tenantId: string, policyId: string) {
  const baseTimelineVersion = await loadCurrentTimelineVersion(q, tenantId, policyId)
  return { baseTimelineVersion, timelineVersion: baseTimelineVersion + 1 }
}

/**
 * Pure computation only — does not write to the database. The caller must
 * persist `newSegments` via `persistPolicyTimelineSegments` AFTER the new
 * transaction's `policy_versions` row has been inserted, since segment rows
 * carry a foreign key to `policy_versions.version_id`.
 */
function computeNewSegmentsAndRetro(params: {
  tenantId: string
  termEffective: string
  termExpiration: string
  timelineVersionsBefore: TimelineVersionInput[]
  oldSegments: ReturnType<typeof deriveTimelineSegments>
  newTimelineVersion: TimelineVersionInput
  eff: string
}) {
  const { tenantId, termEffective, termExpiration, timelineVersionsBefore, oldSegments, newTimelineVersion, eff } = params
  const newSegments = deriveTimelineSegments({
    tenantId,
    versions: [...timelineVersionsBefore, newTimelineVersion],
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  const retroAdjustment = computeRetroResult({
    oldSegments,
    newSegments,
    fromDate: eff,
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  return { newSegments, retroAdjustment }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function simplePremium(amount: number) {
  return {
    byCoverage: [],
    fees: { amount: 0, currency: 'USD' },
    taxes: { amount: 0, currency: 'USD' },
    total: { amount: round2(amount), currency: 'USD' },
  }
}

function toArray(value: any): any[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function policyField(row: any, camelKey: string, snakeKey: string): any {
  return row?.[camelKey] ?? row?.[snakeKey]
}

function policyTermEffective(row: any): string {
  return coerceDateOnly(policyField(row, 'termEffectiveDate', 'term_effective_date'))
}

function policyTermExpiration(row: any): string {
  return coerceDateOnly(policyField(row, 'termExpirationDate', 'term_expiration_date'))
}

function policyProductCode(row: any): string {
  return String(policyField(row, 'productCode', 'product_code') || '')
}

function policyCurrencyCode(row: any): string {
  return String(policyField(row, 'currencyCode', 'currency_code') || 'USD')
}

function policyPremiumSummary(row: any): any {
  return policyField(row, 'premiumSummary', 'premium_summary')
}

function policyRiskSummary(row: any): any {
  return policyField(row, 'riskSummary', 'risk_summary')
}

function policyTermType(row: any): string | null {
  return policyField(row, 'termType', 'term_type') || null
}

type TransactionNumberMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

function transactionNumberPrefix(mode: TransactionNumberMode): string {
  if (mode === 'cancel') return 'CN-'
  if (mode === 'reinstate') return 'RI-'
  if (mode === 'rewrite') return 'RW-'
  if (mode === 'renew') return 'RN-'
  return 'EN-'
}

function generateTransactionNumber(prefix = 'EN-'): string {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${prefix}${stamp}-${rand}`
}

function reserveTransactionNumber(mode: TransactionNumberMode): string {
  return generateTransactionNumber(transactionNumberPrefix(mode))
}

function assertPolicyTransactionState(action: PolicyTransactionAction, status: unknown): void {
  const result = validatePolicyTransactionState(action, status)
  if (!result.ok) throw new BadRequestError(result.code, result.message)
}

async function loadLatestPolicyPayload(q: ReturnType<typeof toRawQuery>, tenantId: string, policyId: string): Promise<any> {
  const res = await q(
    `SELECT payload
       FROM policy_versions
      WHERE tenant_id = $1 AND policy_id = $2
      ORDER BY processed_at DESC, effective_date DESC
      LIMIT 1`,
    [tenantId, policyId]
  )
  return res.rowCount ? res.rows[0].payload || null : null
}

function mapRiskKind(productCode: string | undefined, risk: any): string {
  const type = (risk?.type || '').toString()
  if (!productCode) return type || 'Unknown'
  const normalized = productCode.toLowerCase()
  if (normalized === 'personal-auto') {
    if (type === 'autoVehicle') return 'PA.Vehicle'
    if (type === 'driver') return 'PA.Driver'
  }
  if (normalized === 'commercial-auto') {
    if (type === 'commercialAutoFleet') return 'CA.Fleet'
    if (type === 'commercialAutoVehicle') return 'CA.Vehicle'
    if (type === 'driverSchedule') return 'CA.DriverSchedule'
  }
  if (normalized === 'homeowners') {
    if (type === 'dwelling') return 'HO.Dwelling'
    if (type === 'otherStructure') return 'HO.OtherStructure'
    if (type === 'personalProperty') return 'HO.PersonalProperty'
    if (type === 'liability') return 'HO.LiabilityExposure'
  }
  if (normalized === 'cyber') {
    if (type === 'cyberProfile') return 'CYBER.Profile'
    if (type === 'thirdParty') return 'CYBER.ThirdParty'
    if (type === 'firstParty') return 'CYBER.FirstParty'
  }
  if (normalized === 'professional-liability') {
    if (type === 'professionalLiabilityProfile') return 'PL.Profile'
    if (type === 'clientContract') return 'PL.ClientContract'
  }
  return `${normalized.toUpperCase()}.${type || 'UNKNOWN'}`
}

function summarizeRisk(risk: any): string {
  if (!risk || typeof risk !== 'object') return ''
  if (risk.type === 'autoVehicle') {
    const parts = [risk.year, risk.make, risk.model].filter(Boolean)
    return parts.join(' ').trim()
  }
  if (risk.type === 'commercialAutoFleet') {
    const parts = [
      risk.businessName,
      risk.vehicleCount ? `${risk.vehicleCount} vehicles` : '',
      risk.useClass,
      risk.radiusClass,
    ].filter(Boolean)
    return parts.join(', ').trim()
  }
  if (risk.type === 'dwelling') {
    const parts = [risk.address, risk.construction, risk.yearBuilt].filter(Boolean)
    return parts.join(', ').trim()
  }
  if (risk.type === 'cyberProfile') {
    const parts = [risk.industry, risk.domain, risk.employeeCount ? `${risk.employeeCount} employees` : ''].filter(Boolean)
    return parts.join(', ').trim()
  }
  if (risk.type === 'professionalLiabilityProfile') {
    const parts = [
      risk.industry,
      risk.yearsInBusiness ? `${risk.yearsInBusiness} yrs in business` : '',
      risk.employeeCount ? `${risk.employeeCount} employees` : '',
    ].filter(Boolean)
    return parts.join(', ').trim()
  }
  return risk.type || 'risk'
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Issue a policy (transition to Issued status, DB path only).
 * Covers routes.ts lines 1686-1743 (POST /policies/:id/issue).
 *
 * actor: { id?: string; username?: string }
 */
export async function issuePolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const policyRes: any = await q(
    `SELECT policy_id, policy_number, product_code, status, term_effective_date,
            term_expiration_date, currency_code, premium_summary, lifecycle, metadata
       FROM policies
      WHERE tenant_id=$1 AND policy_id=$2`,
    [tenantId, policyId]
  )
  if (!policyRes.rowCount) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = policyRes.rows[0]
  assertPolicyTransactionState('issue', policyRow.status)
  const issuedAt = new Date().toISOString()
  const lifecycle = {
    ...(policyRow.lifecycle || {}),
    issuedAt,
    updatedAt: issuedAt,
    updatedBy: actor?.username || actor?.id || 'system',
  }
  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    status: 'Issued',
    lifecycle,
  })
  await q(
    'UPDATE policy_transactions SET status=$1 WHERE tenant_id=$2 AND policy_id=$3 AND type=$4',
    ['Issued', tenantId, policyId, 'NB']
  )
  const txnRes = await q(
    `SELECT transaction_id, metadata
       FROM policy_transactions
      WHERE tenant_id = $1 AND policy_id = $2 AND type = 'NB'
      ORDER BY created_at DESC
      LIMIT 1`,
    [tenantId, policyId]
  )
  const issueTransactionId = txnRes.rowCount ? txnRes.rows[0].transaction_id : null
  const transactionNumber = txnRes.rowCount ? txnRes.rows[0].metadata?.transactionNumber || null : null
  const payload = await loadLatestPolicyPayload(q, tenantId, policyId)
  await createPolicyNotificationIntent(db, {
    tenantId,
    policyId,
    policyNumber: policyRow.policy_number,
    productCode: policyRow.product_code,
    transactionId: issueTransactionId,
    transactionType: 'Issue',
    transactionNumber,
    eventType: 'POLICY_ISSUED',
    effectiveDate: coerceDateOnly(policyRow.term_effective_date),
    expirationDate: coerceDateOnly(policyRow.term_expiration_date),
    payload,
    actorId: actor?.id || null,
    correlationId: transactionNumber || issueTransactionId,
  })
  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [tenantId, 'Policy', policyId, 'STATUS_CHANGE', policyRow.status, 'Issued', { issuedAt }, actor?.id || null]
  )
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyRow.policy_number,
    transactionId: issueTransactionId,
    transactionNumber,
    transactionType: 'Issue',
    sourceEvent: 'POLICY_ISSUED',
    effectiveDate: coerceDateOnly(policyRow.term_effective_date),
    expirationDate: coerceDateOnly(policyRow.term_expiration_date),
    processedAt: issuedAt,
    productCode: policyRow.product_code,
    state: payload?.state || payload?.jurisdiction?.code || null,
    premiumImpact: safeMoney(policyRow.premium_summary?.total?.amount),
    currency: policyRow.currency_code || policyRow.premium_summary?.total?.currency || 'USD',
    payload,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber || issueTransactionId,
  })
  return { policyId, policyNumber: policyRow.policy_number, status: 'Issued', issuedAt }
}

/**
 * Cancel a policy and persist all related records (DB path only).
 * Covers routes.ts lines 2982-3174 (POST /policies/:id/cancel).
 *
 * actor: { id?: string; username?: string }
 */
export async function cancelPolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  const cancellationReasonCode = typeof body?.cancellationReasonCode === 'string' ? body.cancellationReasonCode.trim() : ''
  const overridePayload = body?.payload && typeof body.payload === 'object' ? body.payload : null
  const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  assertPolicyTransactionState('cancel', policyRow.status)
  const eff = asDateOnly(body?.effectiveDate) || today()
  const termEffective = policyTermEffective(policyRow)
  const termExpiration = policyTermExpiration(policyRow)
  const txPayload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : (ctx.latestPayload && typeof ctx.latestPayload === 'object'
        ? JSON.parse(JSON.stringify(ctx.latestPayload))
        : null)
  const fullPremium = safeMoney(policyPremiumSummary(policyRow)?.total?.amount)

  // Detect whether this cancellation lands before an already-processed later
  // transaction and, if so, correct the refund/earned-premium basis using the
  // premium that was actually in effect on `eff` (issue #52).
  const oos = await computeOutOfSequenceContext({
    q, tenantId, policyId, termEffective, termExpiration, eff, currentFullPremium: fullPremium,
  })
  const effectiveFullPremium = oos.effectiveFullPremium

  let returnPremiumResult = { returnPremium: 0, earnedPremium: effectiveFullPremium, method: 'PRO_RATA' }
  let resolvedCancellationType = 'PRO_RATA'
  let resolvedReasonDescription = reason || ''

  if (cancellationReasonCode) {
    const reasonRow = await getCancellationReasonCode(q, cancellationReasonCode)
    if (reasonRow) {
      resolvedCancellationType = reasonRow.cancellation_type
      resolvedReasonDescription = reasonRow.description

      let shortRateTable: any[] = []
      if (reasonRow.return_premium === 'SHORT_RATE') {
        shortRateTable = await loadShortRateTable(q, tenantId, policyProductCode(policyRow), txPayload?.state || '')
      }

      returnPremiumResult = computeReturnPremium({
        returnPremiumMethod: reasonRow.return_premium as any,
        fullPremium: effectiveFullPremium,
        cancelDate: eff,
        termEffectiveDate: termEffective,
        termExpirationDate: termExpiration,
        shortRateTable,
      })
    }
  }

  if (!cancellationReasonCode || returnPremiumResult.returnPremium === 0) {
    const factor = proRataFactor(eff, termEffective, termExpiration)
    const proRataRefund = round2(effectiveFullPremium * factor)
    if (returnPremiumResult.returnPremium === 0 && proRataRefund > 0) {
      returnPremiumResult = { returnPremium: proRataRefund, earnedPremium: round2(effectiveFullPremium - proRataRefund), method: 'PRO_RATA' }
    }
  }

  const refund = returnPremiumResult.returnPremium
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const currency = policyCurrencyCode(policyRow)
  const processedAt = new Date().toISOString()
  const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('cancel')
  const version: any = {
    versionId,
    effectiveDate: eff,
    processedDate: processedAt,
    transactionType: 'Cancel',
    transactionNumber,
    premium: simplePremium(-refund),
  }

  const sequenceNo = await nextPolicyTransactionSequence(q, tenantId, policyId)
  const { baseTimelineVersion, timelineVersion } = await nextTimelineVersion(q, tenantId, policyId)
  const newCancelTimelineVersion: TimelineVersionInput = {
    versionId, transactionId, transactionType: 'Cancel', transactionNumber,
    effectiveDate: eff, processedAt, payload: txPayload,
  }
  const { newSegments, retroAdjustment } = computeNewSegmentsAndRetro({
    tenantId, termEffective, termExpiration,
    timelineVersionsBefore: oos.timelineVersionsBefore,
    oldSegments: oos.oldSegments,
    newTimelineVersion: newCancelTimelineVersion,
    eff,
  })

  const documentPacket = await buildPolicyDocumentPacket(q, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Cancel',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    effectiveDate: eff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  })

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'Cancel',
    status: 'Issued',
    jurisdiction: txPayload?.jurisdiction || (txPayload?.state ? { code: txPayload.state } : null),
    term: { effectiveDate: termEffective, expirationDate: termExpiration, cancelDate: eff },
    requestedChanges: [],
    snapshot: txPayload || null,
    ratingId,
    uw: null,
    notes: [],
    forms: documentPacket.forms,
    documents: documentPacket.documents,
    createdBy: actor?.id || null,
    effectiveDate: eff,
    processedAt,
    sequenceNo,
    baseTimelineVersion,
    timelineVersion,
    metadata: {
      reason: resolvedReasonDescription || reason || null,
      refund,
      cancellationReasonCode: cancellationReasonCode || null,
      cancellationType: resolvedCancellationType,
      returnPremiumMethod: returnPremiumResult.method,
      transactionNumber,
      outOfSequence: oos.isOutOfSequence,
      rebasedTransactions: oos.rebasedTransactions,
      retroAdjustment,
    },
  })

  await persistPolicyDocumentPacket(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Cancel',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    effectiveDate: eff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  }, documentPacket)

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: eff,
    transactionType: 'Cancel',
    premiumTotal: -refund,
    premiumFees: 0,
    premiumTaxes: 0,
    currency,
    payload: txPayload || null,
    transactionNumber,
    baseTimelineVersion,
    timelineVersion,
  })

  await persistPolicyTimelineSegments(q, tenantId, policyId, timelineVersion, newSegments)

  if (cancellationReasonCode || resolvedCancellationType) {
    await q(
      `UPDATE policy_versions
          SET cancellation_reason_code = $1, cancellation_type = $2, return_premium_amount = $3
        WHERE tenant_id = $4 AND version_id = $5`,
      [cancellationReasonCode || null, resolvedCancellationType, refund, tenantId, versionId]
    ).catch(() => { /* non-fatal if columns not yet migrated */ })
  }

  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: { payload: txPayload || null },
    components: [],
    discounts: [],
    surcharges: [],
    taxes: [],
    totalPremium: -refund,
    currency,
  })

  await createPolicyNotificationIntent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    productCode: policyProductCode(policyRow),
    transactionId,
    transactionType: 'Cancel',
    transactionNumber,
    eventType: 'POLICY_CANCELLED',
    effectiveDate: eff,
    expirationDate: termExpiration,
    reason: resolvedReasonDescription || reason || cancellationReasonCode || null,
    premiumImpact: -refund,
    payload: txPayload || null,
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    status: 'Cancelled',
    lifecycle: {
      ...(policyRow.lifecycle || {}),
      cancelledAt: eff,
      updatedAt: processedAt,
      updatedBy: actor?.username || actor?.id || 'system',
    },
    metadata: {
      ...(policyRow.metadata || {}),
      lastTransactionId: transactionId,
      cancelledAt: eff,
      cancelReason: reason || null,
    },
  })

  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      tenantId,
      'Policy',
      policyId,
      'CANCELLED',
      policyRow.status,
      'Cancelled',
      { transactionId, refund, reason: reason || null, transactionNumber },
      actor?.id || null,
    ]
  )
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionNumber,
    transactionType: 'Cancel',
    sourceEvent: 'POLICY_CANCELLED',
    effectiveDate: eff,
    expirationDate: termExpiration,
    processedAt,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    premiumImpact: -refund,
    currency,
    payload: txPayload || null,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  return version
}

/**
 * Reinstate a cancelled policy and persist all related records (DB path only).
 * Covers routes.ts lines 3176-3322 (POST /policies/:id/reinstate).
 *
 * actor: { id?: string; username?: string }
 */
export async function reinstatePolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const overridePayload = body?.payload && typeof body.payload === 'object' ? body.payload : null
  const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  assertPolicyTransactionState('reinstate', policyRow.status)
  const eff = asDateOnly(body?.effectiveDate) || today()
  const termEffective = policyTermEffective(policyRow)
  const termExpiration = policyTermExpiration(policyRow)
  const txPayload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : (ctx.latestPayload && typeof ctx.latestPayload === 'object'
        ? JSON.parse(JSON.stringify(ctx.latestPayload))
        : null)
  const fullPremium = safeMoney(policyPremiumSummary(policyRow)?.total?.amount)

  // Detect whether this reinstatement lands before an already-processed later
  // transaction and, if so, correct the reinstatement charge basis using the
  // premium that was actually in effect on `eff` (issue #52).
  const oos = await computeOutOfSequenceContext({
    q, tenantId, policyId, termEffective, termExpiration, eff, currentFullPremium: fullPremium,
  })
  const effectiveFullPremium = oos.effectiveFullPremium

  const factor = proRataFactor(eff, termEffective, termExpiration)
  const reinstatementCharge = round2(effectiveFullPremium * factor)
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const currency = policyCurrencyCode(policyRow)
  const processedAt = new Date().toISOString()
  const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('reinstate')
  const version: any = {
    versionId,
    effectiveDate: eff,
    processedDate: processedAt,
    transactionType: 'Reinstate',
    transactionNumber,
    premium: simplePremium(reinstatementCharge),
  }

  const sequenceNo = await nextPolicyTransactionSequence(q, tenantId, policyId)
  const { baseTimelineVersion, timelineVersion } = await nextTimelineVersion(q, tenantId, policyId)
  const newReinstateTimelineVersion: TimelineVersionInput = {
    versionId, transactionId, transactionType: 'Reinstate', transactionNumber,
    effectiveDate: eff, processedAt, payload: txPayload,
  }
  const { newSegments, retroAdjustment } = computeNewSegmentsAndRetro({
    tenantId, termEffective, termExpiration,
    timelineVersionsBefore: oos.timelineVersionsBefore,
    oldSegments: oos.oldSegments,
    newTimelineVersion: newReinstateTimelineVersion,
    eff,
  })

  const documentPacket = await buildPolicyDocumentPacket(q, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Reinstate',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    effectiveDate: eff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  })

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'Reinstate',
    status: 'Issued',
    jurisdiction: txPayload?.jurisdiction || (txPayload?.state ? { code: txPayload.state } : null),
    term: { effectiveDate: termEffective, expirationDate: termExpiration, reinstateDate: eff },
    requestedChanges: [],
    snapshot: txPayload || null,
    ratingId,
    uw: null,
    notes: [],
    forms: documentPacket.forms,
    documents: documentPacket.documents,
    createdBy: actor?.id || null,
    effectiveDate: eff,
    processedAt,
    sequenceNo,
    baseTimelineVersion,
    timelineVersion,
    metadata: {
      reinstateDate: eff,
      transactionNumber,
      reinstatementCharge,
      outOfSequence: oos.isOutOfSequence,
      rebasedTransactions: oos.rebasedTransactions,
      retroAdjustment,
    },
  })

  await persistPolicyDocumentPacket(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Reinstate',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    effectiveDate: eff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  }, documentPacket)

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: eff,
    transactionType: 'Reinstate',
    premiumTotal: reinstatementCharge,
    premiumFees: 0,
    premiumTaxes: 0,
    currency,
    payload: txPayload || null,
    transactionNumber,
    baseTimelineVersion,
    timelineVersion,
  })

  await persistPolicyTimelineSegments(q, tenantId, policyId, timelineVersion, newSegments)

  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: { payload: txPayload || null },
    components: [],
    discounts: [],
    surcharges: [],
    taxes: [],
    totalPremium: reinstatementCharge,
    currency,
  })

  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    status: 'Issued',
    lifecycle: {
      ...(policyRow.lifecycle || {}),
      reinstatedAt: eff,
      updatedAt: processedAt,
      updatedBy: actor?.username || actor?.id || 'system',
      cancelledAt: null,
    },
    metadata: {
      ...(policyRow.metadata || {}),
      lastTransactionId: transactionId,
      cancelledAt: null,
      reinstateDate: eff,
    },
  })

  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      tenantId,
      'Policy',
      policyId,
      'REINSTATED',
      policyRow.status,
      'Issued',
      { transactionId, effectiveDate: eff, transactionNumber, reinstatementCharge },
      actor?.id || null,
    ]
  )
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionNumber,
    transactionType: 'Reinstate',
    sourceEvent: 'POLICY_REINSTATED',
    effectiveDate: eff,
    expirationDate: termExpiration,
    processedAt,
    productCode: policyProductCode(policyRow),
    state: txPayload?.state || txPayload?.jurisdiction?.code || null,
    premiumImpact: reinstatementCharge,
    currency,
    payload: txPayload || null,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  return version
}

/**
 * Renew a policy and persist all related records (DB path only).
 * Covers routes.ts lines 3570-3801 (POST /policies/:id/renew).
 *
 * actor: { id?: string; username?: string; roles?: string[]; permissions?: string[] }
 */
export async function renewPolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const overrideReason = body && typeof body.overrideReason === 'string' ? body.overrideReason.trim() : ''
  const overridePayload = body?.payload && typeof body.payload === 'object' ? body.payload : null
  const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
  const overrideEffectiveDate = asDateOnly(body?.effectiveDate)

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  assertPolicyTransactionState('renew', policyRow.status)
  const termMonths = diffMonths(policyTermEffective(policyRow), policyTermExpiration(policyRow)) || 12
  const nextEff = overrideEffectiveDate || policyTermExpiration(policyRow)
  const nextExp = addMonths(nextEff, termMonths)
  const prevPayload = ctx.latestPayload && typeof ctx.latestPayload === 'object' ? ctx.latestPayload : {}
  const payload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : JSON.parse(JSON.stringify(prevPayload || {}))
  payload.effectiveDate = nextEff
  payload.termMonths = termMonths
  payload.productCode = payload.productCode || policyProductCode(policyRow)
  const prem = rate(tenantId, payload)
  const uw = evaluateUW(tenantId, payload)
  if (uw.decision === 'Decline') {
    throw new BadRequestError('UW_DECLINED', `Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ')}`)
  }
  let referralId: string | null = null
  if (uw.decision === 'Refer') {
    const gate = await resolveReferralGateForActor(
      db,
      tenantId,
      {
        policyId,
        transactionType: 'Renew',
        productCode: policyProductCode(policyRow),
        insuredName: payload?.insureds?.primary
          ? `${payload.insureds.primary.firstName || ''} ${payload.insureds.primary.lastName || ''}`.trim()
          : null,
        effectiveDate: nextEff,
        reasons: uw.reasons || [],
        createdBy: actor?.id || null,
      },
      actor,
      overrideReason
    )
    if (gate.blocked) {
      throw new BadRequestError(
        'UW_REFERRAL_REQUIRED',
        `Underwriting decision is Refer. Referral ${gate.referral.referralId} requires underwriter approval before this transaction can proceed.`
      )
    }
    referralId = gate.referral.referralId
  }
  const uwOverride = uw.decision === 'Refer' && !!referralId
  const submittedBy = !uwOverride && uw.decision === 'Refer' ? (actor?.username || null) : null
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const currency = policyCurrencyCode(policyRow)
  const processedAt = new Date().toISOString()
  const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('renew')
  const version: any = {
    versionId,
    effectiveDate: nextEff,
    processedDate: processedAt,
    transactionType: 'Renew',
    transactionNumber,
    premium: prem,
    meta: {
      uwDecision: uw,
      uwOverride,
      uwReferralId: referralId || undefined,
      submittedBy: submittedBy || undefined,
      transactionNumber,
    },
  }
  const riskList = Array.isArray(payload?.risks) ? payload.risks : []
  const riskEntries: RiskEntry[] = riskList.map((risk: any) => ({
    id: uuidv4(),
    kind: mapRiskKind(policyProductCode(policyRow), risk),
    attributes: risk,
  }))
  const riskSummary = riskEntries.length
    ? { risks: riskEntries.map((r: RiskEntry) => ({ kind: r.kind, summary: summarizeRisk(r.attributes) })) }
    : policyRiskSummary(policyRow) || null
  const premiumSummary = prem
    ? {
        total: (prem as any).total || { amount: safeMoney((prem as any)?.total?.amount), currency },
        fees: (prem as any).fees || null,
        taxes: (prem as any).taxes || null,
        byCoverage: (prem as any).byCoverage || [],
      }
    : policyPremiumSummary(policyRow)
  const lifecycle = {
    ...(policyRow.lifecycle || {}),
    renewedAt: processedAt,
    updatedAt: processedAt,
    updatedBy: actor?.username || actor?.id || 'system',
  }
  const metadata = {
    ...(policyRow.metadata || {}),
    lastTransactionId: transactionId,
    lastRenewalEffective: nextEff,
  }
  const trace = submittedBy ? { uw: { submittedBy, submittedAt: processedAt } } : null

  const documentPacket = await buildPolicyDocumentPacket(q, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Renew',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    effectiveDate: nextEff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  })

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'Renew',
    status: 'Issued',
    jurisdiction: payload?.jurisdiction || null,
    term: { effectiveDate: nextEff, expirationDate: nextExp, termMonths },
    requestedChanges: [],
    snapshot: payload,
    ratingId,
    uw,
    notes: [],
    forms: documentPacket.forms,
    documents: documentPacket.documents,
    createdBy: actor?.id || null,
    metadata: {
      renewal: true,
      uwReferralId: referralId || null,
      submittedBy,
      transactionNumber,
    },
  })

  await persistPolicyDocumentPacket(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Renew',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    effectiveDate: nextEff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  }, documentPacket)

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: nextEff,
    transactionType: 'Renew',
    premiumTotal: safeMoney((prem as any)?.total?.amount),
    premiumFees: safeMoney((prem as any)?.fees?.amount),
    premiumTaxes: safeMoney((prem as any)?.taxes?.amount),
    currency,
    uwDecision: uw.decision,
    uwOverride,
    overrideReason: null,
    calcTrace: trace,
    payload,
    transactionNumber,
  })

  if (referralId) {
    await q(
      'UPDATE underwriting_referrals SET transaction_id=$1, version_id=$2, updated_at=now() WHERE tenant_id=$3 AND referral_id=$4',
      [transactionId, versionId, tenantId, referralId]
    )
  }

  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: { payload, factors: payload?.uwAnswers || {} },
    components: Array.isArray((prem as any)?.byCoverage) ? (prem as any).byCoverage : [],
    discounts: toArray((prem as any)?.discounts),
    surcharges: toArray((prem as any)?.surcharges),
    taxes: toArray((prem as any)?.taxes),
    totalPremium: safeMoney((prem as any)?.total?.amount),
    currency,
    calcTrace: (prem as any)?.calcTrace || null,
  })

  await persistRiskUnits({
    q: db,
    tenantId,
    policyId,
    versionId,
    entries: riskEntries,
    productCode: policyProductCode(policyRow),
    transactionId,
    effectiveDate: nextEff,
    expirationDate: nextExp,
    uwAnswers: payload?.uwAnswers || null,
  })

  const coveragesArr = Array.isArray(payload?.coverages) ? payload.coverages : []
  const defaultRiskRef = riskEntries.length === 1 ? riskEntries[0].id : null
  if (coveragesArr.length) {
    await persistCoverageRecords({
      q: db,
      tenantId,
      policyId,
      versionId,
      coverages: coveragesArr,
      transactionId,
      effectiveDate: nextEff,
      expirationDate: nextExp,
      fallbackRiskRef: defaultRiskRef,
    })
  }

  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    premiumSummary,
    riskSummary,
    lifecycle,
    metadata,
    termEffectiveDate: nextEff,
    termExpirationDate: nextExp,
    termType: policyTermType(policyRow),
    currencyCode: currency,
  })

  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      tenantId,
      'Policy',
      policyId,
      'RENEWED',
      policyRow.status,
      policyRow.status,
      { transactionId, nextEffective: nextEff, transactionNumber },
      actor?.id || null,
    ]
  )
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionNumber,
    transactionType: 'Renew',
    sourceEvent: 'POLICY_RENEWED',
    effectiveDate: nextEff,
    expirationDate: nextExp,
    processedAt,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    premiumImpact: safeMoney((prem as any)?.total?.amount),
    currency,
    payload,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  await computePlacementForTransactionSafely(db, tenantId, policyId, transactionId)

  return version
}

/**
 * Rewrite a cancelled policy: re-rate, evaluate UW, persist all records (DB path only).
 * Extracted from the inline handler in transactions.routes.ts POST /policies/:id/rewrite.
 *
 * actor: { id?: string; username?: string; roles?: string[]; permissions?: string[] }
 */
export async function rewritePolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const overrideReason =
    body && typeof body.overrideReason === 'string' ? body.overrideReason.trim() : ''
  const overridePayload =
    body?.payload && typeof body.payload === 'object' ? body.payload : null
  const requestedTransactionNumber =
    typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
  const overrideEffectiveDate = asDateOnly(body?.effectiveDate)

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  assertPolicyTransactionState('rewrite', policyRow.status)

  const baseTermMonths =
    diffMonths(policyTermEffective(policyRow), policyTermExpiration(policyRow)) || 12
  const prevPayload =
    ctx.latestPayload && typeof ctx.latestPayload === 'object' ? ctx.latestPayload : {}
  const payload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : JSON.parse(JSON.stringify(prevPayload || {}))
  const termMonths = Number(payload?.termMonths || baseTermMonths || 12)
  const nextEff = overrideEffectiveDate || asDateOnly(payload?.effectiveDate) || today()
  const nextExp = addMonths(nextEff, termMonths)
  payload.effectiveDate = nextEff
  payload.termMonths = termMonths
  payload.productCode = payload.productCode || policyProductCode(policyRow)

  const prem = rate(tenantId, payload)
  const uw = evaluateUW(tenantId, payload)
  if (uw.decision === 'Decline') {
    throw new BadRequestError(
      'UW_DECLINED',
      `Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ')}`
    )
  }
  let referralId: string | null = null
  if (uw.decision === 'Refer') {
    const gate = await resolveReferralGateForActor(
      db,
      tenantId,
      {
        policyId,
        transactionType: 'Rewrite',
        productCode: policyProductCode(policyRow),
        insuredName: payload?.insureds?.primary
          ? `${payload.insureds.primary.firstName || ''} ${payload.insureds.primary.lastName || ''}`.trim()
          : null,
        effectiveDate: nextEff,
        reasons: uw.reasons || [],
        createdBy: actor?.id || null,
      },
      actor,
      overrideReason
    )
    if (gate.blocked) {
      throw new BadRequestError(
        'UW_REFERRAL_REQUIRED',
        `Underwriting decision is Refer. Referral ${gate.referral.referralId} requires underwriter approval before this transaction can proceed.`
      )
    }
    referralId = gate.referral.referralId
  }
  const uwOverride = uw.decision === 'Refer' && !!referralId
  const submittedBy = !uwOverride && uw.decision === 'Refer' ? (actor?.username || null) : null
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const currency = policyCurrencyCode(policyRow)
  const processedAt = new Date().toISOString()
  const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('rewrite')
  const version: any = {
    versionId,
    effectiveDate: nextEff,
    processedDate: processedAt,
    transactionType: 'Rewrite',
    transactionNumber,
    premium: prem,
    meta: {
      uwDecision: uw,
      uwOverride,
      uwReferralId: referralId || undefined,
      submittedBy: submittedBy || undefined,
      rewrite: true,
      transactionNumber,
    },
  }
  const riskList = Array.isArray(payload?.risks) ? payload.risks : []
  const riskEntries: RiskEntry[] = riskList.map((risk: any) => ({
    id: uuidv4(),
    kind: mapRiskKind(policyProductCode(policyRow), risk),
    attributes: risk,
  }))
  const riskSummary = riskEntries.length
    ? {
        risks: riskEntries.map((r: RiskEntry) => ({
          kind: r.kind,
          summary: summarizeRisk(r.attributes),
        })),
      }
    : policyRiskSummary(policyRow) || null
  const premiumSummary = prem
    ? {
        total: (prem as any).total || {
          amount: safeMoney((prem as any)?.total?.amount),
          currency,
        },
        fees: (prem as any).fees || null,
        taxes: (prem as any).taxes || null,
        byCoverage: (prem as any).byCoverage || [],
      }
    : policyPremiumSummary(policyRow)
  const lifecycle = {
    ...(policyRow.lifecycle || {}),
    rewrittenAt: processedAt,
    cancelledAt: null,
    updatedAt: processedAt,
    updatedBy: actor?.username || actor?.id || 'system',
  }
  const metadata = {
    ...(policyRow.metadata || {}),
    lastTransactionId: transactionId,
    rewriteEffective: nextEff,
    cancelledAt: null,
  }
  const trace = submittedBy ? { uw: { submittedBy, submittedAt: processedAt } } : null

  const documentPacket = await buildPolicyDocumentPacket(q, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Rewrite',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    effectiveDate: nextEff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  })

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'Rewrite',
    status: 'Issued',
    jurisdiction: payload?.jurisdiction || null,
    term: { effectiveDate: nextEff, expirationDate: nextExp, termMonths },
    requestedChanges: [],
    snapshot: payload,
    ratingId,
    uw,
    notes: [],
    forms: documentPacket.forms,
    documents: documentPacket.documents,
    createdBy: actor?.id || null,
    metadata: {
      rewrite: true,
      uwReferralId: referralId || null,
      submittedBy,
      transactionNumber,
    },
  })

  await persistPolicyDocumentPacket(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'Rewrite',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    effectiveDate: nextEff,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  }, documentPacket)

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: nextEff,
    transactionType: 'Rewrite',
    premiumTotal: safeMoney((prem as any)?.total?.amount),
    premiumFees: safeMoney((prem as any)?.fees?.amount),
    premiumTaxes: safeMoney((prem as any)?.taxes?.amount),
    currency,
    uwDecision: uw.decision,
    uwOverride,
    overrideReason: null,
    calcTrace: trace,
    payload,
    transactionNumber,
  })

  if (referralId) {
    await q(
      'UPDATE underwriting_referrals SET transaction_id=$1, version_id=$2, updated_at=now() WHERE tenant_id=$3 AND referral_id=$4',
      [transactionId, versionId, tenantId, referralId]
    )
  }

  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: { payload, factors: payload?.uwAnswers || {} },
    components: Array.isArray((prem as any)?.byCoverage) ? (prem as any).byCoverage : [],
    discounts: toArray((prem as any)?.discounts),
    surcharges: toArray((prem as any)?.surcharges),
    taxes: toArray((prem as any)?.taxes),
    totalPremium: safeMoney((prem as any)?.total?.amount),
    currency,
    calcTrace: (prem as any)?.calcTrace || null,
  })

  await persistRiskUnits({
    q: db,
    tenantId,
    policyId,
    versionId,
    entries: riskEntries,
    productCode: policyProductCode(policyRow),
    transactionId,
    effectiveDate: nextEff,
    expirationDate: nextExp,
    uwAnswers: payload?.uwAnswers || null,
  })

  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : []
  const defaultRiskRef = riskEntries.length === 1 ? riskEntries[0].id : null
  if (coverages.length) {
    await persistCoverageRecords({
      q: db,
      tenantId,
      policyId,
      versionId,
      coverages,
      transactionId,
      effectiveDate: nextEff,
      expirationDate: nextExp,
      fallbackRiskRef: defaultRiskRef,
    })
  }

  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    status: 'Issued',
    premiumSummary,
    riskSummary,
    lifecycle,
    metadata,
    termEffectiveDate: nextEff,
    termExpirationDate: nextExp,
    termType: policyTermType(policyRow),
    currencyCode: currency,
  })

  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      tenantId,
      'Policy',
      policyId,
      'REWRITTEN',
      policyRow.status,
      'Issued',
      { transactionId, effectiveDate: nextEff, transactionNumber },
      actor?.id || null,
    ]
  )
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionNumber,
    transactionType: 'Rewrite',
    sourceEvent: 'POLICY_REWRITTEN',
    effectiveDate: nextEff,
    expirationDate: nextExp,
    processedAt,
    productCode: policyProductCode(policyRow),
    state: payload?.state || payload?.jurisdiction?.code || null,
    premiumImpact: safeMoney((prem as any)?.total?.amount),
    currency,
    payload,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  await computePlacementForTransactionSafely(db, tenantId, policyId, transactionId)

  return version
}

/**
 * Preview renewal underwriting and premium without persisting (DB path only).
 * Covers routes.ts lines 3804-3839 (POST /policies/:id/renew/preview).
 */
export async function previewRenewal(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any
): Promise<any> {
  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  const termMonths = diffMonths(policyTermEffective(policyRow), policyTermExpiration(policyRow)) || 12
  const nextEff = policyTermExpiration(policyRow)
  const nextExp = addMonths(nextEff, termMonths)
  const prevPayload = ctx.latestPayload && typeof ctx.latestPayload === 'object' ? ctx.latestPayload : {}
  const payload = JSON.parse(JSON.stringify(prevPayload || {}))
  payload.effectiveDate = nextEff
  payload.termMonths = termMonths
  payload.productCode = payload.productCode || policyProductCode(policyRow)
  const premium = rate(tenantId, payload)
  const underwriting = evaluateUW(tenantId, payload)
  return { underwriting, premium, nextEffectiveDate: nextEff, nextExpirationDate: nextExp }
}

/**
 * Mark a policy as non-renewed and persist all related records (DB path only).
 * Covers routes.ts lines 5381-5517 (POST /policies/:id/non-renew).
 *
 * actor: { id?: string; username?: string }
 */
export async function nonRenewPolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const reasonCode = typeof body?.reasonCode === 'string' ? body.reasonCode.trim() : ''
  const reasonDescription = typeof body?.reasonDescription === 'string' ? body.reasonDescription.trim() : ''
  const noticeDate = asDateOnly(body?.noticeDate) || today()

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  assertPolicyTransactionState('nonRenew', policyRow.status)
  if (policyField(policyRow, 'nonRenewedAt', 'non_renewed_at')) {
    throw new ConflictError('ALREADY_NON_RENEWED', 'Policy is already marked as non-renewed.')
  }

  const termExpiration = policyTermExpiration(policyRow)
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const currency = policyCurrencyCode(policyRow)
  const processedAt = new Date().toISOString()
  const transactionNumber = reserveTransactionNumber('renew').replace('RN-', 'NR-')

  const documentPacket = await buildPolicyDocumentPacket(q, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'NonRenewal',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: ctx.latestPayload?.state || ctx.latestPayload?.jurisdiction?.code || null,
    effectiveDate: termExpiration,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  })

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'NON_RENEWAL',
    status: 'Issued',
    jurisdiction: ctx.latestPayload?.jurisdiction || (ctx.latestPayload?.state ? { code: ctx.latestPayload.state } : null),
    term: { effectiveDate: termExpiration, expirationDate: termExpiration },
    requestedChanges: [],
    snapshot: ctx.latestPayload || null,
    ratingId,
    uw: null,
    notes: [],
    forms: documentPacket.forms,
    documents: documentPacket.documents,
    createdBy: actor?.id || null,
    metadata: {
      reasonCode: reasonCode || null,
      reasonDescription: reasonDescription || null,
      noticeDate,
      nonRenewedAt: termExpiration,
      transactionNumber,
    },
  })

  await persistPolicyDocumentPacket(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionType: 'NonRenewal',
    transactionNumber,
    productCode: policyProductCode(policyRow),
    state: ctx.latestPayload?.state || ctx.latestPayload?.jurisdiction?.code || null,
    effectiveDate: termExpiration,
    generatedBy: actor?.id || null,
    correlationId: transactionNumber,
  }, documentPacket)

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: termExpiration,
    transactionType: 'NonRenewal',
    premiumTotal: 0,
    premiumFees: 0,
    premiumTaxes: 0,
    currency,
    payload: ctx.latestPayload || null,
    transactionNumber,
  })

  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: {},
    components: [],
    discounts: [],
    surcharges: [],
    taxes: [],
    totalPremium: 0,
    currency,
  })

  await createPolicyNotificationIntent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    productCode: policyProductCode(policyRow),
    transactionId,
    transactionType: 'NonRenewal',
    transactionNumber,
    eventType: 'POLICY_NON_RENEWAL',
    effectiveDate: termExpiration,
    expirationDate: termExpiration,
    noticeDate,
    reason: reasonDescription || reasonCode || null,
    payload: ctx.latestPayload || null,
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  await q(
    `UPDATE policies
        SET non_renewed_at = $1, non_renewal_reason = $2,
            lifecycle = lifecycle || $3::jsonb,
            updated_at = NOW()
      WHERE tenant_id = $4 AND policy_id = $5`,
    [
      termExpiration,
      reasonCode || reasonDescription || null,
      JSON.stringify({ nonRenewedAt: termExpiration, nonRenewalReason: reasonCode || null, noticeDate }),
      tenantId,
      policyId,
    ]
  ).catch(() => {
    // If non_renewed_at column not yet present, update lifecycle only
    return q(
      `UPDATE policies SET lifecycle = lifecycle || $1::jsonb, updated_at = NOW()
        WHERE tenant_id = $2 AND policy_id = $3`,
      [JSON.stringify({ nonRenewedAt: termExpiration, nonRenewalReason: reasonCode || null, noticeDate }), tenantId, policyId]
    )
  })

  await q(
    `INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor)
     VALUES ($1, $2, $3::uuid, $4, $5, $6, $7::jsonb, $8)`,
    [
      tenantId,
      'Policy',
      policyId,
      'NON_RENEWAL_ISSUED',
      policyRow.status,
      'NonRenewed',
      JSON.stringify({ noticeDate, reasonCode, termExpiration, transactionNumber }),
      actor?.id || null,
    ]
  ).catch(() => {})
  await createCommissionHandoffEvent(db, {
    tenantId,
    policyId,
    policyNumber: policyField(policyRow, 'policyNumber', 'policy_number'),
    transactionId,
    transactionNumber,
    transactionType: 'NonRenewal',
    sourceEvent: 'POLICY_NON_RENEWAL',
    effectiveDate: termExpiration,
    expirationDate: termExpiration,
    processedAt,
    productCode: policyProductCode(policyRow),
    state: ctx.latestPayload?.state || ctx.latestPayload?.jurisdiction?.code || null,
    premiumImpact: 0,
    currency,
    payload: ctx.latestPayload || null,
    policyMetadata: policyRow.metadata || {},
    actorId: actor?.id || null,
    correlationId: transactionNumber,
  })

  return {
    ok: true,
    policyId,
    transactionNumber,
    nonRenewedAt: termExpiration,
    noticeDate,
    reasonCode: reasonCode || null,
    message: `Policy will not be renewed at expiration on ${termExpiration}. Non-renewal notice date: ${noticeDate}.`,
  }
}
