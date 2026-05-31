/**
 * policyInterests.ts
 *
 * CRUD routes for policy additional interests:
 *   Additional Insureds, Loss Payees, Mortgagees, Certificate Holders, etc.
 *
 * Mounted at: /v1/policies/:id/interests
 */

import { Router } from 'express'
import { v4 as uuidv4 } from '../uuid.js'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'

export const interestsRoutes = Router({ mergeParams: true })

const VALID_ROLES = [
  'ADDITIONAL_INSURED',
  'ADDITIONAL_NAMED_INSURED',
  'LOSS_PAYEE',
  'LOSS_PAYEE_AS_LESSOR',
  'MORTGAGEE',
  'ADDITIONAL_INTEREST',
  'CERTIFICATE_HOLDER',
  'PREMIUM_FINANCE_COMPANY'
]

const ROLE_LABELS: Record<string, string> = {
  ADDITIONAL_INSURED:      'Additional Insured',
  ADDITIONAL_NAMED_INSURED:'Additional Named Insured',
  LOSS_PAYEE:              'Loss Payee (Lienholder)',
  LOSS_PAYEE_AS_LESSOR:    'Loss Payee as Lessor',
  MORTGAGEE:               'Mortgagee',
  ADDITIONAL_INTEREST:     'Additional Interest',
  CERTIFICATE_HOLDER:      'Certificate Holder',
  PREMIUM_FINANCE_COMPANY: 'Premium Finance Company'
}

function validateInterestBody(body: any): { error?: string } {
  if (!body.role || !VALID_ROLES.includes(body.role)) {
    return { error: `role must be one of: ${VALID_ROLES.join(', ')}` }
  }
  if (!body.name || String(body.name).trim().length < 2) {
    return { error: 'name is required (minimum 2 characters)' }
  }
  return {}
}

// ─── GET /v1/policies/:id/interests ──────────────────────────
interestsRoutes.get('/', requirePermission('page.policy.view'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  const policyId = req.params.id
  const db = getDb()

  if (!db) {
    return res.json({ items: [], total: 0, _source: 'no-db' })
  }

  withTenantTx(tenantId, (db) => {
    const q = toRawQuery(db)
    return q(
      `SELECT ai_id, role, name, address, coverage_codes, ai_form_code,
              loan_number, isaoa, atima, receive_cancel_notice,
              receive_nonrenewal_notice, effective_date, expiration_date,
              created_at, updated_at
         FROM policy_additional_interests
        WHERE tenant_id = $1 AND policy_id = $2
        ORDER BY
          CASE role
            WHEN 'MORTGAGEE'               THEN 1
            WHEN 'LOSS_PAYEE'              THEN 2
            WHEN 'LOSS_PAYEE_AS_LESSOR'    THEN 3
            WHEN 'ADDITIONAL_INSURED'      THEN 4
            WHEN 'ADDITIONAL_NAMED_INSURED'THEN 5
            WHEN 'CERTIFICATE_HOLDER'      THEN 6
            ELSE 9
          END,
          created_at ASC`,
      [tenantId, policyId]
    )
  })
    .then((r: any) => {
      const items = (r.rows ?? []).map((row: any) => ({
        aiId: row.ai_id,
        role: row.role,
        roleLabel: ROLE_LABELS[row.role] || row.role,
        name: row.name,
        address: row.address,
        coverageCodes: row.coverage_codes,
        aiFormCode: row.ai_form_code,
        loanNumber: row.loan_number,
        isaoa: row.isaoa,
        atima: row.atima,
        receiveCancelNotice: row.receive_cancel_notice,
        receiveNonrenewalNotice: row.receive_nonrenewal_notice,
        effectiveDate: row.effective_date,
        expirationDate: row.expiration_date,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }))
      res.json({ items, total: items.length })
    })
    .catch((err: any) => {
      res.status(500).json({ code: 'DB_ERROR', message: err?.message || String(err) })
    })
})

