import { Router } from 'express'
import { v4 as uuidv4 } from '../uuid.js'
import { requirePermission } from '../auth.js'
import { validate } from '../lib/validate.js'
import { ok } from '../lib/respond.js'
import {
  EndorsePolicySchema,
  CancelPolicySchema,
  ReinstatePolicySchema,
  NonRenewPolicySchema,
} from '../schemas/policy.schema.js'
import { getDb, withTenantTx } from '../db.js'
import { store } from '../store.js'
import {
  loadPolicyContext,
  safeMoney,
} from '../persistence.js'
import * as endorsementService from '../services/endorsement.service.js'
import * as lifecycleService from '../services/lifecycle.service.js'
import { rate } from '../rating.js'
import { evaluateUW } from '../uw.js'
import { today, asDateOnly, addMonths, diffMonths, round2, proRataFactor } from '../lib/date.utils.js'

// ── local helpers ─────────────────────────────────────────────────────────────

type TransactionNumberMode = 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew'

function transactionNumberPrefix(mode: TransactionNumberMode): string {
  if (mode === 'cancel') return 'CN-'
  if (mode === 'reinstate') return 'RI-'
  if (mode === 'rewrite') return 'RW-'
  if (mode === 'renew') return 'RN-'
  return 'EN-'
}

function generateTransactionNumber(prefix = 'EN-'): string {
  const now = new Date()
  const stamp = now.toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `${prefix}${stamp}-${rand}`
}

function reserveTransactionNumber(mode: TransactionNumberMode): string {
  return generateTransactionNumber(transactionNumberPrefix(mode))
}

function validateTransactionNumberReservation(
  mode: TransactionNumberMode,
  rawStatus: any
): { code: string; message: string } | null {
  const status = String(rawStatus || '').toLowerCase()
  if (mode === 'reinstate' || mode === 'rewrite') {
    if (status !== 'cancelled') return { code: 'INVALID_STATE', message: 'Policy is not cancelled' }
    return null
  }
  if (mode === 'cancel' && status === 'cancelled') {
    return { code: 'INVALID_STATE', message: 'Policy already cancelled' }
  }
  if (status === 'cancelled') {
    return { code: 'INVALID_STATE', message: 'Policy is cancelled' }
  }
  return null
}

function parseTransactionNumberMode(value: any): TransactionNumberMode | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (
    normalized === 'endorse' ||
    normalized === 'cancel' ||
    normalized === 'reinstate' ||
    normalized === 'rewrite' ||
    normalized === 'renew'
  ) {
    return normalized as TransactionNumberMode
  }
  return null
}

function simplePremium(amount: number) {
  return {
    byCoverage: [],
    fees: { amount: 0, currency: 'USD' },
    taxes: { amount: 0, currency: 'USD' },
    total: { amount: round2(amount), currency: 'USD' },
  }
}

export const transactionRoutes = Router()

// ── POST /policies/:id/issue ──────────────────────────────────────────────────
transactionRoutes.post('/policies/:id/issue', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const result = await req.tx((db) =>
        lifecycleService.issuePolicy(db, tenantId, req.params.id, req.body || {}, req.user)
      )
      return res.json(result)
    }

    // In-memory fallback
    const policy = store.getPolicyForTenant(req.params.id, tenantId)
    if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    if (policy.status === 'Cancelled') {
      return res.status(400).json({ code: 'INVALID_STATE', message: 'Policy is cancelled' })
    }
    if (policy.status !== 'Bound' && policy.status !== 'Issued') {
      return res
        .status(400)
        .json({
          code: 'INVALID_STATE',
          message: `Cannot issue policy from status ${policy.status}`,
        })
    }
    policy.status = 'Issued'
    return res.json({
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      status: 'Issued',
    })
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    next(err)
  }
})

