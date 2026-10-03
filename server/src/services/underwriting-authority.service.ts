export type AuthorityGrant = {
  grantId: string
  transactionTypes: string[]
  maxPremium: number | null
  maxLimit: number | null
  mayOverride: boolean
}

export type AuthorityDecision = {
  configured: boolean
  authorized: boolean
  grantId: string | null
  reasons: string[]
  mayOverride: boolean
}

export function evaluateAuthority(
  grants: AuthorityGrant[],
  input: { transactionType: string; premium: number; requestedLimit: number }
): AuthorityDecision {
  const applicable = grants.filter(grant =>
    grant.transactionTypes.includes(input.transactionType) || grant.transactionTypes.includes('*'))
  if (!applicable.length) return { configured: true, authorized: false, grantId: null, reasons: ['NO_AUTHORITY_GRANT'], mayOverride: false }
  for (const grant of applicable) {
    const reasons: string[] = []
    if (grant.maxPremium != null && input.premium > grant.maxPremium) reasons.push('PREMIUM_AUTHORITY_EXCEEDED')
    if (grant.maxLimit != null && input.requestedLimit > grant.maxLimit) reasons.push('LIMIT_AUTHORITY_EXCEEDED')
    if (!reasons.length) return { configured: true, authorized: true, grantId: grant.grantId, reasons: [], mayOverride: grant.mayOverride }
  }
  const best = applicable[0]
  const reasons = [
    ...(best.maxPremium != null && input.premium > best.maxPremium ? ['PREMIUM_AUTHORITY_EXCEEDED'] : []),
    ...(best.maxLimit != null && input.requestedLimit > best.maxLimit ? ['LIMIT_AUTHORITY_EXCEEDED'] : []),
  ]
  return { configured: true, authorized: false, grantId: best.grantId, reasons, mayOverride: best.mayOverride }
}

export function maximumRequestedLimit(payload: any): number {
  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : []
  return coverages.reduce((maximum: number, coverage: any) => {
    const candidates = [coverage?.limit, coverage?.perOccurrenceLimit, coverage?.aggregateLimit]
      .map(Number).filter(Number.isFinite)
    return Math.max(maximum, ...candidates, 0)
  }, 0)
}

export async function loadAuthorityGrants(q: any, input: {
  tenantId: string; actorId?: string | null; roles?: string[]; producerId?: string | null;
  productCode: string; stateCode: string; effectiveDate: string
}): Promise<AuthorityGrant[]> {
  const subjects = [
    ...(input.actorId ? [`USER:${input.actorId}`] : []),
    ...(input.roles || []).map(role => `ROLE:${role}`),
    ...(input.producerId ? [`PRODUCER:${input.producerId}`] : []),
  ]
  if (!subjects.length) return []
  const result = await q(
    `SELECT grant_id,transaction_types,max_premium,max_limit,may_override
       FROM underwriting_authority_grants
      WHERE tenant_id=$1 AND subject_type || ':' || subject_id = ANY($2::text[]) AND active=true
        AND (product_code IS NULL OR LOWER(product_code)=LOWER($3))
        AND (state_code IS NULL OR UPPER(state_code)=UPPER($4))
        AND effective_date <= $5::date AND (expiration_date IS NULL OR expiration_date >= $5::date)
      ORDER BY effective_date DESC`,
    [input.tenantId, subjects, input.productCode, input.stateCode, input.effectiveDate])
  return result.rows.map((row: any) => ({
    grantId: row.grant_id, transactionTypes: row.transaction_types || [],
    maxPremium: row.max_premium == null ? null : Number(row.max_premium),
    maxLimit: row.max_limit == null ? null : Number(row.max_limit), mayOverride: row.may_override === true,
  }))
}

export async function resolveAuthorityDecision(q: any, input: {
  tenantId: string; actorId?: string | null; roles?: string[]; producerId?: string | null;
  productCode: string; stateCode: string; effectiveDate: string; transactionType: string;
  premium: number; requestedLimit: number
}): Promise<AuthorityDecision> {
  const configuredResult = await q(
    `SELECT 1 FROM underwriting_authority_grants
      WHERE tenant_id=$1 AND active=true
        AND (product_code IS NULL OR LOWER(product_code)=LOWER($2))
        AND (state_code IS NULL OR UPPER(state_code)=UPPER($3))
        AND effective_date <= $4::date AND (expiration_date IS NULL OR expiration_date >= $4::date)
      LIMIT 1`,
    [input.tenantId, input.productCode, input.stateCode, input.effectiveDate])
  if (!configuredResult.rowCount) {
    return { configured: false, authorized: true, grantId: null, reasons: [], mayOverride: false }
  }
  const grants = await loadAuthorityGrants(q, input)
  return evaluateAuthority(grants, input)
}
