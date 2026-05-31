import { rate } from '../rating.js'
import { safeMoney } from '../persistence.js'
import { coerceDateOnly, addDays, round2 } from './date.utils.js'

export type TimelineChange = {
  path: string
  newValue: any
}

export type TimelineVersionInput = {
  versionId: string
  transactionId?: string | null
  transactionType: string
  transactionNumber?: string | null
  effectiveDate: string
  processedAt: string
  payload: any
  changes?: TimelineChange[]
}

export type TimelineSegment = {
  sourceVersionId: string
  sourceTransactionId: string | null
  sourceTransactionType: string
  sourceTransactionNumber: string | null
  startDate: string
  endDate: string
  endExclusiveDate: string
  payload: any
  premium: any
  premiumTotal: number
  premiumFees: number
  premiumTaxes: number
  currency: string
}

export type TimelineRebasedTransaction = {
  versionId: string
  transactionId: string | null
  transactionType: string
  transactionNumber: string | null
  effectiveDate: string
}

export type RetroImpactSegment = {
  startDate: string
  endDate: string
  oldPremium: number
  newPremium: number
  oldFees: number
  newFees: number
  oldTaxes: number
  newTaxes: number
  proRatedDelta: number
  proRatedFeesDelta: number
  proRatedTaxesDelta: number
}

export type RetroResult = {
  totalDelta: number
  feesDelta: number
  taxesDelta: number
  impactedSegments: RetroImpactSegment[]
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function deriveTimelineSegments(params: {
  tenantId: string
  versions: TimelineVersionInput[]
  termEffectiveDate: string
  termExpirationDate: string
}): TimelineSegment[] {
  const { tenantId, versions, termEffectiveDate, termExpirationDate } = params
  const termEff = coerceDateOnly(termEffectiveDate)
  const termExp = coerceDateOnly(termExpirationDate)
  const sorted = sortTimelineVersions(versions).filter((item) => {
    if (!item || !item.payload || typeof item.payload !== 'object') return false
    const eff = coerceDateOnly(item.effectiveDate)
    return eff < termExp
  })
  if (!sorted.length) return []

  const segments: TimelineSegment[] = []
  let runningPayload: any = null
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    if (runningPayload === null) {
      runningPayload = deepClone(current.payload)
    } else if (shouldApplyChangeSet(current)) {
      runningPayload = applyChanges(deepClone(runningPayload), current.changes || [])
    } else {
      runningPayload = deepClone(current.payload)
    }

    const currentEffective = coerceDateOnly(current.effectiveDate)
    const nextVersion = sorted[index + 1]
    const nextVersionEffective = nextVersion ? coerceDateOnly(nextVersion.effectiveDate) : null
    // Multiple transactions can share the same effective date (e.g., rebased OOS endorsements).
    // Persist only one segment per effective date and let the latest processed transaction for that
    // date define the segment state.
    if (nextVersionEffective && nextVersionEffective === currentEffective) {
      continue
    }
    const segmentStart = maxDate(currentEffective, termEff)
    const nextStart = nextDistinctEffectiveDate(sorted, index, termExp)
    const segmentEndExclusive = minDate(nextStart, termExp)
    if (segmentStart >= segmentEndExclusive) continue

    const rated = safeRate(tenantId, runningPayload)
    const currency = extractCurrency(rated) || 'USD'
    segments.push({
      sourceVersionId: current.versionId,
      sourceTransactionId: current.transactionId || null,
      sourceTransactionType: String(current.transactionType || '').toUpperCase(),
      sourceTransactionNumber: current.transactionNumber || null,
      startDate: segmentStart,
      endDate: dayBefore(segmentEndExclusive),
      endExclusiveDate: segmentEndExclusive,
      payload: deepClone(runningPayload),
      premium: rated,
      premiumTotal: round2(safeMoney(rated?.total?.amount)),
      premiumFees: round2(safeMoney(rated?.fees?.amount)),
      premiumTaxes: round2(safeMoney(rated?.taxes?.amount)),
      currency
    })
  }

  return segments
}