// ── POST /policies/:id/endorse/reserve-number ─────────────────────────────────
transactionRoutes.post('/policies/:id/endorse/reserve-number', (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()

  if (db) {
    return withTenantTx(tenantId, async (db) => {
      const ctx = await loadPolicyContext(db, tenantId, req.params.id)
      if (!ctx) return { notFound: true }
      const invalidState = validateTransactionNumberReservation('endorse', ctx.policy.status)
      if (invalidState) return { error: { status: 400, ...invalidState } }
      return { transactionNumber: reserveTransactionNumber('endorse') }
    })
      .then((result: any) => {
        if (result?.notFound)
          return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
        if (result?.error)
          return res
            .status(result.error.status)
            .json({ code: result.error.code, message: result.error.message })
        return res.json({ transactionNumber: result.transactionNumber })
      })
      .catch((err: any) =>
        res.status(500).json({ code: 'DB_ERROR', message: String(err?.message || err) })
      )
  }

  const policy = store.getPolicyForTenant(req.params.id, tenantId)
  if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
  const invalidState = validateTransactionNumberReservation('endorse', policy.status)
  if (invalidState) return res.status(400).json(invalidState)
  return res.json({ transactionNumber: reserveTransactionNumber('endorse') })
})

// ── POST /policies/:id/transactions/reserve-number ────────────────────────────
transactionRoutes.post('/policies/:id/transactions/reserve-number', (req, res) => {
  const tenantId = req.tenant!.tenantId
  const mode = parseTransactionNumberMode(req.body?.mode)
  if (!mode) {
    return res.status(400).json({
      code: 'INVALID_MODE',
      message: 'mode must be endorse, cancel, reinstate, rewrite, or renew',
    })
  }
  const db = getDb()

  if (db) {
    return withTenantTx(tenantId, async (db) => {
      const ctx = await loadPolicyContext(db, tenantId, req.params.id)
      if (!ctx) return { notFound: true }
      const invalidState = validateTransactionNumberReservation(mode, ctx.policy.status)
      if (invalidState) return { error: { status: 400, ...invalidState } }
      return { transactionNumber: reserveTransactionNumber(mode) }
    })
      .then((result: any) => {
        if (result?.notFound)
          return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
        if (result?.error)
          return res
            .status(result.error.status)
            .json({ code: result.error.code, message: result.error.message })
        return res.json({ transactionNumber: result.transactionNumber })
      })
      .catch((err: any) =>
        res.status(500).json({ code: 'DB_ERROR', message: String(err?.message || err) })
      )
  }

  const policy = store.getPolicyForTenant(req.params.id, tenantId)
  if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
  const invalidState = validateTransactionNumberReservation(mode, policy.status)
  if (invalidState) return res.status(400).json(invalidState)
  return res.json({ transactionNumber: reserveTransactionNumber(mode) })
})

// ── POST /policies/:id/endorse/preview ────────────────────────────────────────
transactionRoutes.post('/policies/:id/endorse/preview', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (!db) {
      return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
    }

    const result = await req.tx((db) =>
      endorsementService.previewEndorsement(db, tenantId, req.params.id, req.body || {})
    )
    return res.json(result)
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    next(err)
  }
})

// ── POST /policies/:id/endorse — execute endorsement ─────────────────────────
transactionRoutes.post(
  '/policies/:id/endorse',
  validate(EndorsePolicySchema),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const db = getDb()

      if (!db) {
        return res.status(400).json({ code: 'NO_DB', message: 'Requires database mode' })
      }

      const result = await req.tx((db) =>
        endorsementService.executeEndorsement(db, tenantId, req.params.id, req.body || {}, req.user)
      )
      return res.json(result)
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ code: err.code, message: err.message })
      }
      next(err)
    }
  }
)