// ─── POST /v1/policies/:id/interests ─────────────────────────
interestsRoutes.post('/', requirePermission('page.policy.view'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  const policyId = req.params.id
  const body = req.body || {}
  const db = getDb()

  const { error } = validateInterestBody(body)
  if (error) return res.status(400).json({ code: 'VALIDATION_ERROR', message: error })

  if (!db) {
    return res.status(501).json({ code: 'NO_DB', message: 'Database required' })
  }

  const aiId = uuidv4()
  const name = String(body.name).trim()
  const role = String(body.role)
  const address = body.address || null
  const coverageCodes = Array.isArray(body.coverageCodes) ? body.coverageCodes : null
  const aiFormCode = body.aiFormCode ? String(body.aiFormCode).trim() : null
  const loanNumber = body.loanNumber ? String(body.loanNumber).trim() : null
  const isaoa = !!body.isaoa
  const atima = !!body.atima
  const receiveCancelNotice = body.receiveCancelNotice !== false
  const receiveNonrenewalNotice = body.receiveNonrenewalNotice !== false
  const effectiveDate = body.effectiveDate || null
  const expirationDate = body.expirationDate || null

  withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    // Verify policy exists and belongs to tenant
    const policyCheck = await q(
      'SELECT policy_id FROM policies WHERE tenant_id=$1 AND policy_id=$2',
      [tenantId, policyId]
    )
    if (!policyCheck.rowCount) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })

    await q(
      `INSERT INTO policy_additional_interests
         (ai_id, tenant_id, policy_id, role, name, address, coverage_codes,
          ai_form_code, loan_number, isaoa, atima,
          receive_cancel_notice, receive_nonrenewal_notice,
          effective_date, expiration_date)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        aiId, tenantId, policyId, role, name,
        address ? JSON.stringify(address) : null,
        coverageCodes,
        aiFormCode, loanNumber, isaoa, atima,
        receiveCancelNotice, receiveNonrenewalNotice,
        effectiveDate, expirationDate
      ]
    )

    res.status(201).json({
      aiId,
      role,
      roleLabel: ROLE_LABELS[role] || role,
      name,
      address,
      coverageCodes,
      aiFormCode,
      loanNumber,
      isaoa,
      atima,
      receiveCancelNotice,
      receiveNonrenewalNotice,
      effectiveDate,
      expirationDate
    })
  }).catch((err: any) => {
    res.status(500).json({ code: 'DB_ERROR', message: err?.message || String(err) })
  })
})

// ─── PATCH /v1/policies/:id/interests/:aiId ──────────────────
interestsRoutes.patch('/:aiId', requirePermission('page.policy.view'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  const policyId = req.params.id
  const aiId = req.params.aiId
  const body = req.body || {}
  const db = getDb()

  if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Database required' })

  const sets: string[] = ['updated_at = NOW()']
  const values: any[] = []
  const push = (col: string, val: any) => { sets.push(`${col} = $${values.length + 3}`); values.push(val) }

  if (body.name !== undefined)    push('name',           String(body.name).trim())
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      return res.status(400).json({ code: 'VALIDATION_ERROR', message: `Invalid role: ${body.role}` })
    }
    push('role', body.role)
  }
  if (body.address !== undefined)              push('address',                  body.address ? JSON.stringify(body.address) : null)
  if (body.coverageCodes !== undefined)        push('coverage_codes',            body.coverageCodes || null)
  if (body.aiFormCode !== undefined)           push('ai_form_code',              body.aiFormCode || null)
  if (body.loanNumber !== undefined)           push('loan_number',               body.loanNumber || null)
  if (body.isaoa !== undefined)                push('isaoa',                     !!body.isaoa)
  if (body.atima !== undefined)                push('atima',                     !!body.atima)
  if (body.receiveCancelNotice !== undefined)  push('receive_cancel_notice',     !!body.receiveCancelNotice)
  if (body.receiveNonrenewalNotice !== undefined) push('receive_nonrenewal_notice', !!body.receiveNonrenewalNotice)
  if (body.effectiveDate !== undefined)        push('effective_date',             body.effectiveDate || null)
  if (body.expirationDate !== undefined)       push('expiration_date',            body.expirationDate || null)

  if (values.length === 0) return res.status(400).json({ code: 'NO_CHANGES', message: 'No updatable fields provided' })

  withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const r = await q(
      `UPDATE policy_additional_interests
          SET ${sets.join(', ')}
        WHERE tenant_id=$1 AND ai_id=$2
        RETURNING ai_id`,
      [tenantId, aiId, ...values]
    )
    if (!r.rowCount) return res.status(404).json({ code: 'NOT_FOUND' })
    const updated = await q(
      `SELECT ai_id, role, name, address, coverage_codes, ai_form_code,
              loan_number, isaoa, atima, receive_cancel_notice,
              receive_nonrenewal_notice, effective_date, expiration_date,
              created_at, updated_at
         FROM policy_additional_interests
        WHERE tenant_id=$1 AND ai_id=$2`,
      [tenantId, aiId]
    )
    const row = updated.rows[0]
    res.json({
      aiId: row.ai_id,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role,
      name: row.name,
      address: row.address,
      coverageCodes: row.coverage_codes,
      aiFormCode: row.ai_form_code,
      loanNumber: row.loan_number,
      isaoa: row.isaoa,
      atima: row.atima,
      receiveCancelNotice: row.receive_cancel_notice,
      receiveNonrenewalNotice: row.receive_nonrenewal_notice,
      effectiveDate: row.effective_date,
      expirationDate: row.expiration_date,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  }).catch((err: any) => {
    res.status(500).json({ code: 'DB_ERROR', message: err?.message || String(err) })
  })
})

// ─── DELETE /v1/policies/:id/interests/:aiId ─────────────────
interestsRoutes.delete('/:aiId', requirePermission('page.policy.view'), (req, res) => {
  const tenantId = req.tenant!.tenantId
  const aiId = req.params.aiId
  const db = getDb()

  if (!db) return res.status(501).json({ code: 'NO_DB', message: 'Database required' })

  withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const r = await q(
      'DELETE FROM policy_additional_interests WHERE tenant_id=$1 AND ai_id=$2 RETURNING ai_id',
      [tenantId, aiId]
    )
    if (!r.rowCount) return res.status(404).json({ code: 'NOT_FOUND' })
    res.json({ ok: true, deleted: aiId })
  }).catch((err: any) => {
    res.status(500).json({ code: 'DB_ERROR', message: err?.message || String(err) })
  })
})

// ─── GET /v1/reference/cancellation-reason-codes ─────────────
// (mounted separately in index.ts via routes)
export async function getCancellationReasonCodesHandler(req: any, res: any): Promise<void> {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) {
    return res.json({ items: FALLBACK_REASON_CODES })
  }
  withTenantTx(tenantId, (db) => {
    const q = toRawQuery(db)
    return q('SELECT * FROM cancellation_reason_codes ORDER BY initiator, reason_code', [])
  })
    .then((r: any) => res.json({ items: r.rows }))
    .catch(() => res.json({ items: FALLBACK_REASON_CODES }))
}

// Fallback for in-memory mode
const FALLBACK_REASON_CODES = [
  { reason_code: 'INSURED_REQUEST', description: 'Insured requested cancellation', initiator: 'INSURED', cancellation_type: 'SHORT_RATE', notice_days: 0, return_premium: 'SHORT_RATE' },
  { reason_code: 'NON_PAYMENT', description: 'Non-payment of premium', initiator: 'CARRIER', cancellation_type: 'NON_PAYMENT', notice_days: 10, return_premium: 'PRO_RATA' },
  { reason_code: 'MATERIAL_MISREP', description: 'Material misrepresentation or fraud', initiator: 'CARRIER', cancellation_type: 'UW_CANCEL', notice_days: 30, return_premium: 'PRO_RATA' },
  { reason_code: 'RISK_CHANGE', description: 'Unacceptable change in risk', initiator: 'CARRIER', cancellation_type: 'UW_CANCEL', notice_days: 30, return_premium: 'PRO_RATA' },
  { reason_code: 'FLAT_CANCEL', description: 'Flat cancellation — rescission', initiator: 'CARRIER', cancellation_type: 'FLAT', notice_days: 0, return_premium: 'FLAT' },
  { reason_code: 'MUTUAL_CONSENT', description: 'Mutual consent of both parties', initiator: 'MUTUAL', cancellation_type: 'MUTUAL_CONSENT', notice_days: 0, return_premium: 'PRO_RATA' },
  { reason_code: 'REPLACED_COVERAGE', description: 'Coverage replaced by other carrier', initiator: 'INSURED', cancellation_type: 'SHORT_RATE', notice_days: 0, return_premium: 'SHORT_RATE' },
  { reason_code: 'VEHICLE_SOLD', description: 'Vehicle sold or total loss', initiator: 'INSURED', cancellation_type: 'SHORT_RATE', notice_days: 0, return_premium: 'SHORT_RATE' }
]
