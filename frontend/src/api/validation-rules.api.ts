import type { ValidationFinding, ValidationLevel, ValidationRule } from '@lattice-policy/rules'
import { request } from './request'

export type StoredValidationRule = ValidationRule & { ruleId: string; version: number; updatedBy: string | null; updatedAt: string }
export type ValidationRuleDraft = Omit<ValidationRule, 'active'> & { active: boolean }
export type CatalogField = { path: string; label: string; area: string }
export type ValidationHistoryEntry = { action: 'CREATED' | 'UPDATED' | 'DELETED'; actor: string; before: unknown; after: unknown; createdAt: string }
export type ValidationAcknowledgement = {
  level: 'bind' | 'issue'
  transactionType: string
  ruleCode: string
  ruleVersion: number | null
  message: string
  fieldPath: string | null
  acknowledgedBy: string
  createdAt: string
}

export const validationRulesApi = {
  list: () => request<{ items: StoredValidationRule[] }>('GET', '/v1/admin/validation-rules'),
  catalog: (productCode?: string | null) =>
    request<{ fields: CatalogField[] }>('GET', `/v1/admin/validation-rules/catalog${productCode ? `?productCode=${encodeURIComponent(productCode)}` : ''}`),
  history: (ruleId: string) => request<{ items: ValidationHistoryEntry[] }>('GET', `/v1/admin/validation-rules/${ruleId}/history`),
  create: (rule: ValidationRuleDraft) => request<StoredValidationRule>('POST', '/v1/admin/validation-rules', rule),
  update: (ruleId: string, rule: ValidationRuleDraft) => request<StoredValidationRule>('PUT', `/v1/admin/validation-rules/${ruleId}`, rule),
  remove: (ruleId: string) => request<{ deleted: true }>('DELETE', `/v1/admin/validation-rules/${ruleId}`),
  applicable: (productCode: string, state: string) =>
    request<{ items: ValidationRule[] }>(
      'GET',
      `/v1/validation-rules/applicable?productCode=${encodeURIComponent(productCode)}&state=${encodeURIComponent(state)}`,
    ),
  acknowledgements: (entityType: 'quote' | 'policy', entityId: string) =>
    request<{ items: ValidationAcknowledgement[] }>(
      'GET',
      `/v1/validation-acknowledgements?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`,
    ),
}

/** A rate, bind or issue request stopped by the carrier's validation rules. */
export type ValidationStop = {
  code: 'VALIDATION_FAILED' | 'VALIDATION_WARNINGS_UNACKNOWLEDGED'
  level: ValidationLevel
  transactionType: string
  errors: ValidationFinding[]
  warnings: ValidationFinding[]
  /** Warnings still to acknowledge (VALIDATION_WARNINGS_UNACKNOWLEDGED only). */
  pending: ValidationFinding[]
}

/**
 * Reads a validation stop from an API error. request() throws
 * `API <method> <path> failed <status>: <body>`; anything else returns null.
 */
export function validationStopFrom(error: unknown): ValidationStop | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const at = message.indexOf(': {')
  if (at < 0) return null
  try {
    const body = JSON.parse(message.slice(at + 2))
    if (body?.code !== 'VALIDATION_FAILED' && body?.code !== 'VALIDATION_WARNINGS_UNACKNOWLEDGED') return null
    const details = body.details || {}
    return {
      code: body.code,
      level: details.level,
      transactionType: details.transactionType,
      errors: Array.isArray(details.errors) ? details.errors : [],
      warnings: Array.isArray(details.warnings) ? details.warnings : [],
      pending: Array.isArray(details.pending) ? details.pending : [],
    }
  } catch {
    return null
  }
}