export function findTimelineStateAtDate(segments: TimelineSegment[], date: string): TimelineSegment | null {
  if (!segments.length) return null
  const asOf = coerceDateOnly(date)
  for (const segment of segments) {
    if (asOf >= segment.startDate && asOf < segment.endExclusiveDate) return segment
  }
  if (asOf < segments[0].startDate) return segments[0]
  return segments[segments.length - 1]
}

export function computeRetroResult(params: {
  oldSegments: TimelineSegment[]
  newSegments: TimelineSegment[]
  fromDate: string
  termEffectiveDate: string
  termExpirationDate: string
}): RetroResult {
  const { oldSegments, newSegments, fromDate, termEffectiveDate, termExpirationDate } = params
  const termEff = coerceDateOnly(termEffectiveDate)
  const termExp = coerceDateOnly(termExpirationDate)
  const start = maxDate(coerceDateOnly(fromDate), termEff)
  if (start >= termExp) {
    return { totalDelta: 0, feesDelta: 0, taxesDelta: 0, impactedSegments: [] }
  }
  const termDays = Math.max(1, daysBetween(termEff, termExp))
  const boundaries = new Set<string>([start, termExp])
  for (const segment of [...oldSegments, ...newSegments]) {
    const segStart = maxDate(segment.startDate, start)
    const segEnd = minDate(segment.endExclusiveDate, termExp)
    if (segStart < segEnd) {
      boundaries.add(segStart)
      boundaries.add(segEnd)
    }
  }
  const sortedBoundaries = Array.from(boundaries).sort(compareDate)
  const impactedSegments: RetroImpactSegment[] = []
  let total = 0
  let fees = 0
  let taxes = 0
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const intervalStart = sortedBoundaries[index]
    const intervalEnd = sortedBoundaries[index + 1]
    if (intervalStart >= intervalEnd) continue
    const days = daysBetween(intervalStart, intervalEnd)
    if (days <= 0) continue
    const oldState = findTimelineStateAtDate(oldSegments, intervalStart)
    const newState = findTimelineStateAtDate(newSegments, intervalStart)
    const oldPremium = oldState ? oldState.premiumTotal : 0
    const newPremium = newState ? newState.premiumTotal : 0
    const oldFees = oldState ? oldState.premiumFees : 0
    const newFees = newState ? newState.premiumFees : 0
    const oldTaxes = oldState ? oldState.premiumTaxes : 0
    const newTaxes = newState ? newState.premiumTaxes : 0
    const share = days / termDays
    const proRatedDelta = (newPremium - oldPremium) * share
    const proRatedFeesDelta = (newFees - oldFees) * share
    const proRatedTaxesDelta = (newTaxes - oldTaxes) * share
    total += proRatedDelta
    fees += proRatedFeesDelta
    taxes += proRatedTaxesDelta
    if (Math.abs(proRatedDelta) >= 0.0001 || Math.abs(proRatedFeesDelta) >= 0.0001 || Math.abs(proRatedTaxesDelta) >= 0.0001) {
      impactedSegments.push({
        startDate: intervalStart,
        endDate: dayBefore(intervalEnd),
        oldPremium: round2(oldPremium),
        newPremium: round2(newPremium),
        oldFees: round2(oldFees),
        newFees: round2(newFees),
        oldTaxes: round2(oldTaxes),
        newTaxes: round2(newTaxes),
        proRatedDelta: round2(proRatedDelta),
        proRatedFeesDelta: round2(proRatedFeesDelta),
        proRatedTaxesDelta: round2(proRatedTaxesDelta)
      })
    }
  }
  return {
    totalDelta: round2(total),
    feesDelta: round2(fees),
    taxesDelta: round2(taxes),
    impactedSegments
  }
}

