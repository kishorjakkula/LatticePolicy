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
    'SELECT policy_id, policy_number, status, lifecycle FROM policies WHERE tenant_id=$1 AND policy_id=$2',
    [tenantId, policyId]
  )
  if (!policyRes.rowCount) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = policyRes.rows[0]
  const currentStatus = (policyRow.status || '').toLowerCase()
  if (currentStatus === 'cancelled') {
    throw new BadRequestError('INVALID_STATE', 'Policy is cancelled')
  }
  if (currentStatus && currentStatus !== 'bound' && currentStatus !== 'issued') {
    throw new BadRequestError('INVALID_STATE', `Cannot issue policy from status ${policyRow.status}`)
  }
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
  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [tenantId, 'Policy', policyId, 'STATUS_CHANGE', policyRow.status, 'Issued', { issuedAt }, actor?.id || null]
  )
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
  if ((policyRow.status || '').toLowerCase() === 'cancelled') {
    throw new BadRequestError('INVALID_STATE', 'Policy already cancelled')
  }
  const eff = asDateOnly(body?.effectiveDate) || today()
  const termEffective = policyTermEffective(policyRow)
  const termExpiration = policyTermExpiration(policyRow)
  const txPayload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : (ctx.latestPayload && typeof ctx.latestPayload === 'object'
        ? JSON.parse(JSON.stringify(ctx.latestPayload))
        : null)
  const fullPremium = safeMoney(policyPremiumSummary(policyRow)?.total?.amount)

  let returnPremiumResult = { returnPremium: 0, earnedPremium: fullPremium, method: 'PRO_RATA' }
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
        fullPremium,
        cancelDate: eff,
        termEffectiveDate: termEffective,
        termExpirationDate: termExpiration,
        shortRateTable,
      })
    }
  }

  if (!cancellationReasonCode || returnPremiumResult.returnPremium === 0) {
    const factor = proRataFactor(eff, termEffective, termExpiration)
    const proRataRefund = round2(fullPremium * factor)
    if (returnPremiumResult.returnPremium === 0 && proRataRefund > 0) {
      returnPremiumResult = { returnPremium: proRataRefund, earnedPremium: round2(fullPremium - proRataRefund), method: 'PRO_RATA' }
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
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    metadata: {
      reason: resolvedReasonDescription || reason || null,
      refund,
      cancellationReasonCode: cancellationReasonCode || null,
      cancellationType: resolvedCancellationType,
      returnPremiumMethod: returnPremiumResult.method,
      transactionNumber,
    },
  })

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
  })

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
  if ((policyRow.status || '').toLowerCase() !== 'cancelled') {
    throw new BadRequestError('INVALID_STATE', 'Policy is not cancelled')
  }
  const eff = asDateOnly(body?.effectiveDate) || today()
  const termEffective = policyTermEffective(policyRow)
  const termExpiration = policyTermExpiration(policyRow)
  const txPayload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : (ctx.latestPayload && typeof ctx.latestPayload === 'object'
        ? JSON.parse(JSON.stringify(ctx.latestPayload))
        : null)
  const fullPremium = safeMoney(policyPremiumSummary(policyRow)?.total?.amount)
  const factor = proRataFactor(eff, termEffective, termExpiration)
  const reinstatementCharge = round2(fullPremium * factor)
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
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    metadata: { reinstateDate: eff, transactionNumber, reinstatementCharge },
  })

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
  })

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
  const roles = actor?.roles || []
  const permissions = actor?.permissions || []
  const isUw = roles.includes('underwriter') || roles.includes('admin') || permissions.includes('uw.referrals.decide')
  const overrideReason = body && typeof body.overrideReason === 'string' ? body.overrideReason.trim() : ''
  const overridePayload = body?.payload && typeof body.payload === 'object' ? body.payload : null
  const requestedTransactionNumber = typeof body?.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
  const overrideEffectiveDate = asDateOnly(body?.effectiveDate)

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
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
  const uwOverride = uw.decision === 'Refer' && isUw && !!overrideReason
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
      overrideReason: uwOverride ? overrideReason : undefined,
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
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    metadata: {
      renewal: true,
      overrideReason: uwOverride ? overrideReason : null,
      submittedBy,
      transactionNumber,
    },
  })

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
    overrideReason: uwOverride ? overrideReason : null,
    calcTrace: trace,
    payload,
    transactionNumber,
  })

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
  const roles = actor?.roles || []
  const permissions = actor?.permissions || []
  const isUw =
    roles.includes('underwriter') ||
    roles.includes('admin') ||
    permissions.includes('uw.referrals.decide')
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
  if ((policyRow.status || '').toLowerCase() !== 'cancelled') {
    throw new BadRequestError('INVALID_STATE', 'Policy must be cancelled to rewrite')
  }

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
  const uwOverride = uw.decision === 'Refer' && isUw && !!overrideReason
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
      overrideReason: uwOverride ? overrideReason : undefined,
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
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    metadata: {
      rewrite: true,
      overrideReason: uwOverride ? overrideReason : null,
      submittedBy,
      transactionNumber,
    },
  })

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
    overrideReason: uwOverride ? overrideReason : null,
    calcTrace: trace,
    payload,
    transactionNumber,
  })

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
  const status = (policyRow.status || '').toLowerCase()

  if (status === 'cancelled') {
    throw new BadRequestError('INVALID_STATE', 'Cannot non-renew a cancelled policy.')
  }
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
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    metadata: {
      reasonCode: reasonCode || null,
      reasonDescription: reasonDescription || null,
      noticeDate,
      nonRenewedAt: termExpiration,
      transactionNumber,
    },
  })

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
