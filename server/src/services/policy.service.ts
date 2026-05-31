import { toRawQuery, withTenantTx, type DrizzleDB } from '../db.js'
import { NotFoundError } from '../errors/domain.errors.js'
import { today, coerceDateOnly, addDays, asDateOnly } from '../lib/date.utils.js'
import { csvEscape } from '../lib/utils.js'
import { diffPayloadPaths, getByPath } from '../lib/patch.utils.js'
import { deriveTimelineSegments, findTimelineStateAtDate } from '../policyTimeline.js'
import { loadPolicyContext } from '../persistence.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PolicyStatusFilter =
  | ''
  | 'Draft'
  | 'Rated'
  | 'Bind'
  | 'Issued'
  | 'Inforced'
  | 'Expired'
  | 'Cancelled'

export interface ListPoliciesFilters {
  q?: string
  product?: string
  status?: PolicyStatusFilter
  effectiveFrom?: string
  effectiveTo?: string
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export function derivePolicyWorkflowStatus(
  rawStatus: any,
  effectiveDate: any,
  expirationDate: any
): string {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  const todayValue = today()
  const eff = coerceDateOnly(effectiveDate, todayValue)
  const exp = coerceDateOnly(expirationDate, todayValue)

  if (normalized === 'cancelled') return 'Cancelled'
  if (exp < todayValue) return 'Expired'
  if (normalized === 'bound') return 'Bind'
  if (normalized === 'issued') {
    if (eff <= todayValue && exp >= todayValue) return 'Inforced'
    return 'Issued'
  }
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'draft' || normalized === 'quote') return 'Draft'
  if (!normalized) return 'Draft'
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1)
}

export function normalizePolicyStatusFilter(rawValue: any): PolicyStatusFilter {
  const value = String(rawValue || '').trim()
  if (!value) return ''
  const normalized = value.toLowerCase()
  if (normalized === 'bound' || normalized === 'bind') return 'Bind'
  if (normalized === 'inforce' || normalized === 'inforced') return 'Inforced'
  if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled'
  if (normalized === 'draft') return 'Draft'
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'issued') return 'Issued'
  if (normalized === 'expired') return 'Expired'
  return ''
}

function appendPolicyStatusFilterClause(
  clauses: string[],
  params: any[],
  idx: number,
  statusFilter: PolicyStatusFilter,
  columns: {
    statusColumn: string
    effectiveDateColumn: string
    expirationDateColumn: string
  }
): number {
  if (!statusFilter) return idx
  const { statusColumn, effectiveDateColumn, expirationDateColumn } = columns
  const statusExpr = `LOWER(${statusColumn}::text)`

  if (statusFilter === 'Draft') {
    clauses.push(`${statusExpr} IN ('draft','quote')`)
    return idx
  }
  if (statusFilter === 'Rated') {
    clauses.push(`${statusExpr} = 'rated'`)
    return idx
  }
  if (statusFilter === 'Bind') {
    clauses.push(`${statusExpr} = 'bound'`)
    return idx
  }
  if (statusFilter === 'Cancelled') {
    clauses.push(`${statusExpr} = 'cancelled'`)
    return idx
  }

  const todayValue = today()
  params.push(todayValue)
  if (statusFilter === 'Issued') {
    clauses.push(
      `${statusExpr} = 'issued' AND ${effectiveDateColumn} > $${idx} AND ${expirationDateColumn} >= $${idx}`
    )
    return idx + 1
  }
  if (statusFilter === 'Inforced') {
    clauses.push(
      `${statusExpr} = 'issued' AND ${effectiveDateColumn} <= $${idx} AND ${expirationDateColumn} >= $${idx}`
    )
    return idx + 1
  }
  if (statusFilter === 'Expired') {
    clauses.push(`${statusExpr} <> 'cancelled' AND ${expirationDateColumn} < $${idx}`)
    return idx + 1
  }
  params.pop()
  return idx
}

// ── Service functions ─────────────────────────────────────────────────────────

/**
 * Retrieve a single policy by ID from the database.
 *
 * Joins to policy_customer_links / customers to resolve the primary customer.
 * Throws NotFoundError if the policy does not exist.
 */
