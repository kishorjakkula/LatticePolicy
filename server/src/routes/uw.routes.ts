import { Router } from 'express'
import { getDb, toRawQuery, withTenantTx } from '../db.js'
import { hasPermission, requirePermission } from '../auth.js'
import {
  listReferrals,
  getReferral,
  assignReferral,
  addReferralComment,
  decideReferral,
} from '../services/uw-referral.service.js'

export const uwRoutes = Router()

uwRoutes.get('/uw/authority-grants', requirePermission('uw.authority.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!getDb()) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const result = await withTenantTx(tenantId, db => toRawQuery(db)(
    `SELECT * FROM underwriting_authority_grants WHERE tenant_id=$1
      ORDER BY subject_type,subject_id,effective_date DESC`, [tenantId]))
  return res.json({ items: result.rows })
})

uwRoutes.post('/uw/authority-grants', requirePermission('uw.authority.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const body = req.body || {}
  const subjectType = String(body.subjectType || '').toUpperCase()
  const subjectId = String(body.subjectId || '').trim()
  const transactionTypes = Array.isArray(body.transactionTypes) ? body.transactionTypes.map(String).filter(Boolean) : []
  if (!['USER', 'ROLE', 'PRODUCER'].includes(subjectType) || !subjectId || !transactionTypes.length || !body.effectiveDate) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'subjectType, subjectId, transactionTypes, and effectiveDate are required' })
  }
  if (!getDb()) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const actor = req.user?.username || req.user?.id || 'system'
  const row = await withTenantTx(tenantId, async db => {
    const q = toRawQuery(db)
    const inserted = await q(
      `INSERT INTO underwriting_authority_grants
       (tenant_id,subject_type,subject_id,product_code,state_code,transaction_types,max_premium,max_limit,
        may_override,effective_date,expiration_date,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [tenantId, subjectType, subjectId, body.productCode || null, body.stateCode || null, transactionTypes,
       body.maxPremium ?? null, body.maxLimit ?? null, body.mayOverride === true, body.effectiveDate,
       body.expirationDate || null, actor])
    await q(`INSERT INTO underwriting_authority_audit (tenant_id,grant_id,action,actor,after_value)
             VALUES ($1,$2,'CREATE',$3,$4::jsonb)`, [tenantId, inserted.rows[0].grant_id, actor, JSON.stringify(inserted.rows[0])])
    return inserted.rows[0]
  })
  return res.status(201).json(row)
})

uwRoutes.patch('/uw/authority-grants/:grantId', requirePermission('uw.authority.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!getDb()) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const actor = req.user?.username || req.user?.id || 'system'
  const row = await withTenantTx(tenantId, async db => {
    const q = toRawQuery(db)
    const before = await q(`SELECT * FROM underwriting_authority_grants WHERE tenant_id=$1 AND grant_id=$2::uuid FOR UPDATE`, [tenantId, req.params.grantId])
    if (!before.rowCount) return null
    const updated = await q(
      `UPDATE underwriting_authority_grants SET active=COALESCE($3,active), expiration_date=COALESCE($4::date,expiration_date)
        WHERE tenant_id=$1 AND grant_id=$2::uuid RETURNING *`,
      [tenantId, req.params.grantId, req.body?.active, req.body?.expirationDate || null])
    await q(`INSERT INTO underwriting_authority_audit (tenant_id,grant_id,action,actor,before_value,after_value)
             VALUES ($1,$2::uuid,'UPDATE',$3,$4::jsonb,$5::jsonb)`,
      [tenantId, req.params.grantId, actor, JSON.stringify(before.rows[0]), JSON.stringify(updated.rows[0])])
    return updated.rows[0]
  })
  return row ? res.json(row) : res.status(404).json({ code: 'NOT_FOUND', message: 'Authority grant not found' })
})

function isUnderwriter(req: any): boolean {
  const roles: string[] = req.user?.roles || []
  const permissions: string[] = req.user?.permissions || []
  return roles.includes('underwriter') || roles.includes('admin') || permissions.includes('uw.referrals.decide')
}

// GET /uw/referrals
// Lists underwriting referrals for the tenant, optionally filtered by status.
// Returns empty result set when no DB is configured.
uwRoutes.get('/uw/referrals', requirePermission('uw.referrals.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.json({ items: [], total: 0, page: 1, pageSize: 20 })
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  withTenantTx(tenantId, (innerDb) => listReferrals(innerDb, tenantId, { status, page, pageSize }))
    .then((result) => res.json(result))
    .catch((err) => next(err))
})

// GET /uw/referrals/:referralId
uwRoutes.get('/uw/referrals/:referralId', requirePermission('uw.referrals.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  withTenantTx(tenantId, (innerDb) => getReferral(innerDb, tenantId, String(req.params.referralId)))
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})

// PATCH /uw/referrals/:referralId/assign
// Body: { assignedTo: string (user id) }
uwRoutes.patch('/uw/referrals/:referralId/assign', requirePermission('uw.referrals.decide'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const assignedTo = (req.body?.assignedTo || '').toString().trim()
  if (!assignedTo) {
    return res.status(400).json({ code: 'ASSIGNED_TO_REQUIRED', message: 'assignedTo is required' })
  }
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  withTenantTx(tenantId, (innerDb) => assignReferral(innerDb, tenantId, String(req.params.referralId), assignedTo))
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})

// POST /uw/referrals/:referralId/comments
// Body: { text: string }
uwRoutes.post('/uw/referrals/:referralId/comments', requirePermission('uw.referrals.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const by = req.user?.id || req.user?.username || 'unknown'
  withTenantTx(tenantId, (innerDb) =>
    addReferralComment(innerDb, tenantId, String(req.params.referralId), { by, text: req.body?.text })
  )
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})

// PATCH /uw/referrals/:referralId/decide
// Body: { decision: 'Approved' | 'Declined' | 'InfoRequested', reason?: string }
// Requires an underwriter-permission actor; the decision authorizes (or blocks)
// the pending bind/renewal/rewrite/endorsement that created this referral.
uwRoutes.patch('/uw/referrals/:referralId/decide', requirePermission('uw.referrals.decide'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const decision = (req.body?.decision || '').toString().trim()
  if (!['Approved', 'Declined', 'InfoRequested'].includes(decision)) {
    return res.status(400).json({
      code: 'INVALID_DECISION',
      message: "decision must be one of 'Approved', 'Declined', 'InfoRequested'",
    })
  }
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const decidedBy = req.user?.id || null
  withTenantTx(tenantId, (innerDb) =>
    decideReferral(innerDb, tenantId, String(req.params.referralId), {
      decision: decision as any,
      reason: req.body?.reason,
      decidedBy,
      isUnderwriter: isUnderwriter(req),
      canOverrideAuthority: hasPermission(req, 'uw.authority.override'),
    })
  )
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})

// Backward-compatible aliases used by the existing UW queue UI.
uwRoutes.patch('/uw/referrals/:referralId/approve', requirePermission('uw.referrals.decide'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const decidedBy = req.user?.id || null
  withTenantTx(tenantId, (innerDb) =>
    decideReferral(innerDb, tenantId, String(req.params.referralId), {
      decision: 'Approved',
      reason: req.body?.reason,
      decidedBy,
      isUnderwriter: isUnderwriter(req),
      canOverrideAuthority: hasPermission(req, 'uw.authority.override'),
    })
  )
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})

uwRoutes.patch('/uw/referrals/:referralId/decline', requirePermission('uw.referrals.decide'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const decidedBy = req.user?.id || null
  withTenantTx(tenantId, (innerDb) =>
    decideReferral(innerDb, tenantId, String(req.params.referralId), {
      decision: 'Declined',
      reason: req.body?.reason,
      decidedBy,
      isUnderwriter: isUnderwriter(req),
      canOverrideAuthority: hasPermission(req, 'uw.authority.override'),
    })
  )
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})
