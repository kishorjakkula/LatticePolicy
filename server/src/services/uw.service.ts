import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { loadTenantOverrides } from '../products.js'
import { resolveFieldValue } from './underwriting-rule-fields.js'

export type UWDecision = { decision: 'Eligible'|'Refer'|'Decline'; reasons: string[] }

/**
 * Evaluates underwriting eligibility for a submission.
 *
 * Mirrors the "published/configured data takes over, hardcoded logic stays
 * as the fallback" pattern already used by rating.service.ts's
 * `rateWithPublishedModelOrFallback`: if the tenant has any active
 * `underwriting_rules` rows configured for this product (and matching
 * state), those rows are the *entire* decision -- not an addition on top of
 * the hardcoded checks. Otherwise, today's hand-coded per-product function
 * runs completely unchanged. This means a tenant/product with zero
 * configured rules sees zero behavior change from before this engine
 * existed.
 */
export async function evaluateUW(tenantId: string, payload: any): Promise<UWDecision> {
  const product = payload?.productCode as string
  const configured = await evaluateUwRules(tenantId, product, payload)
  if (configured) return configured
  return evaluateUwFallback(tenantId, product, payload)
}

/**
 * Looks up active, effective-dated `underwriting_rules` rows for
 * (tenantId, productCode[, stateCode]) and evaluates each one's condition
 * against `payload`. Returns `null` when nothing is configured (zero
 * matching rows) -- signaling the caller to fall back to the hardcoded
 * per-product function -- rather than `Eligible`, since silently treating
 * "nothing configured" as "approved" would remove today's protections for
 * every unconfigured product.
 *
 * When rows exist, every rule whose condition evaluates true contributes
 * its outcome and reason; the final decision is the max severity across all
 * firing rules (Decline > Refer > Eligible), matching the existing
 * escalation-only `maxDecision` semantics used by the hardcoded functions.
 * A configured ruleset where no rule's condition fires legitimately
 * produces `Eligible` with no reasons -- that is the tenant's own data
 * saying "nothing applies here", not a signal to fall back.
 */
export async function evaluateUwRules(
  tenantId: string,
  productCode: string,
  payload: any
): Promise<UWDecision | null> {
  if (!tenantId || !productCode) return null
  if (!getDb()) return null

  const stateCode = normalizeStateCode(payload?.state)
  const effectiveDate = normalizeEffectiveDate(payload?.effectiveDate)

  let rows: any[]
  try {
    rows = await withTenantTx(tenantId, async (innerDb) => {
      const q = toRawQuery(innerDb)
      const result = await q(
        `SELECT field_path, operator, comparison_value, outcome, reason_code, reason_description
           FROM underwriting_rules
          WHERE tenant_id = $1
            AND product_code = $2
            AND active = true
            AND (state_code IS NULL OR state_code = $3)
            AND effective_date <= $4::date
            AND (expiration_date IS NULL OR expiration_date >= $4::date)`,
        [tenantId, productCode, stateCode, effectiveDate]
      )
      return (result as any).rows || []
    })
  } catch (err: any) {
    // Table not created yet (pre-migration) -- behave exactly as "nothing configured".
    if (err?.code === '42P01') return null
    throw err
  }

  if (!rows.length) return null

  let decision: 'Eligible' | 'Refer' | 'Decline' = 'Eligible'
  const reasons: string[] = []
  for (const rule of rows) {
    if (evaluateRuleCondition(payload, rule)) {
      reasons.push(String(rule.reason_description))
      decision = maxDecision(decision, rule.outcome)
    }
  }
  return { decision, reasons }
}

function normalizeStateCode(value: unknown): string | null {
  const s = String(value || '').trim().toUpperCase()
  return s.length === 2 ? s : null
}

function normalizeEffectiveDate(value: unknown): string {
  const candidate = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate)
    ? candidate
    : new Date().toISOString().slice(0, 10)
}

