import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { loadTenantAiMlConfig } from '../tenantAi.js'
import {
  inferDashboardAiInsights,
  inferPolicyAiInsights,
  inferQuoteAiInsights,
  type DashboardAiInsights,
  type PolicyAiInsights,
  type QuoteAiInsights
} from '../aiMl.js'
import { NotFoundError } from '../errors/domain.errors.js'
import { coerceDateOnly } from '../lib/date.utils.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type QuoteInsightsBody = {
  payload?: any
  premium?: any
  underwriting?: any
  [key: string]: unknown
}

export type QuoteInsightsResult = {
  tenantId: string
  aiInsights: QuoteAiInsights
}

export type DashboardInsightsResult = {
  tenantId: string
  aiInsights: DashboardAiInsights
}

export type PolicyInsightsResult = {
  tenantId: string
  policyId: string
  aiInsights: PolicyAiInsights
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Run AI insights inference for a quote submission.
 *
 * Loads the tenant's AI/ML config and calls inferQuoteAiInsights with the
 * provided payload, premium, and underwriting data. No DB query beyond the
 * config load is needed; the inference is purely computational.
 */
export async function getQuoteInsights(
  db: DrizzleDB,
  tenantId: string,
  body: QuoteInsightsBody
): Promise<QuoteInsightsResult> {
  const aiMlConfig = await loadTenantAiMlConfig(tenantId)
  const aiInsights = inferQuoteAiInsights(aiMlConfig, {
    payload: body.payload || body,
    premium: body.premium,
    underwriting: body.underwriting
  })
  return { tenantId, aiInsights }
}

/**
 * Generate AI-driven portfolio insights for the dashboard.
 *
 * Loads policy and quote records for the tenant from the database, then runs
 * inferDashboardAiInsights against the tenant's AI/ML config.
 *
 * Queries:
 *   - policies (with latest premium_total from policy_versions)
 *   - quotes (status, effective_date, premium from JSONB)
 */
export async function getDashboardInsights(
  db: DrizzleDB,
  tenantId: string
): Promise<DashboardInsightsResult> {
  const aiMlConfig = await loadTenantAiMlConfig(tenantId)

  const [policyRows, quoteRows] = await Promise.all([
    withTenantTx(tenantId, (innerDb) =>
      toRawQuery(innerDb)(
        `SELECT p.status,
                p.term_effective_date,
                p.term_expiration_date,
                p.created_at,
                p.updated_at,
                COALESCE(
                  (
                    SELECT pv.premium_total::text
                    FROM policy_versions pv
                    WHERE pv.tenant_id = p.tenant_id
                      AND pv.policy_id = p.policy_id
                    ORDER BY pv.processed_at DESC NULLS LAST
                    LIMIT 1
                  ),
                  '0'
                ) AS premium_total
           FROM policies p
          WHERE p.tenant_id = $1`,
        [tenantId]
      )
    ),
    withTenantTx(tenantId, (innerDb) =>
      toRawQuery(innerDb)(
        `SELECT status, effective_date, created_at, updated_at,
                COALESCE(premium->'total'->>'amount', '0') AS premium_total
           FROM quotes
          WHERE tenant_id = $1`,
        [tenantId]
      )
    )
  ])

  const policies = ((policyRows as any).rows || []).map((row: any) => ({
    status: row.status,
    effectiveDate: coerceDateOnly(row.term_effective_date),
    expirationDate: coerceDateOnly(row.term_expiration_date),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    premiumTotal: Number(row.premium_total || 0)
  }))

  const quotes = ((quoteRows as any).rows || []).map((row: any) => ({
    status: row.status,
    effectiveDate: coerceDateOnly(row.effective_date),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    premiumTotal: Number(row.premium_total || 0)
  }))

  const aiInsights = inferDashboardAiInsights(aiMlConfig, { policies, quotes })

  return { tenantId, aiInsights }
}

/**
 * Generate AI-driven insights for a specific policy.
 *
 * Queries the policy record and all its versions, then runs
 * inferPolicyAiInsights against the tenant's AI/ML config.
 *
 * Throws NotFoundError if the policy does not exist for this tenant.
 */
export async function getPolicyInsights(
  db: DrizzleDB,
  tenantId: string,
  policyId: string
): Promise<PolicyInsightsResult> {
  const aiMlConfig = await loadTenantAiMlConfig(tenantId)

  const [policyRes, versionsRes] = await Promise.all([
    withTenantTx(tenantId, (innerDb) =>
      toRawQuery(innerDb)(
        `SELECT policy_id, product_code, status, term_effective_date, term_expiration_date
           FROM policies
          WHERE tenant_id = $1 AND policy_id = $2
          LIMIT 1`,
        [tenantId, policyId]
      )
    ),
    withTenantTx(tenantId, (innerDb) =>
      toRawQuery(innerDb)(
        `SELECT version_id, transaction_type, transaction_number, effective_date, processed_at,
                premium_total, premium_fees, premium_taxes, currency, payload
           FROM policy_versions
          WHERE tenant_id = $1 AND policy_id = $2
          ORDER BY processed_at ASC NULLS LAST, version_id ASC`,
        [tenantId, policyId]
      )
    )
  ])

  if (!((policyRes as any).rowCount || 0)) {
    throw new NotFoundError('POLICY_NOT_FOUND')
  }

  const policyRow = (policyRes as any).rows[0]
  const policyInput = {
    productCode: policyRow.product_code,
    status: policyRow.status,
    effectiveDate: coerceDateOnly(policyRow.term_effective_date),
    expirationDate: coerceDateOnly(policyRow.term_expiration_date)
  }

  const versionsInput = (((versionsRes as any).rows || []) as any[]).map((row: any) => ({
    transactionType: row.transaction_type,
    transactionNumber: row.transaction_number,
    effectiveDate: coerceDateOnly(row.effective_date),
    processedAt:
      row.processed_at instanceof Date
        ? row.processed_at.toISOString()
        : String(row.processed_at || ''),
    premiumTotal: Number(row.premium_total || 0),
    premiumFees: Number(row.premium_fees || 0),
    premiumTaxes: Number(row.premium_taxes || 0),
    currency: row.currency || 'USD',
    payload: row.payload && typeof row.payload === 'object' ? row.payload : null
  }))

  const aiInsights = inferPolicyAiInsights(aiMlConfig, {
    policy: policyInput,
    versions: versionsInput
  })

  return { tenantId, policyId, aiInsights }
}
