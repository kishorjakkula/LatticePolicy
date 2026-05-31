import { Router } from 'express'
import { requirePermission } from '../auth.js'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { isUuidLike } from '../lib/utils.js'

export const customerPortalRoutes = Router()

customerPortalRoutes.use(requirePermission('customer.portal.read'))

// `Inforced` is a derived UI status; persisted policy_status_enum values are used here.
const PORTAL_VISIBLE_POLICY_STATUSES = ['Issued', 'Expired', 'Cancelled']


function titleize(code: string): string {
  return String(code || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function toMoneySummary(value: any) {
  if (!value) return null
  if (typeof value === 'object') {
    const amount =
      value.amount ??
      value.total ??
      value.premium ??
      (value.totalPremium ?? null)
    const currency = String(value.currency || value.currencyCode || 'USD')
    const num = Number(amount)
    if (Number.isFinite(num)) return { amount: Number(num.toFixed(2)), currency }
  }
  const num = Number(value)
  if (Number.isFinite(num)) return { amount: Number(num.toFixed(2)), currency: 'USD' }
  return null
}

function extractNamedInsured(payload: any, fallbackName: string): string {
  const primary = payload?.insureds?.primary || {}
  const name = String(primary.displayName || [primary.firstName, primary.lastName].filter(Boolean).join(' ') || '').trim()
  return name || fallbackName || '-'
}

function extractCoverageRows(payload: any): any[] {
  const coverages = Array.isArray(payload?.coverages) ? payload.coverages : []
  return coverages
    .filter((cov: any) => cov && typeof cov === 'object')
    .map((cov: any) => ({
      code: String(cov.code || '').trim(),
      label: titleize(String(cov.label || cov.code || 'Coverage')),
      selected: cov.selected !== false,
      limit: cov.limit ?? null,
      deductible: cov.deductible ?? null,
      percent: cov.percent ?? null
    }))
}

function extractVehicleRows(payload: any): any[] {
  const risks = Array.isArray(payload?.risks) ? payload.risks : []
  return risks
    .filter((risk: any) => risk && typeof risk === 'object')
    .map((risk: any, index: number) => ({
      index: index + 1,
      year: risk.year ?? null,
      make: risk.make ?? null,
      model: risk.model ?? null,
      vin: risk.vin ?? null
    }))
}

async function resolvePortalCustomer(req: any): Promise<{ customerId: string; customerKey: string | null; customerName: string | null; entityType: string | null } | null> {
  const tenantId = req.tenant?.tenantId || req.user?.tenantId
  const db = getDb()
  if (!db || !tenantId) return null
  const tokenCustomerId = String(req.user?.customerId || '').trim()
  const isAdmin = Array.isArray(req.user?.roles) && req.user.roles.includes('admin')
  const queryCustomerRef = isAdmin ? String(req.query?.customerId || req.query?.customerKey || '').trim() : ''
  const customerRef = queryCustomerRef || tokenCustomerId
  if (!customerRef) return null

  const byId = isUuidLike(customerRef)
  const result = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT c.customer_id, c.customer_key, c.display_name, c.entity_type,
              pd.first_name, pd.last_name, cd.legal_name
         FROM customers c
         LEFT JOIN customer_person_details pd
           ON pd.tenant_id = c.tenant_id AND pd.customer_id = c.customer_id
         LEFT JOIN customer_company_details cd
           ON cd.tenant_id = c.tenant_id AND cd.customer_id = c.customer_id
        WHERE c.tenant_id = $1
          AND (${byId ? 'c.customer_id = $2::uuid' : 'LOWER(c.customer_key) = LOWER($2)'})
        LIMIT 1`,
      [tenantId, customerRef]
    )
  })
  if (!(result as any).rowCount) return null
  const row = (result as any).rows[0]
  const derivedName = String(
    row.display_name || row.legal_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || ''
  ).trim()
  return {
    customerId: String(row.customer_id),
    customerKey: row.customer_key ? String(row.customer_key) : null,
    customerName: derivedName || null,
    entityType: row.entity_type ? String(row.entity_type) : null
  }
}

customerPortalRoutes.get('/summary', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Customer portal requires DB mode' })
  try {
    const portalCustomer = await resolvePortalCustomer(req)
    if (!portalCustomer?.customerId) {
      return res.status(403).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Login user is not linked to a customer record' })
    }

    const policiesRes = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT DISTINCT ON (p.policy_id)
                p.policy_id,
                p.policy_number,
                p.product_code,
                p.status,
                p.term_effective_date,
                p.term_expiration_date,
                p.premium_summary,
                p.updated_at,
                p.created_at
           FROM policy_customer_links pcl
           JOIN policies p
             ON p.tenant_id = pcl.tenant_id
            AND p.policy_id = pcl.policy_id
          WHERE pcl.tenant_id = $1
            AND pcl.customer_id = $2::uuid
            AND p.status = ANY($3)
          ORDER BY p.policy_id,
                   CASE WHEN pcl.role_code = 'PRIMARY_NAMED_INSURED' THEN 0 WHEN pcl.is_primary THEN 1 ELSE 2 END,
                   pcl.updated_at DESC NULLS LAST`,
        [tenantId, portalCustomer.customerId, PORTAL_VISIBLE_POLICY_STATUSES]
      )
    })

    const policies = ((policiesRes as any).rows || []).map((row: any) => ({
      policyId: String(row.policy_id),
      policyNumber: String(row.policy_number || row.policy_id),
      productCode: String(row.product_code || ''),
      status: String(row.status || ''),
      term: {
        effectiveDate: row.term_effective_date,
        expirationDate: row.term_expiration_date
      },
      premium: toMoneySummary(row.premium_summary),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    }))

    return res.json({
      customer: portalCustomer,
      policies
    })
  } catch (err: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(err?.message || err) })
  }
})

