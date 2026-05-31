import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'

export const uwRoutes = Router()

// GET /uw/referrals
// Lists policy versions in 'Refer' UW decision state that have not been overridden.
// Returns empty result set when no DB is configured.
uwRoutes.get('/uw/referrals', requirePermission('uw.referrals.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.json({ items: [], total: 0, page: 1, pageSize: 20 })
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
  const offset = (page - 1) * pageSize
  const sql = `
    SELECT pv.version_id, pv.policy_id, pv.effective_date, pv.processed_at, pv.transaction_type,
           pv.uw_decision, pv.uw_override, pv.override_reason, pv.calc_trace,
           p.policy_number, p.product_code
      FROM policy_versions pv
      JOIN policies p ON p.policy_id = pv.policy_id AND p.tenant_id = pv.tenant_id
     WHERE pv.tenant_id = $1 AND pv.uw_decision = 'Refer' AND COALESCE(pv.uw_override, false) = false
     ORDER BY pv.processed_at DESC
     LIMIT ${pageSize} OFFSET ${offset}`
  withTenantTx(tenantId, (db) => toRawQuery(db)(sql, [tenantId]))
    .then((r: any) => {
      const items = r.rows.map((row: any) => ({
        versionId: row.version_id,
        policyId: row.policy_id,
        policyNumber: row.policy_number,
        productCode: row.product_code,
        effectiveDate: row.effective_date,
        processedDate: row.processed_at,
        transactionType: row.transaction_type,
        uwDecision: row.uw_decision,
        uwOverride: row.uw_override,
        overrideReason: row.override_reason,
        submittedBy: row.calc_trace?.uw?.submittedBy || null
      }))
      return res.json({ items, total: items.length, page, pageSize })
    })
    .catch((err: any) => next(err))
})

// PATCH /uw/referrals/:versionId/approve
// Sets uw_override=true with the provided override reason.
// Requires a non-empty reason in the request body.
// DB-only — returns 400 when no DB is configured.
uwRoutes.patch(
  '/uw/referrals/:versionId/approve',
  requirePermission('uw.referrals.decide'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const versionId = req.params.versionId
    const reason = (req.body?.reason || '').toString().trim()
    if (!reason) {
      return res.status(400).json({ code: 'REASON_REQUIRED', message: 'Override reason is required' })
    }
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    withTenantTx(tenantId, (db) =>
      toRawQuery(db)(
        'UPDATE policy_versions SET uw_override=true, override_reason=$1 WHERE tenant_id=$2 AND version_id=$3',
        [reason, tenantId, versionId]
      )
    )
      .then(() => res.json({ ok: true }))
      .catch((err: any) => next(err))
  }
)

// PATCH /uw/referrals/:versionId/decline
// Sets uw_decision='Decline' and uw_override=false with the optional override reason.
// DB-only — returns 400 when no DB is configured.
uwRoutes.patch(
  '/uw/referrals/:versionId/decline',
  requirePermission('uw.referrals.decide'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const versionId = req.params.versionId
    const reason = (req.body?.reason || '').toString().trim()
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    withTenantTx(tenantId, (db) =>
      toRawQuery(db)(
        'UPDATE policy_versions SET uw_decision=$1, uw_override=false, override_reason=$2 WHERE tenant_id=$3 AND version_id=$4',
        ['Decline', reason || null, tenantId, versionId]
      )
    )
      .then(() => res.json({ ok: true }))
      .catch((err: any) => next(err))
  }
)
