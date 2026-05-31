import { v4 as uuidv4 } from '../uuid.js'
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
    return [risk.year, risk.make, risk.model].filter(Boolean).join(' ').trim()
  }
  if (risk.type === 'dwelling') {
    return [risk.address, risk.construction, risk.yearBuilt].filter(Boolean).join(', ').trim()
  }
  return risk.type || 'risk'
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
  actorId?: string | null
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
  if (quote.uw) {
    if (quote.uw.decision === 'Decline') {
      throw new BadRequestError(
        'UW_DECLINED',
        `Underwriting decision: Decline. Reasons: ${quote.uw.reasons?.join('; ')}`
      )
    }
    if (quote.uw.decision === 'Refer' && !overrideReason) {
      throw new BadRequestError(
        'UW_OVERRIDE_REQUIRED',
        'Underwriting decision is Refer. Provide overrideReason to bind.'
      )
    }
  }

  // ── 4. OFAC screening ───────────────────────────────────────────────────────
  const insuredDisplayName = (
    (quote.payload?.insureds?.primary?.firstName || '') +
    ' ' +
    (quote.payload?.insureds?.primary?.lastName ||
      quote.payload?.applicant?.firstName ||
      '')
  ).trim()

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

  // ── 7. Customer link extraction ─────────────────────────────────────────────
  const quoteCustomerLinks = extractQuoteCustomerLinks(quote.payload)
  const primaryCustomerLink =
    quoteCustomerLinks.find((item: any) => item.isPrimary) ||
    quoteCustomerLinks[0] ||
    null
  const transactionMetadata: any = {
    sourceQuoteId: quoteId,
    transactionNumber,
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
  const uwOverride = quote.uw?.decision === 'Refer' && !!overrideReason
  const termDetails: any = { effectiveDate, expirationDate, termMonths: months }

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
      forms: [],
      documents: [],
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
