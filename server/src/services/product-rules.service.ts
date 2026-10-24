import { ValidationError } from '../errors/domain.errors.js'
import { getInstalledProductCapabilities } from '../lib/product-registry.js'
import { loadProductConfig, loadRiskScreen } from '../lib/products.js'
import { checkQuoteAgainstScreen, type ScreenViolation } from '../lib/product-screen.js'
import { requireLoadedSnapshot } from '../lib/product-snapshot.js'
import { loadCarrierTables } from '../lib/carrier-tables.js'
import { productPackageViolations, type PackageViolation } from '../lib/product-package.js'

/**
 * Rules a carrier pack defines for a product (required fields, conditional
 * requirements, validations), applied to the risk data of any transaction.
 * The wizard applies the same rules on screen; checking them here means no
 * transaction can store data the product's own rules reject.
 *
 * Applied wherever risk data is created or can change: new quotes, bind,
 * endorsement, renewal, and rewrite. A cancellation or reinstatement that
 * leaves the risk data as it was is never blocked; one that changes it must
 * meet the rules too, so neither can be used to get around them.
 */

export type RuledTransaction = 'quote' | 'bind' | 'issue' | 'endorsement' | 'renewal' | 'rewrite' | 'reinstatement' | 'cancellation'

/** A coverage code the payload's product (version) does not define. */
export type CoverageViolation = { path: string; keyword: 'coverage'; code: string; message: string }
export type ProductRuleViolation = ScreenViolation | CoverageViolation | PackageViolation
export type ProductRuleOptions = {
  /**
   * The policy's current payload, for changes to an existing policy: undefined
   * coverage codes already on it are carried (and reported elsewhere), only
   * codes the change introduces are refused.
   */
  previous?: any
}

/** Coverage codes the payload's product defines: its pinned version, else the current definition. */
function definedCoverages(tenantId: string, payload: any): { codes: Set<string>; label: string } | null {
  const snapshot = requireLoadedSnapshot(tenantId, payload)
  const code = String(payload?.productCode || '').trim().toLowerCase()
  const config = snapshot ? snapshot.definition.config : code && getInstalledProductCapabilities(code) ? loadProductConfig(code) : null
  if (!config || !Array.isArray(config.coverages)) return null
  const codes = new Set<string>(config.coverages.map((coverage: any) => String(coverage?.code || '')).filter(Boolean))
  return { codes, label: String(config?.capabilities?.label || code || 'this product') }
}

/**
 * Coverage codes the product does not offer. Every product transaction refuses
 * them, so a quote or policy can never carry, be rated with or bind coverage
 * that was not defined (and filed) for its product.
 */
export function coverageViolations(tenantId: string, payload: any, options: ProductRuleOptions = {}): CoverageViolation[] {
  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : []
  if (!coverages.length) return []
  const defined = definedCoverages(tenantId, payload)
  if (!defined) return []
  const carried = new Set<string>(
    (Array.isArray(options.previous?.coverages) ? options.previous.coverages : []).map((coverage: any) => String(coverage?.code || '')),
  )
  const violations: CoverageViolation[] = []
  coverages.forEach((coverage: any, index: number) => {
    const code = String(coverage?.code || '').trim()
    if (!code || defined.codes.has(code) || carried.has(code)) return
    violations.push({ path: `/coverages/${index}/code`, keyword: 'coverage', code, message: `Coverage ${code} is not offered by ${defined.label}.` })
  })
  return violations
}

function screenViolations(tenantId: string, payload: any): ScreenViolation[] {
  // A pinned payload is checked against the rules of the product version it
  // was written on, not rules added since.
  const snapshot = requireLoadedSnapshot(tenantId, payload)
  if (snapshot) {
    return snapshot.definition.screen ? checkQuoteAgainstScreen(snapshot.definition.screen, payload, snapshot.definition.tables || {}) : []
  }
  const code = String(payload?.productCode || '').trim().toLowerCase()
  if (!code || !getInstalledProductCapabilities(code)) return []
  const screen = loadRiskScreen(code, loadProductConfig(code), tenantId)
  return screen ? checkQuoteAgainstScreen(screen, payload, loadCarrierTables(tenantId)) : []
}

export function productRuleViolations(tenantId: string, payload: any, options: ProductRuleOptions = {}): ProductRuleViolation[] {
  const snapshot = requireLoadedSnapshot(tenantId, payload)
  const code = String(payload?.productCode || '')
  const config = snapshot?.definition.config || (getInstalledProductCapabilities(code) ? loadProductConfig(code) : null)
  return [...screenViolations(tenantId, payload), ...coverageViolations(tenantId, payload, options), ...productPackageViolations(payload, config)]
}

function refuse(transaction: RuledTransaction, violations: ProductRuleViolation[]): void {
  if (violations.length === 0) return
  throw new ValidationError('PRODUCT_RULES_NOT_MET', {
    message: `This ${transaction} does not satisfy the rules for this product`,
    transaction,
    errors: violations,
  })
}

export function assertProductRules(tenantId: string, payload: any, transaction: RuledTransaction, options: ProductRuleOptions = {}): void {
  refuse(transaction, productRuleViolations(tenantId, payload, options))
}

/** Issue re-checks coverage codes only; bind already enforced the screen rules. */
export function assertCoveragesDefined(tenantId: string, payload: any, transaction: RuledTransaction): void {
  const snapshot = requireLoadedSnapshot(tenantId, payload)
  const code = String(payload?.productCode || '')
  const config = snapshot?.definition.config || (getInstalledProductCapabilities(code) ? loadProductConfig(code) : null)
  refuse(transaction, [...coverageViolations(tenantId, payload), ...productPackageViolations(payload, config)])
}

/** True when two payloads describe the same risks and coverages. */
export function sameRiskData(left: any, right: any): boolean {
  const pick = (payload: any) => JSON.stringify({ risks: payload?.risks ?? null, coverages: payload?.coverages ?? null })
  return pick(left) === pick(right)
}
