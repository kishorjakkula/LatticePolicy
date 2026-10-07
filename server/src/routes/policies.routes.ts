import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { getDb, type DrizzleDB, withTenantTx, toRawQuery } from '../db.js'
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
import { csvEscape, isUuidLike, routeParam, sanitizeInlineFileName } from '../lib/utils.js'
import { requirePermission, hasPermission } from '../auth.js'
import { regenerateAndVerifyDocument, retrieveAndVerifyStoredDocument } from '../services/document-storage.service.js'

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
const policyDocumentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
})

// ── GET /policies — list ──────────────────────────────────────────────────────
policyRoutes.get('/policies', requirePermission(['page.policy.view', 'page.search.view']), async (req, res, next) => {
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
policyRoutes.get('/policies/export', requirePermission(['page.policy.view', 'page.search.view']), async (req, res, next) => {
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
policyRoutes.get('/policies/:id', requirePermission('page.policy.view'), (req, res, next) => {
  const policyId = routeParam(req.params.id)
  if (policyId === 'export') return next()
  const tenantId = req.tenant!.tenantId
  const db = getDb()

  if (db) {
    policyService
      .getPolicy(db as unknown as DrizzleDB, tenantId, policyId)
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
    const p = store.getPolicyForTenant(policyId, tenantId)
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
policyRoutes.get('/policies/:id/full', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Full payload requires DB' })
    const payload = await policyService.getFullPolicyPayload(db as unknown as DrizzleDB, tenantId, routeParam(req.params.id))
    if (!payload) return res.status(404).json({ code: 'NOT_FOUND' })
    return ok(res, payload)
  } catch (err) {
    next(err)
  }
})

// ── GET /policies/:id/state ───────────────────────────────────────────────────
policyRoutes.get('/policies/:id/state', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const policyId = routeParam(req.params.id)
    const asOfParam = asDateOnly(req.query?.asOf)
    const db = getDb()

    if (!db) {
      const policy = store.getPolicyForTenant(policyId, tenantId)
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

    const result = await policyService.getPolicyState(db as unknown as DrizzleDB, tenantId, policyId, asOfParam)
    return ok(res, result)
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    next(err)
  }
})

// ── GET /policies/:id/timeline ────────────────────────────────────────────────
policyRoutes.get('/policies/:id/timeline', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Timeline requires DB' })
    const result = await policyService.getPolicyTimeline(db as unknown as DrizzleDB, tenantId, routeParam(req.params.id))
    return ok(res, result)
  } catch (err: any) {
    if (err?.statusCode === 404) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    next(err)
  }
})

// ── GET /policies/:id/versions ────────────────────────────────────────────────
policyRoutes.get('/policies/:id/versions', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const policyId = routeParam(req.params.id)
    const db = getDb()

    if (db) {
      const rows = await policyService.getPolicyVersions(db as unknown as DrizzleDB, tenantId, policyId)
      return ok(res, rows)
    }

    // In-memory fallback
    const p = store.getPolicyForTenant(policyId, tenantId)
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
policyRoutes.get('/policies/:id/versions/:vid/details', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const id = routeParam(req.params.id)
    const vid = routeParam(req.params.vid)
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
policyRoutes.get('/policies/:id/versions/:vid/rating-worksheet', requirePermission('page.policy.view'), async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const id = routeParam(req.params.id)
    const vid = routeParam(req.params.vid)
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

function toMetadataObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

async function resolveDocumentAccessContext(
  req: any,
  tenantId: string,
  policyId: string
): Promise<{ isInternal: boolean; customerId: string } | null> {
  const isInternal = hasPermission(req, 'page.policy.view')
  const customerId = String(req.user?.customerId || '').trim()
  if (isInternal) return { isInternal, customerId }
  if (!customerId) return null
  const linked = await withTenantTx(tenantId, async (txDb) => {
    const q = toRawQuery(txDb)
    return q(
      `SELECT 1 FROM policy_customer_links
        WHERE tenant_id = $1 AND policy_id = $2::uuid AND customer_id = $3::uuid
        LIMIT 1`,
      [tenantId, policyId, customerId]
    )
  })
  if (!((linked as any).rowCount > 0)) return null
  return { isInternal, customerId }
}

// ── GET /policies/:id/documents ───────────────────────────────────────────────
// Lists generated policy documents. Internal callers (page.policy.view) see
// every document for the policy; customer-portal callers see only documents
// linked to their own customer record and flagged metadata.customerSafe.
policyRoutes.get(
  '/policies/:id/documents',
  requirePermission(['page.policy.view', 'customer.portal.read']),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const policyId = routeParam(req.params.id)
      if (!isUuidLike(policyId)) return res.status(400).json({ code: 'INVALID_POLICY_ID' })
      const db = getDb()
      if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Documents require DB' })

      const access = await resolveDocumentAccessContext(req, tenantId, policyId)
      if (!access) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })

      const result = await withTenantTx(tenantId, async (txDb) => {
        const q = toRawQuery(txDb)
        return q(
          `SELECT document_id, version_id, type, hash, input_hash, form_set_hash,
                  integrity_status, delivery_evidence, metadata, created_at
             FROM documents
            WHERE tenant_id = $1 AND policy_id = $2::uuid
            ORDER BY created_at DESC`,
          [tenantId, policyId]
        )
      })

      const rows = ((result as any).rows || []) as any[]
      const documents = rows
        .map((row) => ({ row, metadata: toMetadataObject(row.metadata) }))
        .filter(({ metadata }) => access.isInternal || metadata.customerSafe === true)
        .map(({ row, metadata }) => ({
          documentId: String(row.document_id),
          versionId: row.version_id || null,
          type: String(row.type),
          displayName: `${String(row.type)} ${metadata.transactionNumber || ''}`.trim(),
          transactionType: metadata.transactionType || null,
          transactionNumber: metadata.transactionNumber || null,
          forms: Array.isArray(metadata.forms) ? metadata.forms : [],
          contentHash: row.hash || null,
          inputHash: row.input_hash || null,
          formSetHash: row.form_set_hash || null,
          integrityStatus: row.integrity_status || 'UNVERIFIED',
          deliveryEvidence: Array.isArray(row.delivery_evidence) ? row.delivery_evidence : [],
          contentType: metadata.artifact?.contentType || null,
          byteSize: metadata.artifact?.byteSize ?? null,
          customerSafe: metadata.customerSafe === true,
          generatedAt: metadata.generatedAt || row.created_at,
        }))
      return ok(res, { documents })
    } catch (err) {
      next(err)
    }
  }
)

policyRoutes.patch(
  '/policies/:id/documents/:documentId/delivery',
  policyDocumentLimiter,
  requirePermission('page.policy.view'),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const policyId = routeParam(req.params.id)
      const documentId = routeParam(req.params.documentId)
      if (!isUuidLike(policyId) || !isUuidLike(documentId)) {
        return res.status(400).json({ code: 'INVALID_ID' })
      }
      const method = String(req.body?.method || '').trim()
      const status = String(req.body?.status || '').trim()
      if (!method || !['Pending', 'Delivered', 'Failed'].includes(status)) {
        return res.status(400).json({ code: 'INVALID_DELIVERY_EVIDENCE' })
      }
      if (!getDb()) return res.status(501).json({ code: 'NO_DB', message: 'Documents require DB' })
      const evidence = await withTenantTx(tenantId, async (txDb) => {
        const q = toRawQuery(txDb)
        const current = await q(
          `SELECT delivery_evidence FROM documents
            WHERE tenant_id=$1 AND policy_id=$2::uuid AND document_id=$3::uuid FOR UPDATE`,
          [tenantId, policyId, documentId]
        )
        if (!current.rowCount) return null
        const entries = Array.isArray(current.rows[0].delivery_evidence)
          ? current.rows[0].delivery_evidence.filter((entry: any) => String(entry?.method) !== method)
          : []
        entries.push({
          method,
          status,
          evidenceRef: req.body?.evidenceRef || null,
          detail: req.body?.detail || null,
          recordedAt: new Date().toISOString(),
          recordedBy: req.user?.id || req.user?.username || null,
        })
        await q(
          `UPDATE documents SET delivery_evidence=$4::jsonb
            WHERE tenant_id=$1 AND policy_id=$2::uuid AND document_id=$3::uuid`,
          [tenantId, policyId, documentId, JSON.stringify(entries)]
        )
        return entries
      })
      return evidence
        ? res.json({ documentId, deliveryEvidence: evidence })
        : res.status(404).json({ code: 'DOCUMENT_NOT_FOUND' })
    } catch (err) {
      next(err)
    }
  }
)

