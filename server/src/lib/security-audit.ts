import { logger } from '../logger.js'

export type SensitiveAccessContext = {
  tenantId?: string | null
  userId?: string | null
  resource?: string
  field?: string
}

/**
 * Emits a structured audit log line for any read of sensitive/PII data.
 * Callers should pass context whenever available; context-free calls still
 * log (with nulls) so no decrypt path silently skips the audit trail.
 */
export function logSensitiveAccess(context: SensitiveAccessContext = {}): void {
  logger.info({
    audit: 'sensitive_data_access',
    tenantId: context.tenantId ?? null,
    userId: context.userId ?? null,
    resource: context.resource ?? 'unknown',
    field: context.field ?? 'unknown',
    ts: new Date().toISOString()
  }, 'Sensitive data accessed')
}
