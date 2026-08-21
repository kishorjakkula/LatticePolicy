import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'
import { v4 as uuidv4 } from '../uuid.js'
import { routeParam } from '../lib/utils.js'
import { BadRequestError, NotFoundError } from '../errors/domain.errors.js'
import {
  assertValidTreatyType,
  computePlacementForTransaction,
  validateParticipantShares
} from '../services/reinsurance.service.js'

export const reinsuranceAdminRoutes = Router()

reinsuranceAdminRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Reinsurance administration requires database mode' })
  }
  next()
})

// ── Treaties ─────────────────────────────────────────────────────────────────

reinsuranceAdminRoutes.get('/treaties', requirePermission('admin.reinsurance.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['t.tenant_id = $1']
      const params: any[] = [tenantId]
      if (status) {
        clauses.push(`t.status = $2`)
        params.push(status)
      }
      const result = await q(
        `SELECT t.treaty_id, t.program_id, t.treaty_name, t.treaty_type, t.status, t.effective_date,
                t.expiration_date, t.version, t.broker_name, t.broker_reference, t.currency,
                t.product_codes, t.state_codes, t.created_at,
                COALESCE(json_agg(json_build_object(
                  'layerId', l.layer_id, 'layerNumber', l.layer_number, 'layerType', l.layer_type,
                  'retentionAmount', l.retention_amount, 'limitAmount', l.limit_amount,
                  'cededPercent', l.ceded_percent, 'retainedPercent', l.retained_percent
                ) ORDER BY l.layer_number) FILTER (WHERE l.layer_id IS NOT NULL), '[]') AS layers
           FROM reinsurance_treaties t
           LEFT JOIN reinsurance_treaty_layers l ON l.treaty_id = t.treaty_id AND l.tenant_id = t.tenant_id
          WHERE ${clauses.join(' AND ')}
          GROUP BY t.treaty_id
          ORDER BY t.effective_date DESC`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err) {
    next(err)
  }
})

reinsuranceAdminRoutes.post('/treaties', requirePermission('admin.reinsurance.manage'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const body = req.body || {}
  try {
    const treatyName = String(body.treatyName || '').trim()
    if (!treatyName) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'treatyName is required')
    assertValidTreatyType(String(body.treatyType || ''))
    const effectiveDate = body.effectiveDate
    const expirationDate = body.expirationDate
    if (!effectiveDate || !expirationDate) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'effectiveDate and expirationDate are required')

    const layers = Array.isArray(body.layers) ? body.layers : []
    if (layers.length === 0) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'At least one layer is required')
    for (const layer of layers) {
      const validation = validateParticipantShares(
        (layer.participants || []).map((p: any) => ({ participationPercent: Number(p.participationPercent) }))
      )
      if (!validation.valid) throw new BadRequestError('REINSURANCE_INVALID_INPUT', validation.error || 'Invalid participant shares')
    }

    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const treatyId = uuidv4()
      await q(
        `INSERT INTO reinsurance_treaties
           (treaty_id, tenant_id, program_id, treaty_name, treaty_type, status, effective_date, expiration_date,
            broker_name, broker_reference, currency, product_codes, state_codes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          treatyId,
          tenantId,
          body.programId || null,
          treatyName,
          body.treatyType,
          body.status || 'Active',
          effectiveDate,
          expirationDate,
          body.brokerName || null,
          body.brokerReference || null,
          body.currency || 'USD',
          body.productCodes || null,
          body.stateCodes || null,
          req.user?.id || null
        ]
      )

      for (let i = 0; i < layers.length; i += 1) {
        const layer = layers[i]
        const layerId = uuidv4()
        await q(
          `INSERT INTO reinsurance_treaty_layers
             (layer_id, tenant_id, treaty_id, layer_number, layer_type, retention_amount, limit_amount,
              ceded_percent, retained_percent, premium_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            layerId,
            tenantId,
            treatyId,
            layer.layerNumber || i + 1,
            layer.layerType || body.treatyType,
            layer.retentionAmount ?? null,
            layer.limitAmount ?? null,
            layer.cededPercent,
            layer.retainedPercent,
            layer.premiumRate ?? null
          ]
        )
        for (const participant of layer.participants || []) {
          await q(
            `INSERT INTO reinsurance_market_participants
               (participant_id, tenant_id, layer_id, reinsurer_name, reinsurer_reference, participation_percent, broker_name, is_lead)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              uuidv4(),
              tenantId,
              layerId,
              participant.reinsurerName,
              participant.reinsurerReference || null,
              participant.participationPercent,
              participant.brokerName || null,
              participant.isLead === true
            ]
          )
        }
      }

      const result = await q(`SELECT * FROM reinsurance_treaties WHERE tenant_id = $1 AND treaty_id = $2`, [tenantId, treatyId])
      return result.rows[0]
    })
    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

reinsuranceAdminRoutes.patch('/treaties/:id', requirePermission('admin.reinsurance.manage'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const treatyId = routeParam(req.params.id)
  const body = req.body || {}
  try {
    const sets: string[] = []
    const params: any[] = []
    let idx = 1
    const fieldMap: Array<[string, any]> = [
      ['broker_name', body.brokerName],
      ['broker_reference', body.brokerReference],
      ['expiration_date', body.expirationDate],
      ['product_codes', body.productCodes],
      ['state_codes', body.stateCodes]
    ]
    for (const [column, value] of fieldMap) {
      if (value !== undefined) {
        sets.push(`${column} = $${idx}`)
        params.push(value)
        idx += 1
      }
    }
    if (body.status !== undefined) {
      if (!['Draft', 'Active', 'Expired', 'Cancelled'].includes(body.status)) {
        throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'status must be one of Draft, Active, Expired, Cancelled')
      }
      sets.push(`status = $${idx}`)
      params.push(body.status)
      idx += 1
    }
    sets.push(`updated_at = now()`)
    if (sets.length === 1) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'No updatable fields provided')

    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      params.push(tenantId, treatyId)
      const result = await q(
        `UPDATE reinsurance_treaties SET ${sets.join(', ')} WHERE tenant_id = $${idx} AND treaty_id = $${idx + 1} RETURNING *`,
        params
      )
      return result.rows[0]
    })
    if (!row) throw new NotFoundError('REINSURANCE_NOT_FOUND', 'Treaty not found')
    res.json(row)
  } catch (err) {
    next(err)
  }
})

// ── Facultative certificates ─────────────────────────────────────────────────

reinsuranceAdminRoutes.get('/facultative', requirePermission('admin.reinsurance.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const policyId = typeof req.query.policyId === 'string' ? req.query.policyId : undefined
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id = $1']
      const params: any[] = [tenantId]
      if (policyId) {
        clauses.push('policy_id = $2')
        params.push(policyId)
      }
      const result = await q(
        `SELECT * FROM reinsurance_facultative_certificates WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err) {
    next(err)
  }
})

