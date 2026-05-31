import { Router } from 'express'
import { getDb, type DrizzleDB } from '../db.js'
import { ok } from '../lib/respond.js'
import { store } from '../store.js'
import {
  derivePolicyWorkflowStatus,
  normalizePolicyStatusFilter,
  matchesPolicyStatusFilter,
} from '../lib/policy.utils.js'
import * as policyService from '../services/policy.service.js'
import { rate } from '../rating.js'
import { coerceDateOnly, today, asDateOnly } from '../lib/date.utils.js'
import { csvEscape } from '../lib/utils.js'

// ── local helpers (in-memory fallback only) ──────────────────────────────────

function currentPolicyStateAsOfDate(termEffectiveDate: string, termExpirationDate: string): string {
  const currentDate = today()
  if (currentDate >= termExpirationDate) {
    const prev = new Date(`${termExpirationDate}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000
    const fallback = new Date(prev).toISOString().slice(0, 10)
    return fallback < termEffectiveDate ? termEffectiveDate : fallback
  }
  return currentDate
}

function derivePolicyTermCountFromPolicy(policy: any): number {
  const explicit = Number(policy?.termCount)
  if (Number.isFinite(explicit) && explicit > 0) return Math.max(1, Math.round(explicit))
  const versions = Array.isArray(policy?.versions) ? policy.versions : []
  const renewals = versions.filter((version: any) => {
    const tx = String(version?.transactionType || '').trim().toLowerCase()
    return tx === 'renew' || tx === 'renewal'
  })
  return 1 + renewals.length
}

export const policyRoutes = Router()

// ── GET /policies — list ──────────────────────────────────────────────────────
policyRoutes.get('/policies', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const q = (req.query.q || '').toString().toLowerCase()
    const product = (req.query.product || '').toString().toLowerCase()
    const status = normalizePolicyStatusFilter(req.query.status)
    const effFrom = (req.query.effectiveFrom || '').toString()
    const effTo = (req.query.effectiveTo || '').toString()
    const page = Math.max(1, Number(req.query.page || 1))
    const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
    const sortBy = (req.query.sortBy || 'effectiveDate').toString()
    const sortDir =
      (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'asc' : 'desc'

    const db = getDb()
    if (db) {
      const result = await policyService.listPolicies(db as unknown as DrizzleDB, tenantId, {
        q,
        product,
        status,
        effectiveFrom: effFrom,
        effectiveTo: effTo,
        page,
        pageSize,
        sortBy,
        sortDir: sortDir as 'asc' | 'desc',
      })
      return res.json({
        items: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      })
    }

    // In-memory fallback
    let items = store.searchPolicies(tenantId, q)
    if (product) {
      const products = product.split(',').map((s) => s.trim()).filter(Boolean)
      items = items.filter((p: any) => products.includes(p.productCode.toLowerCase()))
    }
    if (status) {
      items = items.filter((p: any) =>
        matchesPolicyStatusFilter(status, p.status, p.term?.effectiveDate, p.term?.expirationDate)
      )
    }
    if (effFrom) items = items.filter((p: any) => p.term.effectiveDate >= effFrom)
    if (effTo) items = items.filter((p: any) => p.term.effectiveDate <= effTo)

    const dirMul = sortDir === 'asc' ? 1 : -1
    items.sort((a: any, b: any) => {
      const get = (p: any) => {
        switch (sortBy) {
          case 'policyNumber': return p.policyNumber
          case 'productCode': return p.productCode
          case 'status': return derivePolicyWorkflowStatus(p.status, p.term?.effectiveDate, p.term?.expirationDate)
          case 'createdAt': return p.createdAt || p.created_at || ''
          case 'updatedAt': return p.updatedAt || p.updated_at || p.versions?.[p.versions.length - 1]?.processedDate || ''
          case 'updatedBy': return p.lifecycle?.updatedBy || p.lifecycle?.createdBy || p.metadata?.updatedBy || p.updatedBy || 'system'
          case 'expirationDate': return p.term?.expirationDate
          case 'effectiveDate':
          default: return p.term?.effectiveDate
        }
      }
      const av = get(a) || ''
      const bv = get(b) || ''
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })

    const total = items.length
    const start = (page - 1) * pageSize
    const pagedItems = items.slice(start, start + pageSize).map((p: any) => {
      const premAmt = p.premium?.total?.amount ?? p.annualPremium ?? p.totalPremium ?? null
      const premCurrency = p.premium?.total?.currency || p.currencyCode || 'USD'
      return {
        policyId: p.policyId,
        policyNumber: p.policyNumber,
        productCode: p.productCode,
        status: derivePolicyWorkflowStatus(p.status, p.term?.effectiveDate, p.term?.expirationDate),
        internalStatus: p.status,
        term: p.term,
        termCount: derivePolicyTermCountFromPolicy(p),
        createdAt: p.createdAt || p.created_at || null,
        updatedAt: p.updatedAt || p.updated_at || p.versions?.[p.versions.length - 1]?.processedDate || null,
        updatedBy: p.lifecycle?.updatedBy || p.lifecycle?.createdBy || p.metadata?.updatedBy || p.updatedBy || 'system',
        insuredName: p.insuredName || p.customer?.name || p.namedInsured || '',
        state: p.state || p.term?.state || p.jurisdictionCode?.replace(/^US-/i, '').toUpperCase() || '',
        agentName: p.agentName || p.agent?.name || p.agency?.name || '',
        premium: premAmt != null ? { total: { amount: Number(premAmt), currency: premCurrency } } : null,
        annualPremium: premAmt != null ? Number(premAmt) : null,
      }
    })
    return res.json({ items: pagedItems, total, page, pageSize })
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/export ──────────────────────────────────────────────────────
policyRoutes.get('/policies/export', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const q = (req.query.q || '').toString().toLowerCase()
    const product = (req.query.product || '').toString().toLowerCase()
    const status = normalizePolicyStatusFilter(req.query.status)
    const effFrom = (req.query.effectiveFrom || '').toString()
    const effTo = (req.query.effectiveTo || '').toString()
    const sortBy = (req.query.sortBy || 'effectiveDate').toString()
    const sortDir =
      (req.query.sortDir || 'desc').toString().toLowerCase() === 'asc' ? 'asc' : 'desc'

    const db = getDb()
    if (db) {
      const csv = await policyService.exportPoliciesCsv(db as unknown as DrizzleDB, tenantId, {
        q, product, status, effectiveFrom: effFrom, effectiveTo: effTo, sortBy, sortDir: sortDir as 'asc' | 'desc',
      })
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="policies-export.csv"')
      return res.send(csv)
    }

    // In-memory fallback
    let items = store.searchPolicies(tenantId, q)
    if (product) {
      const products = product.split(',').map((s) => s.trim()).filter(Boolean)
      items = items.filter((p: any) => products.includes(p.productCode.toLowerCase()))
    }
    if (status) items = items.filter((p: any) => matchesPolicyStatusFilter(status, p.status, p.term?.effectiveDate, p.term?.expirationDate))
    if (effFrom) items = items.filter((p: any) => p.term.effectiveDate >= effFrom)
    if (effTo) items = items.filter((p: any) => p.term.effectiveDate <= effTo)

    const dirMul = sortDir === 'asc' ? 1 : -1
    items.sort((a: any, b: any) => {
      const get = (p: any) => {
        switch (sortBy) {
          case 'policyNumber': return p.policyNumber
          case 'productCode': return p.productCode
          case 'status': return derivePolicyWorkflowStatus(p.status, p.term?.effectiveDate, p.term?.expirationDate)
          case 'expirationDate': return p.term?.expirationDate
          case 'effectiveDate':
          default: return p.term?.effectiveDate
        }
      }
      const av = get(a) || ''
      const bv = get(b) || ''
      if (av < bv) return -1 * dirMul
      if (av > bv) return 1 * dirMul
      return 0
    })

    const header = ['policyNumber', 'policyId', 'productCode', 'status', 'effectiveDate', 'expirationDate', 'uwDecision', 'uwOverride']
    const rows = items.map((p: any) => {
      const latest = (p.versions || []).slice(-1)[0] || null
      const decision = latest?.meta?.uwDecision?.decision || latest?.uwDecision || ''
      const override = latest?.meta?.uwOverride || latest?.uwOverride || false
      const workflowStatus = derivePolicyWorkflowStatus(p.status, p.term?.effectiveDate, p.term?.expirationDate)
      return [p.policyNumber, p.policyId, p.productCode, workflowStatus, p.term?.effectiveDate, p.term?.expirationDate, decision, override ? 'true' : 'false']
    })
    const csv = [header.join(','), ...rows.map((r: any[]) => r.map(csvEscape).join(','))].join('\n')
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="policies-export.csv"')
    res.send(csv)
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id ─────────────────────────────────────────────────────────
policyRoutes.get('/policies/:id', (req, res, next) => {
  if (req.params.id === 'export') return next()
  const tenantId = req.tenant!.tenantId
  const db = getDb()

  if (db) {
    policyService
      .getPolicy(db as unknown as DrizzleDB, tenantId, req.params.id)
      .then((data) => res.json(data))
      .catch((err: any) => {
        if (err?.statusCode === 404) {
          return res.status(404).json({ code: err.code || 'POLICY_NOT_FOUND' })
        }
        next(err)
      })
    return
  }

  // In-memory fallback
  try {
    const p = store.getPolicy(req.params.id)
    if (!p) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    return res.json({
      ...p,
      status: derivePolicyWorkflowStatus(p.status, (p as any).term?.effectiveDate, (p as any).term?.expirationDate),
      internalStatus: p.status,
      customer: (() => {
        const metadata = (p as any).metadata || {}
        const payloadPrimary = (p as any)?.payload?.insureds?.primary || {}
        const customerId = String(metadata.customerId || payloadPrimary.customerId || '').trim()
        const customerKey = String(metadata.customerKey || payloadPrimary.customerKey || '').trim()
        const firstName = String(payloadPrimary.firstName || '').trim()
        const lastName = String(payloadPrimary.lastName || '').trim()
        const name = String(
          metadata.customerName ||
            payloadPrimary.displayName ||
            [firstName, lastName].filter(Boolean).join(' ').trim()
        ).trim()
        if (!customerId && !customerKey && !name) return null
        return { customerId, customerKey, firstName, lastName, name }
      })(),
    })
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id/full ────────────────────────────────────────────────────
policyRoutes.get('/policies/:id/full', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Full payload requires DB' })
    const payload = await policyService.getFullPolicyPayload(db as unknown as DrizzleDB, tenantId, req.params.id)
    if (!payload) return res.status(404).json({ code: 'NOT_FOUND' })
    return ok(res, payload)
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id/state ───────────────────────────────────────────────────
policyRoutes.get('/policies/:id/state', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const asOfParam = asDateOnly(req.query?.asOf)
    const db = getDb()

    if (!db) {
      const policy = store.getPolicy(req.params.id)
      if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
      const asOf = asOfParam || today()
      const premium = rate(tenantId, (policy as any).payload)
      return ok(res, {
        policyId: policy.policyId,
        policyNumber: policy.policyNumber,
        asOf,
        timelineVersion: null,
        segmentStart: (policy as any).term.effectiveDate,
        segmentEnd: (policy as any).term.expirationDate,
        payload: (policy as any).payload,
        premium,
      })
    }

    const result = await policyService.getPolicyState(db as unknown as DrizzleDB, tenantId, req.params.id, asOfParam)
    return ok(res, result)
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    next(err)
  }
})

// ── GET /policies/:id/timeline ────────────────────────────────────────────────
policyRoutes.get('/policies/:id/timeline', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Timeline requires DB' })
    const result = await policyService.getPolicyTimeline(db as unknown as DrizzleDB, tenantId, req.params.id)
    return ok(res, result)
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    next(err)
  }
})

// ── GET /policies/:id/versions ────────────────────────────────────────────────
policyRoutes.get('/policies/:id/versions', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const rows = await policyService.getPolicyVersions(db as unknown as DrizzleDB, tenantId, req.params.id)
      return ok(res, rows)
    }

    // In-memory fallback
    const p = store.getPolicy(req.params.id)
    if (!p) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    const versions = ((p as any).versions || []).map((version: any) => ({
      ...version,
      policyEffectiveDate:
        version?.policyEffectiveDate || (p as any)?.term?.effectiveDate || null,
      createdDate: version?.createdDate || version?.processedDate || null,
      updatedDate: version?.updatedDate || version?.processedDate || null,
      updatedUser: version?.updatedUser || version?.meta?.submittedBy || 'system',
    }))
    return ok(res, versions)
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id/versions/:vid/details ───────────────────────────────────
policyRoutes.get('/policies/:id/versions/:vid/details', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const { id, vid } = req.params
    const db = getDb()
    if (!db) {
      return res.status(501).json({ code: 'NOT_IMPLEMENTED', message: 'Details available only with DB configured.' })
    }
    const data = await policyService.getVersionDetails(db as unknown as DrizzleDB, tenantId, id, vid)
    return ok(res, data)
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id/versions/:vid/rating-worksheet ─────────────────────────
policyRoutes.get('/policies/:id/versions/:vid/rating-worksheet', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const { id, vid } = req.params
    const db = getDb()
    if (!db) {
      return res.status(501).json({ code: 'NO_DB', message: 'Rating worksheet documents require DB' })
    }
    const data = await policyService.getRatingWorksheet(db as unknown as DrizzleDB, tenantId, id, vid)
    return ok(res, data)
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ code: 'DOCUMENT_NOT_FOUND' })
    next(err)
  }
})
