import { Router } from 'express'
import { getDb, type DrizzleDB } from '../db.js'
import { requirePermission } from '../auth.js'
import { buildCacheKey, cacheGetJson, cacheSetJson, hashCacheInput } from '../cache.js'
import {
  buildWizardFormDocumentHtml,
  sanitizeInlineFileName
} from '../services/forms.service.js'
import * as formsService from '../services/forms.service.js'

export const formsRoutes = Router()

// POST /forms/preview
// Returns the list of applicable forms for a given submission context.
// Uses Redis cache keyed by input hash (TTL 120s).
// Returns empty array when no DB is configured.
formsRoutes.post(
  '/forms/preview',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const payload = req.body || {}
    const inputHash = hashCacheInput(payload)
    const cacheKey = buildCacheKey(['forms-preview', tenantId, inputHash])
    try {
      const cached = await cacheGetJson<any[]>(cacheKey)
      if (cached) {
        return res.json(cached)
      }
      const db = getDb()
      if (!db) return res.json([])

      const result = await formsService.previewForm(db as unknown as DrizzleDB, tenantId, payload)
      await cacheSetJson(cacheKey, result, 120)
      return res.json(result)
    } catch (err) {
      next(err)
    }
  }
)

// GET /forms/:id/document
// Returns the form document — either a binary PDF asset or a generated HTML page.
// Returns 404 when no DB is configured (no in-memory fallback for documents).
formsRoutes.get(
  '/forms/:id/document',
  requirePermission(['page.wizard.view', 'page.policy.view']),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const formId = req.params.id
    const db = getDb()
    if (!db) return res.status(404).json({ code: 'NOT_FOUND', message: 'Form not found' })
    try {
      const data = await formsService.getFormDocument(db as unknown as DrizzleDB, tenantId, formId)
      if (!data) return res.status(404).json({ code: 'NOT_FOUND', message: 'Form not found' })

      if (data.templateAsset?.content) {
        const fileName = String(data.templateAsset.file_name || 'form-template.pdf')
        const mimeType = String(data.templateAsset.mime_type || 'application/pdf')
        res.setHeader('Content-Type', mimeType)
        res.setHeader('Content-Disposition', `inline; filename="${sanitizeInlineFileName(fileName)}"`)
        res.setHeader('Cache-Control', 'no-store')
        return res.status(200).send(data.templateAsset.content)
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      return res
        .status(200)
        .send(buildWizardFormDocumentHtml(data.form, data.output, data.jurisdictions))
    } catch (err) {
      next(err)
    }
  }
)
