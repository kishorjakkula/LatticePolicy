import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { issuePolicy } from '../services/lifecycle.service.js'
import { createOrRateQuote } from '../services/quote.service.js'
import { bindQuote } from '../services/quote-bind.service.js'
import { withTenantTx } from '../db.js'

const app = createApp()
const tenantId = 'sample-carrier'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency, mfa_required)
     VALUES ($1,$2,$3,$4,false)
     ON CONFLICT (tenant_id) DO UPDATE
       SET name = EXCLUDED.name, mfa_required = false`,
    [tenantId, 'Notification Admin Carrier', 'en-US', 'USD'],
  )
}

async function login(username: string) {
  const res = await request(app).post('/auth/login').send({ tenantId, username, password }).expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authGet(path: string, token: string) {
  return request(app).get(path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}
function authPost(path: string, token: string) {
  return request(app).post(path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}
function authPatch(path: string, token: string) {
  return request(app).patch(path).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}

function quotePayload(customerName: string, vin: string) {
  const [firstName, lastName] = customerName.split(' ')
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName, lastName, email: `${firstName.toLowerCase()}@example.com` },
    insureds: { primary: { firstName, lastName, displayName: customerName } },
    risks: [
      { type: 'autoVehicle', year: 2024, make: 'Honda', model: 'Accord', vin, garagingZip: '94105', symbol: 'A', usage: 'commute' },
    ],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
  }
}

async function issueTestPolicy(customerName: string, vin: string) {
  const quote = await createOrRateQuote({} as any, tenantId, quotePayload(customerName, vin), null, 'integration-test')
  const bound = await bindQuote({} as any, tenantId, quote.quoteId, {}, 'integration-test', null)
  await withTenantTx(tenantId, (db) =>
    issuePolicy(db, tenantId, bound.policyId, {}, {
      id: crypto.randomUUID(),
      username: 'integration-test',
      roles: ['admin'],
      permissions: ['uw.referrals.decide'],
    }),
  )
  return bound
}

async function latestIssuedSubject(policyId: string) {
  const row = await getDb()!.query(
    `SELECT subject FROM notification_intents
      WHERE tenant_id = $1 AND policy_id = $2::uuid AND event_type = 'POLICY_ISSUED'
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId, policyId],
  )
  return row.rows[0]?.subject as string | undefined
}

