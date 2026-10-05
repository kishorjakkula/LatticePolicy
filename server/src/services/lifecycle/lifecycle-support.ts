import { BadRequestError } from '../../errors/domain.errors.js'
import { coerceDateOnly, round2 } from '../../lib/date.utils.js'
import {
  resolvePolicyTransition,
  validatePolicyTransactionState,
  type PolicyTransactionAction,
  type PolicyTransition,
} from '../../lib/transaction-state.js'
import { mapProductRiskKind } from '../../lib/product-registry.js'

export function simplePremium(amount: number) {
  return {
    byCoverage: [],
    fees: { amount: 0, currency: 'USD' },
    taxes: { amount: 0, currency: 'USD' },
    total: { amount: round2(amount), currency: 'USD' },
  }
}

export function toArray(value: any): any[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

export function policyField(row: any, camelKey: string, snakeKey: string): any {
  return row?.[camelKey] ?? row?.[snakeKey]
}

export const policyTermEffective = (row: any) => coerceDateOnly(policyField(row, 'termEffectiveDate', 'term_effective_date'))
export const policyTermExpiration = (row: any) => coerceDateOnly(policyField(row, 'termExpirationDate', 'term_expiration_date'))
export const policyProductCode = (row: any) => String(policyField(row, 'productCode', 'product_code') || '')
export const policyCurrencyCode = (row: any) => String(policyField(row, 'currencyCode', 'currency_code') || 'USD')
export const policyPremiumSummary = (row: any) => policyField(row, 'premiumSummary', 'premium_summary')
export const policyRiskSummary = (row: any) => policyField(row, 'riskSummary', 'risk_summary')
export const policyTermType = (row: any) => policyField(row, 'termType', 'term_type') || null

export type TransactionNumberMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

export function transactionNumberPrefix(mode: TransactionNumberMode): string {
  if (mode === 'cancel') return 'CN-'
  if (mode === 'reinstate') return 'RI-'
  if (mode === 'rewrite') return 'RW-'
  if (mode === 'renew') return 'RN-'
  return 'EN-'
}

export function reserveTransactionNumber(mode: TransactionNumberMode): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${transactionNumberPrefix(mode)}${stamp}-${rand}`
}

export function assertPolicyTransactionState(action: PolicyTransactionAction, status: unknown): PolicyTransition {
  const result = validatePolicyTransactionState(action, status)
  if (!result.ok) throw new BadRequestError(result.code, result.message, result)
  return resolvePolicyTransition(action, status)!
}

export function mapRiskKind(productCode: string | undefined, risk: any): string {
  return mapProductRiskKind(productCode, risk)
}

export function summarizeRisk(risk: any): string {
  if (!risk || typeof risk !== 'object') return ''
  if (risk.type === 'autoVehicle') return [risk.year, risk.make, risk.model].filter(Boolean).join(' ').trim()
  if (risk.type === 'commercialAutoFleet') {
    return [risk.businessName, risk.vehicleCount ? `${risk.vehicleCount} vehicles` : '', risk.useClass, risk.radiusClass]
      .filter(Boolean).join(', ').trim()
  }
  if (risk.type === 'dwelling') return [risk.address, risk.construction, risk.yearBuilt].filter(Boolean).join(', ').trim()
  if (risk.type === 'cyberProfile') {
    return [risk.industry, risk.domain, risk.employeeCount ? `${risk.employeeCount} employees` : ''].filter(Boolean).join(', ').trim()
  }
  if (risk.type === 'professionalLiabilityProfile') {
    return [risk.industry, risk.yearsInBusiness ? `${risk.yearsInBusiness} yrs in business` : '', risk.employeeCount ? `${risk.employeeCount} employees` : '']
      .filter(Boolean).join(', ').trim()
  }
  return risk.type || 'risk'
}
