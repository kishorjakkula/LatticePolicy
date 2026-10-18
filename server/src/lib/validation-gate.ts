import { normalizeValidationTransaction, type ValidationLevel } from '@lattice-policy/rules'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { loadPolicyContext } from '../persistence.js'
import { enforceValidationRules } from '../services/validation-rules.service.js'

/**
 * Glue between transaction routes and the carrier's validation rules: picks
 * the payload and facts a level is checked against and runs the rules in the
 * caller's database transaction.
 */
export type GateInput = {
  level: ValidationLevel
  transaction: string
  payload: any
  transactionFacts?: Record<string, unknown>
  policy?: Record<string, unknown>
  premium?: unknown
  acknowledged?: unknown
  entity?: { type: 'quote' | 'policy'; id: string } | null
  actor: string
}

/** Removes the acknowledgement list from a request body so services never see it. */
export function takeAcknowledgements(body: any): { acknowledged: string[]; body: any } {
  if (!body || typeof body !== 'object') return { acknowledged: [], body: body || {} }
  const { validationAcknowledgements, ...rest } = body
  return { acknowledged: Array.isArray(validationAcknowledgements) ? validationAcknowledgements : [], body: rest }
}

/** Rated premium as `premium.total` (a number) for rule expressions. */
export function premiumFacts(premium: any): Record<string, unknown> {
  const total = Number(premium?.total?.amount ?? premium?.total ?? premium?.annualPremium)
  return Number.isFinite(total) ? { total } : {}
}

export async function runValidationGate(db: DrizzleDB, tenantId: string, input: GateInput) {
  return enforceValidationRules(toRawQuery(db), tenantId, {
    level: input.level,
    transactionType: normalizeValidationTransaction(input.transaction),
    payload: input.payload,
    extras: {
      transaction: input.transactionFacts,
      policy: input.policy,
      premium: input.premium === undefined ? undefined : premiumFacts(input.premium),
    },
    acknowledged: input.acknowledged,
    entity: input.entity,
    actor: input.actor,
  })
}

/**
 * Checks a policy transaction: the payload the request sends (the changed
 * policy) or, when it sends none, the policy as it stands.
 */
export async function runPolicyValidationGate(
  db: DrizzleDB,
  tenantId: string,
  policyId: string,
  input: Omit<GateInput, 'payload' | 'policy' | 'entity'> & { payload?: any },
) {
  const context = await loadPolicyContext(db, tenantId, policyId)
  // An unknown policy is left to the transaction itself to report.
  if (!context) return { errors: [], warnings: [] }
  const policy = context.policy || {}
  return runValidationGate(db, tenantId, {
    ...input,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : context.latestPayload || {},
    policy: {
      status: policy.status ?? null,
      policyNumber: policy.policyNumber ?? null,
      termEffectiveDate: policy.termEffectiveDate ?? null,
      termExpirationDate: policy.termExpirationDate ?? null,
    },
    entity: { type: 'policy', id: policyId },
  })
}
