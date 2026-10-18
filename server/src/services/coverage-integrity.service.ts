import { withTenantTx, toRawQuery } from '../db.js'
import { listProductPackDirs } from '../lib/product-registry.js'
import { loadProductConfig } from '../lib/products.js'
import { ensureProductSnapshots } from '../lib/product-snapshot.js'
import { coverageViolations } from './product-rules.service.js'

/**
 * Read-only report of quotes and policies whose coverages are not offered by
 * their product (version). Nothing is changed: correcting a policy is the
 * carrier's decision (it may need an endorsement or a notice to the insured).
 *
 * The database selects candidates itself — records of an unknown product,
 * pinned to a missing product version, or with any coverage code outside the
 * codes common to every version of their product — so nothing is missed
 * however many records exist. Each candidate is then checked exactly against
 * its own pinned product version; one that cannot be checked is reported.
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

const RESULT_LIMIT = 500

/** Per product: the coverage codes every known version (current and pinned) defines. */
async function codesInEveryVersion(q: (sql: string, params?: any[]) => Promise<any>, tenantId: string): Promise<Record<string, string[]>> {
  const versions = new Map<string, Array<Set<string>>>()
  const add = (product: string, coverages: unknown) => {
    if (!Array.isArray(coverages)) return
    const codes = new Set(coverages.map((coverage: any) => String(coverage?.code || '')).filter(Boolean))
    versions.set(product, [...(versions.get(product) || []), codes])
  }
  for (const entry of listProductPackDirs()) {
    try {
      add(entry.code, loadProductConfig(entry.code as any)?.coverages)
    } catch {
      // A product without a readable definition is skipped, as rating skips it.
    }
  }
  const snapshots = await q(
    `SELECT product_code, definition->'config'->'coverages' AS coverages FROM product_snapshots WHERE tenant_id = $1`,
    [tenantId],
  )
  for (const row of snapshots.rows) add(String(row.product_code), row.coverages)
  const common: Record<string, string[]> = {}
  for (const [product, sets] of versions) {
    common[product] = [...sets[0]].filter((code) => sets.every((set) => set.has(code)))
  }
  return common
}

export async function coverageIntegrityReport(tenantId: string): Promise<{ items: CoverageIntegrityItem[]; total: number; truncated: boolean }> {
  const rows = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const common = JSON.stringify(await codesInEveryVersion(q, tenantId))
    // Candidates: the product is unknown, the pinned product version is
    // missing, or a coverage code is not defined by every version of the
    // product. Only the fields the check reads are loaded. Sequential: one client.
    const slim = (payload: string) =>
      `jsonb_strip_nulls(jsonb_build_object('productCode', ${payload}->'productCode', 'coverages', ${payload}->'coverages', 'productSnapshot', ${payload}->'productSnapshot'))`
    const candidate = (product: string, payload: string) =>
      `(NOT ($2::jsonb ? ${product})
        OR (${payload}->'productSnapshot'->>'id' IS NOT NULL AND NOT EXISTS (
              SELECT 1 FROM product_snapshots s WHERE s.tenant_id = $1 AND s.snapshot_id::text = ${payload}->'productSnapshot'->>'id'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${payload}->'coverages') = 'array' THEN ${payload}->'coverages' ELSE '[]'::jsonb END) c
              WHERE NOT (($2::jsonb -> ${product}) ? (c->>'code'))))`
    const quotes = await q(
      `SELECT 'quote' AS kind, quote_id::text AS id, quote_number AS number, product_code, status, created_at, ${slim('x.payload')} AS payload
         FROM quotes x WHERE tenant_id = $1 AND ${candidate('x.product_code', 'x.payload')}`,
      [tenantId, common],
    )
    // Each policy's latest version only, via the (tenant, policy, processed_at) index.
    const policies = await q(
      `SELECT 'policy' AS kind, p.policy_id::text AS id, p.policy_number AS number, p.product_code, p.status::text AS status,
              v.processed_at AS created_at, ${slim('v.payload')} AS payload
         FROM policies p
         CROSS JOIN LATERAL (
           SELECT pv.processed_at, pv.payload FROM policy_versions pv
            WHERE pv.tenant_id = p.tenant_id AND pv.policy_id = p.policy_id
            ORDER BY pv.processed_at DESC LIMIT 1
         ) v
        WHERE p.tenant_id = $1 AND ${candidate('p.product_code', 'v.payload')}`,
      [tenantId, common],
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
