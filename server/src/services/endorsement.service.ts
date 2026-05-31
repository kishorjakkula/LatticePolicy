import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { NotFoundError, BadRequestError } from '../errors/domain.errors.js'
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
  computeRetroResult,
  deriveTimelineSegments,
  findRebasedTransactions,
  findTimelineStateAtDate,
  type TimelineSegment,
  type TimelineVersionInput,
} from '../policyTimeline.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { today, coerceDateOnly, asDateOnly, round2, proRataFactor } from '../lib/date.utils.js'
import { diffPayloadPaths, getByPath } from '../lib/patch.utils.js'

// ── Types ─────────────────────────────────────────────────────────────────────

type TransactionNumberMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

type EndorsementTimelineComputation = {
  termEffective: string
  termExpiration: string
  effectiveDate: string
  previousPayload: any
  nextPayload: any
  changes: any[]
  previousPremium: any
  nextPremium: any
  oldSegments: TimelineSegment[]
  newSegments: TimelineSegment[]
  oldStateAtEffective: TimelineSegment | null
  newStateAtEffective: TimelineSegment | null
  retroResult: ReturnType<typeof computeRetroResult>
  rebasedTransactions: ReturnType<typeof findRebasedTransactions>
}

type CoverageDeltaEntry = {
  code: string
  amount: { amount: number; currency: string }
  fullTermDelta: { amount: number; currency: string }
  previousAmount: { amount: number; currency: string }
  currentAmount: { amount: number; currency: string }
  deltaType: 'ADD' | 'RETURN' | 'FLAT'
  selected: boolean
  limit: any
  deductible: any
  percent: any
}

type PremiumDeltaInput = {
  previousStored?: any
  previousCalculated?: any
  nextCalculated?: any
  factor: number
  currency: string
}

type PatchOp = { path: string; op: 'add' | 'replace' | 'remove'; value?: any }

// ── Pure helpers ──────────────────────────────────────────────────────────────

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.max(0, Math.min(1, value))
}

function toArray(value: any): any[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function safeJsonValue(value: any): any {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return null
  }
}

function jsonParam(value: any): string | null {
  const sanitized = safeJsonValue(value)
  if (sanitized == null) return null
  return JSON.stringify(sanitized)
}

function transactionNumberPrefix(mode: TransactionNumberMode): string {
  if (mode === 'cancel') return 'CN-'
  if (mode === 'reinstate') return 'RI-'
  if (mode === 'rewrite') return 'RW-'
  if (mode === 'renew') return 'RN-'
  return 'EN-'
}

function validateTransactionNumberReservation(
  mode: TransactionNumberMode,
  rawStatus: any
): { code: string; message: string } | null {
  const status = String(rawStatus || '').toLowerCase()
  if (mode === 'reinstate' || mode === 'rewrite') {
    if (status !== 'cancelled') return { code: 'INVALID_STATE', message: 'Policy is not cancelled' }
    return null
  }
  if (mode === 'cancel' && status === 'cancelled') {
    return { code: 'INVALID_STATE', message: 'Policy already cancelled' }
  }
  if (status === 'cancelled') {
    return { code: 'INVALID_STATE', message: 'Policy is cancelled' }
  }
  return null
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

function applyJsonPatch(obj: any, ops: PatchOp[]): any {
  for (const op of ops) {
    const path = op.path || ''
    const parts = path.split('/').slice(1).map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'))
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i]
      if (!(key in target) || typeof target[key] !== 'object' || target[key] === null) {
        target[key] = {}
      }
      target = target[key]
    }
    const last = parts[parts.length - 1]
    if (op.op === 'remove') {
      if (last in target) delete target[last]
    } else if (op.op === 'add' || op.op === 'replace') {
      target[last] = op.value
    }
  }
  return obj
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

function moneyValueOrNull(value: any): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function extractMoneyAmount(value: any): number {
  if (value == null) return 0
  if (typeof value === 'number') return safeMoney(value)
  if (typeof value === 'string') return safeMoney(value)
  if (typeof value === 'object') {
    if (value.amount != null) return safeMoney(value.amount)
    if (value.value != null) return safeMoney(value.value)
    if (value.total != null) return extractMoneyAmount(value.total)
  }
  return safeMoney(value)
}