customerPortalRoutes.get('/policies/:policyId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Customer portal requires DB mode' })
  try {
    const portalCustomer = await resolvePortalCustomer(req)
    if (!portalCustomer?.customerId) {
      return res.status(403).json({ code: 'CUSTOMER_LINK_REQUIRED', message: 'Login user is not linked to a customer record' })
    }
    const policyId = String(req.params.policyId || '').trim()
    if (!isUuidLike(policyId)) return res.status(400).json({ code: 'INVALID_POLICY_ID' })

    const policyRes = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT p.policy_id, p.policy_number, p.product_code, p.status,
                p.term_effective_date, p.term_expiration_date,
                p.premium_summary, p.created_at, p.updated_at
           FROM policies p
          WHERE p.tenant_id = $1
            AND p.policy_id = $2::uuid
            AND p.status = ANY($3)
            AND EXISTS (
              SELECT 1
                FROM policy_customer_links pcl
               WHERE pcl.tenant_id = p.tenant_id
                 AND pcl.policy_id = p.policy_id
                 AND pcl.customer_id = $4::uuid
            )
          LIMIT 1`,
        [tenantId, policyId, PORTAL_VISIBLE_POLICY_STATUSES, portalCustomer.customerId]
      )
    })
    if (!((policyRes as any).rowCount > 0)) {
      return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    }
    const policyRow = (policyRes as any).rows[0]

    const latestVersionRes = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT version_id, transaction_number, transaction_type, effective_date, processed_at,
                premium_total, premium_fees, premium_taxes, currency, payload
           FROM policy_versions
          WHERE tenant_id = $1 AND policy_id = $2::uuid
          ORDER BY processed_at DESC
          LIMIT 1`,
        [tenantId, policyId]
      )
    })
    const versionRow = (latestVersionRes as any).rows?.[0] || null
    const payload = (versionRow?.payload && typeof versionRow.payload === 'object') ? versionRow.payload : {}
    const coverages = extractCoverageRows(payload).filter((x) => x.selected !== false)
    const vehicles = extractVehicleRows(payload)
    const insuredName = extractNamedInsured(payload, portalCustomer.customerName || '')
    const premium =
      toMoneySummary(
        versionRow
          ? {
              total: versionRow.premium_total,
              fees: versionRow.premium_fees,
              taxes: versionRow.premium_taxes,
              currency: versionRow.currency
            }
          : null
      ) || toMoneySummary(policyRow.premium_summary)

    const declarations = {
      policyNumber: String(policyRow.policy_number || policyRow.policy_id),
      productCode: String(policyRow.product_code || ''),
      status: String(policyRow.status || ''),
      namedInsured: insuredName,
      customerKey: portalCustomer.customerKey,
      term: {
        effectiveDate: policyRow.term_effective_date,
        expirationDate: policyRow.term_expiration_date
      },
      premium,
      transaction: versionRow
        ? {
            versionId: String(versionRow.version_id || ''),
            transactionNumber: String(versionRow.transaction_number || ''),
            transactionType: String(versionRow.transaction_type || ''),
            transactionEffectiveDate: versionRow.effective_date || null,
            processedAt: versionRow.processed_at || null
          }
        : null,
      coverages
    }

    const idCard = {
      available: String(policyRow.product_code || '').toLowerCase() === 'personal-auto',
      policyNumber: declarations.policyNumber,
      namedInsured: insuredName,
      term: declarations.term,
      vehicles,
      state: String(payload?.state || payload?.jurisdictionCode || '').trim() || null
    }

    return res.json({
      policy: {
        policyId: String(policyRow.policy_id),
        policyNumber: declarations.policyNumber,
        productCode: declarations.productCode,
        status: declarations.status,
        term: declarations.term,
        premium,
        createdAt: policyRow.created_at || null,
        updatedAt: policyRow.updated_at || null
      },
      declarations,
      idCard
    })
  } catch (err: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(err?.message || err) })
  }
})
