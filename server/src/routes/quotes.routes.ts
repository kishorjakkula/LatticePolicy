import { Router } from 'express'
import { v4 as uuidv4 } from '../uuid.js'
import { requirePermission } from '../auth.js'
import { validate } from '../lib/validate.js'
import { ok } from '../lib/respond.js'
import { CreateQuoteSchema, DraftQuoteSchema, BindQuoteSchema } from '../schemas/quote.schema.js'
import { getDb } from '../db.js'
import { store } from '../store.js'
import { safeMoney } from '../persistence.js'
import { generatePolicyNumber } from '../policyNumbers.js'
import { getMemoryTenantPolicyNumberFormats } from '../tenantPreferences.js'
import { extractQuoteCustomerLinks, resolveQuoteActor } from '../lib/quote.utils.js'
import * as quoteService from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { loadTenantAiMlConfig } from '../tenantAi.js'
import { inferQuoteAiInsights } from '../aiMl.js'
import { validateQuote } from '../contracts.js'
import { addMonths } from '../lib/date.utils.js'
import { csvEscape } from '../lib/utils.js'

export const quoteRoutes = Router()

// ── POST /quotes — rate/create ────────────────────────────────────────────────
quoteRoutes.post(
  '/quotes',
  requirePermission(['page.wizard.view']),
  validate(CreateQuoteSchema),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const body = quoteService.normalizeQuotePayload(req.body || {})
      const requestedQuoteId =
        typeof body.quoteId === 'string' && body.quoteId ? body.quoteId : null
      const updatedBy = resolveQuoteActor(req)

      const db = getDb()
      if (!db) {
        // In-memory fallback
        const valid = validateQuote(body)
        if (!valid) {
          return res.status(400).json({ code: 'INVALID_QUOTE', message: 'Missing required fields' })
        }
        const premium = rate(tenantId, body)
        const uw = evaluateUW(tenantId, body)
        const aiMlConfig = await loadTenantAiMlConfig(tenantId)
        const aiInsights = inferQuoteAiInsights(aiMlConfig, {
          payload: body,
          premium,
          underwriting: uw,
        })
        const quoteId = requestedQuoteId || uuidv4()
        const nowIso = new Date().toISOString()
        const statusHistory = quoteService.upsertQuoteAuditHistory(
          [],
          'Rated',
          nowIso,
          updatedBy
        )
        const stepHistory = quoteService.upsertQuoteAuditHistory([], 5, nowIso, updatedBy)

        if (requestedQuoteId) {
          const existing = store.getQuote(requestedQuoteId)
          if (!existing || (existing as any).tenantId !== tenantId) {
            return res.status(404).json({ code: 'QUOTE_NOT_FOUND' })
          }
          store.updateQuote(requestedQuoteId, {
            payload: body,
            premium,
            uw,
            status: 'Rated',
            progressStep: 5,
            updatedAt: nowIso,
            updatedBy,
            statusHistory,
            stepHistory,
          })
        } else {
          const quoteNumber = quoteService.generateQuoteNumber()
          store.addQuote({
            id: quoteId,
            tenantId,
            payload: body,
            premium,
            uw,
            quoteNumber,
            status: 'Rated',
            progressStep: 5,
            createdAt: nowIso,
            updatedAt: nowIso,
            updatedBy,
            statusHistory,
            stepHistory,
          })
        }
        return res.json({
          quoteId,
          premium,
          aiInsights,
          underwriting: uw,
          nextActions: ['bind'],
          status: 'Rated',
          progressStep: 5,
          updatedAt: nowIso,
          updatedBy,
          statusHistory,
          stepHistory,
        })
      }

      // DB path — delegate to service
      const result = await req.tx((db) =>
        quoteService.createOrRateQuote(db, tenantId, body, requestedQuoteId, updatedBy)
      )
      ok(res, result)
    } catch (err) {
      next(err)
    }
  }
)

