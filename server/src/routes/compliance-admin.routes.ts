import type { Request } from 'express'
import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { hasPermission } from '../auth.js'
import { normalizeOfacName } from '../lib/policy-compliance.js'
import { routeParam } from '../lib/utils.js'
import { BadRequestError, ForbiddenError, NotFoundError } from '../errors/domain.errors.js'

export const complianceAdminRoutes = Router()

const ELIGIBILITY_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED', 'FILING_PENDING'] as const
const OFAC_DISPOSITIONS = ['PENDING', 'CLEARED', 'ESCALATED', 'BLOCKED'] as const

function currentActorId(req: Request): string | null {
  return req.user?.id || null
}

function canManage(req: Request): boolean {
  return hasPermission(req, 'admin.compliance.manage')
}

complianceAdminRoutes.use((_req, _res, next) => {
  if (!getDb()) {
    throw new BadRequestError('NO_DB', 'Compliance administration requires database mode')
  }
  next()
})

// ── Product/state eligibility ────────────────────────────────────────────────

complianceAdminRoutes.get('/eligibility', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const productCode = typeof req.query.productCode === 'string' ? req.query.productCode : undefined
  const stateCode = typeof req.query.stateCode === 'string' ? req.query.stateCode.toUpperCase() : undefined
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : undefined

  const rows = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const clauses = ['tenant_id = $1']
    const params: any[] = [tenantId]
    let idx = 2
    if (productCode) {
      clauses.push(`product_code = $${idx}`)
      params.push(productCode)
      idx += 1
    }
    if (stateCode) {
      clauses.push(`state_code = $${idx}`)
      params.push(stateCode)
      idx += 1
    }
    if (status) {
      clauses.push(`status = $${idx}`)
      params.push(status)
      idx += 1
    }
    const result = await q(
      `SELECT eligibility_id, tenant_id, product_code, state_code, admitted, surplus_lines,
              min_premium, max_tiv, max_limit, status, notes, effective_date, expiration_date, created_at
         FROM product_state_eligibility
        WHERE ${clauses.join(' AND ')}
        ORDER BY product_code, state_code`,
      params
    )
    return result.rows
  })
  res.json({ items: rows })
})

complianceAdminRoutes.post('/eligibility', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!canManage(req)) {
    throw new ForbiddenError('FORBIDDEN')
  }

  const body = req.body || {}
  const productCode = String(body.productCode || '').trim()
  const stateCode = String(body.stateCode || '').trim().toUpperCase()
  if (!productCode || stateCode.length !== 2) {
    throw new BadRequestError('INVALID_INPUT', 'productCode and a 2-letter stateCode are required')
  }
  const status = ELIGIBILITY_STATUSES.includes(body.status) ? body.status : 'ACTIVE'
  const admitted = body.admitted !== false
  const surplusLines = body.surplusLines === true
  const minPremium = body.minPremium != null ? Number(body.minPremium) : null
  const maxTiv = body.maxTiv != null ? Number(body.maxTiv) : null
  const maxLimit = body.maxLimit != null ? Number(body.maxLimit) : null
  const notes = typeof body.notes === 'string' ? body.notes : null
  const effectiveDate = body.effectiveDate || null
  const expirationDate = body.expirationDate || null

  const row = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `INSERT INTO product_state_eligibility
         (tenant_id, product_code, state_code, admitted, surplus_lines, min_premium, max_tiv, max_limit, status, notes, effective_date, expiration_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (tenant_id, product_code, state_code) DO UPDATE SET
         admitted = EXCLUDED.admitted,
         surplus_lines = EXCLUDED.surplus_lines,
         min_premium = EXCLUDED.min_premium,
         max_tiv = EXCLUDED.max_tiv,
         max_limit = EXCLUDED.max_limit,
         status = EXCLUDED.status,
         notes = EXCLUDED.notes,
         effective_date = EXCLUDED.effective_date,
         expiration_date = EXCLUDED.expiration_date
       RETURNING eligibility_id, tenant_id, product_code, state_code, admitted, surplus_lines,
                 min_premium, max_tiv, max_limit, status, notes, effective_date, expiration_date, created_at`,
      [tenantId, productCode, stateCode, admitted, surplusLines, minPremium, maxTiv, maxLimit, status, notes, effectiveDate, expirationDate]
    )
    return result.rows[0]
  })
  res.status(201).json(row)
})

