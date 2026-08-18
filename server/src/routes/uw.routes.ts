import { Router } from 'express'
import { getDb, withTenantTx } from '../db.js'
import { requirePermission } from '../auth.js'
import {
  listReferrals,
  getReferral,
  assignReferral,
  addReferralComment,
  decideReferral,
} from '../services/uw-referral.service.js'

export const uwRoutes = Router()

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
    })
  )
    .then((referral) => res.json(referral))
    .catch((err) => next(err))
})