describe('notification template admin API', () => {
  afterAll(async () => {
    await closeDb()
  })

  it('requires admin.notifications permissions and enforces tenant scope', async () => {
    await initDb()
    await ensureTenant()
    const run = suffix()

    await createUser({ username: `notif-admin-${run}`, password, tenantId, roles: ['notification_admin'] })
    await createUser({ username: `notif-agent-${run}`, password, tenantId, roles: ['agent'] })

    const adminToken = await login(`notif-admin-${run}`)
    const agentToken = await login(`notif-agent-${run}`)

    const denied = await authGet('/api/v1/admin/notification-templates', agentToken).expect(403)
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN' })

    const allowed = await authGet('/api/v1/admin/notification-templates', adminToken).expect(200)
    expect(Array.isArray(allowed.body)).toBe(true)

    const deniedWrite = await authPost('/api/v1/admin/notification-templates', agentToken)
      .send({
        templateCode: `agent-blocked-${run}`,
        eventType: 'POLICY_ISSUED',
        subjectTemplate: 'x',
        bodyTemplate: 'y',
      })
      .expect(403)
    expect(deniedWrite.body).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('supports create, list, update, activate/deactivate, and preview flows', async () => {
    await initDb()
    await ensureTenant()
    const run = suffix()

    await createUser({ username: `notif-crud-${run}`, password, tenantId, roles: ['notification_admin'] })
    const token = await login(`notif-crud-${run}`)

    const templateCode = `pa-issued-${run}`
    const created = await authPost('/api/v1/admin/notification-templates', token)
      .send({
        templateCode,
        eventType: 'POLICY_ISSUED',
        productCode: 'personal-auto',
        transactionType: 'Issue',
        subjectTemplate: 'Custom subject {{policyNumber}}',
        bodyTemplate: 'Custom body {{policyNumber}} effective {{effectiveDate}}',
        visibility: ['customer'],
      })
      .expect(201)
    expect(created.body).toMatchObject({
      templateCode,
      eventType: 'POLICY_ISSUED',
      channel: 'EMAIL',
      active: true,
    })
    const templateId = created.body.templateId as string

    const duplicate = await authPost('/api/v1/admin/notification-templates', token)
      .send({
        templateCode,
        eventType: 'POLICY_ISSUED',
        subjectTemplate: 'x',
        bodyTemplate: 'y',
      })
      .expect(409)
    expect(duplicate.body).toMatchObject({ code: 'DUPLICATE' })

    const listed = await authGet(`/api/v1/admin/notification-templates?eventType=POLICY_ISSUED`, token).expect(200)
    expect(listed.body.some((t: any) => t.templateId === templateId)).toBe(true)

    const fetched = await authGet(`/api/v1/admin/notification-templates/${templateId}`, token).expect(200)
    expect(fetched.body.templateCode).toBe(templateCode)

    const preview = await authPost('/api/v1/admin/notification-templates/preview', token)
      .send({
        subjectTemplate: created.body.subjectTemplate,
        bodyTemplate: created.body.bodyTemplate,
        sampleFields: { policyNumber: 'PA-SAMPLE-1', effectiveDate: '2026-08-01' },
      })
      .expect(200)
    expect(preview.body).toEqual({
      subject: 'Custom subject PA-SAMPLE-1',
      body: 'Custom body PA-SAMPLE-1 effective 2026-08-01',
    })

    const updated = await authPatch(`/api/v1/admin/notification-templates/${templateId}`, token)
      .send({ subjectTemplate: 'Updated subject {{policyNumber}}' })
      .expect(200)
    expect(updated.body.subjectTemplate).toBe('Updated subject {{policyNumber}}')
    expect(updated.body.bodyTemplate).toBe(created.body.bodyTemplate)

    const deactivated = await authPost(`/api/v1/admin/notification-templates/${templateId}/deactivate`, token).expect(200)
    expect(deactivated.body.active).toBe(false)

    const reactivated = await authPost(`/api/v1/admin/notification-templates/${templateId}/activate`, token).expect(200)
    expect(reactivated.body.active).toBe(true)

    // Leave this template deactivated so it cannot shadow the built-in default
    // template for POLICY_ISSUED/personal-auto/Issue in other tests that share
    // this tenant.
    await authPost(`/api/v1/admin/notification-templates/${templateId}/deactivate`, token).expect(200)
  })

  it('applies active templates to runtime notifications and falls back once deactivated', async () => {
    await initDb()
    await ensureTenant()
    const run = suffix()

    await createUser({ username: `notif-runtime-${run}`, password, tenantId, roles: ['notification_admin'] })
    const token = await login(`notif-runtime-${run}`)

    const created = await authPost('/api/v1/admin/notification-templates', token)
      .send({
        templateCode: `pa-issued-runtime-${run}`,
        eventType: 'POLICY_ISSUED',
        productCode: 'personal-auto',
        transactionType: 'Issue',
        subjectTemplate: `Custom issued notice ${run} {{policyNumber}}`,
        bodyTemplate: 'Custom body',
      })
      .expect(201)
    const templateId = created.body.templateId as string

    const firstPolicy = await issueTestPolicy(`Ada ${run}`, `VINA${run}`)
    const firstSubject = await latestIssuedSubject(firstPolicy.policyId)
    expect(firstSubject).toBe(`Custom issued notice ${run} ${firstPolicy.policyNumber}`)

    await authPost(`/api/v1/admin/notification-templates/${templateId}/deactivate`, token).expect(200)

    const secondPolicy = await issueTestPolicy(`Grace ${run}`, `VINB${run}`)
    const secondSubject = await latestIssuedSubject(secondPolicy.policyId)
    expect(secondSubject).toBe(`Policy ${secondPolicy.policyNumber} issued`)
  })
})
