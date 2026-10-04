import { Router } from 'express'
import { rateLimit } from 'express-rate-limit'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { hasPermission } from '../auth.js'
import { enqueueJob } from '../jobs/jobQueue.js'
import { routeParam } from '../lib/utils.js'

export const adminDashboardRoutes = Router()
const integrityActionLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false })

adminDashboardRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Operational dashboard requires database mode' })
  }
  next()
})

function toStatusMap(rows: any[], key: 'status' | 'disposition'): Record<string, number> {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[String(row[key])] = Number(row.count)
  }
  return map
}

// GET /admin/dashboard/summary
// Aggregate counts across operational queues so operators can see failures
// and pending work from one place without visiting each admin area.
adminDashboardRoutes.get('/summary', async (req, res) => {
  const tenantId = req.tenant!.tenantId

  try {
    const summary = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      // Sequential, not Promise.all: these share one transaction client, and
      // pg does not support concurrent queries on the same client/connection.
      const outbox = await q(`SELECT status, count(*)::int AS count FROM async_message_outbox WHERE tenant_id = $1 GROUP BY status`, [tenantId])
      const ofac = await q(`SELECT disposition, count(*)::int AS count FROM ofac_screens WHERE tenant_id = $1 GROUP BY disposition`, [tenantId])
      const referrals = await q(`SELECT status, count(*)::int AS count FROM underwriting_referrals WHERE tenant_id = $1 GROUP BY status`, [tenantId])
      const notifications = await q(`SELECT status, count(*)::int AS count FROM notification_intents WHERE tenant_id = $1 GROUP BY status`, [tenantId])
      const integrity = await q(`SELECT status, count(*)::int AS count FROM policy_integrity_exceptions WHERE tenant_id = $1 GROUP BY status`, [tenantId])
      return {
        outbox: toStatusMap(outbox.rows, 'status'),
        ofac: toStatusMap(ofac.rows, 'disposition'),
        referrals: toStatusMap(referrals.rows, 'status'),
        notifications: toStatusMap(notifications.rows, 'status'),
        integrity: toStatusMap(integrity.rows, 'status'),
      }
    })
    res.json(summary)
  } catch (err: any) {
    res.status(500).json({ code: 'DASHBOARD_SUMMARY_FAILED', message: err?.message || 'Failed to load dashboard summary' })
  }
})

// GET /admin/dashboard/policy-integrity?status=&class=&format=csv
adminDashboardRoutes.get('/policy-integrity', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const exceptionClass = typeof req.query.class === 'string' ? req.query.class : undefined
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['pie.tenant_id = $1']
      const params: unknown[] = [tenantId]
      if (status) { params.push(status); clauses.push(`pie.status = $${params.length}`) }
      else clauses.push(`pie.status <> 'Resolved'`)
      if (exceptionClass) { params.push(exceptionClass); clauses.push(`pie.exception_class = $${params.length}`) }
      const result = await q(
        `SELECT pie.*, p.policy_number, p.status AS policy_status, pt.type AS transaction_type
           FROM policy_integrity_exceptions pie
           JOIN policies p ON p.tenant_id = pie.tenant_id AND p.policy_id = pie.policy_id
           LEFT JOIN policy_transactions pt ON pt.tenant_id = pie.tenant_id AND pt.transaction_id = pie.transaction_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY CASE pie.severity WHEN 'Critical' THEN 1 WHEN 'Error' THEN 2 ELSE 3 END, pie.last_detected_at DESC
          LIMIT 1000`, params)
      return result.rows
    })
    if (req.query.format === 'csv') {
      const columns = ['exception_id','policy_number','policy_id','transaction_id','transaction_type','exception_class','severity','status','summary','suggested_action','correlation_id','first_detected_at','last_detected_at']
      const csv = [columns.join(','), ...rows.map((row: any) => columns.map((column) => csvCell(row[column])).join(','))].join('\n')
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="policy-integrity-exceptions.csv"')
      return res.send(csv)
    }
    res.json({ items: rows })
  } catch (err: any) {
    res.status(500).json({ code: 'POLICY_INTEGRITY_LIST_FAILED', message: err?.message || 'Failed to list policy integrity exceptions' })
  }
})