// ── GET /quotes/:id ───────────────────────────────────────────────────────────
quoteRoutes.get('/quotes/:id', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const data = await quoteService.getQuote(db as any, tenantId, req.params.id)
      return ok(res, data)
    }

    // In-memory fallback
    const q = store.getQuote(req.params.id)
    if (!q || (q as any).tenantId !== tenantId) {
      return res.status(404).json({ code: 'QUOTE_NOT_FOUND' })
    }
    return res.json(q)
  } catch (err) {
    next(err)
  }
})

// ── POST /quotes/draft — create draft quote ───────────────────────────────────
// NOTE: must be registered BEFORE /quotes/:id to avoid route conflict
quoteRoutes.post('/quotes/draft', validate(DraftQuoteSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const body = req.body || {}
    const updatedBy = resolveQuoteActor(req)
    const db = getDb()

    if (db) {
      try {
        const result = await quoteService.createDraftQuote(db as any, tenantId, body, updatedBy)
        return ok(res, result)
      } catch {
        return res
          .status(500)
          .json({ code: 'DB_ERROR', message: 'Unable to create draft quote' })
      }
    }

    // In-memory fallback
    const quoteId = uuidv4()
    const progressStep = quoteService.clampStep(body.progressStep)
    const status = typeof body.status === 'string' ? body.status : 'Draft'
    const payload = quoteService.normalizeQuotePayload(body.payload || {}, body.effectiveDate)
    const nowIso = new Date().toISOString()
    const stepHistory = quoteService.upsertQuoteAuditHistory([], progressStep, nowIso, updatedBy)
    const statusHistory = quoteService.upsertQuoteAuditHistory([], status, nowIso, updatedBy)
    const quoteNumber = quoteService.generateQuoteNumber()
    store.addQuote({
      id: quoteId,
      tenantId,
      payload,
      premium: null,
      quoteNumber,
      status,
      progressStep,
      createdAt: nowIso,
      updatedAt: nowIso,
      updatedBy,
      statusHistory,
      stepHistory,
    })
    return res.json({
      quoteId,
      quoteNumber,
      status,
      progressStep,
      updatedAt: nowIso,
      updatedBy,
      statusHistory,
      stepHistory,
    })
  } catch (err) {
    next(err)
  }
})

// ── PATCH /quotes/:id/draft — update draft quote ─────────────────────────────
quoteRoutes.patch('/quotes/:id/draft', validate(DraftQuoteSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const quoteId = req.params.id
    const body = req.body || {}
    const updatedBy = resolveQuoteActor(req)
    const db = getDb()

    if (db) {
      try {
        const result = await quoteService.updateDraftQuote(db as any, tenantId, quoteId, body, updatedBy)
        store.updateQuote(quoteId, {
          payload: result.normalizedPayload || undefined,
          status: result.status as any,
          progressStep: result.progressStep,
          updatedAt: result.updatedAt,
          updatedBy: result.updatedBy,
          statusHistory: result.statusHistory,
          stepHistory: result.stepHistory,
        })
        return ok(res, {
          quoteId: result.quoteId,
          quoteNumber: result.quoteNumber,
          status: result.status,
          progressStep: result.progressStep,
          updatedAt: result.updatedAt,
          updatedBy: result.updatedBy,
          statusHistory: result.statusHistory,
          stepHistory: result.stepHistory,
        })
      } catch {
        return res
          .status(500)
          .json({ code: 'DB_ERROR', message: 'Unable to update draft quote' })
      }
    }

    // In-memory fallback
    const existing = store.getQuote(quoteId)
    if (!existing || (existing as any).tenantId !== tenantId) {
      return res.status(404).json({ code: 'QUOTE_NOT_FOUND' })
    }
    const normalizedPayload = Object.keys(body.payload || {}).length > 0
      ? quoteService.normalizeQuotePayload(body.payload, body.effectiveDate)
      : null
    const status = typeof body.status === 'string' ? body.status : undefined
    const progressStep =
      body.progressStep != null ? quoteService.clampStep(body.progressStep) : undefined
    const nowIso = new Date().toISOString()
    const nextPayload = normalizedPayload || existing.payload
    const updated = {
      payload: nextPayload,
      status: status || existing.status,
      progressStep: progressStep || existing.progressStep,
      updatedAt: nowIso,
      updatedBy,
      statusHistory: quoteService.upsertQuoteAuditHistory(
        (existing as any).statusHistory || [],
        status || existing.status || 'Draft',
        nowIso,
        updatedBy
      ),
      stepHistory: quoteService.upsertQuoteAuditHistory(
        (existing as any).stepHistory || [],
        progressStep || existing.progressStep || 1,
        nowIso,
        updatedBy
      ),
    }
    store.updateQuote(quoteId, updated)
    return res.json({
      quoteId,
      quoteNumber: (existing as any).quoteNumber,
      status: updated.status,
      progressStep: updated.progressStep,
      updatedAt: nowIso,
      updatedBy,
      statusHistory: updated.statusHistory || [],
      stepHistory: updated.stepHistory || [],
    })
  } catch (err) {
    next(err)
  }
})