export async function getPolicy(
  db: DrizzleDB,
  tenantId: string,
  policyId: string
): Promise<any> {
  const result = await withTenantTx(tenantId, (innerDb) =>
    toRawQuery(innerDb)(
      `SELECT
         p.*,
         link.customer_id AS linked_customer_id,
         link.customer_key AS linked_customer_key,
         link.customer_name AS linked_customer_name,
         link.first_name AS linked_customer_first_name,
         link.last_name AS linked_customer_last_name
       FROM policies p
       LEFT JOIN LATERAL (
         SELECT
           pcl.customer_id::text AS customer_id,
           c.customer_key,
           c.display_name AS customer_name,
           pd.first_name,
           pd.last_name
         FROM policy_customer_links pcl
         JOIN customers c
           ON c.tenant_id = pcl.tenant_id
          AND c.customer_id = pcl.customer_id
         LEFT JOIN customer_person_details pd
           ON pd.tenant_id = c.tenant_id
          AND pd.customer_id = c.customer_id
         WHERE pcl.tenant_id = p.tenant_id
           AND pcl.policy_id = p.policy_id
         ORDER BY
           CASE WHEN pcl.role_code = 'PRIMARY_NAMED_INSURED' THEN 0 WHEN pcl.is_primary THEN 1 ELSE 2 END,
           pcl.created_at ASC
         LIMIT 1
       ) link ON true
       WHERE p.tenant_id = $1 AND p.policy_id = $2
       LIMIT 1`,
      [tenantId, policyId]
    )
  )

  const rr: any = result
  if ((rr.rowCount ?? 0) === 0) throw new NotFoundError('POLICY_NOT_FOUND')

  const row = rr.rows[0]
  const effectiveDate = coerceDateOnly(row.term_effective_date)
  const expirationDate = coerceDateOnly(row.term_expiration_date)
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {}

  const linkedCustomerId = String(row.linked_customer_id || '').trim()
  const linkedCustomerKey = String(row.linked_customer_key || '').trim()
  const linkedCustomerName = String(row.linked_customer_name || '').trim()
  const metadataCustomerId = String((metadata as any).customerId || '').trim()
  const metadataCustomerKey = String((metadata as any).customerKey || '').trim()
  const metadataCustomerName = String((metadata as any).customerName || '').trim()
  const customerId = linkedCustomerId || metadataCustomerId
  const customerKey = linkedCustomerKey || metadataCustomerKey
  const firstName = String(row.linked_customer_first_name || '').trim()
  const lastName = String(row.linked_customer_last_name || '').trim()
  const fallbackNameFromPayload = [
    String(row?.risk_summary?.insureds?.primary?.firstName || '').trim(),
    String(row?.risk_summary?.insureds?.primary?.lastName || '').trim(),
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  const customerName = linkedCustomerName || metadataCustomerName || fallbackNameFromPayload

  return {
    policyId: row.policy_id,
    policyNumber: row.policy_number,
    tenantId,
    productCode: row.product_code,
    status: derivePolicyWorkflowStatus(row.status, effectiveDate, expirationDate),
    internalStatus: row.status,
    customer:
      customerId || customerKey || customerName
        ? {
            customerId: customerId || '',
            customerKey: customerKey || '',
            firstName,
            lastName,
            name: customerName || [firstName, lastName].filter(Boolean).join(' ').trim(),
          }
        : null,
    term: { effectiveDate, expirationDate },
    versions: [],
  }
}

/**
 * List policies from the database with filtering, sorting and pagination.
 *
 * Returns `{ items, total, page, pageSize }`.
 */
export async function listPolicies(
  db: DrizzleDB,
  tenantId: string,
  filters: ListPoliciesFilters
): Promise<{ items: any[]; total: number; page: number; pageSize: number }> {
  const {
    q = '',
    product = '',
    status = '' as PolicyStatusFilter,
    effectiveFrom = '',
    effectiveTo = '',
    page = 1,
    pageSize = 20,
    sortBy = 'effectiveDate',
    sortDir = 'desc',
  } = filters

  const clauses = ['p.tenant_id = $1']
  const params: any[] = [tenantId]
  let idx = 2

  if (q) {
    clauses.push(
      `(LOWER(p.policy_number) LIKE $${idx}` +
      ` OR CAST(p.policy_id AS text) LIKE $${idx}` +
      ` OR LOWER(COALESCE(insured_link.customer_name, TRIM(CONCAT_WS(' ', insured_link.first_name, insured_link.last_name)), '')) LIKE $${idx})`
    )
    params.push('%' + q + '%')
    idx++
  }
  if (product) {
    clauses.push('LOWER(p.product_code) = $' + idx)
    params.push(product)
    idx++
  }
  idx = appendPolicyStatusFilterClause(clauses, params, idx, status, {
    statusColumn: 'p.status',
    effectiveDateColumn: 'p.term_effective_date',
    expirationDateColumn: 'p.term_expiration_date',
  })
  if (effectiveFrom) {
    clauses.push('p.term_effective_date >= $' + idx)
    params.push(effectiveFrom)
    idx++
  }
  if (effectiveTo) {
    clauses.push('p.term_effective_date <= $' + idx)
    params.push(effectiveTo)
    idx++
  }

  const validSortBys = [
    'effectiveDate',
    'expirationDate',
    'policyNumber',
    'productCode',
    'status',
    'createdAt',
    'updatedAt',
    'updatedBy',
  ]
  const order = validSortBys.includes(sortBy) ? sortBy : 'effectiveDate'
  const sortColumn = ({
    effectiveDate: 'p.term_effective_date',
    expirationDate: 'p.term_expiration_date',
    policyNumber: 'p.policy_number',
    productCode: 'p.product_code',
    status: 'p.status',
    createdAt: 'p.created_at',
    updatedAt: 'p.updated_at',
    updatedBy: 'updated_actor_display',
  } as any)[order]
  const dir = sortDir === 'asc' ? 'asc' : 'desc'
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const offset = (page - 1) * pageSize

  const sqlText = `SELECT p.policy_id, p.policy_number, p.product_code, p.status, p.term_effective_date, p.term_expiration_date,
    p.created_at, p.updated_at, p.lifecycle, p.metadata,
    p.jurisdiction_code,
    p.premium_summary,
    COALESCE(
      insured_link.customer_name,
      NULLIF(TRIM(CONCAT_WS(' ', insured_link.first_name, insured_link.last_name)), '')
    ) AS insured_name,
    COALESCE(
      p_agent.name->>'display',
      NULLIF(TRIM(CONCAT_WS(' ', p_agent.name->>'first', p_agent.name->>'last')), ''),
      p_agent.org->>'legalName',
      p_agent.org->>'name'
    ) AS agent_name,
    COALESCE(
      u_updated.username,
      NULLIF(
        COALESCE(
          p.lifecycle->>'updatedBy',
          p.lifecycle->>'updated_by',
          p.metadata->>'updatedBy',
          p.metadata->>'updated_by',
          p.lifecycle->>'createdBy',
          p.lifecycle->>'created_by'
        ),
        ''
      ),
      'system'
    ) AS updated_actor_display,
    (1 + COALESCE((
      SELECT COUNT(*)
      FROM policy_versions pv
      WHERE pv.tenant_id = p.tenant_id
        AND pv.policy_id = p.policy_id
        AND LOWER(COALESCE(pv.transaction_type::text, '')) IN ('renew', 'renewal')
    ), 0))::int AS term_count
    FROM policies p
    LEFT JOIN LATERAL (
      SELECT
        c.display_name AS customer_name,
        pd.first_name,
        pd.last_name
      FROM policy_customer_links pcl
      JOIN customers c ON c.tenant_id = pcl.tenant_id AND c.customer_id = pcl.customer_id
      LEFT JOIN customer_person_details pd ON pd.tenant_id = c.tenant_id AND pd.customer_id = c.customer_id
      WHERE pcl.tenant_id = p.tenant_id AND pcl.policy_id = p.policy_id
      ORDER BY
        CASE WHEN pcl.role_code = 'PRIMARY_NAMED_INSURED' THEN 0 WHEN pcl.is_primary THEN 1 ELSE 2 END,
        pcl.created_at ASC
      LIMIT 1
    ) insured_link ON true
    LEFT JOIN LATERAL (
      SELECT pp.party_id FROM policy_parties pp
      WHERE pp.policy_id = p.policy_id AND pp.tenant_id = p.tenant_id
        AND LOWER(pp.role_code) IN ('agent', 'producer', 'broker', 'agent/broker')
      LIMIT 1
    ) pp_agent_link ON true
    LEFT JOIN parties p_agent ON p_agent.party_id = pp_agent_link.party_id
    LEFT JOIN users u_updated ON u_updated.tenant_id = p.tenant_id
      AND u_updated.user_id::text = COALESCE(
        p.lifecycle->>'updatedBy',
        p.lifecycle->>'updated_by',
        p.metadata->>'updatedBy',
        p.metadata->>'updated_by',
        p.lifecycle->>'createdBy',
        p.lifecycle->>'created_by'
      )
    ${where} ORDER BY ${sortColumn} ${dir} LIMIT ${pageSize} OFFSET ${offset}`

  const countSqlText = `SELECT COUNT(*) FROM policies p
    LEFT JOIN LATERAL (
      SELECT
        c.display_name AS customer_name,
        pd.first_name,
        pd.last_name
      FROM policy_customer_links pcl
      JOIN customers c ON c.tenant_id = pcl.tenant_id AND c.customer_id = pcl.customer_id
      LEFT JOIN customer_person_details pd ON pd.tenant_id = c.tenant_id AND pd.customer_id = c.customer_id
      WHERE pcl.tenant_id = p.tenant_id AND pcl.policy_id = p.policy_id
      ORDER BY
        CASE WHEN pcl.role_code = 'PRIMARY_NAMED_INSURED' THEN 0 WHEN pcl.is_primary THEN 1 ELSE 2 END,
        pcl.created_at ASC
      LIMIT 1
    ) insured_link ON true
    ${where}`

  const [rows, cnt] = await Promise.all([
    withTenantTx(tenantId, (innerDb) => toRawQuery(innerDb)(sqlText, params)),
    withTenantTx(tenantId, (innerDb) => toRawQuery(innerDb)(countSqlText, params)),
  ])

  const items = (rows as any).rows.map((r: any) => {
    const effectiveDate = coerceDateOnly(r.term_effective_date)
    const expirationDate = coerceDateOnly(r.term_expiration_date)
    const premSummary = r.premium_summary
    const premiumTotal = premSummary?.total?.amount != null ? Number(premSummary.total.amount) : null
    const premiumCurrency = premSummary?.total?.currency || 'USD'
    return {
      policyId: r.policy_id,
      policyNumber: r.policy_number,
      productCode: r.product_code,
      status: derivePolicyWorkflowStatus(r.status, effectiveDate, expirationDate),
      internalStatus: r.status,
      term: { effectiveDate, expirationDate },
      termCount: Number(r.term_count || 1),
      createdAt: r.created_at || null,
      updatedAt: r.updated_at || null,
      updatedBy: r.updated_actor_display || 'system',
      insuredName: r.insured_name || '',
      state: r.jurisdiction_code ? String(r.jurisdiction_code).replace(/^US-/i, '').toUpperCase() : '',
      agentName: r.agent_name || '',
      premium: premiumTotal != null ? { total: { amount: premiumTotal, currency: premiumCurrency } } : null,
      annualPremium: premiumTotal,
    }
  })

  const total = Number((cnt as any).rows[0].count)
  return { items, total, page, pageSize }
}

// ── Helper: current as-of date ────────────────────────────────────────────────

function currentPolicyStateAsOfDate(termEffectiveDate: string, termExpirationDate: string): string {
  const currentDate = today()
  if (currentDate >= termExpirationDate) {
    const prev = new Date(`${termExpirationDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000
    const fallback = new Date(prev).toISOString().slice(0, 10)
    return fallback < termEffectiveDate ? termEffectiveDate : fallback
  }
  return currentDate
}

// ── 2a. getFullPolicyPayload ──────────────────────────────────────────────────

/**
 * Reconstruct the full policy payload from the database by querying ~13 tables.
 * Returns null if no data is found.
 */
export async function getFullPolicyPayload(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string,
  versionId?: string
): Promise<any | null> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    let pv: any
    if (versionId) {
      pv = await q(
        'SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
        [tenantId, policyId, versionId]
      )
    } else {
      pv = await q(
        'SELECT payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1',
        [tenantId, policyId]
      )
    }
    if (pv.rowCount && pv.rows[0].payload) return pv.rows[0].payload
    const pol = await q(
      'SELECT product_code FROM policies WHERE tenant_id=$1 AND policy_id=$2',
      [tenantId, policyId]
    )
    if (!pol.rowCount) return null
    const productCode = pol.rows[0].product_code
    const latest = versionId
      ? versionId
      : (
          await q(
            'SELECT version_id FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 ORDER BY processed_at DESC LIMIT 1',
            [tenantId, policyId]
          )
        ).rows[0]?.version_id
    if (!latest) return null
    const ru = await q(
      'SELECT attributes FROM risk_units WHERE tenant_id=$1 AND policy_id=$2 ORDER BY effective_date NULLS FIRST, created_at',
      [tenantId, policyId]
    )
    const cov = await q(
      'SELECT definition_code, limits, deductibles, options FROM coverages WHERE tenant_id=$1 AND policy_id=$2 ORDER BY created_at',
      [tenantId, policyId]
    )
    const fallbackCov = await q(
      'SELECT coverage_code AS code, selected, limit_value AS limit, deductible, percent FROM coverage_selections WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3 ORDER BY coverage_code',
      [tenantId, policyId, latest]
    )
    const av = await q(
      'SELECT year, make, model, vin, symbol, garaging_zip, usage, annual_miles, driver_age FROM auto_vehicles WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
      [tenantId, policyId, latest]
    )
    const dw = await q(
      'SELECT address, construction, protection_class, year_built, roof_age_years, square_feet FROM dwellings WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
      [tenantId, policyId, latest]
    )
    const payload: any = { productCode, risks: [], coverages: [] }
    if (ru.rowCount) {
      payload.risks = ru.rows.map((r: any) => r.attributes)
      const firstRisk = payload.risks[0]
      if (firstRisk?.driverAge) payload.uwAnswers = { driverAge: firstRisk.driverAge }
    } else if (av.rowCount) {
      const r = av.rows[0]
      payload.risks.push({
        type: 'autoVehicle',
        year: r.year,
        make: r.make,
        model: r.model,
        vin: r.vin,
        symbol: r.symbol,
        garagingZip: r.garaging_zip,
        usage: r.usage,
        annualMiles: r.annual_miles,
        driverAge: r.driver_age,
      })
      payload.uwAnswers = { driverAge: r.driver_age }
    } else if (dw.rowCount) {
      const r = dw.rows[0]
      payload.risks.push({
        type: 'dwelling',
        address: r.address,
        construction: r.construction,
        protectionClass: r.protection_class,
        yearBuilt: r.year_built,
        roofAgeYears: r.roof_age_years,
        squareFeet: r.square_feet,
      })
    }
    if (cov.rowCount) {
      payload.coverages = cov.rows.map((c: any) => ({
        code: c.definition_code,
        selected: true,
        limit: c.limits?.limit ?? c.limits?.amount ?? null,
        deductible: c.deductibles?.deductible ?? null,
        options: c.options || null,
      }))
    } else {
      payload.coverages = fallbackCov.rows
    }
    return payload
  })
}

// ── 2b. getPolicyTimeline ─────────────────────────────────────────────────────

/**
 * Build the full policy timeline: transactions, ratings, forms, documents,
 * notes, and ledger events.
 */
export async function getPolicyTimeline(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string
): Promise<any> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const policyRes = await q(
      'SELECT policy_id, policy_number, product_code, status, term_effective_date, term_expiration_date, currency_code FROM policies WHERE tenant_id=$1 AND policy_id=$2',
      [tenantId, policyId]
    )
    if (!policyRes.rowCount) throw new NotFoundError('POLICY_NOT_FOUND')

    const txnRes = await q(
      `SELECT transaction_id, type, status, jurisdiction, term, requested_changes, snapshot, rating_id,
              uw, metadata, created_at, created_by
         FROM policy_transactions
        WHERE tenant_id=$1 AND policy_id=$2
        ORDER BY created_at`,
      [tenantId, policyId]
    )
    const txnIds = txnRes.rows.map((r: any) => r.transaction_id).filter(Boolean)

    let ratingRows: any[] = []
    if (txnIds.length) {
      const ratings = await q(
        `SELECT rating_id, transaction_id, inputs, components, discounts, surcharges, taxes, total_premium, currency_code, calc_trace
           FROM ratings
          WHERE tenant_id=$1 AND policy_id=$2 AND transaction_id = ANY($3)`,
        [tenantId, policyId, txnIds]
      )
      ratingRows = ratings.rows
    }

    const formRowsRes = await q(
      `SELECT pf.policy_form_id, pf.transaction_id, pf.form_id, pf.code, pf.created_at, pf.metadata,
              fc.code AS catalog_code, fc.name, fc.edition
         FROM policy_forms pf
         LEFT JOIN forms_catalog fc ON fc.form_id = pf.form_id
        WHERE pf.tenant_id=$1 AND pf.policy_id=$2
        ORDER BY pf.created_at`,
      [tenantId, policyId]
    )

    const docRowsRes = await q(
      `SELECT document_id, transaction_id, type, uri, hash, metadata, created_at, created_by
         FROM documents
        WHERE tenant_id=$1 AND policy_id=$2
        ORDER BY created_at`,
      [tenantId, policyId]
    )

    let noteRows: any[] = []
    if (txnIds.length) {
      const notesRes = await q(
        `SELECT note_id, transaction_id, note_type, note_text, visibility, added_by, created_at, metadata
           FROM notes
          WHERE tenant_id=$1 AND transaction_id = ANY($2)
          ORDER BY created_at`,
        [tenantId, txnIds]
      )
      noteRows = notesRes.rows
    }

    const ledgerRowsRes = await q(
      `SELECT event_id, event, from_state, to_state, payload, occurred_at, actor
         FROM ledger_events
        WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3
        ORDER BY occurred_at`,
      [tenantId, 'Policy', policyId]
    )

    // ── shape the response ──────────────────────────────────────────────
    const policyRow = policyRes.rows[0]

    const ratingByTxn: Record<string, any> = {}
    for (const row of ratingRows) {
      ratingByTxn[row.transaction_id] = {
        ratingId: row.rating_id,
        transactionId: row.transaction_id,
        inputs: row.inputs || null,
        components: row.components || [],
        discounts: row.discounts || [],
        surcharges: row.surcharges || [],
        taxes: row.taxes || [],
        total:
          row.total_premium != null
            ? { amount: Number(row.total_premium), currency: row.currency_code || 'USD' }
            : null,
        currencyCode: row.currency_code || 'USD',
        calcTrace: row.calc_trace || null,
      }
    }

    const formsByTxn: Record<string, any[]> = {}
    for (const row of formRowsRes.rows as any[]) {
      const key = row.transaction_id || '__policy'
      if (!formsByTxn[key]) formsByTxn[key] = []
      formsByTxn[key].push({
        policyFormId: row.policy_form_id,
        transactionId: row.transaction_id || null,
        formId: row.form_id || null,
        code: row.code || row.catalog_code || null,
        name: row.name || null,
        edition: row.edition || null,
        metadata: row.metadata || null,
        createdAt: row.created_at || null,
      })
    }

    const docsByTxn: Record<string, any[]> = {}
    for (const row of docRowsRes.rows as any[]) {
      const key = row.transaction_id || '__policy'
      if (!docsByTxn[key]) docsByTxn[key] = []
      docsByTxn[key].push({
        documentId: row.document_id,
        transactionId: row.transaction_id || null,
        type: row.type,
        uri: row.uri || null,
        hash: row.hash || null,
        metadata: row.metadata || null,
        createdAt: row.created_at || null,
        createdBy: row.created_by || null,
      })
    }

    const notesByTxn: Record<string, any[]> = {}
    for (const row of noteRows) {
      const key = row.transaction_id || '__policy'
      if (!notesByTxn[key]) notesByTxn[key] = []
      notesByTxn[key].push({
        noteId: row.note_id,
        transactionId: row.transaction_id || null,
        noteType: row.note_type || null,
        noteText: row.note_text || null,
        visibility: row.visibility || null,
        addedBy: row.added_by || null,
        createdAt: row.created_at || null,
        metadata: row.metadata || null,
      })
    }

    const transactions = (txnRes.rows as any[]).map((row: any) => ({
      transactionId: row.transaction_id,
      type: row.type,
      status: row.status,
      jurisdiction: row.jurisdiction,
      term: row.term,
      requestedChanges: row.requested_changes || [],
      metadata: row.metadata || null,
      createdAt: row.created_at || null,
      createdBy: row.created_by || null,
      rating: ratingByTxn[row.transaction_id] || null,
      forms: formsByTxn[row.transaction_id] || [],
      documents: docsByTxn[row.transaction_id] || [],
      notes: notesByTxn[row.transaction_id] || [],
    }))

    const ledger = (ledgerRowsRes.rows as any[]).map((row: any) => ({
      eventId: row.event_id,
      event: row.event,
      fromState: row.from_state,
      toState: row.to_state,
      payload: row.payload,
      occurredAt: row.occurred_at,
      actor: row.actor,
    }))

    return {
      policyId,
      policyNumber: policyRow.policy_number,
      productCode: policyRow.product_code,
      status: policyRow.status,
      termEffectiveDate: coerceDateOnly(policyRow.term_effective_date),
      termExpirationDate: coerceDateOnly(policyRow.term_expiration_date),
      currencyCode: policyRow.currency_code || 'USD',
      transactions,
      ledger,
      forms: formsByTxn['__policy'] || [],
      documents: docsByTxn['__policy'] || [],
    }
  })
}

// ── 2c. getPolicyVersions ─────────────────────────────────────────────────────

/**
 * Fetch all versions for a policy, including rating components and UW info.
 */
export async function getPolicyVersions(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string
): Promise<any[]> {
  const r: any = await withTenantTx(tenantId, (db) =>
    toRawQuery(db)(
      `SELECT
         pv.version_id,
         pv.effective_date,
         COALESCE(
           NULLIF(pt.term->>'effectiveDate', '')::date,
           CASE
             WHEN (pv.payload->>'effectiveDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
             THEN (pv.payload->>'effectiveDate')::date
             ELSE NULL
           END,
           p.term_effective_date
         ) AS policy_effective_date,
         pv.processed_at,
         COALESCE(pt.created_at, pv.processed_at) AS created_at,
         COALESCE(pt.updated_at, pv.processed_at) AS updated_at,
         CASE
           WHEN COALESCE(u.username, '') <> '' THEN u.username
           WHEN COALESCE(pv.calc_trace->'uw'->>'submittedBy', '') <> '' THEN pv.calc_trace->'uw'->>'submittedBy'
           ELSE 'system'
         END AS updated_user,
         pv.transaction_type,
         pv.premium_total,
         pv.premium_fees,
         pv.premium_taxes,
         pv.currency,
         r.components AS rating_components,
         r.currency_code AS rating_currency,
         pv.uw_decision,
         pv.uw_override,
         pv.override_reason,
         pv.calc_trace,
         pv.transaction_number,
         COALESCE(
           NULLIF(pt.term->>'expirationDate', '')::date,
           NULLIF(pv.payload->>'expirationDate', '')::date,
           CASE
             WHEN (pv.payload->>'effectiveDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              AND (pv.payload->>'termMonths') ~ '^[0-9]+$'
             THEN ((pv.payload->>'effectiveDate')::date + make_interval(months => (pv.payload->>'termMonths')::int))::date
             ELSE NULL
           END,
           p.term_expiration_date
         ) AS expiration_date
       FROM policy_versions pv
       LEFT JOIN policy_transactions pt
         ON pt.tenant_id = pv.tenant_id
        AND pt.transaction_id = pv.transaction_id
      LEFT JOIN policies p
        ON p.tenant_id = pv.tenant_id
       AND p.policy_id = pv.policy_id
       LEFT JOIN users u
         ON u.tenant_id = pt.tenant_id
        AND u.user_id = pt.created_by
      LEFT JOIN ratings r
         ON r.tenant_id = pv.tenant_id
        AND r.policy_id = pv.policy_id
        AND r.transaction_id = pv.transaction_id
       WHERE pv.tenant_id = $1
         AND pv.policy_id = $2
      ORDER BY pv.processed_at ASC`,
      [tenantId, policyId]
    )
  )
  return r.rows.map((row: any) => {
    const premiumCurrency = row.rating_currency || row.currency || 'USD'
    const byCoverage = Array.isArray(row.rating_components) ? row.rating_components : []
    return {
      versionId: row.version_id,
      effectiveDate: row.effective_date,
      policyEffectiveDate: row.policy_effective_date || null,
      expirationDate: row.expiration_date || null,
      createdDate: row.created_at || row.processed_at,
      updatedDate: row.updated_at || row.processed_at,
      updatedUser: row.updated_user || 'system',
      processedDate: row.processed_at,
      transactionType: row.transaction_type,
      transactionNumber: row.transaction_number || null,
      uwDecision: row.uw_decision || null,
      uwOverride: !!row.uw_override,
      overrideReason: row.override_reason || null,
      uwSubmittedBy: row.calc_trace?.uw?.submittedBy || null,
      premium: {
        byCoverage,
        fees: { amount: Number(row.premium_fees || 0), currency: premiumCurrency },
        taxes: { amount: Number(row.premium_taxes || 0), currency: premiumCurrency },
        total: { amount: Number(row.premium_total || 0), currency: premiumCurrency },
        calcTrace: row.calc_trace || null,
      },
    }
  })
}

// ── 2d. getVersionDetails ─────────────────────────────────────────────────────

/**
 * Fetch detail data for a single policy version: payload, risk entities,
 * coverage selections, and computed diffs against the prior version.
 */
export async function getVersionDetails(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string,
  versionId: string
): Promise<any> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const pv = await q(
      'SELECT payload, processed_at FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
      [tenantId, policyId, versionId]
    )
    const auto = await q(
      'SELECT * FROM auto_vehicles WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
      [tenantId, policyId, versionId]
    )
    const dw = await q(
      'SELECT * FROM dwellings WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3',
      [tenantId, policyId, versionId]
    )
    const cov = await q(
      'SELECT coverage_code, selected, limit_value AS limit, deductible, percent FROM coverage_selections WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3 ORDER BY coverage_code',
      [tenantId, policyId, versionId]
    )
    const ch = await q(
      'SELECT path, old, new FROM policy_version_changes WHERE tenant_id=$1 AND policy_id=$2 AND version_id=$3 ORDER BY path',
      [tenantId, policyId, versionId]
    )
    let changes: string[] = ch.rowCount ? ch.rows.map((r: any) => r.path) : []
    let diffs: any[] = ch.rowCount
      ? ch.rows.map((r: any) => ({ path: r.path, old: r.old, new: r.new }))
      : []
    if (!changes.length) {
      const prev = await q(
        'SELECT version_id, payload FROM policy_versions WHERE tenant_id=$1 AND policy_id=$2 AND processed_at < $3 ORDER BY processed_at DESC LIMIT 1',
        [tenantId, policyId, pv.rowCount ? pv.rows[0].processed_at : new Date(0)]
      )
      const payload = pv.rowCount ? pv.rows[0].payload : null
      const prevPayload = prev.rowCount ? prev.rows[0].payload : null
      changes =
        payload && prevPayload ? diffPayloadPaths(prevPayload, payload) : []
      diffs = changes.map((p: string) => ({
        path: p,
        old: prevPayload ? getByPath(prevPayload, p) : null,
        new: payload ? getByPath(payload, p) : null,
      }))
    }
    return {
      payload: pv.rowCount ? pv.rows[0].payload : null,
      autoVehicle: auto.rowCount ? auto.rows[0] : null,
      dwelling: dw.rowCount ? dw.rows[0] : null,
      coverages: cov.rows,
      changes,
      diffs,
    }
  })
}

// ── 2e. getPolicyState ────────────────────────────────────────────────────────

/**
 * Compute the point-in-time policy state at `asOfDate` (or the current date).
 * Uses persisted timeline segments if available, otherwise derives them from
 * version history.
 */
export async function getPolicyState(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string,
  asOfDate?: string
): Promise<any> {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const ctx = await loadPolicyContext(db, tenantId, policyId)
    if (!ctx) throw new NotFoundError('POLICY_NOT_FOUND')
    const termEffective = coerceDateOnly(ctx.policy.term_effective_date)
    const termExpiration = coerceDateOnly(ctx.policy.term_expiration_date)
    const asOf = asOfDate || currentPolicyStateAsOfDate(termEffective, termExpiration)

    const timelineVersionRes = await q(
      `SELECT COALESCE(MAX(timeline_version), 0) AS max_timeline_version
         FROM policy_timeline_segments
        WHERE tenant_id = $1 AND policy_id = $2`,
      [tenantId, policyId]
    )
    const timelineVersion = Number(timelineVersionRes.rows?.[0]?.max_timeline_version || 0)

    let segments: any[] = []
    if (timelineVersion > 0) {
      const segmentRes = await q(
        `SELECT source_version_id, source_transaction_id, segment_start, segment_end, payload,
                premium_total, premium_fees, premium_taxes, currency, metadata
           FROM policy_timeline_segments
          WHERE tenant_id = $1 AND policy_id = $2 AND timeline_version = $3
          ORDER BY segment_start ASC`,
        [tenantId, policyId, timelineVersion]
      )
      segments = segmentRes.rows.map((row: any) => ({
        sourceVersionId: String(row.source_version_id || ''),
        sourceTransactionId: row.source_transaction_id ? String(row.source_transaction_id) : null,
        sourceTransactionType: String(row.metadata?.sourceTransactionType || ''),
        sourceTransactionNumber: row.metadata?.sourceTransactionNumber
          ? String(row.metadata.sourceTransactionNumber)
          : null,
        startDate: coerceDateOnly(row.segment_start),
        endDate: coerceDateOnly(row.segment_end),
        endExclusiveDate: addDays(coerceDateOnly(row.segment_end), 1),
        payload: row.payload,
        premium: {
          byCoverage: [],
          fees: { amount: Number(row.premium_fees || 0), currency: row.currency || 'USD' },
          taxes: { amount: Number(row.premium_taxes || 0), currency: row.currency || 'USD' },
          total: { amount: Number(row.premium_total || 0), currency: row.currency || 'USD' },
        },
        premiumTotal: Number(row.premium_total || 0),
        premiumFees: Number(row.premium_fees || 0),
        premiumTaxes: Number(row.premium_taxes || 0),
        currency: row.currency || 'USD',
      }))
    } else {
      const versionsRes = await q(
        `SELECT version_id, transaction_id, transaction_type, transaction_number,
                effective_date, processed_at, payload
           FROM policy_versions
          WHERE tenant_id = $1 AND policy_id = $2
          ORDER BY effective_date ASC, processed_at ASC, version_id ASC`,
        [tenantId, policyId]
      )
      const versions = versionsRes.rowCount
        ? versionsRes.rows.map((row: any) => ({
            versionId: String(row.version_id),
            transactionId: row.transaction_id ? String(row.transaction_id) : null,
            transactionType: String(row.transaction_type || ''),
            transactionNumber: row.transaction_number ? String(row.transaction_number) : null,
            effectiveDate: coerceDateOnly(row.effective_date),
            processedAt:
              row.processed_at instanceof Date
                ? row.processed_at.toISOString()
                : String(row.processed_at || new Date().toISOString()),
            payload: row.payload,
            changes: [],
          }))
        : []
      segments = deriveTimelineSegments({
        tenantId,
        versions,
        termEffectiveDate: termEffective,
        termExpirationDate: termExpiration,
      })
    }

    const state = findTimelineStateAtDate(segments, asOf)
    if (!state) {
      return {
        policyId,
        policyNumber: ctx.policy.policy_number,
        asOf,
        timelineVersion,
        segmentStart: termEffective,
        segmentEnd: termExpiration,
        payload: ctx.latestPayload || null,
        premium: ctx.policy.premium_summary || null,
      }
    }
    return {
      policyId,
      policyNumber: ctx.policy.policy_number,
      asOf,
      timelineVersion,
      segmentStart: (state as any).startDate,
      segmentEnd: (state as any).endDate,
      payload: (state as any).payload,
      premium: (state as any).premium,
    }
  })
}

// ── 2f. getRatingWorksheet ────────────────────────────────────────────────────

/**
 * Retrieve the RATING_WORKSHEET document for a given policy version.
 */
export async function getRatingWorksheet(
  _db: DrizzleDB,
  tenantId: string,
  policyId: string,
  versionId: string
): Promise<any> {
  const result: any = await withTenantTx(tenantId, (db) =>
    toRawQuery(db)(
      `SELECT d.document_id, d.type, d.uri, d.hash, d.metadata, d.created_at, d.created_by
         FROM documents d
         JOIN policy_versions pv
           ON pv.tenant_id = d.tenant_id
          AND pv.policy_id = d.policy_id
          AND pv.transaction_id = d.transaction_id
        WHERE d.tenant_id = $1
          AND d.policy_id = $2
          AND pv.version_id = $3
          AND d.type = 'RATING_WORKSHEET'
        ORDER BY d.created_at DESC
        LIMIT 1`,
      [tenantId, policyId, versionId]
    )
  )
  if (!result.rowCount) throw new NotFoundError('DOCUMENT_NOT_FOUND')
  const row = result.rows[0]
  return {
    documentId: row.document_id,
    type: row.type,
    uri: row.uri,
    hash: row.hash,
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    metadata: row.metadata || null,
  }
}

// ── 2g. exportPoliciesCsv ─────────────────────────────────────────────────────

export interface ExportPoliciesFilters {
  q?: string
  product?: string
  status?: PolicyStatusFilter
  effectiveFrom?: string
  effectiveTo?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

/**
 * Export policies as a CSV string. Runs a SQL query with the given filters.
 */
export async function exportPoliciesCsv(
  _db: DrizzleDB,
  tenantId: string,
  filters: ExportPoliciesFilters
): Promise<string> {
  const {
    q = '',
    product = '',
    status = '' as PolicyStatusFilter,
    effectiveFrom = '',
    effectiveTo = '',
    sortBy = 'effectiveDate',
    sortDir = 'desc',
  } = filters

  const clauses = ['p.tenant_id = $1']
  const params: any[] = [tenantId]
  let idx = 2
  if (q) { clauses.push('(LOWER(p.policy_number) LIKE $' + idx + ' OR CAST(p.policy_id AS text) LIKE $' + idx + ')'); params.push('%' + q + '%'); idx++ }
  if (product) { clauses.push('LOWER(p.product_code) = $' + idx); params.push(product); idx++ }
  idx = appendPolicyStatusFilterClause(clauses, params, idx, status, {
    statusColumn: 'p.status',
    effectiveDateColumn: 'p.term_effective_date',
    expirationDateColumn: 'p.term_expiration_date',
  })
  if (effectiveFrom) { clauses.push('p.term_effective_date >= $' + idx); params.push(effectiveFrom); idx++ }
  if (effectiveTo) { clauses.push('p.term_effective_date <= $' + idx); params.push(effectiveTo); idx++ }
  const order = ['effectiveDate', 'expirationDate', 'policyNumber', 'productCode', 'status'].includes(sortBy)
    ? sortBy : 'effectiveDate'
  const sortColumn = ({
    effectiveDate: 'p.term_effective_date',
    expirationDate: 'p.term_expiration_date',
    policyNumber: 'p.policy_number',
    productCode: 'p.product_code',
    status: 'p.status',
  } as any)[order]
  const dir = sortDir === 'asc' ? 'asc' : 'desc'
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''
  const sql = `
    SELECT p.policy_number, p.policy_id, p.product_code, p.status, p.term_effective_date, p.term_expiration_date,
           pv.uw_decision, pv.uw_override
      FROM policies p
      LEFT JOIN LATERAL (
        SELECT uw_decision, uw_override
          FROM policy_versions v
         WHERE v.tenant_id = p.tenant_id AND v.policy_id = p.policy_id
         ORDER BY v.processed_at DESC
         LIMIT 1
      ) pv ON true
      ${where}
     ORDER BY ${sortColumn} ${dir}`

  const r: any = await withTenantTx(tenantId, (db) => toRawQuery(db)(sql, params))
  const header = ['policyNumber', 'policyId', 'productCode', 'status', 'effectiveDate', 'expirationDate', 'uwDecision', 'uwOverride']
  const rows = r.rows.map((row: any) => {
    const effectiveDate = coerceDateOnly(row.term_effective_date)
    const expirationDate = coerceDateOnly(row.term_expiration_date)
    const workflowStatus = derivePolicyWorkflowStatus(row.status, effectiveDate, expirationDate)
    return [row.policy_number, row.policy_id, row.product_code, workflowStatus, effectiveDate, expirationDate, row.uw_decision || '', row.uw_override ? 'true' : 'false']
  })
  return [header.join(','), ...rows.map((rw: any[]) => rw.map(csvEscape).join(','))].join('\n')
}