function extractMoneyCurrency(value: any, fallback: string): string {
  if (value && typeof value === 'object') {
    if (typeof value.currency === 'string' && value.currency) return value.currency
    if (value.amount && typeof value.amount === 'object' && typeof value.amount.currency === 'string') return value.amount.currency
  }
  return fallback || 'USD'
}

function normalizeCoverageComponents(raw: any, defaultCurrency: string): Map<string, {
  amount: number
  currency: string
  selected: boolean
  limit: any
  deductible: any
  percent: any
}> {
  const map = new Map<string, {
    amount: number
    currency: string
    selected: boolean
    limit: any
    deductible: any
    percent: any
  }>()
  const items = Array.isArray(raw) ? raw : []
  for (const item of items) {
    if (!item) continue
    const code = String(item.code || item.coverageCode || item.coverage_code || 'COV').toUpperCase()
    const amountValue = extractMoneyAmount(item.amount ?? item.total ?? item.value)
    const currency = extractMoneyCurrency(item.amount ?? item.total ?? item.value, defaultCurrency)
    const existing = map.get(code)
    if (existing) {
      existing.amount = round2(existing.amount + amountValue)
      if (item.selected !== undefined) existing.selected = item.selected !== false
      if (item.limit !== undefined) existing.limit = item.limit
      if (item.deductible !== undefined) existing.deductible = item.deductible
      if (item.percent !== undefined) existing.percent = item.percent
    } else {
      map.set(code, {
        amount: round2(amountValue),
        currency,
        selected: item.selected !== false,
        limit: item.limit ?? null,
        deductible: item.deductible ?? null,
        percent: item.percent ?? null,
      })
    }
  }
  return map
}

function buildCoverageDeltaEntries(previousRaw: any, nextRaw: any, factor: number, defaultCurrency: string): CoverageDeltaEntry[] {
  const previousMap = normalizeCoverageComponents(previousRaw, defaultCurrency)
  const nextMap = normalizeCoverageComponents(nextRaw, defaultCurrency)
  const codeSet = new Set<string>([...previousMap.keys(), ...nextMap.keys()])
  const out: CoverageDeltaEntry[] = []

  for (const code of codeSet) {
    const prev = previousMap.get(code)
    const next = nextMap.get(code)
    const currency = next?.currency || prev?.currency || defaultCurrency
    const previousAmount = round2(prev?.amount || 0)
    const currentAmount = round2(next?.amount || 0)
    const fullTermDelta = round2(currentAmount - previousAmount)
    const proRatedDelta = round2(fullTermDelta * factor)

    if (Math.abs(fullTermDelta) < 0.01 && Math.abs(previousAmount) < 0.01 && Math.abs(currentAmount) < 0.01) {
      continue
    }

    out.push({
      code,
      amount: { amount: proRatedDelta, currency },
      fullTermDelta: { amount: fullTermDelta, currency },
      previousAmount: { amount: previousAmount, currency },
      currentAmount: { amount: currentAmount, currency },
      deltaType: proRatedDelta > 0 ? 'ADD' : proRatedDelta < 0 ? 'RETURN' : 'FLAT',
      selected: next?.selected ?? prev?.selected ?? true,
      limit: next?.limit ?? prev?.limit ?? null,
      deductible: next?.deductible ?? prev?.deductible ?? null,
      percent: next?.percent ?? prev?.percent ?? null,
    })
  }

  return out.sort((a, b) => a.code.localeCompare(b.code))
}