// ── POST /quotes/:id/bind ─────────────────────────────────────────────────────
quoteRoutes.post('/quotes/:id/bind', validate(BindQuoteSchema), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const id = req.params.id
    const overrideReason =
      req.body && typeof req.body.overrideReason === 'string'
        ? req.body.overrideReason.trim()
        : ''
    const updatedBy = resolveQuoteActor(req)
    const db = getDb()

    if (db) {
      const result = await bindQuote(db as any, tenantId, id, req.body, updatedBy, req.user?.id || null)
      return ok(res, {
        policyId: result.policyId,
        policyNumber: result.policyNumber,
        status: result.status,
      })
    }

    // In-memory fallback
    const quote = store.getQuote(id)
    if (!quote) return res.status(404).json({ code: 'QUOTE_NOT_FOUND' })
    if ((quote as any).uw) {
      if ((quote as any).uw.decision === 'Decline') {
        return res.status(400).json({
          code: 'UW_DECLINED',
          message: `Underwriting decision: Decline. Reasons: ${(quote as any).uw.reasons?.join('; ')}`,
        })
      }
      if ((quote as any).uw.decision === 'Refer' && !overrideReason) {
        return res.status(400).json({
          code: 'UW_OVERRIDE_REQUIRED',
          message: 'Underwriting decision is Refer. Provide overrideReason to bind.',
        })
      }
    }

    const policyId = uuidv4()
    const productCode = quote.payload?.productCode || 'unknown'
    const policyNumberFormatsByProduct = getMemoryTenantPolicyNumberFormats(tenantId)
    const eff = quote.payload?.effectiveDate || new Date().toISOString().slice(0, 10)
    const months = Number(quote.payload?.termMonths || 12)
    const exp = addMonths(eff, months)
    const quoteCustomerLinks = extractQuoteCustomerLinks(quote.payload)
    const primaryCustomerLink =
      quoteCustomerLinks.find((item: any) => item.isPrimary) ||
      quoteCustomerLinks[0] ||
      null
    const policyMetadata: any = {
      sourceQuoteId: id,
      ...(primaryCustomerLink?.customerId
        ? { customerId: primaryCustomerLink.customerId }
        : {}),
      ...(primaryCustomerLink?.customerKey
        ? { customerKey: primaryCustomerLink.customerKey }
        : {}),
      ...(primaryCustomerLink?.displayName
        ? { customerName: primaryCustomerLink.displayName }
        : {}),
    }

    const policyNumber = await generatePolicyNumber({
      policyId,
      productCode,
      formatsByProduct: policyNumberFormatsByProduct,
      isUnique: async (candidate: string) =>
        !store.searchPolicies(tenantId, '').some((p: any) => p.policyNumber === candidate),
    })

    const issueVersion: any = {
      versionId: uuidv4(),
      effectiveDate: eff,
      processedDate: new Date().toISOString(),
      transactionType: 'Issue',
      premium: quote.premium,
      meta: (quote as any).uw
        ? {
            uwDecision: (quote as any).uw,
            uwOverride: (quote as any).uw.decision === 'Refer' && !!overrideReason,
            overrideReason: overrideReason || undefined,
          }
        : undefined,
    }
    const policy: any = {
      policyId,
      policyNumber,
      tenantId,
      productCode,
      status: 'Bound',
      term: { effectiveDate: eff, expirationDate: exp },
      versions: [issueVersion],
      payload: quote.payload,
      lastFullTermPremium: safeMoney(quote.premium?.total?.amount),
      metadata: policyMetadata,
    }
    store.addPolicy(policy)
    const quoteUpdatedAt = new Date().toISOString()
    store.updateQuote(id, {
      status: 'Converted',
      progressStep: 5,
      updatedAt: quoteUpdatedAt,
      updatedBy,
      convertedPolicyId: policyId,
      statusHistory: quoteService.upsertQuoteAuditHistory(
        (quote as any).statusHistory || [],
        'Converted',
        quoteUpdatedAt,
        updatedBy
      ),
      stepHistory: quoteService.upsertQuoteAuditHistory(
        (quote as any).stepHistory || [],
        5,
        quoteUpdatedAt,
        updatedBy
      ),
    })
    return res.json({ policyId, policyNumber, status: 'Bound' })
  } catch (err) {
    next(err)
  }
})

