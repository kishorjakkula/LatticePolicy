import { eq, and, desc, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from './uuid.js'
import type { DrizzleDB } from './db.js'
import {
  policies,
  policyVersions,
  policyTransactions,
  ratings,
  riskUnits,
  autoVehicles,
  dwellings,
  coverages,
  coverageSelections,
  documents,
} from './schema.js'

/**
 * Legacy raw-query function type kept for backward compatibility.
 * New code should use DrizzleDB directly.
 */
export type QueryFn = (text: string, params?: any[]) => Promise<any>

export interface InsertPolicyArgs {
  tenantId: string
  policyId: string
  policyNumber: string
  productCode: string
  productVersion?: string | null
  status: string
  termEffectiveDate: string
  termExpirationDate: string
  termType?: string | null
  currencyCode: string
  premiumSummary?: any
  riskSummary?: any
  lifecycle?: any
  externalIds?: any
  metadata?: any
}

export interface InsertPolicyTransactionArgs {
  tenantId: string
  transactionId: string
  policyId: string
  type: string
  status: string
  effectiveDate?: string | null
  processedAt?: string | null
  sequenceNo?: number | null
  baseTimelineVersion?: number | null
  timelineVersion?: number | null
  jurisdiction?: any
  term?: any
  requestedChanges?: any[]
  snapshot?: any
  ratingId?: string | null
  uw?: any
  notes?: any[]
  forms?: any[]
  documents?: any[]
  createdBy?: string | null
  metadata?: any
}

export interface InsertPolicyVersionArgs {
  tenantId: string
  policyId: string
  versionId: string
  transactionId?: string | null
  effectiveDate: string
  transactionType: 'Issue' | 'Endorse' | 'Cancel' | 'Reinstate' | 'Rewrite' | 'Renew' | 'NonRenewal'
  premiumTotal?: number
  premiumFees?: number
  premiumTaxes?: number
  currency?: string
  uwDecision?: string | null
  uwOverride?: boolean | null
  overrideReason?: string | null
  calcTrace?: any
  payload?: any
  transactionNumber?: string | null
  baseTimelineVersion?: number | null
  timelineVersion?: number | null
}

export interface InsertRatingArgs {
  tenantId: string
  ratingId: string
  policyId: string
  transactionId: string
  inputs?: any
  components?: any
  discounts?: any
  surcharges?: any
  taxes?: any
  totalPremium?: number
  currency?: string
  calcTrace?: any
}

export type RiskEntry = { id: string; kind: string; attributes: any }

export interface PersistRiskUnitsArgs {
  q: DrizzleDB
  tenantId: string
  policyId: string
  versionId: string
  entries: RiskEntry[]
  productCode?: string
  transactionId?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  uwAnswers?: Record<string, any> | null
}

export interface PersistCoverageArgs {
  q: DrizzleDB
  tenantId: string
  policyId: string
  versionId: string
  coverages: any[]
  transactionId?: string | null
  effectiveDate?: string | null
  expirationDate?: string | null
  fallbackRiskRef?: string | null
}

export function safeMoney(value: any): number {
  const num = Number(value)
  return Number.isFinite(num) ? num : 0
}

const txnTypeMap: Record<string, string> = {
  issue: 'NB',
  nb: 'NB',
  endorse: 'ENDORSE',
  cancel: 'CANCEL',
  reinstate: 'REINSTATE',
  renew: 'RENEW',
  rewrite: 'REWRITE',
  non_renewal: 'NON_RENEWAL',
  nonrenewal: 'NON_RENEWAL'
}

function normalizeTxnType(input?: string | null): string | null {
  if (!input) return null
  const raw = input.toString().trim()
  if (!raw) return null
  const key = raw.toLowerCase()
  return txnTypeMap[key] || raw.toUpperCase()
}

export interface PolicyContext {
  policy: any
  latestVersionId: string | null
  latestPayload: any
  latestProcessedAt: string | null
}

export async function loadPolicyContext(q: DrizzleDB, tenantId: string, policyId: string): Promise<PolicyContext | null> {
  const policyRows = await q
    .select({
      policyId: policies.policyId,
      policyNumber: policies.policyNumber,
      productCode: policies.productCode,
      productVersion: policies.productVersion,
      status: policies.status,
      termEffectiveDate: policies.termEffectiveDate,
      termExpirationDate: policies.termExpirationDate,
      termType: policies.termType,
      currencyCode: policies.currencyCode,
      premiumSummary: policies.premiumSummary,
      riskSummary: policies.riskSummary,
      lifecycle: policies.lifecycle,
      metadata: policies.metadata,
    })
    .from(policies)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.policyId, policyId as any)))
    .limit(1)

  if (!policyRows.length) return null

  const latestVersionRows = await q
    .select({
      versionId: policyVersions.versionId,
      payload: policyVersions.payload,
      processedAt: policyVersions.processedAt,
    })
    .from(policyVersions)
    .where(and(eq(policyVersions.tenantId, tenantId), eq(policyVersions.policyId, policyId as any)))
    .orderBy(desc(policyVersions.processedAt))
    .limit(1)

  return {
    policy: policyRows[0],
    latestVersionId: latestVersionRows.length ? String(latestVersionRows[0].versionId) : null,
    latestPayload: latestVersionRows.length ? latestVersionRows[0].payload : null,
    latestProcessedAt: latestVersionRows.length ? String(latestVersionRows[0].processedAt ?? '') : null
  }
}