policyRoutes.post(
  '/policies/:id/documents/:documentId/regenerate',
  policyDocumentLimiter,
  requirePermission('page.policy.view'),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const policyId = routeParam(req.params.id)
      const documentId = routeParam(req.params.documentId)
      if (!isUuidLike(policyId) || !isUuidLike(documentId)) {
        return res.status(400).json({ code: 'INVALID_ID' })
      }
      if (!getDb()) return res.status(501).json({ code: 'NO_DB', message: 'Documents require DB' })
      const result = await withTenantTx(tenantId, async (txDb) => toRawQuery(txDb)(
        `SELECT hash,metadata FROM documents
          WHERE tenant_id=$1 AND policy_id=$2::uuid AND document_id=$3::uuid LIMIT 1`,
        [tenantId, policyId, documentId]
      ))
      if (!(result as any).rowCount) return res.status(404).json({ code: 'DOCUMENT_NOT_FOUND' })
      const row = (result as any).rows[0]
      const metadata = toMetadataObject(row.metadata)
      const artifact = row.hash
        ? await regenerateAndVerifyDocument({ tenantId, documentId, metadata: metadata as any, expectedHash: String(row.hash) })
        : null
      const integrityStatus = artifact ? 'VERIFIED' : 'FAILED'
      await withTenantTx(tenantId, async (txDb) => toRawQuery(txDb)(
        `UPDATE documents SET integrity_status=$4
          WHERE tenant_id=$1 AND policy_id=$2::uuid AND document_id=$3::uuid`,
        [tenantId, policyId, documentId, integrityStatus]
      ))
      return artifact
        ? res.json({ documentId, integrityStatus, contentHash: artifact.contentHash })
        : res.status(409).json({ code: 'DOCUMENT_REGENERATION_MISMATCH' })
    } catch (err) {
      next(err)
    }
  }
)

