/**
 * Exposure management: normalizes per-product risk payloads into common
 * aggregation dimensions (product, jurisdiction, ZIP, class/industry,
 * vehicle/fleet counts, cyber revenue/records, TIV/limits) and aggregates
 * them across a tenant's in-force book, honoring point-in-time effective
 * dating via the existing policy timeline/state model.
 *
 * This is a query-time normalization layer, not a materialized table: it
 * reads the same `policies` / `policy_versions` rows the rest of the app
 * already writes, so there is no separate sync-correctness problem to
 * maintain. The tradeoff is one `getPolicyState` call per policy for
 * historical (`asOf` in the past) queries; see docs/tasks/issue-63-exposure-management-views.md
 * for the documented follow-up if this needs to become a bulk query at
 * larger book sizes.
 */
import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { getPolicyState } from './policy.service.js'

/** Label used when a policy has no computed reinsurance placement row. */
export const UNPLACED_TREATY_PROGRAM_LABEL = 'Unplaced (Direct)'

export interface ExposureRow {
  policyId: string
  policyNumber: string | null
  productCode: string
  state: string | null
  zip: string | null
  classOrIndustry: string | null
  vehicleFleetCount: number | null
  cyberAnnualRevenue: number | null
  cyberRecordsCount: number | null
  tiv: number | null
  effectiveDate: string | null
  expirationDate: string | null
  /**
   * Treaty/program label from the policy's latest computed
   * `policy_reinsurance_placements` row (see docs/REINSURANCE_MODEL.md),
   * or UNPLACED_TREATY_PROGRAM_LABEL when no placement has been computed.
   * Placement computation is on-demand (not auto-wired into bind/servicing
   * transactions), so most policies are expected to be Unplaced unless a
   * treaty/facultative placement was explicitly computed for them.
   */
  treatyProgram: string
}

export interface ExposureFilters {
  productCode?: string
  state?: string
  asOf?: string
}

export interface ExposureAggregateGroup {
  key: string
  policyCount: number
  totalTiv: number
  totalVehicleFleetCount: number
  totalCyberAnnualRevenue: number
}

export interface ExposureSummary {
  asOf: string
  policyCount: number
  totalTiv: number
  byProduct: ExposureAggregateGroup[]
  byState: ExposureAggregateGroup[]
  byClassOrIndustry: ExposureAggregateGroup[]
  byTreatyProgram: ExposureAggregateGroup[]
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function extractZipFromAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/)
  return match ? match[1] : null
}

function sumCoverageLimits(coverages: unknown): number | null {
  if (!Array.isArray(coverages)) return null
  let total = 0
  let sawAny = false
  for (const c of coverages) {
    if (!c || typeof c !== 'object') continue
    const selected = (c as any).selected
    if (selected === false) continue
    const limit = toNumberOrNull((c as any).limit)
    if (limit !== null) {
      total += limit
      sawAny = true
    }
  }
  return sawAny ? total : null
}

/**
 * Normalize one policy's payload (as returned by `getPolicyState` or the
 * latest bind payload) into exposure dimensions. Product-specific risk
 * `type` values match `mapRiskKind`'s inputs in quote-bind.service.ts.
 */
