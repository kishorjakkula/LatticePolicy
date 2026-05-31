import { Router } from 'express'
import { getDb, type DrizzleDB } from '../db.js'
import { ok } from '../lib/respond.js'
import { requirePermission } from '../auth.js'
import { buildCacheKey, cacheGetJson, cacheSetJson } from '../cache.js'
import { getMemoryTenantDatePreferences } from '../tenantPreferences.js'
import { getMemoryTenantAiMlConfig } from '../tenantAi.js'
import * as configService from '../services/config.service.js'

export const configRoutes = Router()

// GET /tenant/preferences
// Returns tenant date preferences and AI/ML config.
// Uses Redis cache (TTL 300s). Falls back to in-memory store when no DB.
configRoutes.get('/tenant/preferences', async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const cacheKey = buildCacheKey(['tenant-preferences', tenantId])
  try {
    const cached = await cacheGetJson<any>(cacheKey)
    if (cached) {
      return res.json(cached)
    }

    const db = getDb()
    if (!db) {
      const prefs = getMemoryTenantDatePreferences(tenantId)
      const dateFormat = prefs.dateFormatsByCountry[prefs.defaultCountry] || 'MM-DD-YYYY'
      const responsePayload = {
        tenantId,
        defaultCountry: prefs.defaultCountry,
        dateFormatsByCountry: prefs.dateFormatsByCountry,
        dateFormat,
        aiMlConfig: getMemoryTenantAiMlConfig(tenantId)
      }
      await cacheSetJson(cacheKey, responsePayload, 300)
      return res.json(responsePayload)
    }

    const result = await configService.getTenantPreferences(db as unknown as DrizzleDB, tenantId)
    await cacheSetJson(cacheKey, result, 300)
    ok(res, result)
  } catch (err) {
    next(err)
  }
})

// GET /ai/settings
// Returns the AI/ML configuration for the current tenant.
configRoutes.get('/ai/settings', requirePermission('page.wizard.view'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  try {
    const db = getDb()
    const result = await configService.getAiSettings(db as unknown as DrizzleDB, tenantId)
    ok(res, result)
  } catch (err) {
    next(err)
  }
})