// ── GET /policies/:id/documents/:documentId/content ───────────────────────────
// Retrieves the rendered artifact bytes for a generated policy document,
// enforcing the same tenant/customer scope as the listing endpoint plus a
// customer-safe check for non-internal callers.
policyRoutes.get(
  '/policies/:id/documents/:documentId/content',
  policyDocumentLimiter,
  requirePermission(['page.policy.view', 'customer.portal.read']),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const policyId = routeParam(req.params.id)
      const documentId = routeParam(req.params.documentId)
      if (!isUuidLike(policyId) || !isUuidLike(documentId)) {
        return res.status(400).json({ code: 'INVALID_ID' })
      }
      const db = getDb()
      if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Documents require DB' })

      const access = await resolveDocumentAccessContext(req, tenantId, policyId)
      if (!access) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })

      const result = await withTenantTx(tenantId, async (txDb) => {
        const q = toRawQuery(txDb)
        return q(
          `SELECT document_id, type, hash, metadata
             FROM documents
            WHERE tenant_id = $1 AND policy_id = $2::uuid AND document_id = $3::uuid
            LIMIT 1`,
          [tenantId, policyId, documentId]
        )
      })
      if (!((result as any).rowCount > 0)) {
        return res.status(404).json({ code: 'DOCUMENT_NOT_FOUND' })
      }
      const row = (result as any).rows[0]
      const metadata = toMetadataObject(row.metadata)
      if (!access.isInternal && metadata.customerSafe !== true) {
        return res.status(403).json({ code: 'FORBIDDEN', message: 'Document is not customer-safe' })
      }
      const artifact = toMetadataObject(metadata.artifact)
      const storageUri = artifact.storageUri
      if (!storageUri) return res.status(404).json({ code: 'ARTIFACT_NOT_FOUND' })
      const content = row.hash
        ? await retrieveAndVerifyStoredDocument(String(storageUri), String(row.hash))
        : null
      if (!content) {
        await withTenantTx(tenantId, async (txDb) => toRawQuery(txDb)(
          `UPDATE documents SET integrity_status='FAILED'
            WHERE tenant_id=$1 AND policy_id=$2::uuid AND document_id=$3::uuid`,
          [tenantId, policyId, documentId]
        ))
        return res.status(409).json({ code: 'ARTIFACT_INTEGRITY_FAILED' })
      }

      res.setHeader('Content-Type', String(artifact.contentType || 'application/octet-stream'))
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${sanitizeInlineFileName(`${row.type}-${documentId}.html`)}"`
      )
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(content)
    } catch (err) {
      next(err)
    }
  }
)