function buildEndorsementPremiumDelta({
  previousStored,
  previousCalculated,
  nextCalculated,
  factor,
  currency,
}: PremiumDeltaInput): {
  premium: {
    byCoverage: CoverageDeltaEntry[]
    fees: { amount: number; currency: string }
    taxes: { amount: number; currency: string }
    total: { amount: number; currency: string }
  }
  byCoverage: CoverageDeltaEntry[]
  fullOld: number
  fullNew: number
  fullDelta: number
  totalDelta: number
  feesDelta: number
  taxesDelta: number
} {
  const normalizedFactor = clamp01(factor)
  const oldStoredAmount = moneyValueOrNull(previousStored?.total?.amount)
  const oldCalculatedTotal = safeMoney(previousCalculated?.total?.amount)
  const fullOld = round2(oldStoredAmount != null ? oldStoredAmount : oldCalculatedTotal)
  const fullNew = round2(safeMoney(nextCalculated?.total?.amount))
  const fullDelta = round2(fullNew - fullOld)
  const targetTotal = round2(fullDelta * normalizedFactor)

  const byCoverage = buildCoverageDeltaEntries(
    previousCalculated?.byCoverage,
    nextCalculated?.byCoverage,
    normalizedFactor,
    currency
  )

  let coverageDelta = round2(
    byCoverage.reduce((sum, item) => sum + safeMoney(item.amount?.amount), 0)
  )
  let feesDelta = round2((safeMoney(nextCalculated?.fees?.amount) - safeMoney(previousCalculated?.fees?.amount)) * normalizedFactor)
  let taxesDelta = round2((safeMoney(nextCalculated?.taxes?.amount) - safeMoney(previousCalculated?.taxes?.amount)) * normalizedFactor)
  let totalDelta = round2(coverageDelta + feesDelta + taxesDelta)
  const roundingRemainder = round2(targetTotal - totalDelta)
  if (Math.abs(roundingRemainder) >= 0.01) {
    taxesDelta = round2(taxesDelta + roundingRemainder)
    totalDelta = round2(coverageDelta + feesDelta + taxesDelta)
  }

  if (!byCoverage.length) {
    coverageDelta = round2(totalDelta - feesDelta - taxesDelta)
  }

  const premium = {
    byCoverage,
    fees: { amount: feesDelta, currency },
    taxes: { amount: taxesDelta, currency },
    total: { amount: totalDelta, currency },
  }

  return {
    premium,
    byCoverage,
    fullOld,
    fullNew,
    fullDelta,
    totalDelta,
    feesDelta,
    taxesDelta,
  }
}