// ── POST /policies/:id/cancel ─────────────────────────────────────────────────
transactionRoutes.post(
  '/policies/:id/cancel',
  validate(CancelPolicySchema),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const db = getDb()

      if (db) {
        const result = await req.tx((db) =>
          lifecycleService.cancelPolicy(db, tenantId, req.params.id, req.body || {}, req.user)
        )
        return res.json(result)
      }

      // In-memory fallback
      const policy = store.getPolicyForTenant(req.params.id, tenantId)
      if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
      if ((policy.status || '').toLowerCase() === 'cancelled') {
        return res.status(400).json({ code: 'INVALID_STATE', message: 'Policy already cancelled' })
      }
      const eff = asDateOnly(req.body?.effectiveDate) || today()
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
      const termEffective = (policy as any).term?.effectiveDate || today()
      const termExpiration = (policy as any).term?.expirationDate || today()
      const fullPremium = safeMoney((policy as any).lastFullTermPremium)
      const factor = proRataFactor(eff, termEffective, termExpiration)
      const refund = round2(fullPremium * factor)
      const versionId = uuidv4()
      const transactionNumber = reserveTransactionNumber('cancel')
      const version: any = {
        versionId,
        effectiveDate: eff,
        processedDate: new Date().toISOString(),
        transactionType: 'Cancel',
        transactionNumber,
        premium: simplePremium(-refund),
      }
      ;(policy as any).versions.push(version)
      policy.status = 'Cancelled'
      ;(policy as any).cancelledAt = eff
      return res.json(version)
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ code: err.code, message: err.message })
      }
      next(err)
    }
  }
)

// ── POST /policies/:id/reinstate ──────────────────────────────────────────────
transactionRoutes.post(
  '/policies/:id/reinstate',
  validate(ReinstatePolicySchema),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const db = getDb()

      if (db) {
        const result = await req.tx((db) =>
          lifecycleService.reinstatePolicy(db, tenantId, req.params.id, req.body || {}, req.user)
        )
        return res.json(result)
      }

      // In-memory fallback
      const policy = store.getPolicyForTenant(req.params.id, tenantId)
      if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
      if ((policy.status || '').toLowerCase() !== 'cancelled') {
        return res.status(400).json({ code: 'INVALID_STATE', message: 'Policy is not cancelled' })
      }
      const eff = asDateOnly(req.body?.effectiveDate) || today()
      const termEffective = (policy as any).term?.effectiveDate || today()
      const termExpiration = (policy as any).term?.expirationDate || today()
      const fullPremium = safeMoney((policy as any).lastFullTermPremium)
      const factor = proRataFactor(eff, termEffective, termExpiration)
      const charge = round2(fullPremium * factor)
      const versionId = uuidv4()
      const transactionNumber = reserveTransactionNumber('reinstate')
      const version: any = {
        versionId,
        effectiveDate: eff,
        processedDate: new Date().toISOString(),
        transactionType: 'Reinstate',
        transactionNumber,
        premium: simplePremium(charge),
      }
      ;(policy as any).versions.push(version)
      policy.status = 'Issued'
      ;(policy as any).cancelledAt = undefined
      return res.json(version)
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ code: err.code, message: err.message })
      }
      next(err)
    }
  }
)

