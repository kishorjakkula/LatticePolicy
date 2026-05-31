import { Router } from 'express'
import { getDb, type DrizzleDB } from '../db.js'
import { ok } from '../lib/respond.js'
import { requirePermission } from '../auth.js'
import { buildCacheKey, cacheGetJson, cacheSetJson } from '../cache.js'
import { store } from '../store.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { loadTenantAiMlConfig } from '../tenantAi.js'
import {
  inferDashboardAiInsights,
  inferPolicyAiInsights,
  inferQuoteAiInsights
} from '../aiMl.js'
import * as aiService from '../services/ai.service.js'
import { coerceDateOnly } from '../lib/date.utils.js'

export const aiRoutes = Router()

function normalizeQuotePayload(rawPayload: any): any {
  const payload = rawPayload && typeof rawPayload === 'object' ? { ...rawPayload } : {}
  const effectiveDate = coerceDateOnly(
    payload.effectiveDate || payload.transactionEffectiveDate,
    new Date().toISOString().slice(0, 10)
  )
  payload.effectiveDate = effectiveDate
  payload.transactionEffectiveDate = effectiveDate
  return payload
}

// POST /ai/quotes/insights
// Infers AI insights for a quote payload using the tenant's AI/ML config.
// Purely computational — no DB required beyond config load.
aiRoutes.post('/ai/quotes/insights', requirePermission('page.wizard.view'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const payload = normalizeQuotePayload(req.body?.payload || req.body || {})
  try {
    const aiMlConfig = await loadTenantAiMlConfig(tenantId)
    const premium = req.body?.premium || rate(tenantId, payload)
    const underwriting = req.body?.underwriting || evaluateUW(tenantId, payload)
    const aiInsights = inferQuoteAiInsights(aiMlConfig, {
      payload,
      premium,
      underwriting
    })
    ok(res, { tenantId, aiInsights })
  } catch (err) {
    next(err)
  }
})

// GET /ai/dashboard/insights
// Returns portfolio-level AI insights. Cached for 30s.
// Falls back to in-memory store when no DB is available.
aiRoutes.get('/ai/dashboard/insights', requirePermission('page.search.view'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const cacheKey = buildCacheKey(['ai-dashboard-insights', tenantId])
  try {
    const cached = await cacheGetJson<any>(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    const aiMlConfig = await loadTenantAiMlConfig(tenantId)
    const db = getDb()

    let policies: Array<{
      status?: string
      effectiveDate?: string
      expirationDate?: string
      createdAt?: string
      updatedAt?: string
      premiumTotal?: number
    }> = []

    let quotes: Array<{
      status?: string
      effectiveDate?: string
      createdAt?: string
      updatedAt?: string
      premiumTotal?: number
    }> = []

    if (db) {
      const result = await aiService.getDashboardInsights(db as unknown as DrizzleDB, tenantId)
      const payload = { tenantId: result.tenantId, aiInsights: result.aiInsights }
      await cacheSetJson(cacheKey, payload, 30)
      return res.json(payload)
    }

    // In-memory fallback
    policies = store.searchPolicies(tenantId, '').map((row: any) => ({
      status: row?.status,
      effectiveDate: coerceDateOnly(row?.term?.effectiveDate),
      expirationDate: coerceDateOnly(row?.term?.expirationDate),
      createdAt: row?.createdAt || null,
      updatedAt: row?.updatedAt || null,
      premiumTotal: Number(row?.lastFullTermPremium || 0)
    }))
    quotes = store.searchQuotes(tenantId, '').map((row: any) => ({
      status: row?.status || 'Draft',
      effectiveDate: coerceDateOnly(row?.payload?.effectiveDate),
      createdAt: row?.createdAt || null,
      updatedAt: row?.updatedAt || null,
      premiumTotal: Number(row?.premium?.total?.amount || 0)
    }))

    const aiInsights = inferDashboardAiInsights(aiMlConfig, { policies, quotes })
    const payload = { tenantId, aiInsights }
    await cacheSetJson(cacheKey, payload, 30)
    return res.json(payload)
  } catch (err) {
    next(err)
  }
})

// GET /ai/policies/:id/insights
// Returns AI insights for a specific policy. Cached for 20s.
// Falls back to in-memory store when no DB is available.
aiRoutes.get('/ai/policies/:id/insights', requirePermission('page.policy.view'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const policyId = String(req.params.id || '').trim()
  if (!policyId) {
    return res.status(400).json({ code: 'POLICY_ID_REQUIRED' })
  }
  const cacheKey = buildCacheKey(['ai-policy-insights', tenantId, policyId])
  try {
    const cached = await cacheGetJson<any>(cacheKey)
    if (cached) return res.json(cached)

    const aiMlConfig = await loadTenantAiMlConfig(tenantId)
    const db = getDb()

    if (db) {
      const result = await aiService.getPolicyInsights(db as unknown as DrizzleDB, tenantId, policyId)
      const responsePayload = {
        tenantId: result.tenantId,
        policyId: result.policyId,
        aiInsights: result.aiInsights
      }
      await cacheSetJson(cacheKey, responsePayload, 20)
      return res.json(responsePayload)
    }

    // In-memory fallback
    const policy = store.getPolicy(policyId)
    if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })

    const policyInput = {
      productCode: policy.productCode,
      status: policy.status,
      effectiveDate: policy.term?.effectiveDate,
      expirationDate: policy.term?.expirationDate,
      payload: policy.payload || null
    }
    const versionsInput = (Array.isArray(policy.versions) ? policy.versions : []).map((row: any) => ({
      transactionType: row.transactionType,
      transactionNumber: row.transactionNumber || null,
      effectiveDate: coerceDateOnly(row.effectiveDate),
      processedAt: row.processedDate || new Date().toISOString(),
      premiumTotal: Number(row?.premium?.total?.amount || 0),
      premiumFees: Number(row?.premium?.fees?.amount || 0),
      premiumTaxes: Number(row?.premium?.taxes?.amount || 0),
      currency: row?.premium?.total?.currency || 'USD',
      payload: policy.payload || null
    }))

    const aiInsights = inferPolicyAiInsights(aiMlConfig, {
      policy: policyInput,
      versions: versionsInput
    })
    const responsePayload = { tenantId, policyId, aiInsights }
    await cacheSetJson(cacheKey, responsePayload, 20)
    return res.json(responsePayload)
  } catch (err) {
    next(err)
  }
})