function evaluateRuleCondition(payload: any, rule: { field_path: string; operator: string; comparison_value: unknown }): boolean {
  const fieldValue = resolveFieldValue(payload, rule.field_path)
  return applyOperator(fieldValue, rule.operator, rule.comparison_value)
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return undefined
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'yes' || v === '1') return true
    if (v === 'false' || v === 'no' || v === '0' || v === '') return false
  }
  return undefined
}

function normalizeComparable(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value).trim().toLowerCase()
}

function applyOperator(fieldValue: unknown, operator: string, comparisonValue: unknown): boolean {
  // A missing field never satisfies a comparison -- except `is_false`, which
  // (matching the hardcoded checks it replaces, e.g. MFA/written-contracts)
  // treats "not affirmatively true" as the referral-worthy condition.
  if (fieldValue === undefined) return operator === 'is_false'

  switch (operator) {
    case 'is_true':
      return coerceBoolean(fieldValue) === true
    case 'is_false':
      return coerceBoolean(fieldValue) !== true
    case 'equals':
    case 'not_equals': {
      const a = normalizeComparable(fieldValue)
      const b = normalizeComparable(comparisonValue)
      const eq = a !== null && b !== null && a === b
      return operator === 'equals' ? eq : !eq
    }
    case 'in':
    case 'not_in': {
      const list = Array.isArray(comparisonValue) ? comparisonValue : [comparisonValue]
      const a = normalizeComparable(fieldValue)
      const isIn = a !== null && list.some((item) => normalizeComparable(item) === a)
      return operator === 'in' ? isIn : !isIn
    }
    case 'greater_than':
    case 'greater_than_or_equal':
    case 'less_than':
    case 'less_than_or_equal': {
      const a = Number(fieldValue)
      const b = Number(comparisonValue)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      if (operator === 'greater_than') return a > b
      if (operator === 'greater_than_or_equal') return a >= b
      if (operator === 'less_than') return a < b
      return a <= b
    }
    default:
      return false
  }
}

/**
 * The original, hand-coded per-product underwriting logic. Runs unchanged
 * (byte-identical decisions/reasons) for any tenant/product combination with
 * zero configured `underwriting_rules` rows -- see
 * uw.service.test.ts's zero-rows regression coverage.
 *
 * The one-off tenant config.yaml `overrides.underwriting.rules` mechanism
 * remains active on this fallback path until an administrator explicitly
 * migrates the product to database-authored rules.
 */