adminDashboardRoutes.patch('/policy-integrity/:exceptionId', integrityActionLimiter, async (req, res) => {
  if (!hasPermission(req, 'admin.jobs.manage')) return res.status(403).json({ code: 'FORBIDDEN', message: 'Requires admin.jobs.manage permission' })
  const tenantId = req.tenant!.tenantId
  const exceptionId = routeParam(req.params.exceptionId)
  const status = req.body?.status
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : null
  if (!['Acknowledged', 'Resolved'].includes(status)) return res.status(400).json({ code: 'INVALID_STATUS', message: 'Status must be Acknowledged or Resolved' })
  try {
    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(
        `UPDATE policy_integrity_exceptions SET status = $3,
           acknowledged_at = CASE WHEN $3 = 'Acknowledged' THEN now() ELSE acknowledged_at END,
           acknowledged_by = CASE WHEN $3 = 'Acknowledged' THEN $4::uuid ELSE acknowledged_by END,
           resolved_at = CASE WHEN $3 = 'Resolved' THEN now() ELSE NULL END,
           resolved_by = CASE WHEN $3 = 'Resolved' THEN $4::uuid ELSE NULL END,
           resolution_note = CASE WHEN $3 = 'Resolved' THEN $5 ELSE resolution_note END, updated_at = now()
         WHERE tenant_id = $1 AND exception_id = $2 RETURNING *`,
        [tenantId, exceptionId, status, req.user?.id || null, note]
      )
      return result.rows[0]
    })
    if (!row) return res.status(404).json({ code: 'POLICY_INTEGRITY_NOT_FOUND', message: 'Exception not found' })
    res.json(row)
  } catch (err: any) {
    res.status(500).json({ code: 'POLICY_INTEGRITY_UPDATE_FAILED', message: err?.message || 'Failed to update exception' })
  }
})

adminDashboardRoutes.post('/policy-integrity/:exceptionId/retry', integrityActionLimiter, async (req, res) => {
  if (!hasPermission(req, 'admin.jobs.manage')) return res.status(403).json({ code: 'FORBIDDEN', message: 'Requires admin.jobs.manage permission' })
  const tenantId = req.tenant!.tenantId
  const exceptionId = routeParam(req.params.exceptionId)
  try {
    const finding = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(`UPDATE policy_integrity_exceptions SET retry_count = retry_count + 1, last_retry_at = now(), updated_at = now() WHERE tenant_id = $1 AND exception_id = $2 RETURNING *`, [tenantId, exceptionId])
      return result.rows[0]
    })
    if (!finding) return res.status(404).json({ code: 'POLICY_INTEGRITY_NOT_FOUND', message: 'Exception not found' })
    const { run } = await enqueueJob({
      tenantId,
      jobCode: 'policy_integrity_reconciliation',
      idempotencyKey: `integrity-retry:${tenantId}:${exceptionId}:${Date.now()}`,
      requestPayload: { policyId: finding.policy_id },
    })
    res.status(202).json({ run, exception: finding })
  } catch (err: any) {
    res.status(500).json({ code: 'POLICY_INTEGRITY_RETRY_FAILED', message: err?.message || 'Failed to enqueue retry' })
  }
})

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  return `"${String(value).replace(/"/g, '""')}"`
}

// GET /admin/dashboard/outbox?status=
// Recent async delivery outbox rows, defaulting to pending/retry/failed so
// operators see what still needs attention.
adminDashboardRoutes.get('/outbox', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const status = typeof req.query.status === 'string' ? req.query.status : undefined

  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id = $1']
      const params: any[] = [tenantId]
      if (status) {
        clauses.push('status = $2')
        params.push(status)
      } else {
        clauses.push(`status IN ('Pending','Retry','Failed')`)
      }
      const result = await q(
        `SELECT message_id, tenant_id, source_table, source_id, topic, status, attempts, max_attempts,
                next_attempt_at, last_attempt_at, last_error, created_at
           FROM async_message_outbox
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT 200`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err: any) {
    res.status(500).json({ code: 'DASHBOARD_OUTBOX_FAILED', message: err?.message || 'Failed to load outbox queue' })
  }
})

// GET /admin/dashboard/notifications?status=
// Recent notification intents that failed to send or were suppressed, so
// operators can see delivery problems without a working outbound provider.
adminDashboardRoutes.get('/notifications', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const status = typeof req.query.status === 'string' ? req.query.status : undefined

  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id = $1']
      const params: any[] = [tenantId]
      if (status) {
        clauses.push('status = $2')
        params.push(status)
      } else {
        clauses.push(`status IN ('Failed','Suppressed')`)
      }
      const result = await q(
        `SELECT notification_id, tenant_id, policy_id, transaction_id, event_type, channel, status,
                attempts, max_attempts, last_error, next_attempt_at, sent_at, created_at
           FROM notification_intents
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT 200`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err: any) {
    res.status(500).json({ code: 'DASHBOARD_NOTIFICATIONS_FAILED', message: err?.message || 'Failed to load notification failures' })
  }
})