reinsuranceAdminRoutes.post('/facultative', requirePermission('admin.reinsurance.manage'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const body = req.body || {}
  try {
    const policyId = String(body.policyId || '').trim()
    if (!policyId) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'policyId is required')
    if (!body.effectiveDate || !body.expirationDate) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'effectiveDate and expirationDate are required')
    if (body.cededPercent == null || body.retainedPercent == null) throw new BadRequestError('REINSURANCE_INVALID_INPUT', 'cededPercent and retainedPercent are required')

    const participants = Array.isArray(body.participants) ? body.participants : []
    if (participants.length > 0) {
      const validation = validateParticipantShares(participants.map((p: any) => ({ participationPercent: Number(p.participationPercent) })))
      if (!validation.valid) throw new BadRequestError('REINSURANCE_INVALID_INPUT', validation.error || 'Invalid participant shares')
    }

    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const certificateId = uuidv4()
      await q(
        `INSERT INTO reinsurance_facultative_certificates
           (certificate_id, tenant_id, policy_id, certificate_number, status, effective_date, expiration_date,
            retention_amount, limit_amount, ceded_percent, retained_percent, broker_name, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          certificateId,
          tenantId,
          policyId,
          body.certificateNumber || null,
          body.status || 'Active',
          body.effectiveDate,
          body.expirationDate,
          body.retentionAmount ?? null,
          body.limitAmount ?? null,
          body.cededPercent,
          body.retainedPercent,
          body.brokerName || null,
          req.user?.id || null
        ]
      )
      for (const participant of participants) {
        await q(
          `INSERT INTO reinsurance_market_participants
             (participant_id, tenant_id, facultative_certificate_id, reinsurer_name, reinsurer_reference, participation_percent, broker_name, is_lead)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            uuidv4(),
            tenantId,
            certificateId,
            participant.reinsurerName,
            participant.reinsurerReference || null,
            participant.participationPercent,
            participant.brokerName || null,
            participant.isLead === true
          ]
        )
      }
      const result = await q(`SELECT * FROM reinsurance_facultative_certificates WHERE tenant_id = $1 AND certificate_id = $2`, [
        tenantId,
        certificateId
      ])
      return result.rows[0]
    })
    res.status(201).json(row)
  } catch (err) {
    next(err)
  }
})

// ── Placement lookup ─────────────────────────────────────────────────────────

reinsuranceAdminRoutes.post(
  '/policies/:policyId/transactions/:transactionId/compute',
  requirePermission('admin.reinsurance.manage'),
  async (req, res, next) => {
    const tenantId = req.tenant!.tenantId
    const policyId = routeParam(req.params.policyId)
    const transactionId = routeParam(req.params.transactionId)
    try {
      const matches = await withTenantTx(tenantId, (db) => computePlacementForTransaction(db, tenantId, policyId, transactionId))
      res.json({ items: matches })
    } catch (err) {
      next(err)
    }
  }
)

reinsuranceAdminRoutes.get('/policies/:policyId/placements', requirePermission('admin.reinsurance.read'), async (req, res, next) => {
  const tenantId = req.tenant!.tenantId
  const policyId = routeParam(req.params.policyId)
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(
        `SELECT * FROM policy_reinsurance_placements WHERE tenant_id = $1 AND policy_id = $2 ORDER BY computed_at DESC`,
        [tenantId, policyId]
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err) {
    next(err)
  }
})
