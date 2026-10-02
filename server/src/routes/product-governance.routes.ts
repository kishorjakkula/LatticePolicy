import { Router } from 'express'
import { requirePermission } from '../auth.js'
import { getDb, toRawQuery, withTenantTx } from '../db.js'
import {
  artifactDigest, assertCompleteArtifacts, assertGovernanceTransition, assertMakerChecker, mapGovernanceRelease,
  newReleaseId, type GovernanceStatus,
} from '../services/product-governance.service.js'

export const productGovernanceRoutes = Router()

function actor(req: any) { return String(req.user?.username || req.user?.sub || req.user?.id || 'system') }
function required(value: unknown, name: string) {
  const result = String(value || '').trim()
  if (!result) throw new Error(`INVALID_INPUT:${name}`)
  return result
}

productGovernanceRoutes.get('/product-governance/releases', requirePermission('product.governance.read'), async (req, res) => {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  const tenantId = req.tenant!.tenantId
  const rows = await withTenantTx(tenantId, async db => toRawQuery(db)(
    `SELECT * FROM product_governance_releases WHERE tenant_id=$1
     ORDER BY product_code, effective_date DESC, created_at DESC`, [tenantId]))
  return res.json({ items: rows.rows.map(mapGovernanceRelease) })
})

productGovernanceRoutes.post('/product-governance/releases', requirePermission('product.governance.manage'), async (req, res, next) => {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const tenantId = req.tenant!.tenantId
    const artifacts = req.body?.artifacts
    assertCompleteArtifacts(artifacts)
    const input = {
      releaseId: newReleaseId(), productCode: required(req.body?.productCode, 'productCode').toLowerCase(),
      jurisdictionCode: String(req.body?.jurisdictionCode || '').trim().toUpperCase() || null,
      versionLabel: required(req.body?.versionLabel, 'versionLabel'),
      effectiveDate: required(req.body?.effectiveDate, 'effectiveDate'),
      expirationDate: String(req.body?.expirationDate || '').trim() || null,
      artifacts, digest: artifactDigest(artifacts), actor: actor(req),
    }
    const release = await withTenantTx(tenantId, async db => {
      const q = toRawQuery(db)
      const result = await q(
        `INSERT INTO product_governance_releases
         (release_id,tenant_id,product_code,jurisdiction_code,version_label,effective_date,expiration_date,artifacts,content_sha256,created_by)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8::jsonb,$9,$10) RETURNING *`,
        [input.releaseId, tenantId, input.productCode, input.jurisdictionCode, input.versionLabel, input.effectiveDate,
         input.expirationDate, JSON.stringify(input.artifacts), input.digest, input.actor])
      await q(`INSERT INTO product_governance_audit (tenant_id,release_id,action,to_status,actor,reason)
               VALUES ($1,$2::uuid,'CREATE','DRAFT',$3,$4)`,
        [tenantId, input.releaseId, input.actor, String(req.body?.reason || '').trim() || null])
      return result.rows[0]
    })
    return res.status(201).json(mapGovernanceRelease(release))
  } catch (error: any) {
    const message = String(error?.message || error)
    if (message.startsWith('INVALID_') || message.startsWith('MISSING_ARTIFACTS:') || error?.code === '22007') {
      return res.status(400).json({ code: 'INVALID_INPUT', message })
    }
    next(error)
  }
})

