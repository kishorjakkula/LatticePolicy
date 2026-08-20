import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { hasPermission } from '../auth.js'
import { routeParam } from '../lib/utils.js'
import { enqueueJob, retryDeadLetteredRun, type JobRunRow } from '../jobs/jobQueue.js'
import { isJobCodeRegistered, validateJobPayload } from '../jobs/registry.js'

export const adminJobsRoutes = Router()

function canManage(req: import('express').Request): boolean {
  return hasPermission(req, 'admin.jobs.manage')
}

adminJobsRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Job administration requires database mode' })
  }
  next()
})

// ── Job definitions (global registry) ───────────────────────────────────────

adminJobsRoutes.get('/definitions', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(
        `SELECT job_code, description, enabled, default_schedule, default_max_attempts, default_timeout_seconds, created_at, updated_at
           FROM job_definitions
          ORDER BY job_code`
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err: any) {
    res.status(500).json({ code: 'JOB_DEFINITIONS_LIST_FAILED', message: err?.message || 'Failed to list job definitions' })
  }
})

// ── Job runs (tenant-scoped history) ────────────────────────────────────────

adminJobsRoutes.get('/runs', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const jobCode = typeof req.query.jobCode === 'string' ? req.query.jobCode : undefined
  const status = typeof req.query.status === 'string' ? req.query.status : undefined
  const limit = clampLimit(req.query.limit)

  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id = $1']
      const params: any[] = [tenantId]
      let idx = 2
      if (jobCode) {
        clauses.push(`job_code = $${idx}`)
        params.push(jobCode)
        idx += 1
      }
      if (status) {
        clauses.push(`status = $${idx}`)
        params.push(status)
        idx += 1
      }
      params.push(limit)
      const result = await q(
        `SELECT run_id, tenant_id, job_code, schedule_id, idempotency_key, status, attempts, max_attempts,
                checkpoint, request_payload, result_payload, last_error, locked_by, locked_until,
                next_attempt_at, started_at, finished_at, created_at, updated_at
           FROM job_runs
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${idx}`,
        params
      )
      return result.rows
    })
    res.json({ items: rows })
  } catch (err: any) {
    res.status(500).json({ code: 'JOB_RUNS_LIST_FAILED', message: err?.message || 'Failed to list job runs' })
  }
})

adminJobsRoutes.get('/runs/:runId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const runId = routeParam(req.params.runId)
  try {
    const { run, events } = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const runResult = await q(`SELECT * FROM job_runs WHERE tenant_id = $1 AND run_id = $2`, [tenantId, runId])
      if (!runResult.rows[0]) return { run: null, events: [] }
      const eventsResult = await q(
        `SELECT event_id, event_type, message, payload, created_at FROM job_run_events WHERE tenant_id = $1 AND run_id = $2 ORDER BY created_at ASC`,
        [tenantId, runId]
      )
      return { run: runResult.rows[0], events: eventsResult.rows }
    })
    if (!run) {
      return res.status(404).json({ code: 'JOB_RUN_NOT_FOUND', message: 'Job run not found' })
    }
    res.json({ run, events })
  } catch (err: any) {
    res.status(500).json({ code: 'JOB_RUN_GET_FAILED', message: err?.message || 'Failed to load job run' })
  }
})

adminJobsRoutes.post('/runs', async (req, res) => {
  if (!canManage(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Requires admin.jobs.manage permission' })
  }
  const tenantId = req.tenant!.tenantId
  const jobCode = typeof req.body?.jobCode === 'string' ? req.body.jobCode : ''
  const idempotencyKey = typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey
    ? req.body.idempotencyKey
    : `manual:${tenantId}:${jobCode}:${Date.now()}`
  const requestPayload = req.body?.requestPayload ?? {}

  if (!jobCode || !isJobCodeRegistered(jobCode)) {
    return res.status(400).json({ code: 'UNKNOWN_JOB_CODE', message: `Unknown or unregistered job code: ${jobCode}` })
  }
  try {
    validateJobPayload(jobCode, requestPayload)
  } catch (err: any) {
    return res.status(400).json({ code: 'INVALID_JOB_PAYLOAD', message: err?.message || 'Invalid job payload' })
  }

  try {
    const { run, created } = await enqueueJob({ tenantId, jobCode, idempotencyKey, requestPayload })
    res.status(created ? 201 : 200).json({ run, created })
  } catch (err: any) {
    res.status(500).json({ code: 'JOB_ENQUEUE_FAILED', message: err?.message || 'Failed to enqueue job run' })
  }
})

adminJobsRoutes.post('/runs/:runId/retry', async (req, res) => {
  if (!canManage(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Requires admin.jobs.manage permission' })
  }
  const tenantId = req.tenant!.tenantId
  const runId = routeParam(req.params.runId)
  const actorId = req.user?.id || null

  try {
    const existing = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(`SELECT * FROM job_runs WHERE tenant_id = $1 AND run_id = $2`, [tenantId, runId])
      return result.rows[0] as JobRunRow | undefined
    })
    if (!existing) {
      return res.status(404).json({ code: 'JOB_RUN_NOT_FOUND', message: 'Job run not found' })
    }
    if (existing.status !== 'DeadLettered') {
      return res.status(409).json({ code: 'JOB_RUN_NOT_DEAD_LETTERED', message: `Run is not dead-lettered (status: ${existing.status})` })
    }
    const newRun = await retryDeadLetteredRun(existing, actorId)
    res.status(201).json({ run: newRun })
  } catch (err: any) {
    res.status(500).json({ code: 'JOB_RETRY_FAILED', message: err?.message || 'Failed to retry job run' })
  }
})

function clampLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 200)
}
