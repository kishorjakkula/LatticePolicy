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
import {
  listUwFieldsForProduct,
  findUwFieldCatalogEntry,
  UW_FIELD_CATALOG,
  type UwRuleOperator,
} from '../services/underwriting-rule-fields.js'

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

const UW_RULE_OUTCOMES = ['Refer', 'Decline']

function normalizeRuleStateCode(value: unknown): string | null {
  const s = String(value || '').trim().toUpperCase()
  return s.length === 2 ? s : null
}

// GET /admin/underwriting-rules/fields?productCode=X
// Returns the curated field-path catalog (see underwriting-rule-fields.ts)
// that CREATE/PATCH below validate field_path/operator against. Scoped to
// one product when productCode is given ({ productCode, fields: [...] });
// otherwise the full catalog ({ fields: { [productCode]: [...] } }).
uwRoutes.get(
  '/admin/underwriting-rules/fields',
  requirePermission('admin.underwriting_rules.read'),
  (req, res) => {
    const productCode = typeof req.query.productCode === 'string' ? req.query.productCode.trim() : ''
    if (productCode) {
      return res.json({ productCode, fields: listUwFieldsForProduct(productCode) })
    }
    return res.json({ fields: UW_FIELD_CATALOG })
  }
)

// GET /admin/underwriting-rules?productCode=&stateCode=&page=&pageSize=
uwRoutes.get(
  '/admin/underwriting-rules',
  requirePermission('admin.underwriting_rules.read'),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      if (!getDb()) return res.json({ items: [], total: 0, page: 1, pageSize: 20 })
      const page = Math.max(1, Number(req.query.page || 1))
      const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 20)))
      const offset = (page - 1) * pageSize
      const productCode = typeof req.query.productCode === 'string' && req.query.productCode.trim()
        ? req.query.productCode.trim()
        : null
      const stateCode = typeof req.query.stateCode === 'string' && req.query.stateCode.trim()
        ? normalizeRuleStateCode(req.query.stateCode)
        : null

      const result = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const rows = await q(
          `SELECT * FROM underwriting_rules
             WHERE tenant_id = $1
               AND ($2::text IS NULL OR product_code = $2)
               AND ($3::text IS NULL OR state_code = $3)
             ORDER BY product_code, state_code NULLS FIRST, created_at DESC
             LIMIT ${pageSize} OFFSET ${offset}`,
          [tenantId, productCode, stateCode]
        )
        const totalResult = await q(
          `SELECT count(*)::int AS total FROM underwriting_rules
             WHERE tenant_id = $1
               AND ($2::text IS NULL OR product_code = $2)
               AND ($3::text IS NULL OR state_code = $3)`,
          [tenantId, productCode, stateCode]
        )
        return { items: rows.rows, total: Number(totalResult.rows[0]?.total || 0) }
      })
      return res.json({ items: result.items, total: result.total, page, pageSize })
    } catch (err) {
      next(err)
    }
  }
)

// POST /admin/underwriting-rules
// Body: { productCode, stateCode?, fieldPath, operator, comparisonValue,
//         outcome: 'Refer'|'Decline', reasonCode, reasonDescription,
//         active?, effectiveDate?, expirationDate? }
// field_path and operator are validated against the curated catalog for
// the given productCode (see underwriting-rule-fields.ts) -- a typo'd
// field path or an operator that doesn't make sense for the field's data
// type is rejected with a 400 rather than silently creating a rule that
// never fires.
uwRoutes.post(
  '/admin/underwriting-rules',
  requirePermission('admin.underwriting_rules.manage'),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const body = req.body || {}
      const productCode = String(body.productCode || '').trim()
      const fieldPath = String(body.fieldPath || '').trim()
      const operator = String(body.operator || '').trim()
      const outcome = String(body.outcome || '').trim()
      const reasonCode = String(body.reasonCode || '').trim()
      const reasonDescription = String(body.reasonDescription || '').trim()
      const stateCode = body.stateCode != null ? normalizeRuleStateCode(body.stateCode) : null

      if (!productCode || !fieldPath || !operator || !outcome || !reasonCode || !reasonDescription) {
        return res.status(400).json({
          code: 'INVALID_INPUT',
          message: 'productCode, fieldPath, operator, outcome, reasonCode, and reasonDescription are required',
        })
      }
      if (!UW_RULE_OUTCOMES.includes(outcome)) {
        return res.status(400).json({ code: 'INVALID_OUTCOME', message: "outcome must be one of 'Refer', 'Decline'" })
      }
      if (body.comparisonValue === undefined || body.comparisonValue === null) {
        return res.status(400).json({ code: 'INVALID_INPUT', message: 'comparisonValue is required' })
      }

      const fieldEntry = findUwFieldCatalogEntry(productCode, fieldPath)
      if (!fieldEntry) {
        return res.status(400).json({
          code: 'UNKNOWN_FIELD_PATH',
          message: `'${fieldPath}' is not a recognized underwriting field for product '${productCode}'`,
          details: { productCode, fieldPath, allowedFieldPaths: listUwFieldsForProduct(productCode).map((f) => f.fieldPath) },
        })
      }
      if (!fieldEntry.allowedOperators.includes(operator as UwRuleOperator)) {
        return res.status(400).json({
          code: 'UNSUPPORTED_OPERATOR',
          message: `Operator '${operator}' is not valid for field '${fieldPath}' (dataType: ${fieldEntry.dataType})`,
          details: { fieldPath, dataType: fieldEntry.dataType, allowedOperators: fieldEntry.allowedOperators },
        })
      }

      if (!getDb()) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
      const actor = req.user?.username || req.user?.id || 'system'
      const effectiveDate = body.effectiveDate || new Date().toISOString().slice(0, 10)
      const row = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const inserted = await q(
          `INSERT INTO underwriting_rules
             (tenant_id, product_code, state_code, field_path, operator, comparison_value, outcome,
              reason_code, reason_description, active, effective_date, expiration_date, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11::date,$12::date,$13,$13)
           RETURNING *`,
          [
            tenantId, productCode, stateCode, fieldPath, operator, JSON.stringify(body.comparisonValue), outcome,
            reasonCode, reasonDescription, body.active !== false, effectiveDate, body.expirationDate || null, actor,
          ]
        )
        return inserted.rows[0]
      })
      return res.status(201).json(row)
    } catch (err) {
      next(err)
    }
  }
)