export interface UpdatePolicyProjectionArgs {
  tenantId: string
  policyId: string
  premiumSummary?: any
  riskSummary?: any
  lifecycle?: any
  metadata?: any
  status?: string
  termEffectiveDate?: string
  termExpirationDate?: string
  termType?: string | null
  currencyCode?: string
}

export async function updatePolicyProjection(q: DrizzleDB, args: UpdatePolicyProjectionArgs): Promise<void> {
  const {
    tenantId,
    policyId,
    premiumSummary,
    riskSummary,
    lifecycle,
    metadata,
    status,
    termEffectiveDate,
    termExpirationDate,
    termType,
    currencyCode
  } = args

  const setValues: Record<string, any> = { updatedAt: new Date() }

  if (premiumSummary !== undefined) setValues.premiumSummary = premiumSummary
  if (riskSummary !== undefined) setValues.riskSummary = riskSummary
  if (lifecycle !== undefined) setValues.lifecycle = lifecycle
  if (metadata !== undefined) setValues.metadata = metadata
  if (status !== undefined) setValues.status = status
  if (termEffectiveDate !== undefined) setValues.termEffectiveDate = termEffectiveDate
  if (termExpirationDate !== undefined) setValues.termExpirationDate = termExpirationDate
  if (termType !== undefined) setValues.termType = termType
  if (currencyCode !== undefined) setValues.currencyCode = currencyCode

  await q
    .update(policies)
    .set(setValues)
    .where(and(eq(policies.tenantId, tenantId), eq(policies.policyId, policyId as any)))
}

export async function insertPolicyProjection(q: DrizzleDB, args: InsertPolicyArgs): Promise<void> {
  const {
    tenantId,
    policyId,
    policyNumber,
    productCode,
    productVersion = null,
    status,
    termEffectiveDate,
    termExpirationDate,
    termType = null,
    currencyCode,
    premiumSummary = null,
    riskSummary = null,
    lifecycle = null,
    externalIds = null,
    metadata = null
  } = args

  await q.insert(policies).values({
    tenantId,
    policyId: policyId as any,
    policyNumber,
    productCode,
    productVersion,
    status,
    termEffectiveDate,
    termExpirationDate,
    termType,
    currencyCode: currencyCode as any,
    premiumSummary,
    riskSummary,
    lifecycle,
    externalIds,
    metadata
  })
}

export async function insertPolicyTransaction(q: DrizzleDB, args: InsertPolicyTransactionArgs): Promise<void> {
  const {
    tenantId,
    transactionId,
    policyId,
    type,
    status,
    effectiveDate = null,
    processedAt = null,
    sequenceNo = null,
    baseTimelineVersion = null,
    timelineVersion = null,
    jurisdiction = null,
    term = null,
    requestedChanges = [],
    snapshot = null,
    ratingId = null,
    uw = null,
    notes = [],
    forms = [],
    documents: docs = [],
    createdBy = null,
    metadata = null
  } = args

  const dbTransactionType = normalizeTxnType(type)

  await q.insert(policyTransactions).values({
    tenantId,
    transactionId: transactionId as any,
    policyId: policyId as any,
    type: dbTransactionType as any,
    status: status as any,
    jurisdiction,
    term,
    requestedChanges,
    snapshot,
    ratingId: ratingId as any,
    uw,
    notes,
    forms,
    documents: docs,
    effectiveDate: effectiveDate as any,
    processedAt: processedAt ? new Date(processedAt) : null,
    sequenceNo,
    baseTimelineVersion,
    timelineVersion,
    createdBy: createdBy as any,
    metadata
  })
}

