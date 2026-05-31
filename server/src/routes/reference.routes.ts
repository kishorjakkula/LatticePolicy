import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery, type DrizzleDB } from '../db.js'
import { ok } from '../lib/respond.js'
import { requirePermission } from '../auth.js'
import { buildCacheKey, cacheGetJson, cacheSetJson } from '../cache.js'
import {
  listMemoryUnderwritingCompanies,
  normalizeCompanyCountryCode,
  normalizeCompanyProductCode,
  normalizeCompanyStateCode
} from '../uwCompaniesStore.js'
import { getCancellationReasonCodesHandler } from '../policyInterests.js'
import { US_INSURANCE_CARRIERS } from '../insuranceCarriers.js'
import { NotFoundError } from '../errors/domain.errors.js'
import * as referenceService from '../services/reference.service.js'
import { isUuidLike } from '../lib/utils.js'

export const referenceRoutes = Router()

function asTrimmedText(value: any): string {
  return String(value ?? '').trim()
}

// GET /reference/agencies
// Lists active agencies for the tenant, optionally filtered by query string.
// Returns empty array when no DB is configured.
referenceRoutes.get(
  '/reference/agencies',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) {
      return res.json({ items: [] })
    }
    try {
      const result = await referenceService.listAgencies(db as unknown as DrizzleDB, tenantId, {
        q: asTrimmedText(req.query.q),
        limit: Number(req.query.limit) || undefined
      })
      ok(res, result)
    } catch (err) {
      next(err)
    }
  }
)

// GET /reference/agencies/:agencyId/contacts
// Returns deduplicated contact points for a specific agency.
// Returns empty array when no DB is configured.
referenceRoutes.get(
  '/reference/agencies/:agencyId/contacts',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const agencyId = asTrimmedText(req.params.agencyId)
    if (!isUuidLike(agencyId)) {
      return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId is invalid' })
    }
    const db = getDb()
    if (!db) {
      return res.json({ items: [] })
    }
    try {
      const result = await referenceService.getAgencyContacts(db as unknown as DrizzleDB, tenantId, agencyId)
      ok(res, result)
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ code: 'NOT_FOUND', message: 'Agency not found' })
      }
      next(err)
    }
  }
)

// GET /reference/underwriters
// Lists users with underwriter or admin roles for the tenant.
// Falls back to a static demo list when no DB is configured.
referenceRoutes.get(
  '/reference/underwriters',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) {
      const fallback = [
        { userId: 'demo-admin', username: 'admin', displayName: 'admin' },
        { userId: 'demo-uw1', username: 'uw1', displayName: 'uw1' }
      ]
      return res.json({ items: fallback })
    }
    try {
      const result = await referenceService.listUnderwriters(db as unknown as DrizzleDB, tenantId)
      ok(res, result)
    } catch (err) {
      next(err)
    }
  }
)

// GET /reference/insurance-carriers
// Returns US insurance carriers filtered by optional query string.
// Memory-only — no DB query.
referenceRoutes.get(
  '/reference/insurance-carriers',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  (req, res, next) => {
    try {
      const query = asTrimmedText(req.query.q).toLowerCase()
      const limitRaw = Number(req.query.limit)
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.round(limitRaw))) : 2000
      const items = US_INSURANCE_CARRIERS
        .filter((name) => !query || name.toLowerCase().includes(query))
        .slice(0, limit)
        .map((name) => ({ name, country: 'US' }))
      ok(res, { items })
    } catch (err) {
      next(err)
    }
  }
)

// GET /reference/cancellation-reason-codes
// Returns cancellation reason codes. Handler defined in policyInterests.ts.
referenceRoutes.get(
  '/reference/cancellation-reason-codes',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  getCancellationReasonCodesHandler
)

// GET /reference/state-eligibility
// Checks whether a product/state combination is eligible for writing.
// Returns eligible=true with no-db source when DB is not configured.
referenceRoutes.get(
  '/reference/state-eligibility',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const productCode = asTrimmedText(req.query.productCode)
    const stateCode = asTrimmedText(req.query.stateCode)
    if (!productCode || !stateCode) {
      return res.status(400).json({ code: 'MISSING_PARAMS', message: 'productCode and stateCode are required' })
    }
    const db = getDb()
    if (!db) return res.json({ eligible: true, _source: 'no-db' })
    try {
      const result = await referenceService.checkStateEligibilityForProduct(
        db as unknown as DrizzleDB,
        tenantId,
        productCode,
        stateCode
      )
      ok(res, result)
    } catch (err) {
      next(err)
    }
  }
)

// GET /underwriting-companies
// Lists underwriting companies filtered by productCode, country, and state.
// Falls back to in-memory store when no DB is configured.
// Note: mounted at /underwriting-companies (no /reference prefix) to match routes.ts.
referenceRoutes.get('/underwriting-companies', async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const productCode = normalizeCompanyProductCode(req.query.productCode)
  const country = req.query.country ? normalizeCompanyCountryCode(req.query.country) : ''
  const state = req.query.state ? normalizeCompanyStateCode(req.query.state) : ''
  const cacheKey = buildCacheKey([
    'uw-companies',
    tenantId,
    productCode || 'all',
    country || 'all',
    state || 'all'
  ])
  try {
    const cached = await cacheGetJson<any>(cacheKey)
    if (cached) {
      return res.json(cached)
    }
    const db = getDb()
    if (db) {
      const result = await withTenantTx(tenantId, async (innerDb) => {
        const q = toRawQuery(innerDb)
        const clauses = ['tenant_id = $1', 'active = true']
        const params: any[] = [tenantId]
        let idx = 2
        if (productCode) {
          clauses.push(`product_code = $${idx}`)
          params.push(productCode)
          idx++
        }
        if (country) {
          clauses.push(`country_code = $${idx}`)
          params.push(country)
          idx++
        }
        if (state) {
          clauses.push(`(state_code = $${idx} OR state_code = 'ALL')`)
          params.push(state)
          idx++
        }
        const sql = `SELECT company_id, name, product_code, country_code, state_code
                     FROM underwriting_companies
                     WHERE ${clauses.join(' AND ')}
                     ORDER BY name ASC`
        return q(sql, params)
      })
      const items = (result as any).rows.map((row: any) => ({
        companyId: row.company_id,
        name: row.name,
        productCode: row.product_code,
        country: row.country_code,
        state: row.state_code
      }))
      const payload = { items }
      await cacheSetJson(cacheKey, payload, 180)
      return res.json(payload)
    }

    // In-memory fallback
    const items = listMemoryUnderwritingCompanies(tenantId, {
      productCode,
      country,
      state,
      includeInactive: false
    }).map((item) => ({
      companyId: item.companyId,
      name: item.name,
      productCode: item.productCode,
      country: item.country,
      state: item.state
    }))
    const payload = { items }
    await cacheSetJson(cacheKey, payload, 60)
    return res.json(payload)
  } catch (err) {
    next(err)
  }
})