// ── POST /policies/:id/rewrite ────────────────────────────────────────────────
transactionRoutes.post('/policies/:id/rewrite', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const result = await req.tx((db) =>
        lifecycleService.rewritePolicy(db, tenantId, req.params.id, req.body || {}, req.user)
      )
      return ok(res, result)
    }

    // In-memory fallback
    const roles = req.user?.roles || []
    const permissions = req.user?.permissions || []
    const isUw =
      roles.includes('underwriter') ||
      roles.includes('admin') ||
      permissions.includes('uw.referrals.decide')
    const overrideReason =
      req.body && typeof req.body.overrideReason === 'string'
        ? req.body.overrideReason.trim()
        : ''
    const overridePayload =
      req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null
    const requestedTransactionNumber =
      typeof req.body?.transactionNumber === 'string' ? req.body.transactionNumber.trim() : ''
    const overrideEffectiveDate = asDateOnly(req.body?.effectiveDate)

    const policy = store.getPolicyForTenant(req.params.id, tenantId)
    if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    if (policy.status !== 'Cancelled') {
      return res
        .status(400)
        .json({ code: 'INVALID_STATE', message: 'Policy must be cancelled to rewrite' })
    }
    const payload = overridePayload
      ? JSON.parse(JSON.stringify(overridePayload))
      : JSON.parse(JSON.stringify((policy as any).payload || {}))
    const termMonths = Number(
      payload?.termMonths ||
        diffMonths((policy as any).term.effectiveDate, (policy as any).term.expirationDate) ||
        12
    )
    const nextEff = overrideEffectiveDate || asDateOnly(payload?.effectiveDate) || today()
    const nextExp = addMonths(nextEff, termMonths)
    payload.effectiveDate = nextEff
    payload.termMonths = termMonths
    payload.productCode = payload.productCode || (policy as any).productCode
    const prem = rate(tenantId, payload)
    const uw = evaluateUW(tenantId, payload)
    if (uw.decision === 'Decline') {
      return res.status(400).json({
        code: 'UW_DECLINED',
        message: `Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ')}`,
      })
    }
    const uwOverride = uw.decision === 'Refer' && isUw && !!overrideReason
    const submittedBy = !uwOverride && uw.decision === 'Refer' ? req.user?.username || null : null
    const transactionNumber =
      requestedTransactionNumber || reserveTransactionNumber('rewrite')
    const version: any = {
      versionId: uuidv4(),
      effectiveDate: nextEff,
      processedDate: new Date().toISOString(),
      transactionType: 'Rewrite',
      transactionNumber,
      premium: prem,
      meta: {
        uwDecision: uw,
        uwOverride,
        overrideReason: uwOverride ? overrideReason : undefined,
        submittedBy: submittedBy || undefined,
        rewrite: true,
        transactionNumber,
      },
    }
    ;(policy as any).versions.push(version)
    ;(policy as any).payload = payload
    ;(policy as any).term = { effectiveDate: nextEff, expirationDate: nextExp }
    policy.status = 'Issued'
    ;(policy as any).cancelledAt = undefined
    ;(policy as any).lastFullTermPremium = safeMoney((prem as any)?.total?.amount)
    return res.json(version)
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    next(err)
  }
})

// ── POST /policies/:id/renew ──────────────────────────────────────────────────
transactionRoutes.post('/policies/:id/renew', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const result = await req.tx((db) =>
        lifecycleService.renewPolicy(db, tenantId, req.params.id, req.body || {}, req.user)
      )
      return res.json(result)
    }

    // In-memory fallback
    const roles = req.user?.roles || []
    const permissions = req.user?.permissions || []
    const isUw =
      roles.includes('underwriter') ||
      roles.includes('admin') ||
      permissions.includes('uw.referrals.decide')
    const overrideReason =
      req.body && typeof req.body.overrideReason === 'string'
        ? req.body.overrideReason.trim()
        : ''
    const overridePayload =
      req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null
    const requestedTransactionNumber =
      typeof req.body?.transactionNumber === 'string' ? req.body.transactionNumber.trim() : ''
    const overrideEffectiveDate = asDateOnly(req.body?.effectiveDate)

    const policy = store.getPolicyForTenant(req.params.id, tenantId)
    if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    const nextEff =
      overrideEffectiveDate || (policy as any).term.expirationDate
    const termMonths =
      diffMonths((policy as any).term.effectiveDate, (policy as any).term.expirationDate) || 12
    const nextExp = addMonths(nextEff, termMonths)
    const payload = overridePayload
      ? JSON.parse(JSON.stringify(overridePayload))
      : { ...(policy as any).payload }
    payload.effectiveDate = nextEff
    payload.termMonths = termMonths
    payload.productCode = payload.productCode || (policy as any).productCode
    const prem = rate(tenantId, payload)
    const uw = evaluateUW(tenantId, payload)
    if (uw.decision === 'Decline') {
      return res.status(400).json({
        code: 'UW_DECLINED',
        message: `Underwriting decision: Decline. Reasons: ${uw.reasons?.join('; ')}`,
      })
    }
    const uwOverride = uw.decision === 'Refer' && isUw && !!overrideReason
    const submittedBy =
      !uwOverride && uw.decision === 'Refer' ? req.user?.username || null : null
    const transactionNumber =
      requestedTransactionNumber || reserveTransactionNumber('renew')
    const version: any = {
      versionId: uuidv4(),
      effectiveDate: nextEff,
      processedDate: new Date().toISOString(),
      transactionType: 'Renew',
      transactionNumber,
      premium: prem,
      meta: {
        uwDecision: uw,
        uwOverride,
        overrideReason: uwOverride ? overrideReason : undefined,
        submittedBy: submittedBy || undefined,
        transactionNumber,
      },
    }
    ;(policy as any).versions.push(version)
    ;(policy as any).payload = payload
    ;(policy as any).term = { effectiveDate: nextEff, expirationDate: nextExp }
    ;(policy as any).lastFullTermPremium = safeMoney((prem as any)?.total?.amount)
    return res.json(version)
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    next(err)
  }
})