export async function insertPolicyVersion(q: DrizzleDB, args: InsertPolicyVersionArgs): Promise<void> {
  const {
    tenantId,
    policyId,
    versionId,
    transactionId = null,
    effectiveDate,
    transactionType,
    premiumTotal = 0,
    premiumFees = 0,
    premiumTaxes = 0,
    currency = 'USD',
    uwDecision = null,
    uwOverride = null,
    overrideReason = null,
    calcTrace = null,
    payload = null,
    transactionNumber = null,
    baseTimelineVersion = null,
    timelineVersion = null
  } = args

  const dbTransactionType = normalizeTxnType(transactionType) || transactionType

  await q.insert(policyVersions).values({
    tenantId,
    policyId: policyId as any,
    versionId: versionId as any,
    transactionId: transactionId as any,
    effectiveDate,
    transactionType: dbTransactionType as any,
    premiumTotal: String(premiumTotal) as any,
    premiumFees: String(premiumFees) as any,
    premiumTaxes: String(premiumTaxes) as any,
    currency: currency as any,
    uwDecision,
    uwOverride,
    overrideReason,
    calcTrace,
    payload,
    transactionNumber,
    baseTimelineVersion,
    timelineVersion
  })
}

export async function insertRating(q: DrizzleDB, args: InsertRatingArgs): Promise<void> {
  const {
    tenantId,
    ratingId,
    policyId,
    transactionId,
    inputs = null,
    components = [],
    discounts = [],
    surcharges = [],
    taxes = [],
    totalPremium = 0,
    currency = 'USD',
    calcTrace = null
  } = args

  await q.insert(ratings).values({
    tenantId,
    ratingId: ratingId as any,
    policyId: policyId as any,
    transactionId: transactionId as any,
    inputs,
    components,
    discounts,
    surcharges,
    taxes,
    totalPremium: String(totalPremium) as any,
    currencyCode: currency as any,
    calcTrace
  })

  // Generated rating worksheet metadata is non-critical; keep rating persistence resilient.
  try {
    await upsertRatingWorksheetDocument(q, {
      tenantId,
      policyId,
      transactionId,
      ratingId,
      inputs,
      components,
      discounts,
      surcharges,
      taxes,
      totalPremium,
      currency,
      calcTrace
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Rating worksheet document persistence skipped:', err)
  }
}

type UpsertRatingWorksheetDocumentArgs = {
  tenantId: string
  policyId: string
  transactionId: string
  ratingId: string
  inputs?: any
  components?: any
  discounts?: any
  surcharges?: any
  taxes?: any
  totalPremium?: number
  currency?: string
  calcTrace?: any
}

async function upsertRatingWorksheetDocument(q: DrizzleDB, args: UpsertRatingWorksheetDocumentArgs): Promise<void> {
  const {
    tenantId,
    policyId,
    transactionId,
    ratingId,
    inputs = null,
    components = [],
    discounts = [],
    surcharges = [],
    taxes = [],
    totalPremium = 0,
    currency = 'USD',
    calcTrace = null
  } = args

  const versionRows = await q
    .select({
      versionId: policyVersions.versionId,
      transactionNumber: policyVersions.transactionNumber,
      transactionType: policyVersions.transactionType,
      versionEffectiveDate: policyVersions.effectiveDate,
      premiumTotal: policyVersions.premiumTotal,
      premiumFees: policyVersions.premiumFees,
      premiumTaxes: policyVersions.premiumTaxes,
      currency: policyVersions.currency,
      payload: policyVersions.payload,
      processedAt: policyVersions.processedAt,
      policyNumber: policies.policyNumber,
      productCode: policies.productCode,
      termEffectiveDate: policies.termEffectiveDate,
      termExpirationDate: policies.termExpirationDate,
      transactionEffectiveDate: policyTransactions.effectiveDate,
      createdBy: policyTransactions.createdBy,
    })
    .from(policyVersions)
    .leftJoin(policies, and(
      eq(policies.tenantId, policyVersions.tenantId),
      eq(policies.policyId, policyVersions.policyId)
    ))
    .leftJoin(policyTransactions, and(
      eq(policyTransactions.tenantId, policyVersions.tenantId),
      eq(policyTransactions.transactionId, policyVersions.transactionId as any)
    ))
    .where(and(
      eq(policyVersions.tenantId, tenantId),
      eq(policyVersions.policyId, policyId as any),
      eq(policyVersions.transactionId, transactionId as any)
    ))
    .orderBy(desc(policyVersions.processedAt))
    .limit(1)

  if (!versionRows.length) return
  const versionRow = versionRows[0]
  const premiumCurrency = String(versionRow.currency || currency || 'USD')
  const metadata = {
    generatedKind: 'RATING_WORKSHEET',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ratingId,
    versionId: versionRow.versionId,
    snapshot: {
      payload: versionRow.payload || null,
      premium: {
        byCoverage: Array.isArray(components) ? components : [],
        discounts: Array.isArray(discounts) ? discounts : [],
        surcharges: Array.isArray(surcharges) ? surcharges : [],
        fees: { amount: safeMoney(versionRow.premiumFees), currency: premiumCurrency },
        taxes:
          taxes && typeof taxes === 'object' && !Array.isArray(taxes) && Object.prototype.hasOwnProperty.call(taxes, 'amount')
            ? taxes
            : { amount: safeMoney(versionRow.premiumTaxes), currency: premiumCurrency },
        total: { amount: safeMoney(versionRow.premiumTotal ?? totalPremium), currency: premiumCurrency },
        calcTrace: calcTrace || null
      },
      ratingInputs: inputs || null,
      context: {
        policyId,
        policyNumber: versionRow.policyNumber || null,
        productCode: versionRow.productCode || null,
        transactionId,
        transactionType: versionRow.transactionType || null,
        transactionNumber: versionRow.transactionNumber || null,
        quoteOrTransactionNumber: versionRow.transactionNumber || versionRow.versionId || null,
        policyEffectiveDate: versionRow.termEffectiveDate || null,
        policyExpirationDate: versionRow.termExpirationDate || null,
        transactionEffectiveDate: versionRow.transactionEffectiveDate || versionRow.versionEffectiveDate || null
      }
    }
  }

  const existingDocRows = await q
    .select({ documentId: documents.documentId })
    .from(documents)
    .where(and(
      eq(documents.tenantId, tenantId),
      eq(documents.policyId, policyId as any),
      eq(documents.transactionId, transactionId as any),
      eq(documents.type, 'RATING_WORKSHEET')
    ))
    .orderBy(desc(documents.createdAt))
    .limit(1)

  if (existingDocRows.length) {
    await q
      .update(documents)
      .set({
        uri: `generated://rating-worksheet/${transactionId}`,
        hash: `rating:${ratingId}`,
        metadata
      })
      .where(and(
        eq(documents.tenantId, tenantId),
        eq(documents.policyId, policyId as any),
        eq(documents.documentId, existingDocRows[0].documentId as any)
      ))
    return
  }

  await q.insert(documents).values({
    documentId: uuidv4() as any,
    tenantId,
    policyId: policyId as any,
    transactionId: transactionId as any,
    type: 'RATING_WORKSHEET',
    uri: `generated://rating-worksheet/${transactionId}`,
    hash: `rating:${ratingId}`,
    metadata,
    createdBy: versionRow.createdBy ?? null
  })
}

export async function persistRiskUnits(args: PersistRiskUnitsArgs): Promise<void> {
  const {
    q,
    tenantId,
    policyId,
    versionId,
    entries,
    productCode,
    transactionId = null,
    effectiveDate = null,
    expirationDate = null,
    uwAnswers = null
  } = args

  const normalizeJsonDoc = (val: any) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'object') return val
    return { value: String(val) }
  }

  for (const entry of entries) {
    await q.insert(riskUnits).values({
      tenantId,
      riskUnitId: entry.id as any,
      policyId: policyId as any,
      transactionId: transactionId as any,
      kind: entry.kind,
      attributes: entry.attributes || {},
      effectiveDate: effectiveDate as any,
      expirationDate: expirationDate as any
    })

    const type = (entry.attributes?.type || '').toString()
    if ((productCode || '').toLowerCase() === 'personal-auto' && type === 'autoVehicle') {
      const vehicle = entry.attributes || {}
      const driverAge = uwAnswers?.driverAge ?? vehicle.driverAge ?? null
      await q.insert(autoVehicles).values({
        tenantId,
        policyId: policyId as any,
        versionId: versionId as any,
        year: vehicle.year ?? null,
        make: vehicle.make ?? null,
        model: vehicle.model ?? null,
        vin: vehicle.vin ?? null,
        symbol: vehicle.symbol ?? null,
        garagingZip: vehicle.garagingZip ?? null,
        usage: vehicle.usage ?? null,
        annualMiles: vehicle.annualMiles ?? null,
        driverAge: driverAge
      })
    } else if ((productCode || '').toLowerCase() === 'homeowners' && type === 'dwelling') {
      const dwelling = entry.attributes || {}
      await q.insert(dwellings).values({
        tenantId,
        policyId: policyId as any,
        versionId: versionId as any,
        address: normalizeJsonDoc(dwelling.address),
        construction: dwelling.construction ?? null,
        protectionClass: dwelling.protectionClass ?? null,
        yearBuilt: dwelling.yearBuilt ?? null,
        roofAgeYears: dwelling.roofAgeYears ?? null,
        squareFeet: dwelling.squareFeet ?? null
      })
    }
  }
}