// ── POST /quotes/:id/copy ─────────────────────────────────────────────────────
quoteRoutes.post('/quotes/:id/copy', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const id = req.params.id
    const updatedBy = resolveQuoteActor(req)
    const db = getDb()

    if (db) {
      const result = await quoteService.copyQuote(db as any, tenantId, id, updatedBy)
      return ok(res, result)
    }

    // In-memory fallback
    const existing = store.getQuote(id)
    if (!existing || (existing as any).tenantId !== tenantId) {
      return res.status(404).json({ code: 'QUOTE_NOT_FOUND' })
    }
    const nowIso = new Date().toISOString()
    const newId = uuidv4()
    const quoteNumber = quoteService.generateQuoteNumber()
    const copyPayload = quoteService.normalizeQuotePayload(
      existing.payload || {},
      existing.payload?.effectiveDate
    )
    const statusHistory = quoteService.upsertQuoteAuditHistory([], 'Draft', nowIso, updatedBy)
    const stepHistory = quoteService.upsertQuoteAuditHistory([], 1, nowIso, updatedBy)
    store.addQuote({
      id: newId,
      tenantId,
      payload: copyPayload,
      premium: null,
      quoteNumber,
      status: 'Draft',
      progressStep: 1,
      updatedAt: nowIso,
      updatedBy,
      createdAt: nowIso,
      statusHistory,
      stepHistory,
    })
    return res.json({ quoteId: newId, quoteNumber })
  } catch (err) {
    next(err)
  }
})

