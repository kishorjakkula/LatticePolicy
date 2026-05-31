/**
 * policyCompliance.ts
 *
 * P0 compliance checks:
 *   - OFAC SDN screening at policy bind
 *   - State/product eligibility validation at quote creation
 *   - Quote expiry enforcement at bind
 *   - Short-rate return premium calculation for cancellations
 */

import type { QueryFn } from '../persistence.js'
import { round2 } from './date.utils.js'

// ──────────────────────────────────────────────────────────────
// OFAC Screening
// ──────────────────────────────────────────────────────────────

/** Normalize a name for fuzzy matching against the SDN list */
function normalizeOfacName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Compute a simple word-overlap similarity score (0..1).
 * Returns 1.0 for identical names; ≥0.7 triggers a POTENTIAL_HIT.
 */
function nameSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.split(' ').filter(Boolean))
  const wordsB = new Set(b.split(' ').filter(Boolean))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) { if (wordsB.has(w)) overlap++ }
  return overlap / Math.max(wordsA.size, wordsB.size)
}

export interface OfacScreenResult {
  screenId: string
  result: 'CLEAR' | 'POTENTIAL_HIT' | 'CONFIRMED_HIT'
  matchDetails: any[] | null
}

/**
 * Screen a party name against the OFAC SDN list.
 * Records the screen result in the ofac_screens table.
 */
export async function screenOfac(
  q: QueryFn,
  tenantId: string,
  partyName: string,
  opts: { policyId?: string | null; quoteId?: string | null } = {}
): Promise<OfacScreenResult> {
  const normalized = normalizeOfacName(partyName || '')
  let result: OfacScreenResult['result'] = 'CLEAR'
  let matchDetails: any[] | null = null

  if (normalized) {
    // Pull all SDN entries whose normalized_name shares at least one token
    const firstToken = normalized.split(' ')[0]
    const sdnRows = await q(
      `SELECT entry_id, name, normalized_name, aliases, country, list_type
         FROM ofac_sdn_list
        WHERE normalized_name LIKE $1
           OR normalized_name LIKE $2
        LIMIT 100`,
      [`${firstToken}%`, `% ${firstToken}%`]
    )

    const hits: any[] = []
    for (const row of sdnRows.rows ?? []) {
      const score = nameSimilarity(normalized, row.normalized_name)
      if (score >= 0.7) {
        hits.push({ entryId: row.entry_id, name: row.name, score, country: row.country, listType: row.list_type })
      }
      // Also check aliases
      const aliases: string[] = Array.isArray(row.aliases) ? row.aliases : []
      for (const alias of aliases) {
        const aliasScore = nameSimilarity(normalized, normalizeOfacName(alias))
        if (aliasScore >= 0.7) {
          hits.push({ entryId: row.entry_id, name: row.name, aliasMatch: alias, score: aliasScore })
        }
      }
    }

    if (hits.length > 0) {
      result = 'POTENTIAL_HIT'
      matchDetails = hits.slice(0, 10)
    }
  }

  // Record the screen
  const screenRes = await q(
    `INSERT INTO ofac_screens
       (tenant_id, party_name, policy_id, quote_id, result, match_details, disposition)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
     RETURNING screen_id`,
    [
      tenantId,
      partyName,
      opts.policyId || null,
      opts.quoteId || null,
      result,
      matchDetails ? JSON.stringify(matchDetails) : null,
      result === 'CLEAR' ? 'CLEARED' : 'PENDING'
    ]
  )

  const screenId = screenRes.rows[0]?.screen_id || ''
  return { screenId, result, matchDetails }
}

// ──────────────────────────────────────────────────────────────
// State / Product Eligibility
// ──────────────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean
  reason?: string
  status?: string
}

/**
 * Check whether a product is eligible to be written in a given state.
 * Falls back to ELIGIBLE if no eligibility record exists (open market default).
 */
export async function checkStateEligibility(
  q: QueryFn,
  tenantId: string,
  productCode: string,
  stateCode: string
): Promise<EligibilityResult> {
  if (!productCode || !stateCode) return { eligible: true }

  const res = await q(
    `SELECT status, admitted, surplus_lines, notes
       FROM product_state_eligibility
      WHERE tenant_id = $1 AND product_code = $2 AND state_code = $3
      LIMIT 1`,
    [tenantId, productCode, stateCode.toUpperCase()]
  )

  if (!res.rowCount) {
    // No eligibility record — treat as not configured (block by default for safety)
    return {
      eligible: false,
      reason: `Product '${productCode}' is not configured for state '${stateCode}'. Contact your underwriting team.`
    }
  }

  const row = res.rows[0]
  if (row.status !== 'ACTIVE') {
    const statusMessages: Record<string, string> = {
      SUSPENDED: `Writing of '${productCode}' in '${stateCode}' is currently suspended.`,
      CLOSED: `'${productCode}' is closed to new business in '${stateCode}'.`,
      FILING_PENDING: `Rate/form filing for '${productCode}' in '${stateCode}' is pending approval.`
    }
    return {
      eligible: false,
      status: row.status,
      reason: statusMessages[row.status] || `Product not available in '${stateCode}'.`
    }
  }

  return { eligible: true, status: 'ACTIVE' }
}

// ──────────────────────────────────────────────────────────────
// Quote Expiry
// ──────────────────────────────────────────────────────────────

export interface ExpiryCheckResult {
  expired: boolean
  expiryDate: string | null
}