function evaluateUwFallback(tenantId: string, product: string, payload: any): UWDecision {
  const reasons: string[] = []
  let decision: 'Eligible'|'Refer'|'Decline' = 'Eligible'

  if (product === 'personal-auto') {
    const age = Number(payload?.uwAnswers?.driverAge ?? payload?.risks?.[0]?.driverAge)
    if (!Number.isNaN(age)) {
      if (age < 16) { reasons.push('Driver age under 16 (decline)'); decision = 'Decline' }
      else if (age < 18) { reasons.push('Driver age under 18 (refer)'); decision = maxDecision(decision, 'Refer') }
    }
    const zip = payload?.risks?.[0]?.garagingZip
    if (!zip || String(zip).length !== 5) { reasons.push('Invalid garaging ZIP (refer)'); decision = maxDecision(decision, 'Refer') }
    const annualMiles = Number(payload?.risks?.[0]?.annualMiles)
    if (!Number.isNaN(annualMiles) && annualMiles > 35000) { reasons.push('Annual miles > 35k (refer)'); decision = maxDecision(decision, 'Refer') }
    const usage = (payload?.risks?.[0]?.usage || '').toString().toLowerCase()
    if (usage === 'rideshare' || usage === 'commercial') { reasons.push('Commercial/rideshare use (refer)'); decision = maxDecision(decision, 'Refer') }
    const symbol = (payload?.risks?.[0]?.symbol || '').toString().toUpperCase()
    if (symbol.includes('EXOTIC') || symbol.includes('PERF') || symbol.includes('SUPER')) { reasons.push('High-performance symbol (refer)'); decision = maxDecision(decision, 'Refer') }
  }

  if (product === 'commercial-auto') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const vehicleCount = Number(risk?.vehicleCount)
    const driverCount = Number(risk?.driverCount)
    const annualMileage = Number(risk?.annualMileage)
    const yearsInBusiness = Number(risk?.yearsInBusiness)
    const priorLossesCount = Number(risk?.priorLossesCount)
    const radiusClass = String(risk?.radiusClass || '').toLowerCase()
    const vehicleType = String(risk?.vehicleType || '').toLowerCase()
    const gvwClass = String(risk?.gvwClass || '').toLowerCase()
    const garagingZip = String(risk?.garagingZip || '')

    if (!/^\d{5}$/.test(garagingZip)) {
      reasons.push('Invalid primary garaging ZIP (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(vehicleCount) && vehicleCount > 150) {
      reasons.push('Fleet size > 150 vehicles (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(vehicleCount) && vehicleCount > 50) {
      reasons.push('Fleet size > 50 vehicles (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(driverCount) && !Number.isNaN(vehicleCount) && vehicleCount > 0) {
      const ratio = driverCount / vehicleCount
      if (ratio > 4) {
        reasons.push('High driver-to-vehicle ratio (refer)')
        decision = maxDecision(decision, 'Refer')
      }
    }
    if (radiusClass === 'long-haul') {
      reasons.push('Long-haul operations (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (vehicleType === 'tractor-trailer') {
      reasons.push('Tractor-trailer exposure requires underwriting review (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (vehicleType === 'dump-truck' || gvwClass === 'heavy') {
      reasons.push('Heavy commercial vehicle exposure (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualMileage) && annualMileage > 100000) {
      reasons.push('Average annual mileage > 100,000 (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(priorLossesCount) && priorLossesCount >= 6) {
      reasons.push('6+ prior commercial auto losses (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorLossesCount) && priorLossesCount >= 3) {
      reasons.push('Multiple prior commercial auto losses (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(yearsInBusiness) && yearsInBusiness < 1) {
      reasons.push('New venture < 1 year in business (refer)')
      decision = maxDecision(decision, 'Refer')
    }
  }

  if (product === 'homeowners') {
    const roofAge = Number(payload?.risks?.[0]?.roofAgeYears)
    if (!Number.isNaN(roofAge) && roofAge > 30) { reasons.push('Roof age > 30 (decline)'); decision = 'Decline' }
    else if (!Number.isNaN(roofAge) && roofAge >= 20) { reasons.push('Roof age 20-30 (refer)'); decision = maxDecision(decision, 'Refer') }
    const pc = Number(payload?.risks?.[0]?.protectionClass)
    if (!Number.isNaN(pc) && pc >= 9) { reasons.push('Protection class 9-10 (decline)'); decision = 'Decline' }
    else if (!Number.isNaN(pc) && pc >= 7) { reasons.push('Protection class 7-8 (refer)'); decision = maxDecision(decision, 'Refer') }
  }

  if (product === 'cyber') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const annualRevenue = Number(risk?.annualRevenue)
    const employeeCount = Number(risk?.employeeCount)
    const recordsCount = Number(risk?.recordsCount)
    const priorIncidents = Number(risk?.priorIncidents)
    const mfaEnabled = String(risk?.mfaEnabled || '').toLowerCase()
    const backups = String(risk?.backups || '').toLowerCase()

    if (!Number.isNaN(priorIncidents) && priorIncidents >= 3) {
      reasons.push('3+ prior cyber incidents (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorIncidents) && priorIncidents > 0) {
      reasons.push('Prior cyber incident history (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (mfaEnabled !== 'true' && mfaEnabled !== 'yes' && mfaEnabled !== '1') {
      reasons.push('MFA not fully enabled (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (backups === 'none') {
      reasons.push('No backup controls declared (decline)')
      decision = 'Decline'
    } else if (backups === 'monthly') {
      reasons.push('Infrequent backup controls (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualRevenue) && annualRevenue > 100000000) {
      reasons.push('Large revenue profile > $100M (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(employeeCount) && employeeCount > 5000) {
      reasons.push('Large workforce > 5,000 (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(recordsCount) && recordsCount > 5000000) {
      reasons.push('Very high sensitive records count (refer)')
      decision = maxDecision(decision, 'Refer')
    }
  }

  if (product === 'professional-liability') {
    const risk = Array.isArray(payload?.risks) ? payload.risks[0] || {} : {}
    const priorClaimsCount = Number(risk?.priorClaimsCount)
    const yearsInBusiness = Number(risk?.yearsInBusiness)
    const annualRevenue = Number(risk?.annualRevenue)
    const subcontractorPct = Number(risk?.subcontractorPct)
    const writtenContracts = String(risk?.writtenContracts || '').toLowerCase()
    const qualityControl = String(risk?.qualityControl || '').toLowerCase()
    const retroactiveYears = Number(risk?.retroactiveYears)
    const largestContractValue = Number(risk?.largestContractValue)

    if (!Number.isNaN(priorClaimsCount) && priorClaimsCount >= 4) {
      reasons.push('4+ prior professional liability claims (decline)')
      decision = 'Decline'
    } else if (!Number.isNaN(priorClaimsCount) && priorClaimsCount >= 2) {
      reasons.push('Multiple prior professional liability claims (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(yearsInBusiness) && yearsInBusiness < 1) {
      reasons.push('Startup or new venture with less than 1 year operations (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(annualRevenue) && annualRevenue > 50000000) {
      reasons.push('Revenue profile > $50M (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(subcontractorPct) && subcontractorPct > 75) {
      reasons.push('Subcontracted work exceeds 75% of revenue (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (writtenContracts !== 'true' && writtenContracts !== 'yes' && writtenContracts !== '1') {
      reasons.push('Written engagement contracts not consistently used (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (qualityControl === 'limited') {
      reasons.push('Limited QA / peer review controls (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(retroactiveYears) && retroactiveYears < 1) {
      reasons.push('No prior acts / retroactive coverage history (refer)')
      decision = maxDecision(decision, 'Refer')
    }
    if (!Number.isNaN(largestContractValue) && !Number.isNaN(annualRevenue) && annualRevenue > 0) {
      const concentrationPct = (largestContractValue / annualRevenue) * 100
      if (concentrationPct > 40) {
        reasons.push('High single-client / contract concentration (refer)')
        decision = maxDecision(decision, 'Refer')
      }
    }
  }

  // Preserve legacy tenant overrides until an administrator explicitly
  // migrates that product to database-authored rules. Removing this fallback
  // at deployment time would silently change underwriting behavior for a
  // tenant whose rules table is still empty.
  try {
    const tenantCfg = loadTenantOverrides(tenantId)
    const rules = tenantCfg?.overrides?.underwriting?.rules || []
    for (const r of rules) {
      if (r?.id === 'HO-ROOF-AGE' && product === 'homeowners') {
        const roofAge = Number(payload?.risks?.[0]?.roofAgeYears)
        if (!Number.isNaN(roofAge) && roofAge > 25) {
          reasons.push('Roof age > 25 (refer)')
          decision = maxDecision(decision, 'Refer')
        }
      }
    }
  } catch {}

  return { decision, reasons }
}

function maxDecision(cur: 'Eligible'|'Refer'|'Decline', next: 'Eligible'|'Refer'|'Decline'): 'Eligible'|'Refer'|'Decline' {
  const rank = { 'Eligible': 0, 'Refer': 1, 'Decline': 2 }
  return (rank[next] > rank[cur]) ? next : cur
}