function currentPolicyStateAsOfDate(termEffectiveDate: string, termExpirationDate: string): string {
  const currentDate = today()
  if (currentDate <= termEffectiveDate) return termEffectiveDate
  if (currentDate >= termExpirationDate) {
    const prev = new Date(`${termExpirationDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000
    const fallback = new Date(prev).toISOString().slice(0, 10)
    return fallback < termEffectiveDate ? termEffectiveDate : fallback
  }
  return currentDate
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function loadPolicyTimelineVersions(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyId: string
): Promise<TimelineVersionInput[]> {
  const versionsRes = await q(
    `SELECT version_id, transaction_id, transaction_type, transaction_number,
            effective_date, processed_at, payload
       FROM policy_versions
      WHERE tenant_id = $1 AND policy_id = $2
      ORDER BY effective_date ASC, processed_at ASC, version_id ASC`,
    [tenantId, policyId]
  )
  if (!versionsRes.rowCount) return []

  const changeRes = await q(
    `SELECT version_id, path, new
       FROM policy_version_changes
      WHERE tenant_id = $1 AND policy_id = $2`,
    [tenantId, policyId]
  )
  const changeMap = new Map<string, Array<{ path: string; newValue: any }>>()
  for (const row of changeRes.rows || []) {
    const versionId = String(row.version_id || '')
    if (!versionId) continue
    const list = changeMap.get(versionId) || []
    list.push({
      path: String(row.path || '/'),
      newValue: row.new,
    })
    changeMap.set(versionId, list)
  }

  const versions: TimelineVersionInput[] = []
  for (const row of versionsRes.rows || []) {
    versions.push({
      versionId: String(row.version_id),
      transactionId: row.transaction_id ? String(row.transaction_id) : null,
      transactionType: String(row.transaction_type || ''),
      transactionNumber: row.transaction_number ? String(row.transaction_number) : null,
      effectiveDate: coerceDateOnly(row.effective_date),
      processedAt:
        row.processed_at instanceof Date
          ? row.processed_at.toISOString()
          : String(row.processed_at || new Date().toISOString()),
      payload: row.payload,
      changes: changeMap.get(String(row.version_id)) || [],
    })
  }
  return versions
}

async function loadCurrentTimelineVersion(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyId: string
): Promise<number> {
  const result = await q(
    `SELECT COALESCE(MAX(timeline_version), 0) AS max_timeline_version
       FROM policy_timeline_segments
      WHERE tenant_id = $1 AND policy_id = $2`,
    [tenantId, policyId]
  )
  return Number(result.rows?.[0]?.max_timeline_version || 0)
}

async function nextPolicyTransactionSequence(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyId: string
): Promise<number> {
  const result = await q(
    `SELECT COALESCE(MAX(sequence_no), 0) AS max_sequence_no
       FROM policy_transactions
      WHERE tenant_id = $1 AND policy_id = $2`,
    [tenantId, policyId]
  )
  return Number(result.rows?.[0]?.max_sequence_no || 0) + 1
}

async function persistPolicyTimelineSegments(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyId: string,
  timelineVersion: number,
  segments: TimelineSegment[]
): Promise<void> {
  await q(
    'DELETE FROM policy_timeline_segments WHERE tenant_id = $1 AND policy_id = $2 AND timeline_version = $3',
    [tenantId, policyId, timelineVersion]
  )
  for (const segment of segments) {
    await q(
      `INSERT INTO policy_timeline_segments (
        segment_id, tenant_id, policy_id, timeline_version, segment_start, segment_end,
        source_version_id, source_transaction_id, payload, premium_total, premium_fees, premium_taxes,
        currency, metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9::jsonb, $10, $11, $12,
        $13, $14::jsonb
      )`,
      [
        uuidv4(),
        tenantId,
        policyId,
        timelineVersion,
        segment.startDate,
        segment.endDate,
        segment.sourceVersionId,
        segment.sourceTransactionId,
        jsonParam(segment.payload),
        segment.premiumTotal,
        segment.premiumFees,
        segment.premiumTaxes,
        segment.currency,
        jsonParam({
          sourceTransactionType: segment.sourceTransactionType,
          sourceTransactionNumber: segment.sourceTransactionNumber,
        }),
      ]
    )
  }
}

async function computeEndorsementTimeline(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyId: string,
  termEffective: string,
  termExpiration: string,
  effectiveDate: string,
  latestPayload: any,
  bodyChanges: any[],
  overridePayload: any,
  processedAt: string,
  options?: {
    hypotheticalVersionId?: string
    hypotheticalTransactionId?: string | null
  }
): Promise<EndorsementTimelineComputation> {
  const timelineVersionsBefore = await loadPolicyTimelineVersions(q, tenantId, policyId)
  const oldSegments = deriveTimelineSegments({
    tenantId,
    versions: timelineVersionsBefore,
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  const oldStateAtEffective = findTimelineStateAtDate(oldSegments, effectiveDate)
  const previousPayload = oldStateAtEffective?.payload
    ? JSON.parse(JSON.stringify(oldStateAtEffective.payload))
    : (latestPayload && typeof latestPayload === 'object' ? JSON.parse(JSON.stringify(latestPayload)) : {})
  const nextPayload = overridePayload
    ? JSON.parse(JSON.stringify(overridePayload))
    : applyJsonPatch(JSON.parse(JSON.stringify(previousPayload)), bodyChanges)
  const changes = overridePayload
    ? diffPayloadPaths(previousPayload || {}, nextPayload || {})
    : bodyChanges
  const previousPremium = rate(tenantId, previousPayload)
  const nextPremium = rate(tenantId, nextPayload)
  const hypotheticalVersion: TimelineVersionInput = {
    versionId: options?.hypotheticalVersionId || uuidv4(),
    transactionId: options?.hypotheticalTransactionId || null,
    transactionType: 'Endorse',
    transactionNumber: null,
    effectiveDate,
    processedAt,
    payload: nextPayload,
    changes: changes.map((path: string) => ({ path, newValue: getByPath(nextPayload, path) })),
  }
  const newSegments = deriveTimelineSegments({
    tenantId,
    versions: [...timelineVersionsBefore, hypotheticalVersion],
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  const newStateAtEffective = findTimelineStateAtDate(newSegments, effectiveDate)
  const retroResult = computeRetroResult({
    oldSegments,
    newSegments,
    fromDate: effectiveDate,
    termEffectiveDate: termEffective,
    termExpirationDate: termExpiration,
  })
  const rebasedTransactions = findRebasedTransactions(timelineVersionsBefore, effectiveDate)
  return {
    termEffective,
    termExpiration,
    effectiveDate,
    previousPayload,
    nextPayload,
    changes,
    previousPremium,
    nextPremium,
    oldSegments,
    newSegments,
    oldStateAtEffective,
    newStateAtEffective,
    retroResult,
    rebasedTransactions,
  }
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Reserve a transaction number for an endorsement (DB path only).
 * Covers routes.ts lines 2358-2382 (POST /policies/:id/endorse/reserve-number)
 * and lines 2384-2412 (POST /policies/:id/transactions/reserve-number) for mode='endorse'.
 */
export async function reservePolicyNumber(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  mode: string = 'endorse'
): Promise<{ transactionNumber: string }> {
  const normalizedMode = String(mode || 'endorse').trim().toLowerCase() as TransactionNumberMode
  const q = toRawQuery(db)
  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const invalidState = validateTransactionNumberReservation(normalizedMode, ctx.policy.status)
  if (invalidState) throw new BadRequestError(invalidState.code, invalidState.message)
  return { transactionNumber: reserveTransactionNumber(normalizedMode) }
}

/**
 * Preview an endorsement without persisting (DB path only).
 * Covers routes.ts lines 2510-2589 (POST /policies/:id/endorse/preview).
 */
export async function previewEndorsement(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any
): Promise<any> {
  const q = toRawQuery(db)
  const bodyChanges = Array.isArray(body.changes) ? body.changes : []
  const overridePayload = body.payload && typeof body.payload === 'object' ? body.payload : null
  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  const termEffective = coerceDateOnly(policyRow.term_effective_date)
  const termExpiration = coerceDateOnly(policyRow.term_expiration_date)
  const effectiveDate = asDateOnly(body.effectiveDate) || termEffective
  const computation = await computeEndorsementTimeline(
    q,
    tenantId,
    policyId,
    termEffective,
    termExpiration,
    effectiveDate,
    ctx.latestPayload,
    bodyChanges,
    overridePayload,
    new Date().toISOString()
  )
  const underwriting = evaluateUW(tenantId, computation.nextPayload)
  const currency = policyRow.currency_code || computation.newStateAtEffective?.currency || 'USD'
  const factor = proRataFactor(effectiveDate, termEffective, termExpiration)
  const endorsementPremium = buildEndorsementPremiumDelta({
    previousStored: { total: { amount: computation.oldStateAtEffective?.premiumTotal ?? safeMoney(computation.previousPremium?.total?.amount), currency } },
    previousCalculated: computation.previousPremium,
    nextCalculated: computation.nextPremium,
    factor,
    currency,
  })
  endorsementPremium.totalDelta = computation.retroResult.totalDelta
  endorsementPremium.feesDelta = computation.retroResult.feesDelta
  endorsementPremium.taxesDelta = computation.retroResult.taxesDelta
  endorsementPremium.premium.fees.amount = computation.retroResult.feesDelta
  endorsementPremium.premium.taxes.amount = computation.retroResult.taxesDelta
  endorsementPremium.premium.total.amount = computation.retroResult.totalDelta
  endorsementPremium.fullOld = round2(computation.oldStateAtEffective?.premiumTotal ?? endorsementPremium.fullOld)
  endorsementPremium.fullNew = round2(computation.newStateAtEffective?.premiumTotal ?? endorsementPremium.fullNew)
  endorsementPremium.fullDelta = round2(endorsementPremium.fullNew - endorsementPremium.fullOld)
  return {
    effectiveDate,
    underwriting,
    premium: endorsementPremium.premium,
    fullTerm: {
      old: endorsementPremium.fullOld,
      new: endorsementPremium.fullNew,
      delta: endorsementPremium.fullDelta,
      currency,
    },
    retroAdjustment: {
      totalDelta: computation.retroResult.totalDelta,
      feesDelta: computation.retroResult.feesDelta,
      taxesDelta: computation.retroResult.taxesDelta,
      currency,
      impactedSegments: computation.retroResult.impactedSegments,
    },
    timeline: {
      wouldRebase: computation.rebasedTransactions.length > 0,
      rebasedTransactions: computation.rebasedTransactions,
    },
  }
}

/**
 * Execute an endorsement and persist all related records (DB path only).
 * Covers routes.ts lines 2591-2934 (POST /policies/:id/endorse).
 *
 * actor: { id?: string; username?: string; roles?: string[]; permissions?: string[] }
 */
export async function executeEndorsement(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  body: any,
  actor: any
): Promise<any> {
  const q = toRawQuery(db)
  const bodyChanges = Array.isArray(body.changes) ? body.changes : []
  const overridePayload = body.payload && typeof body.payload === 'object' ? body.payload : null
  const overrideReason = typeof body.overrideReason === 'string' ? body.overrideReason.trim() : ''
  const endorsementReason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const endorsementNotes = typeof body.notes === 'string' ? body.notes.trim() : ''
  const requestedTransactionNumber = typeof body.transactionNumber === 'string' ? body.transactionNumber.trim() : ''
  const roles = actor?.roles || []
  const permissions = actor?.permissions || []
  const isUw = roles.includes('underwriter') || roles.includes('admin') || permissions.includes('uw.referrals.decide')

  const ctx = await loadPolicyContext(db, tenantId, policyId)
  if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
  const policyRow = ctx.policy
  const termEffective = coerceDateOnly(policyRow.term_effective_date)
  const termExpiration = coerceDateOnly(policyRow.term_expiration_date)
  const eff = asDateOnly(body.effectiveDate) || termEffective
  const processedAt = new Date().toISOString()
  const versionId = uuidv4()
  const transactionId = uuidv4()
  const ratingId = uuidv4()
  const computation = await computeEndorsementTimeline(
    q,
    tenantId,
    policyId,
    termEffective,
    termExpiration,
    eff,
    ctx.latestPayload,
    bodyChanges,
    overridePayload,
    processedAt,
    {
      hypotheticalVersionId: versionId,
      hypotheticalTransactionId: transactionId,
    }
  )
  const prevPayload = computation.previousPayload
  const newPayload = computation.nextPayload
  let changes = computation.changes
  const oldPrem = computation.previousPremium
  const newPrem = computation.nextPremium
  const factor = proRataFactor(eff, termEffective, termExpiration)
  const currency = policyRow.currency_code || computation.newStateAtEffective?.currency || 'USD'
  const endorsementPremium = buildEndorsementPremiumDelta({
    previousStored: { total: { amount: computation.oldStateAtEffective?.premiumTotal ?? safeMoney(oldPrem?.total?.amount), currency } },
    previousCalculated: oldPrem,
    nextCalculated: newPrem,
    factor,
    currency,
  })
  endorsementPremium.totalDelta = computation.retroResult.totalDelta
  endorsementPremium.feesDelta = computation.retroResult.feesDelta
  endorsementPremium.taxesDelta = computation.retroResult.taxesDelta
  endorsementPremium.premium.fees.amount = computation.retroResult.feesDelta
  endorsementPremium.premium.taxes.amount = computation.retroResult.taxesDelta
  endorsementPremium.premium.total.amount = computation.retroResult.totalDelta
  endorsementPremium.fullOld = round2(computation.oldStateAtEffective?.premiumTotal ?? endorsementPremium.fullOld)
  endorsementPremium.fullNew = round2(computation.newStateAtEffective?.premiumTotal ?? endorsementPremium.fullNew)
  endorsementPremium.fullDelta = round2(endorsementPremium.fullNew - endorsementPremium.fullOld)
  const fullNew = endorsementPremium.fullNew
  const delta = endorsementPremium.totalDelta
  const uw = evaluateUW(tenantId, newPayload)
  if (uw.decision === 'Decline') {
    throw new BadRequestError('UW_DECLINED', `Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ')}`)
  }
  const uwOverride = uw.decision === 'Refer' && isUw && !!overrideReason
  const submittedBy = !uwOverride && uw.decision === 'Refer' ? (actor?.username || null) : null
  const baseTimelineVersion = await loadCurrentTimelineVersion(q, tenantId, policyId)
  const timelineVersion = baseTimelineVersion + 1
  const sequenceNo = await nextPolicyTransactionSequence(q, tenantId, policyId)
  const transactionNumber = requestedTransactionNumber || reserveTransactionNumber('endorse')
  const version: any = {
    versionId,
    effectiveDate: eff,
    processedDate: processedAt,
    transactionType: 'Endorse',
    transactionNumber,
    premium: endorsementPremium.premium,
    meta: {
      changes,
      uwDecision: uw,
      uwOverride,
      overrideReason: uwOverride ? overrideReason : undefined,
      reason: endorsementReason || undefined,
      notes: endorsementNotes || undefined,
      submittedBy: submittedBy || undefined,
      transactionNumber,
      coveragePremiumDelta: endorsementPremium.byCoverage,
      proRataFactor: factor,
      baseTimelineVersion,
      timelineVersion,
      rebasedTransactions: computation.rebasedTransactions,
      retroAdjustment: {
        totalDelta: endorsementPremium.totalDelta,
        feesDelta: endorsementPremium.feesDelta,
        taxesDelta: endorsementPremium.taxesDelta,
        impactedSegments: computation.retroResult.impactedSegments,
      },
    },
  }
  const riskList = Array.isArray(newPayload?.risks) ? newPayload.risks : []
  const riskEntries: RiskEntry[] = riskList.map((risk: any) => ({
    id: uuidv4(),
    kind: mapRiskKind(policyRow.product_code, risk),
    attributes: risk,
  }))
  const projectionAsOf = currentPolicyStateAsOfDate(termEffective, termExpiration)
  const projectionState = findTimelineStateAtDate(computation.newSegments, projectionAsOf) || computation.newStateAtEffective
  const projectionPayload = projectionState?.payload || newPayload
  const projectionPremium = projectionState?.premium || newPrem
  const projectionRiskList = Array.isArray(projectionPayload?.risks) ? projectionPayload.risks : []
  const riskSummary = projectionRiskList.length
    ? { risks: projectionRiskList.map((risk: any) => ({ kind: mapRiskKind(policyRow.product_code, risk), summary: summarizeRisk(risk) })) }
    : null
  const premiumSummary = projectionPremium
    ? {
        total: (projectionPremium as any).total || { amount: fullNew, currency },
        fees: (projectionPremium as any).fees || null,
        taxes: (projectionPremium as any).taxes || null,
        byCoverage: (projectionPremium as any).byCoverage || [],
      }
    : policyRow.premium_summary
  const lifecycle = {
    ...(policyRow.lifecycle || {}),
    updatedAt: processedAt,
    updatedBy: actor?.username || actor?.id || 'system',
  }
  const metadata = {
    ...(policyRow.metadata || {}),
    lastTransactionId: transactionId,
    lastTimelineVersion: timelineVersion,
  }
  const trace = submittedBy ? { uw: { submittedBy, submittedAt: processedAt } } : null

  await insertPolicyTransaction(db, {
    tenantId,
    transactionId,
    policyId,
    type: 'Endorse',
    status: 'Issued',
    jurisdiction: newPayload?.jurisdiction || null,
    term: { effectiveDate: termEffective, expirationDate: termExpiration },
    requestedChanges: changes,
    snapshot: newPayload,
    ratingId,
    uw,
    notes: [],
    forms: [],
    documents: [],
    createdBy: actor?.id || null,
    effectiveDate: eff,
    processedAt,
    sequenceNo,
    baseTimelineVersion,
    timelineVersion,
    metadata: {
      overrideReason: uwOverride ? overrideReason : null,
      submittedBy,
      delta,
      feesDelta: endorsementPremium.feesDelta,
      taxesDelta: endorsementPremium.taxesDelta,
      coveragePremiumDelta: endorsementPremium.byCoverage,
      transactionNumber,
      baseTimelineVersion,
      timelineVersion,
      rebasedTransactions: computation.rebasedTransactions,
      retroAdjustment: computation.retroResult,
    },
  })

  await insertPolicyVersion(db, {
    tenantId,
    policyId,
    versionId,
    transactionId,
    effectiveDate: eff,
    transactionType: 'Endorse',
    premiumTotal: delta,
    premiumFees: endorsementPremium.feesDelta,
    premiumTaxes: endorsementPremium.taxesDelta,
    currency,
    uwDecision: uw.decision,
    uwOverride,
    overrideReason: uwOverride ? overrideReason : null,
    calcTrace: trace,
    payload: newPayload,
    transactionNumber,
    baseTimelineVersion,
    timelineVersion,
  })

  const componentsValue = jsonParam(Array.isArray(endorsementPremium.byCoverage) ? endorsementPremium.byCoverage : [])
  const discountsValue = jsonParam(toArray((newPrem as any)?.discounts))
  const surchargesValue = jsonParam(toArray((newPrem as any)?.surcharges))
  const taxesValue = jsonParam([
    { code: 'TAX_DELTA', amount: { amount: endorsementPremium.taxesDelta, currency } },
  ])
  const inputsValue = jsonParam({ previousPayload: prevPayload, payload: newPayload, factors: newPayload?.uwAnswers || {}, proRataFactor: factor })
  const calcTraceValue = jsonParam({
    fullOld: endorsementPremium.fullOld,
    fullNew: endorsementPremium.fullNew,
    fullDelta: endorsementPremium.fullDelta,
    totalDelta: endorsementPremium.totalDelta,
    feesDelta: endorsementPremium.feesDelta,
    taxesDelta: endorsementPremium.taxesDelta,
    proRataFactor: factor,
    baseTimelineVersion,
    timelineVersion,
    impactedSegments: computation.retroResult.impactedSegments,
  })
  await insertRating(db, {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs: inputsValue,
    components: componentsValue,
    discounts: discountsValue,
    surcharges: surchargesValue,
    taxes: taxesValue,
    totalPremium: delta,
    currency,
    calcTrace: calcTraceValue,
  })

  await persistRiskUnits({
    q: db,
    tenantId,
    policyId,
    versionId,
    entries: riskEntries,
    productCode: policyRow.product_code,
    transactionId,
    effectiveDate: eff,
    expirationDate: termExpiration,
    uwAnswers: newPayload?.uwAnswers || null,
  })

  const coveragesArr = Array.isArray(newPayload?.coverages) ? newPayload.coverages : []
  const defaultRiskRef = riskEntries.length === 1 ? riskEntries[0].id : null
  if (coveragesArr.length) {
    await persistCoverageRecords({
      q: db,
      tenantId,
      policyId,
      versionId,
      coverages: coveragesArr,
      transactionId,
      effectiveDate: eff,
      expirationDate: termExpiration,
      fallbackRiskRef: defaultRiskRef,
    })
  }

  for (const path of changes) {
    const oldVal = prevPayload ? getByPath(prevPayload, path) : null
    const newVal = getByPath(newPayload, path)
    const oldJson = jsonParam(oldVal)
    const newJson = jsonParam(newVal)
    await q(
      'INSERT INTO policy_version_changes (tenant_id, policy_id, version_id, path, old, new) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
      [tenantId, policyId, versionId, path, oldJson, newJson]
    )
  }

  await persistPolicyTimelineSegments(q, tenantId, policyId, timelineVersion, computation.newSegments)

  if (Math.abs(endorsementPremium.totalDelta) >= 0.01 || computation.retroResult.impactedSegments.length) {
    await q(
      `INSERT INTO policy_retro_adjustments (
        adjustment_id, tenant_id, policy_id, transaction_id, timeline_version, from_date, to_date,
        amount_total, amount_fees, amount_taxes, currency, reason, details
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13::jsonb
      )`,
      [
        uuidv4(),
        tenantId,
        policyId,
        transactionId,
        timelineVersion,
        eff,
        termExpiration,
        endorsementPremium.totalDelta,
        endorsementPremium.feesDelta,
        endorsementPremium.taxesDelta,
        currency,
        'ENDORSEMENT_RECALC',
        jsonParam({
          baseTimelineVersion,
          timelineVersion,
          impactedSegments: computation.retroResult.impactedSegments,
        }),
      ]
    )
  }

  await updatePolicyProjection(db, {
    tenantId,
    policyId,
    premiumSummary,
    riskSummary,
    lifecycle,
    metadata,
  })

  await q(
    'INSERT INTO ledger_events (tenant_id, entity_type, entity_id, event, from_state, to_state, payload, actor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      tenantId,
      'Policy',
      policyId,
      'ENDORSE_ISSUED',
      policyRow.status,
      policyRow.status,
      {
        transactionId,
        delta,
        feesDelta: endorsementPremium.feesDelta,
        taxesDelta: endorsementPremium.taxesDelta,
        changes,
        coveragePremiumDelta: endorsementPremium.byCoverage,
        transactionNumber,
        baseTimelineVersion,
        timelineVersion,
        rebasedTransactions: computation.rebasedTransactions,
        retroAdjustment: computation.retroResult,
      },
      actor?.id || null,
    ]
  )

  return version
}
