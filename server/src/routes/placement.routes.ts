import { Router } from 'express'
import { getDb, withTenantTx } from '../db.js'
import { requirePermission } from '../auth.js'
import {
  createPlacement,
  getPlacement,
  listPlacements,
  addMarketParticipant,
  addSubjectivity,
  resolveSubjectivity,
  addPlacementDocument,
  transitionPlacementStatus,
} from '../services/placement.service.js'

export const placementRoutes = Router()

// GET /placements
placementRoutes.get('/placements', requirePermission('placement.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.json({ items: [], total: 0, page: 1, pageSize: 20 })
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  withTenantTx(tenantId, (innerDb) => listPlacements(innerDb, tenantId, { status, page, pageSize }))
    .then((result) => res.json(result))
    .catch((err) => next(err))
})

// POST /placements
placementRoutes.post('/placements', requirePermission('placement.manage'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  const createdBy = req.user?.id || null
  withTenantTx(tenantId, (innerDb) =>
    createPlacement(innerDb, tenantId, { ...req.body, createdBy })
  )
    .then((placement) => res.status(201).json(placement))
    .catch((err) => next(err))
})

// GET /placements/:placementId
placementRoutes.get('/placements/:placementId', requirePermission('placement.read'), (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
  withTenantTx(tenantId, (innerDb) => getPlacement(innerDb, tenantId, String(req.params.placementId)))
    .then((placement) => res.json(placement))
    .catch((err) => next(err))
})

// POST /placements/:placementId/participants
placementRoutes.post(
  '/placements/:placementId/participants',
  requirePermission('placement.manage'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    withTenantTx(tenantId, (innerDb) =>
      addMarketParticipant(innerDb, tenantId, String(req.params.placementId), req.body)
    )
      .then((participant) => res.status(201).json(participant))
      .catch((err) => next(err))
  }
)

// POST /placements/:placementId/subjectivities
placementRoutes.post(
  '/placements/:placementId/subjectivities',
  requirePermission('placement.manage'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    withTenantTx(tenantId, (innerDb) =>
      addSubjectivity(innerDb, tenantId, String(req.params.placementId), req.body)
    )
      .then((subjectivity) => res.status(201).json(subjectivity))
      .catch((err) => next(err))
  }
)

// PATCH /placements/:placementId/subjectivities/:subjectivityId
placementRoutes.patch(
  '/placements/:placementId/subjectivities/:subjectivityId',
  requirePermission('placement.manage'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    const resolvedBy = req.user?.id || null
    withTenantTx(tenantId, (innerDb) =>
      resolveSubjectivity(
        innerDb,
        tenantId,
        String(req.params.placementId),
        String(req.params.subjectivityId),
        { status: req.body?.status, resolvedBy }
      )
    )
      .then((subjectivity) => res.json(subjectivity))
      .catch((err) => next(err))
  }
)

// POST /placements/:placementId/documents
placementRoutes.post(
  '/placements/:placementId/documents',
  requirePermission('placement.manage'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    const uploadedBy = req.user?.id || null
    withTenantTx(tenantId, (innerDb) =>
      addPlacementDocument(innerDb, tenantId, String(req.params.placementId), { ...req.body, uploadedBy })
    )
      .then((placement) => res.status(201).json(placement))
      .catch((err) => next(err))
  }
)

// PATCH /placements/:placementId/status
placementRoutes.patch(
  '/placements/:placementId/status',
  requirePermission('placement.manage'),
  (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    const actorId = req.user?.id || null
    withTenantTx(tenantId, (innerDb) =>
      transitionPlacementStatus(innerDb, tenantId, String(req.params.placementId), {
        toStatus: req.body?.toStatus,
        reason: req.body?.reason,
        policyId: req.body?.policyId,
        actorId,
      })
    )
      .then((placement) => res.json(placement))
      .catch((err) => next(err))
  }
)
