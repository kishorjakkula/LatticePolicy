import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'

export const adminDashboardRoutes = Router()

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
      return {
        outbox: toStatusMap(outbox.rows, 'status'),
        ofac: toStatusMap(ofac.rows, 'disposition'),
        referrals: toStatusMap(referrals.rows, 'status'),
        notifications: toStatusMap(notifications.rows, 'status'),
      }
    })
    res.json(summary)
  } catch (err: any) {
    res.status(500).json({ code: 'DASHBOARD_SUMMARY_FAILED', message: err?.message || 'Failed to load dashboard summary' })
  }
})

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