complianceAdminRoutes.patch('/eligibility/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const eligibilityId = routeParam(req.params.id)
  if (!canManage(req)) {
    throw new ForbiddenError('FORBIDDEN')
  }

  const body = req.body || {}
  const sets: string[] = []
  const params: any[] = []
  let idx = 1

  const fieldMap: Array<[string, any]> = [
    ['admitted', body.admitted],
    ['surplus_lines', body.surplusLines],
    ['min_premium', body.minPremium],
    ['max_tiv', body.maxTiv],
    ['max_limit', body.maxLimit],
    ['notes', body.notes],
    ['effective_date', body.effectiveDate],
    ['expiration_date', body.expirationDate]
  ]
  for (const [column, value] of fieldMap) {
    if (value !== undefined) {
      sets.push(`${column} = $${idx}`)
      params.push(value)
      idx += 1
    }
  }
  if (body.status !== undefined) {
    if (!ELIGIBILITY_STATUSES.includes(body.status)) {
      throw new BadRequestError('INVALID_INPUT', `status must be one of ${ELIGIBILITY_STATUSES.join(', ')}`)
    }
    sets.push(`status = $${idx}`)
    params.push(body.status)
    idx += 1
  }
  if (sets.length === 0) {
    throw new BadRequestError('INVALID_INPUT', 'No updatable fields provided')
  }

  const row = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    params.push(tenantId, eligibilityId)
    const result = await q(
      `UPDATE product_state_eligibility SET ${sets.join(', ')}
        WHERE tenant_id = $${idx} AND eligibility_id = $${idx + 1}
        RETURNING eligibility_id, tenant_id, product_code, state_code, admitted, surplus_lines,
                  min_premium, max_tiv, max_limit, status, notes, effective_date, expiration_date, created_at`,
      params
    )
    return result.rows[0]
  })
  if (!row) throw new NotFoundError('NOT_FOUND', 'Eligibility record not found')
  res.json(row)
})

// ── OFAC SDN list import ─────────────────────────────────────────────────────
// The SDN list is a global sanctions reference, not tenant-scoped. Import is
// intentionally a local/demo-friendly bulk upsert of caller-supplied entries,
// not a live external sanctions feed integration.

complianceAdminRoutes.post('/ofac/sdn-list/import', async (req, res) => {
  if (!canManage(req)) {
    throw new ForbiddenError('FORBIDDEN')
  }
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
  if (entries.length === 0) {
    throw new BadRequestError('INVALID_INPUT', 'entries array is required')
  }

  const pool = getDb()!
  const q = (text: string, params?: any[]) => pool.query(text, params)
  let imported = 0
  for (const entry of entries) {
    const name = String(entry?.name || '').trim()
    if (!name) continue
    const aliases = Array.isArray(entry?.aliases) ? entry.aliases : []
    await q(
      `INSERT INTO ofac_sdn_list (name, normalized_name, aliases, address, country, list_type, updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,now())`,
      [
        name,
        normalizeOfacName(name),
        JSON.stringify(aliases),
        entry?.address || null,
        entry?.country || null,
        entry?.listType || 'SDN'
      ]
    )
    imported += 1
  }
  res.status(201).json({ imported })
})

// ── OFAC screen review queue ─────────────────────────────────────────────────

complianceAdminRoutes.get('/ofac/screens', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const disposition = typeof req.query.disposition === 'string' ? req.query.disposition.toUpperCase() : undefined

  const rows = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const clauses = ['tenant_id = $1']
    const params: any[] = [tenantId]
    if (disposition) {
      clauses.push('disposition = $2')
      params.push(disposition)
    } else {
      clauses.push(`disposition IN ('PENDING','ESCALATED')`)
    }
    const result = await q(
      `SELECT screen_id, tenant_id, party_name, policy_id, quote_id, screen_date, result,
              match_details, disposition, disposition_reason, reviewed_by, reviewed_at, created_at
         FROM ofac_screens
        WHERE ${clauses.join(' AND ')}
        ORDER BY screen_date DESC
        LIMIT 200`,
      params
    )
    return result.rows
  })
  res.json({ items: rows })
})

complianceAdminRoutes.patch('/ofac/screens/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const screenId = routeParam(req.params.id)
  if (!canManage(req)) {
    throw new ForbiddenError('FORBIDDEN')
  }

  const disposition = String(req.body?.disposition || '').toUpperCase()
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : null
  if (!OFAC_DISPOSITIONS.includes(disposition as any) || disposition === 'PENDING') {
    throw new BadRequestError('INVALID_INPUT', 'disposition must be one of CLEARED, ESCALATED, BLOCKED')
  }
  if ((disposition === 'CLEARED' || disposition === 'BLOCKED') && !reason) {
    throw new BadRequestError('INVALID_INPUT', 'reason is required to clear or block a screen')
  }

  const row = await withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      `UPDATE ofac_screens
          SET disposition = $1, disposition_reason = $2, reviewed_by = $3, reviewed_at = now()
        WHERE tenant_id = $4 AND screen_id = $5
        RETURNING screen_id, tenant_id, party_name, policy_id, quote_id, screen_date, result,
                  match_details, disposition, disposition_reason, reviewed_by, reviewed_at, created_at`,
      [disposition, reason, currentActorId(req), tenantId, screenId]
    )
    return result.rows[0]
  })
  if (!row) throw new NotFoundError('NOT_FOUND', 'OFAC screen not found')
  res.json(row)
})