// ── POST /policies/:id/renew/preview ─────────────────────────────────────────
transactionRoutes.post('/policies/:id/renew/preview', async (req, res, next) => {
  try {
    const tenantId = req.tenant!.tenantId
    const db = getDb()

    if (db) {
      const result = await req.tx((db) =>
        lifecycleService.previewRenewal(db, tenantId, req.params.id, req.body || {})
      )
      return res.json(result)
    }

    // In-memory fallback
    const policy = store.getPolicyForTenant(req.params.id, tenantId)
    if (!policy) return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    const nextEff = (policy as any).term.expirationDate
    const termMonths =
      diffMonths((policy as any).term.effectiveDate, (policy as any).term.expirationDate) || 12
    const nextExp = addMonths(nextEff, termMonths)
    const payload = { ...(policy as any).payload, effectiveDate: nextEff, termMonths }
    const premium = rate(tenantId, payload)
    const underwriting = evaluateUW(tenantId, payload)
    return res.json({
      underwriting,
      premium,
      nextEffectiveDate: nextEff,
      nextExpirationDate: nextExp,
    })
  } catch (err: any) {
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    next(err)
  }
})

// ── POST /policies/:id/non-renew ──────────────────────────────────────────────
transactionRoutes.post(
  '/policies/:id/non-renew',
  requirePermission('page.policy.view'),
  validate(NonRenewPolicySchema),
  async (req, res, next) => {
    try {
      const tenantId = req.tenant!.tenantId
      const policyId = req.params.id
      const db = getDb()

      if (db) {
        const result = await req.tx((db) =>
          lifecycleService.nonRenewPolicy(db, tenantId, policyId, req.body || {}, req.user)
        )
        return res.json(result)
      }

      // In-memory fallback
      const policy = store.getPolicyForTenant(policyId, tenantId)
      if (!policy || (policy as any).tenantId !== tenantId) {
        return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
      }
      if (policy.status === 'Cancelled') {
        return res
          .status(400)
          .json({ code: 'INVALID_STATE', message: 'Cannot non-renew a cancelled policy.' })
      }
      const reasonCode =
        typeof req.body?.reasonCode === 'string' ? req.body.reasonCode.trim() : ''
      const reasonDescription =
        typeof req.body?.reasonDescription === 'string'
          ? req.body.reasonDescription.trim()
          : ''
      const noticeDate = asDateOnly(req.body?.noticeDate) || today()
      const termExpiration = (policy as any).term?.expirationDate || today()
      ;(policy as any).nonRenewedAt = termExpiration
      ;(policy as any).nonRenewalReason = reasonCode || reasonDescription || null
      return res.json({
        ok: true,
        policyId,
        nonRenewedAt: termExpiration,
        noticeDate,
        reasonCode: reasonCode || null,
      })
    } catch (err: any) {
      if (err?.statusCode) {
        return res.status(err.statusCode).json({ code: err.code, message: err.message })
      }
      next(err)
    }
  }
)