async function transition(req: any, res: any, next: any, target: GovernanceStatus) {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const tenantId = req.tenant!.tenantId
    const currentActor = actor(req)
    const result = await withTenantTx(tenantId, async db => {
      const q = toRawQuery(db)
      const loaded = await q(`SELECT * FROM product_governance_releases WHERE tenant_id=$1 AND release_id=$2::uuid FOR UPDATE`, [tenantId, req.params.releaseId])
      if (!loaded.rowCount) throw new Error('NOT_FOUND')
      const row = loaded.rows[0]
      assertGovernanceTransition(row.status, target)
      if (target === 'APPROVED') assertMakerChecker(row.submitted_by, currentActor)
      if (target === 'ACTIVE') {
        await q(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [
          tenantId,
          `${String(row.product_code).toLowerCase()}:${String(row.jurisdiction_code || '').toUpperCase()}`,
        ])
        const overlap = await q(
          `SELECT release_id FROM product_governance_releases
            WHERE tenant_id=$1 AND release_id<>$2::uuid AND LOWER(product_code)=LOWER($3)
              AND COALESCE(UPPER(jurisdiction_code),'')=COALESCE(UPPER($4),'') AND status='ACTIVE'
              AND effective_date <= COALESCE($6::date,'infinity'::date)
              AND COALESCE(expiration_date,'infinity'::date) >= $5::date LIMIT 1`,
          [tenantId, row.release_id, row.product_code, row.jurisdiction_code, row.effective_date, row.expiration_date])
        if (overlap.rowCount) throw new Error('OVERLAPPING_ACTIVE_RELEASE')
      }
      const columns: Record<string, string> = {
        REVIEW: 'submitted_by=$4, submitted_at=now()', APPROVED: 'approved_by=$4, approved_at=now()',
        ACTIVE: 'activated_by=$4, activated_at=now()', RETIRED: 'retired_by=$4, retired_at=now()',
      }
      const actorUpdate = columns[target] ? `, ${columns[target]}` : ''
      const updated = await q(
        `UPDATE product_governance_releases SET status=$3, updated_at=now()${actorUpdate}
          WHERE tenant_id=$1 AND release_id=$2::uuid RETURNING *`,
        actorUpdate
          ? [tenantId, row.release_id, target, currentActor]
          : [tenantId, row.release_id, target])
      await q(`INSERT INTO product_governance_audit (tenant_id,release_id,action,from_status,to_status,actor,reason)
               VALUES ($1,$2::uuid,$3,$4,$5,$6,$7)`,
        [tenantId, row.release_id, target, row.status, target, currentActor, String(req.body?.reason || '').trim() || null])
      return updated.rows[0]
    })
    return res.json(mapGovernanceRelease(result))
  } catch (error: any) {
    const message = String(error?.message || error)
    if (message === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND', message: 'Release not found' })
    if (message === 'MAKER_CHECKER_REQUIRED') return res.status(409).json({ code: message, message: 'Submitter cannot approve the same release' })
    if (message === 'OVERLAPPING_ACTIVE_RELEASE') return res.status(409).json({ code: message, message: 'An active release overlaps this effective period' })
    if (message.startsWith('INVALID_TRANSITION:')) return res.status(409).json({ code: 'INVALID_TRANSITION', message })
    next(error)
  }
}

for (const [path, status, permission] of [
  ['submit', 'REVIEW', 'product.governance.manage'], ['approve', 'APPROVED', 'product.governance.approve'],
  ['schedule', 'SCHEDULED', 'product.governance.approve'], ['activate', 'ACTIVE', 'product.governance.approve'],
  ['retire', 'RETIRED', 'product.governance.approve'],
] as const) {
  productGovernanceRoutes.post(`/product-governance/releases/:releaseId/${path}`, requirePermission(permission),
    (req, res, next) => transition(req, res, next, status))
}

productGovernanceRoutes.get('/product-governance/releases/:releaseId/audit', requirePermission('product.governance.read'), async (req, res) => {
  if (!getDb()) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  const tenantId = req.tenant!.tenantId
  const result = await withTenantTx(tenantId, async db => toRawQuery(db)(
    `SELECT action,from_status,to_status,actor,reason,occurred_at FROM product_governance_audit
      WHERE tenant_id=$1 AND release_id=$2::uuid ORDER BY occurred_at`, [tenantId, req.params.releaseId]))
  return res.json({ items: result.rows })
})
