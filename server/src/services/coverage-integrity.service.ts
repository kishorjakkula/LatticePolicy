import { withTenantTx, toRawQuery } from '../db.js'
import { ensureProductSnapshots } from '../lib/product-snapshot.js'
import { coverageViolations } from './product-rules.service.js'

/**
 * Read-only report of quotes and policies whose coverages are not offered by
 * their product (version). Nothing is changed: correcting a policy is the
 * carrier's decision (it may need an endorsement or a notice to the insured).
 */
export type CoverageIntegrityItem = {
  kind: 'quote' | 'policy'
  id: string
  number: string | null
  productCode: string
  status: string | null
  unexpectedCodes: string[]
  note: string | null
  createdAt: string | null
}

const SCAN_LIMIT = 5000
const RESULT_LIMIT = 500

export async function coverageIntegrityReport(tenantId: string): Promise<{ items: CoverageIntegrityItem[]; total: number; truncated: boolean }> {
  const rows = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    // Sequential: queries share one transaction client.
    const quotes = await q(
      `SELECT 'quote' AS kind, quote_id::text AS id, quote_number AS number, product_code, status, created_at, payload
         FROM quotes
        WHERE tenant_id = $1 AND jsonb_typeof(payload->'coverages') = 'array' AND jsonb_array_length(payload->'coverages') > 0
        ORDER BY created_at DESC LIMIT $2`,
      [tenantId, SCAN_LIMIT],
    )
    const policies = await q(
      `SELECT DISTINCT ON (p.policy_id) 'policy' AS kind, p.policy_id::text AS id, p.policy_number AS number, p.product_code,
              p.status::text AS status, pv.processed_at AS created_at, pv.payload
         FROM policies p JOIN policy_versions pv ON pv.tenant_id = p.tenant_id AND pv.policy_id = p.policy_id
        WHERE p.tenant_id = $1
        ORDER BY p.policy_id, pv.processed_at DESC
        LIMIT $2`,
      [tenantId, SCAN_LIMIT],
    )
    return [...quotes.rows, ...policies.rows]
  })
  const payloadOf = (row: any) => ({ ...(row.payload || {}), productCode: row.payload?.productCode || row.product_code })
  // Load pinned product versions; a missing pin is reported, not fatal.
  try {
    await ensureProductSnapshots(tenantId, rows.map(payloadOf))
  } catch {
    // Records whose version is unavailable are flagged below.
  }
  const items: CoverageIntegrityItem[] = []
  for (const row of rows) {
    let unexpectedCodes: string[] = []
    let note: string | null = null
    try {
      unexpectedCodes = coverageViolations(tenantId, payloadOf(row)).map((violation) => violation.code)
    } catch {
      note = 'The product version this record was written on is not available; coverages could not be checked.'
    }
    if (!unexpectedCodes.length && !note) continue
    items.push({
      kind: row.kind,
      id: row.id,
      number: row.number || null,
      productCode: row.product_code,
      status: row.status || null,
      unexpectedCodes: [...new Set(unexpectedCodes)],
      note,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    })
  }
  items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return { items: items.slice(0, RESULT_LIMIT), total: items.length, truncated: items.length > RESULT_LIMIT }
}