export function extractExposureDimensions(
  productCode: string,
  payload: any
): {
  state: string | null
  zip: string | null
  classOrIndustry: string | null
  vehicleFleetCount: number | null
  cyberAnnualRevenue: number | null
  cyberRecordsCount: number | null
  tiv: number | null
} {
  const risks: any[] = Array.isArray(payload?.risks) ? payload.risks : []
  const state =
    typeof payload?.state === 'string' && payload.state.trim()
      ? payload.state.trim().toUpperCase()
      : null

  let zip: string | null = null
  let classOrIndustry: string | null = null
  let vehicleFleetCount: number | null = null
  let cyberAnnualRevenue: number | null = null
  let cyberRecordsCount: number | null = null

  const normalized = (productCode || '').toLowerCase()

  for (const risk of risks) {
    const type = risk?.type

    if (normalized === 'personal-auto' && type === 'autoVehicle') {
      zip = zip || (typeof risk.garagingZip === 'string' ? risk.garagingZip : null)
      vehicleFleetCount = (vehicleFleetCount || 0) + 1
    }

    if (normalized === 'commercial-auto' && type === 'commercialAutoFleet') {
      zip = zip || (typeof risk.garagingZip === 'string' ? risk.garagingZip : null)
      classOrIndustry = classOrIndustry || (typeof risk.useClass === 'string' ? risk.useClass : null)
      const count = toNumberOrNull(risk.vehicleCount)
      if (count !== null) vehicleFleetCount = (vehicleFleetCount || 0) + count
    }

    if (normalized === 'homeowners' && type === 'dwelling') {
      zip = zip || extractZipFromAddress(risk.address)
    }

    if (normalized === 'cyber' && (type === 'cyberProfile' || type === 'firstParty' || type === 'thirdParty')) {
      const revenue = toNumberOrNull(risk.annualRevenue)
      if (revenue !== null) cyberAnnualRevenue = (cyberAnnualRevenue || 0) + revenue
      const records = toNumberOrNull(risk.recordsCount)
      if (records !== null) cyberRecordsCount = (cyberRecordsCount || 0) + records
    }

    if (normalized === 'professional-liability' && type === 'professionalLiabilityProfile') {
      classOrIndustry = classOrIndustry || (typeof risk.industry === 'string' ? risk.industry : null)
    }
  }

  const tiv = sumCoverageLimits(payload?.coverages)

  return { state, zip, classOrIndustry, vehicleFleetCount, cyberAnnualRevenue, cyberRecordsCount, tiv }
}

/**
 * Bulk-load each policy's latest computed reinsurance placement (if any) and
 * return a policyId -> treaty/program label map. One query for the whole
 * batch (not N+1): `DISTINCT ON (policy_id)` ordered by `computed_at DESC`
 * picks the most recent placement per policy.
 *
 * Facultative placements take precedence in the underlying data model (see
 * docs/REINSURANCE_MODEL.md's Facultative Precedence section), so a policy
 * with both a facultative certificate and treaty layers only ever has
 * FACULTATIVE rows persisted for the same transaction; there is no
 * competing-row ambiguity to resolve here.
 */
async function loadTreatyProgramLabels(
  q: (text: string, params?: any[]) => Promise<any>,
  tenantId: string,
  policyIds: string[]
): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  if (policyIds.length === 0) return labels

  const res = await q(
    `SELECT DISTINCT ON (p.policy_id)
            p.policy_id,
            p.placement_type,
            t.treaty_name,
            pr.program_name,
            fc.certificate_number
       FROM policy_reinsurance_placements p
       LEFT JOIN reinsurance_treaties t ON t.treaty_id = p.treaty_id
       LEFT JOIN reinsurance_programs pr ON pr.program_id = t.program_id
       LEFT JOIN reinsurance_facultative_certificates fc ON fc.certificate_id = p.facultative_certificate_id
      WHERE p.tenant_id = $1 AND p.policy_id = ANY($2::uuid[])
      ORDER BY p.policy_id, p.computed_at DESC`,
    [tenantId, policyIds]
  )

  for (const row of res.rows as any[]) {
    const label =
      row.placement_type === 'FACULTATIVE'
        ? `Facultative: ${row.certificate_number || 'Unlabeled'}`
        : row.program_name
          ? `${row.treaty_name} (${row.program_name})`
          : row.treaty_name || 'Unlabeled Treaty'
    labels.set(String(row.policy_id), label)
  }
  return labels
}

/**
 * Load normalized exposure rows for a tenant's in-force ("Issued") book,
 * optionally filtered by product/state and evaluated as of a specific date.
 *
 * When `asOf` is omitted (or equals "today"), this reads the policy's
 * current payload directly for efficiency. When `asOf` is a past date, it
 * calls `getPolicyState` per policy to respect the effective-dated timeline
 * (out-of-sequence endorsements/cancellations/reinstatements included).
 */