export function findRebasedTransactions(versions: TimelineVersionInput[], effectiveDate: string): TimelineRebasedTransaction[] {
  const eff = coerceDateOnly(effectiveDate)
  return sortTimelineVersions(versions)
    .filter((version) => coerceDateOnly(version.effectiveDate) > eff)
    .map((version) => ({
      versionId: version.versionId,
      transactionId: version.transactionId || null,
      transactionType: String(version.transactionType || '').toUpperCase(),
      transactionNumber: version.transactionNumber || null,
      effectiveDate: coerceDateOnly(version.effectiveDate)
    }))
}

export function sortTimelineVersions(versions: TimelineVersionInput[]): TimelineVersionInput[] {
  return [...versions].sort((a, b) => {
    const byEff = compareDate(coerceDateOnly(a.effectiveDate), coerceDateOnly(b.effectiveDate))
    if (byEff !== 0) return byEff
    const byProcessed = compareDateTime(a.processedAt, b.processedAt)
    if (byProcessed !== 0) return byProcessed
    return String(a.versionId).localeCompare(String(b.versionId))
  })
}

function shouldApplyChangeSet(version: TimelineVersionInput): boolean {
  const tx = String(version.transactionType || '').trim().toUpperCase()
  return tx === 'ENDORSE' && Array.isArray(version.changes) && version.changes.length > 0
}

function applyChanges(target: any, changes: TimelineChange[]): any {
  let output = target
  for (const change of changes) {
    output = setByPath(output, change.path, deepClone(change.newValue))
  }
  return output
}

function setByPath(target: any, path: string, value: any): any {
  if (!path || path === '/') return value
  const parts = path
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (!parts.length) return value
  let cursor: any = target
  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index]
    const nextPart = parts[index + 1]
    const nextIsIndex = /^\d+$/.test(nextPart)
    if (cursor[part] == null || typeof cursor[part] !== 'object') {
      cursor[part] = nextIsIndex ? [] : {}
    }
    cursor = cursor[part]
  }
  const leaf = parts[parts.length - 1]
  cursor[leaf] = value
  return target
}

function nextDistinctEffectiveDate(versions: TimelineVersionInput[], currentIndex: number, fallback: string): string {
  const current = coerceDateOnly(versions[currentIndex].effectiveDate)
  for (let index = currentIndex + 1; index < versions.length; index += 1) {
    const candidate = coerceDateOnly(versions[index].effectiveDate)
    if (candidate > current) return candidate
  }
  return coerceDateOnly(fallback)
}

function extractCurrency(premium: any): string | null {
  const c1 = premium?.total?.currency
  if (typeof c1 === 'string' && c1) return c1
  const c2 = premium?.fees?.currency
  if (typeof c2 === 'string' && c2) return c2
  const c3 = premium?.taxes?.currency
  if (typeof c3 === 'string' && c3) return c3
  return null
}

function safeRate(tenantId: string, payload: any): any {
  try {
    return rate(tenantId, payload)
  } catch {
    return {
      byCoverage: [],
      fees: { amount: 0, currency: 'USD' },
      taxes: { amount: 0, currency: 'USD' },
      total: { amount: 0, currency: 'USD' }
    }
  }
}

function compareDate(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function compareDateTime(a: string, b: string): number {
  const da = new Date(a).getTime()
  const db = new Date(b).getTime()
  if (da < db) return -1
  if (da > db) return 1
  return 0
}

function dayBefore(dateOnly: string): string {
  return addDays(dateOnly, -1)
}

function daysBetween(startDate: string, endDateExclusive: string): number {
  const start = new Date(`${coerceDateOnly(startDate)}T00:00:00Z`).getTime()
  const end = new Date(`${coerceDateOnly(endDateExclusive)}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((end - start) / MS_PER_DAY))
}

function maxDate(a: string, b: string): string {
  return compareDate(a, b) >= 0 ? a : b
}

function minDate(a: string, b: string): string {
  return compareDate(a, b) <= 0 ? a : b
}

function deepClone<T>(value: T): T {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}