export async function persistCoverageRecords(args: PersistCoverageArgs): Promise<void> {
  const {
    q,
    tenantId,
    policyId,
    versionId,
    coverages: coverageList,
    transactionId = null,
    effectiveDate = null,
    expirationDate = null,
    fallbackRiskRef = null
  } = args

  const normalizeJsonValue = (val: any) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'number') {
      return Number.isFinite(val) ? val : null
    }
    if (typeof val === 'boolean') return val
    if (typeof val === 'string') {
      const trimmed = val.trim()
      if (!trimmed || trimmed.toLowerCase() === 'nan') return null
      return trimmed
    }
    if (typeof val === 'object') return val
    return null
  }
  const prepareJsonParam = (val: any) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'string') return JSON.stringify(val)
    return val
  }
  const toJsonDoc = (val: any, key: string) => {
    if (val === null || val === undefined) return null
    if (typeof val === 'object') return val
    return { [key]: val }
  }

  for (const coverage of coverageList) {
    const code = coverage.code || coverage.definitionCode
    if (!code) continue
    const coverageId = uuidv4()
    const selected = coverage.selected != null ? !!coverage.selected : true
    const limitRaw =
      coverage.limit ??
      coverage.limitValue ??
      coverage.limits?.amount ??
      coverage.limits?.limit ??
      null
    const deductibleRaw =
      coverage.deductible ??
      coverage.deductibles?.amount ??
      coverage.deductibles?.deductible ??
      null
    const limitValue = normalizeJsonValue(limitRaw)
    const deductibleValue = normalizeJsonValue(deductibleRaw)
    const percentValue = coverage.percent ?? null
    const appliesTo = coverage.appliesTo?.scope ?? 'policy'
    const riskRef = coverage.appliesTo?.riskRef ?? fallbackRiskRef
    const coverageLimitsDoc = toJsonDoc(limitValue, 'limit')
    const coverageDeductibleDoc = toJsonDoc(deductibleValue, 'deductible')
    const coverageOptionsDoc = coverage.options ?? (coverage.percent != null ? { percent: coverage.percent } : null)

    await q.insert(coverageSelections).values({
      tenantId,
      policyId: policyId as any,
      versionId: versionId as any,
      coverageCode: code,
      selected,
      limitValue: prepareJsonParam(limitValue),
      deductible: prepareJsonParam(deductibleValue),
      percent: percentValue !== null ? String(percentValue) as any : null
    })

    await q.insert(coverages).values({
      tenantId,
      coverageId: coverageId as any,
      policyId: policyId as any,
      transactionId: transactionId as any,
      riskUnitId: riskRef as any,
      appliesTo,
      definitionCode: code,
      limits: coverageLimitsDoc,
      deductibles: coverageDeductibleDoc,
      options: coverageOptionsDoc,
      effectiveDate: effectiveDate as any,
      expirationDate: expirationDate as any
    })
  }
}