export async function loadExposureRows(
  _db: DrizzleDB,
  tenantId: string,
  filters: ExposureFilters = {}
): Promise<ExposureRow[]> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const clauses = [`tenant_id = $1`, `status = 'Issued'`]
    const params: any[] = [tenantId]
    let idx = 2
    if (filters.productCode) {
      clauses.push(`product_code = $${idx}`)
      params.push(filters.productCode)
      idx += 1
    }
    if (filters.state) {
      clauses.push(`jurisdiction_code = $${idx}`)
      params.push(filters.state.toUpperCase())
      idx += 1
    }

    const policiesRes = await q(
      `SELECT policy_id, policy_number, product_code, jurisdiction_code,
              term_effective_date, term_expiration_date
         FROM policies
        WHERE ${clauses.join(' AND ')}
        ORDER BY policy_id ASC`,
      params
    )

    const today = new Date().toISOString().slice(0, 10)
    const asOf = filters.asOf && filters.asOf !== today ? filters.asOf : undefined

    const policyIds = (policiesRes.rows as any[]).map((row) => String(row.policy_id))
    const treatyProgramLabels = await loadTreatyProgramLabels(q, tenantId, policyIds)

    const rows: ExposureRow[] = []
    for (const row of policiesRes.rows as any[]) {
      const policyId = String(row.policy_id)
      let payload: any = null

      if (asOf) {
        const state = await getPolicyState(db, tenantId, policyId, asOf)
        payload = state?.payload || null
      } else {
        const latestRes = await q(
          `SELECT payload FROM policy_versions
            WHERE tenant_id = $1 AND policy_id = $2
            ORDER BY effective_date DESC, processed_at DESC, version_id DESC
            LIMIT 1`,
          [tenantId, policyId]
        )
        payload = latestRes.rows?.[0]?.payload || null
      }

      const dims = extractExposureDimensions(row.product_code, payload || {})
      rows.push({
        policyId,
        policyNumber: row.policy_number || null,
        productCode: row.product_code,
        state: dims.state || row.jurisdiction_code || null,
        zip: dims.zip,
        classOrIndustry: dims.classOrIndustry,
        vehicleFleetCount: dims.vehicleFleetCount,
        cyberAnnualRevenue: dims.cyberAnnualRevenue,
        cyberRecordsCount: dims.cyberRecordsCount,
        tiv: dims.tiv,
        effectiveDate: row.term_effective_date
          ? new Date(row.term_effective_date).toISOString().slice(0, 10)
          : null,
        expirationDate: row.term_expiration_date
          ? new Date(row.term_expiration_date).toISOString().slice(0, 10)
          : null,
        treatyProgram: treatyProgramLabels.get(policyId) || UNPLACED_TREATY_PROGRAM_LABEL,
      })
    }
    return rows
  })
}

function aggregateBy(rows: ExposureRow[], keyFn: (r: ExposureRow) => string | null): ExposureAggregateGroup[] {
  const groups = new Map<string, ExposureAggregateGroup>()
  for (const row of rows) {
    const key = keyFn(row) || 'Unknown'
    const g = groups.get(key) || {
      key,
      policyCount: 0,
      totalTiv: 0,
      totalVehicleFleetCount: 0,
      totalCyberAnnualRevenue: 0,
    }
    g.policyCount += 1
    g.totalTiv += row.tiv || 0
    g.totalVehicleFleetCount += row.vehicleFleetCount || 0
    g.totalCyberAnnualRevenue += row.cyberAnnualRevenue || 0
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.policyCount - a.policyCount)
}

export async function computeExposureSummary(
  db: DrizzleDB,
  tenantId: string,
  filters: ExposureFilters = {}
): Promise<ExposureSummary> {
  const rows = await loadExposureRows(db, tenantId, filters)
  const asOf = filters.asOf || new Date().toISOString().slice(0, 10)
  return {
    asOf,
    policyCount: rows.length,
    totalTiv: rows.reduce((sum, r) => sum + (r.tiv || 0), 0),
    byProduct: aggregateBy(rows, (r) => r.productCode),
    byState: aggregateBy(rows, (r) => r.state),
    byClassOrIndustry: aggregateBy(rows, (r) => r.classOrIndustry),
    byTreatyProgram: aggregateBy(rows, (r) => r.treatyProgram),
  }
}

export function exposureRowsToCsv(rows: ExposureRow[]): string {
  const header = [
    'policyId',
    'policyNumber',
    'productCode',
    'state',
    'zip',
    'classOrIndustry',
    'vehicleFleetCount',
    'cyberAnnualRevenue',
    'cyberRecordsCount',
    'tiv',
    'effectiveDate',
    'expirationDate',
    'treatyProgram',
  ]
  const escape = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.policyId,
        row.policyNumber,
        row.productCode,
        row.state,
        row.zip,
        row.classOrIndustry,
        row.vehicleFleetCount,
        row.cyberAnnualRevenue,
        row.cyberRecordsCount,
        row.tiv,
        row.effectiveDate,
        row.expirationDate,
        row.treatyProgram,
      ]
        .map(escape)
        .join(',')
    )
  }
  return lines.join('\n')
}
