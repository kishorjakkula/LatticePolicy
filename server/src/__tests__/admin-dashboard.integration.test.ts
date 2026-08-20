import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'

const app = createApp()
const tenantId = 'sample-carrier'
const otherTenantId = 'dashboard-other-tenant'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant(id: string) {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [id, `Tenant ${id}`, 'en-US', 'USD'],
  )
}

async function login(tid: string, username: string) {
  const res = await request(app)
    .post('/auth/login')
    .send({ tenantId: tid, username, password })
    .expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authReq(method: 'get', path: string, token: string, tid: string) {
  return (request(app) as any)[method](path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', tid)
}

describe('admin operations dashboard (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant(tenantId)
    await ensureTenant(otherTenantId)
  })

  afterAll(async () => {
    await closeDb()
  })

  it('denies dashboard access to a user without admin.dashboard.read', async () => {
    const run = suffix()
    await createUser({ username: `dash-agent-${run}`, password, tenantId, roles: ['agent'] })
    const token = await login(tenantId, `dash-agent-${run}`)

    await authReq('get', '/api/v1/admin/dashboard/summary', token, tenantId).expect(403)
  })

  it('returns aggregated summary counts and does not leak data across tenants', async () => {
    const run = suffix()
    const db = getDb()!

    // Seed an outbox failure for our tenant and a distinct one for another tenant.
    await db.query(
      `INSERT INTO async_message_outbox (tenant_id, source_table, source_id, topic, payload, status, attempts, last_error)
       VALUES ($1, 'ledger_events', gen_random_uuid(), $2, '{}'::jsonb, 'Failed', 3, 'boom')`,
      [tenantId, `dashboard-test-${run}`],
    )
    await db.query(
      `INSERT INTO async_message_outbox (tenant_id, source_table, source_id, topic, payload, status, attempts, last_error)
       VALUES ($1, 'ledger_events', gen_random_uuid(), $2, '{}'::jsonb, 'Failed', 1, 'other tenant boom')`,
      [otherTenantId, `dashboard-test-other-${run}`],
    )

    await createUser({ username: `dash-admin-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(tenantId, `dash-admin-${run}`)

    const summary = await authReq('get', '/api/v1/admin/dashboard/summary', token, tenantId).expect(200)
    expect(summary.body.outbox.Failed).toBeGreaterThanOrEqual(1)

    const outbox = await authReq('get', '/api/v1/admin/dashboard/outbox?status=Failed', token, tenantId).expect(200)
    const topics = outbox.body.items.map((row: any) => row.topic)
    expect(topics).toContain(`dashboard-test-${run}`)
    expect(topics).not.toContain(`dashboard-test-other-${run}`)
  })

  it('returns failed and suppressed notification intents for the panel', async () => {
    const run = suffix()
    const db = getDb()!

    await db.query(
      `INSERT INTO notification_intents (tenant_id, event_type, channel, recipient, template_code, subject, body, status, attempts, last_error)
       VALUES ($1, $2, 'EMAIL', '{}'::jsonb, 'TEST_TEMPLATE', 'Test subject', 'Test body', 'Failed', 5, 'provider unreachable')`,
      [tenantId, `DASHBOARD_TEST_${run}`],
    )

    await createUser({ username: `dash-admin2-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(tenantId, `dash-admin2-${run}`)

    const res = await authReq('get', '/api/v1/admin/dashboard/notifications', token, tenantId).expect(200)
    expect(res.body.items.some((row: any) => row.event_type === `DASHBOARD_TEST_${run}`)).toBe(true)
  })
})