// PATCH /admin/underwriting-rules/:ruleId
// Body: any subset of { stateCode, fieldPath, operator, comparisonValue,
//         outcome, reasonCode, reasonDescription, active, effectiveDate,
//         expirationDate }. productCode is immutable (create a new rule to
//         move a condition to a different product). Re-validates
//         field_path/operator against the catalog whenever either changes.
uwRoutes.patch(
  '/admin/underwriting-rules/:ruleId',
  requirePermission('admin.underwriting_rules.manage'),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      if (!getDb()) return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
      const actor = req.user?.username || req.user?.id || 'system'
      const body = req.body || {}

      if (body.outcome !== undefined && !UW_RULE_OUTCOMES.includes(body.outcome)) {
        return res.status(400).json({ code: 'INVALID_OUTCOME', message: "outcome must be one of 'Refer', 'Decline'" })
      }

      const outcomeResult = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const existingResult = await q(
          `SELECT * FROM underwriting_rules WHERE tenant_id=$1 AND rule_id=$2::uuid FOR UPDATE`,
          [tenantId, req.params.ruleId]
        )
        const existing = existingResult.rows[0]
        if (!existing) return { status: 404 as const, body: { code: 'NOT_FOUND', message: 'Underwriting rule not found' } }

        const nextFieldPath = body.fieldPath !== undefined ? String(body.fieldPath).trim() : existing.field_path
        const nextOperator = body.operator !== undefined ? String(body.operator).trim() : existing.operator
        if (body.fieldPath !== undefined || body.operator !== undefined) {
          const fieldEntry = findUwFieldCatalogEntry(existing.product_code, nextFieldPath)
          if (!fieldEntry) {
            return {
              status: 400 as const,
              body: {
                code: 'UNKNOWN_FIELD_PATH',
                message: `'${nextFieldPath}' is not a recognized underwriting field for product '${existing.product_code}'`,
              },
            }
          }
          if (!fieldEntry.allowedOperators.includes(nextOperator as UwRuleOperator)) {
            return {
              status: 400 as const,
              body: {
                code: 'UNSUPPORTED_OPERATOR',
                message: `Operator '${nextOperator}' is not valid for field '${nextFieldPath}' (dataType: ${fieldEntry.dataType})`,
              },
            }
          }
        }

        // Compute each column's next value explicitly (rather than relying on SQL
        // COALESCE against the submitted param) so that an admin can actually clear
        // a nullable field back to null -- e.g. broadening a rule from one state back
        // to "all states", or removing an expiration date once set. COALESCE cannot
        // distinguish "field omitted from the request" from "field intentionally set
        // to null", since both arrive as a null bound parameter; it always keeps the
        // old value in the latter case, so a clear silently fails to take effect.
        const nextStateCode = 'stateCode' in body ? normalizeRuleStateCode(body.stateCode) : existing.state_code
        const nextComparisonValue = 'comparisonValue' in body
          ? JSON.stringify(body.comparisonValue)
          : JSON.stringify(existing.comparison_value)
        const nextOutcome = 'outcome' in body ? body.outcome : existing.outcome
        const nextReasonCode = 'reasonCode' in body ? body.reasonCode : existing.reason_code
        const nextReasonDescription = 'reasonDescription' in body ? body.reasonDescription : existing.reason_description
        const nextActive = 'active' in body ? body.active : existing.active
        const nextEffectiveDate = 'effectiveDate' in body ? body.effectiveDate : existing.effective_date
        const nextExpirationDate = 'expirationDate' in body ? (body.expirationDate || null) : existing.expiration_date

        const updated = await q(
          `UPDATE underwriting_rules SET
              state_code = $3,
              field_path = $4,
              operator = $5,
              comparison_value = $6::jsonb,
              outcome = $7,
              reason_code = $8,
              reason_description = $9,
              active = $10,
              effective_date = $11::date,
              expiration_date = $12::date,
              updated_by = $13,
              updated_at = now()
            WHERE tenant_id=$1 AND rule_id=$2::uuid
            RETURNING *`,
          [
            tenantId, req.params.ruleId,
            nextStateCode, nextFieldPath, nextOperator, nextComparisonValue,
            nextOutcome, nextReasonCode, nextReasonDescription,
            nextActive, nextEffectiveDate, nextExpirationDate,
            actor,
          ]
        )
        return { status: 200 as const, body: updated.rows[0] }
      })

      return res.status(outcomeResult.status).json(outcomeResult.body)
    } catch (err) {
      next(err)
    }
  }
)

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