export function checkQuoteExpiry(quote: { expiry_date?: string | null; expiryDate?: string | null }): ExpiryCheckResult {
  const raw = quote.expiry_date || quote.expiryDate
  if (!raw) return { expired: false, expiryDate: null }
  const expiryDate = String(raw).slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  return { expired: expiryDate < today, expiryDate }
}

// ──────────────────────────────────────────────────────────────
// Short-Rate Return Premium Calculation
// ──────────────────────────────────────────────────────────────

export interface CancellationReasonRow {
  reason_code: string
  description: string
  initiator: string
  cancellation_type: string
  notice_days: number
  return_premium: string
}

/**
 * Fetch cancellation reason code details from the DB.
 */
export async function getCancellationReasonCode(
  q: QueryFn,
  reasonCode: string
): Promise<CancellationReasonRow | null> {
  const res = await q(
    'SELECT * FROM cancellation_reason_codes WHERE reason_code = $1',
    [reasonCode]
  )
  return res.rowCount ? (res.rows[0] as CancellationReasonRow) : null
}

/**
 * Fetch all active cancellation reason codes.
 */
export async function listCancellationReasonCodes(q: QueryFn): Promise<CancellationReasonRow[]> {
  const res = await q(
    'SELECT * FROM cancellation_reason_codes ORDER BY initiator, reason_code',
    []
  )
  return res.rows as CancellationReasonRow[]
}

/**
 * Load the applicable short-rate table for a tenant/product/state.
 * Falls back to the global table (product_code IS NULL, state_code IS NULL).
 */
export async function loadShortRateTable(
  q: QueryFn,
  tenantId: string,
  productCode: string,
  stateCode: string
): Promise<Array<{ days_from: number; days_to: number; earned_pct: number }>> {
  // Preference order: tenant+product+state > tenant+product > tenant+state > tenant+global
  const res = await q(
    `SELECT table_data FROM short_rate_tables
      WHERE tenant_id = $1
        AND active = TRUE
        AND (product_code = $2 OR product_code IS NULL)
        AND (state_code   = $3 OR state_code   IS NULL)
      ORDER BY
        (CASE WHEN product_code IS NOT NULL THEN 1 ELSE 0 END) DESC,
        (CASE WHEN state_code   IS NOT NULL THEN 1 ELSE 0 END) DESC
      LIMIT 1`,
    [tenantId, productCode, stateCode?.toUpperCase() || null]
  )
  if (!res.rowCount) return []
  const raw = res.rows[0].table_data
  return Array.isArray(raw) ? raw : []
}

/**
 * Calculate the short-rate earned percentage given days in force and a table.
 * Returns the fraction of premium the carrier KEEPS (1 - return to insured).
 */
export function computeShortRateEarnedPct(
  daysInForce: number,
  table: Array<{ days_from: number; days_to: number; earned_pct: number }>
): number {
  for (const row of table) {
    if (daysInForce >= row.days_from && daysInForce <= row.days_to) {
      return row.earned_pct
    }
  }
  // Fallback: fully earned if beyond table
  return 1.0
}

/**
 * Compute the return premium for a cancellation.
 *
 * - PRO_RATA:    return = fullPremium × (remainingDays / termDays)
 * - SHORT_RATE:  return = fullPremium × (1 - shortRateEarnedPct)
 * - FLAT:        return = fullPremium (full refund)
 * - NONE:        return = 0
 */
export function computeReturnPremium(
  opts: {
    returnPremiumMethod: 'PRO_RATA' | 'SHORT_RATE' | 'FLAT' | 'NONE'
    fullPremium: number
    cancelDate: string
    termEffectiveDate: string
    termExpirationDate: string
    shortRateTable?: Array<{ days_from: number; days_to: number; earned_pct: number }>
  }
): { returnPremium: number; earnedPremium: number; method: string } {
  const { returnPremiumMethod, fullPremium, cancelDate, termEffectiveDate, termExpirationDate, shortRateTable } = opts


  if (returnPremiumMethod === 'FLAT') {
    return { returnPremium: round2(fullPremium), earnedPremium: 0, method: 'FLAT' }
  }

  if (returnPremiumMethod === 'NONE') {
    return { returnPremium: 0, earnedPremium: round2(fullPremium), method: 'NONE' }
  }

  const msPerDay = 1000 * 60 * 60 * 24
  const effDate = new Date(termEffectiveDate)
  const expDate = new Date(termExpirationDate)
  const canDate = new Date(cancelDate)

  const termDays = Math.max(1, Math.round((expDate.getTime() - effDate.getTime()) / msPerDay))
  const daysInForce = Math.max(0, Math.round((canDate.getTime() - effDate.getTime()) / msPerDay))
  const remainingDays = Math.max(0, termDays - daysInForce)

  if (returnPremiumMethod === 'PRO_RATA') {
    const returnPremium = round2(fullPremium * (remainingDays / termDays))
    return { returnPremium, earnedPremium: round2(fullPremium - returnPremium), method: 'PRO_RATA' }
  }

  if (returnPremiumMethod === 'SHORT_RATE') {
    const table = shortRateTable || []
    const earnedPct = computeShortRateEarnedPct(daysInForce, table)
    const earnedPremium = round2(fullPremium * earnedPct)
    const returnPremium = round2(fullPremium - earnedPremium)
    return { returnPremium, earnedPremium, method: 'SHORT_RATE' }
  }

  // Default: pro-rata
  const returnPremium = round2(fullPremium * (remainingDays / termDays))
  return { returnPremium, earnedPremium: round2(fullPremium - returnPremium), method: 'PRO_RATA' }
}
