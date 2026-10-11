import { ValidationError } from '../errors/domain.errors.js'
import { getProductCapabilities } from '../lib/product-registry.js'
import { loadProductConfig, loadRiskScreen } from '../lib/products.js'
import { checkQuoteAgainstScreen, type ScreenViolation } from '../lib/product-screen.js'
import { getLoadedSnapshot, snapshotIdOf } from '../lib/product-snapshot.js'

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

export type RuledTransaction = 'quote' | 'bind' | 'endorsement' | 'renewal' | 'rewrite' | 'reinstatement' | 'cancellation'

export function productRuleViolations(tenantId: string, payload: any): ScreenViolation[] {
  // A pinned payload is checked against the rules of the product version it
  // was written on, not rules added since.
  const snapshot = getLoadedSnapshot(snapshotIdOf(payload))
  if (snapshot) return snapshot.definition.screen ? checkQuoteAgainstScreen(snapshot.definition.screen, payload) : []
  const code = String(payload?.productCode || '').trim().toLowerCase()
  if (!code || !getProductCapabilities(code)) return []
  const screen = loadRiskScreen(code, loadProductConfig(code), tenantId)
  return screen ? checkQuoteAgainstScreen(screen, payload) : []
}

export function assertProductRules(tenantId: string, payload: any, transaction: RuledTransaction): void {
  const violations = productRuleViolations(tenantId, payload)
  if (violations.length === 0) return
  throw new ValidationError('PRODUCT_RULES_NOT_MET', {
    message: `This ${transaction} does not satisfy the rules for this product`,
    transaction,
    errors: violations,
  })
}

/** True when two payloads describe the same risks and coverages. */
export function sameRiskData(left: any, right: any): boolean {
  const pick = (payload: any) => JSON.stringify({ risks: payload?.risks ?? null, coverages: payload?.coverages ?? null })
  return pick(left) === pick(right)
}