// ── GET /quotes — list ────────────────────────────────────────────────────────
quoteRoutes.get('/quotes', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const q = (req.query.q || '').toString().toLowerCase()
    const product = (req.query.product || '').toString().toLowerCase()
    const effFrom = (req.query.effectiveFrom || '').toString()
    const effTo = (req.query.effectiveTo || '').toString()
    const statusFilter = (req.query.status || '').toString()
    const page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
    const sortBy = (req.query.sortBy || 'effectiveDate').toString()
    const sortDir =
      (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'asc' : 'desc'
    const hiddenQuoteStatuses = ['Converted', 'Issued']

    const db = getDb()
    if (db) {
      const result = await quoteService.listQuotes(db as any, tenantId, {
        q, product, status: statusFilter, dateFrom: effFrom, dateTo: effTo,
        page, pageSize, sortBy, sortDir,
      })
      return ok(res, result)
    }

    // In-memory fallback
    let items = store.searchQuotes(tenantId, q)
    items = items.filter(
      (x: any) => !hiddenQuoteStatuses.includes(String(x.status || 'Draft'))
    )
    if (product) {
      const products = product
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      items = items.filter((x: any) =>
        products.includes((x.payload?.productCode || '').toLowerCase())
      )
    }
    if (statusFilter) {
      items = items.filter((x: any) => (x.status || 'Draft') === statusFilter)
    }
    if (effFrom) items = items.filter((x: any) => (x.payload?.effectiveDate || '') >= effFrom)
    if (effTo) items = items.filter((x: any) => (x.payload?.effectiveDate || '') <= effTo)

    const dirMul = sortDir === 'asc' ? 1 : -1
    items.sort((a: any, b: any) => {
      const get = (x: any) => {
        switch (sortBy) {
          case 'id':
            return x.id
          case 'productCode':
            return x.payload?.productCode
          case 'effectiveDate':
          default:
            return x.payload?.effectiveDate
        }
      }
      const av = get(a) || ''
      const bv = get(b) || ''
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })

    const totalCount = items.length
    const start = (page - 1) * pageSize
    const pagedItems = items.slice(start, start + pageSize).map((x: any) => ({
      quoteId: x.id,
      quoteNumber: x.quoteNumber,
      productCode: x.payload?.productCode,
      effectiveDate: x.payload?.effectiveDate,
      status: x.status || 'Draft',
      progressStep: x.progressStep || 1,
      updatedAt: x.updatedAt || null,
      updatedBy: x.updatedBy || null,
    }))
    return res.json({ items: pagedItems, total: totalCount, page, pageSize })
  } catch (err) {
    next(err)
  }
})

// ── GET /quotes/export ────────────────────────────────────────────────────────
quoteRoutes.get('/quotes/export', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const q = (req.query.q || '').toString().toLowerCase()
    const product = (req.query.product || '').toString().toLowerCase()
    const effFrom = (req.query.effectiveFrom || '').toString()
    const effTo = (req.query.effectiveTo || '').toString()
    const sortBy = (req.query.sortBy || 'effectiveDate').toString()
    const sortDir =
      (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'asc' : 'desc'
    const hiddenQuoteStatuses = ['Converted', 'Issued']

    const db = getDb()
    if (db) {
      const csv = await quoteService.exportQuotesCsv(db as any, tenantId, {
        q, product, status: '', dateFrom: effFrom, dateTo: effTo, sortBy, sortDir,
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="quotes-export.csv"')
      return res.send(csv)
    }

    // In-memory fallback
    let items = store.searchQuotes(tenantId, q)
    items = items.filter((x: any) => !hiddenQuoteStatuses.includes(String(x.status || 'Draft')))
    if (product) {
      const products = product
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      items = items.filter((x: any) =>
        products.includes((x.payload?.productCode || '').toLowerCase())
      )
    }
    if (effFrom) items = items.filter((x: any) => (x.payload?.effectiveDate || '') >= effFrom)
    if (effTo) items = items.filter((x: any) => (x.payload?.effectiveDate || '') <= effTo)

    const dirMul = sortDir === 'asc' ? 1 : -1
    items.sort((a: any, b: any) => {
      const get = (x: any) => {
        switch (sortBy) {
          case 'id':
            return x.id
          case 'productCode':
            return x.payload?.productCode
          case 'effectiveDate':
          default:
            return x.payload?.effectiveDate
        }
      }
      const av = get(a) || ''
      const bv = get(b) || ''
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })

    const header = ['id', 'productCode', 'effectiveDate']
    const rows = items.map((x: any) => [x.id, x.payload?.productCode, x.payload?.effectiveDate])
    const csv = [header.join(','), ...rows.map((r: any[]) => r.map(csvEscape).join(','))].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="quotes-export.csv"')
    res.send(csv)
  } catch (err) {
    next(err)
  }
})
