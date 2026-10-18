import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { issueToken } from '../auth.js'
import { createUser } from '../users.js'
import { ensureTenantRbacDefaults } from '../rbac.js'

// Validation rules at every level of every transaction, through the real API:
// rate, bind and issue for new business, and issue for a cancellation, with
// Common rules applying to both. A dedicated tenant keeps these rules away
// from every other test.

const app = createApp()
const tenantId = `validation-${crypto.randomUUID().slice(0, 8)}`
let token = ''
let agentToken = ''

const api = {
  get: (path: string, as = token) => request(app).get(`/api/v1${path}`).set('Authorization', `Bearer ${as}`).set('X-Tenant', tenantId),
  post: (path: string, as = token) => request(app).post(`/api/v1${path}`).set('Authorization', `Bearer ${as}`).set('X-Tenant', tenantId),
  put: (path: string, as = token) => request(app).put(`/api/v1${path}`).set('Authorization', `Bearer ${as}`).set('X-Tenant', tenantId),
  delete: (path: string, as = token) => request(app).delete(`/api/v1${path}`).set('Authorization', `Bearer ${as}`).set('X-Tenant', tenantId),
}

function quotePayload(overrides: Record<string, unknown> = {}) {
  const lastName = `Rules${crypto.randomUUID().slice(0, 6)}`
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Val', lastName, email: `val.${lastName.toLowerCase()}@example.com` },
    insureds: { primary: { firstName: 'Val', lastName, displayName: `Val ${lastName}` } },
    risks: [{ type: 'autoVehicle', year: 2024, make: 'Honda', model: 'Accord', vin: `1HGCM82633A${Math.floor(Math.random() * 900000 + 100000)}`, garagingZip: '94105', symbol: 'A', usage: 'commute' }],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

const rule = (overrides: Record<string, unknown>) => ({
  name: 'Test rule',
  kind: 'condition',
  condition: 'false',
  levels: ['issue'],
  transactionTypes: ['common'],
  productCode: 'personal-auto',
  stateCode: 'CA',
  severity: 'warning',
  message: 'Check this',
  effectiveDate: '2026-01-01',
  active: true,
  ...overrides,
})

describe('validation rules framework', () => {
  beforeAll(async () => {
    await initDb()
    const db = getDb()!
    await db.query(
      `INSERT INTO tenants (tenant_id, name, default_locale, default_currency, mfa_required) VALUES ($1,$1,'en-US','USD',false)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId],
    )
    await db.query(
      `INSERT INTO product_state_eligibility (tenant_id, product_code, state_code, admitted, surplus_lines, status)
       VALUES ($1,'personal-auto','CA',true,false,'ACTIVE') ON CONFLICT (tenant_id, product_code, state_code) DO UPDATE SET status='ACTIVE'`,
      [tenantId],
    )
    await ensureTenantRbacDefaults(tenantId)
    const admin = await createUser({ username: `rules-admin-${tenantId}`, password: 'Rules-Admin-Pass-9!', tenantId, roles: ['admin'] })
    const agent = await createUser({ username: `rules-agent-${tenantId}`, password: 'Rules-Agent-Pass-9!', tenantId, roles: ['agent'] })
    token = issueToken({ id: admin.id, username: admin.username, tenantId, roles: ['admin'], permissions: [] } as any)
    agentToken = issueToken({ id: agent.id, username: agent.username, tenantId, roles: ['agent'], permissions: [] } as any)
  })

  afterAll(async () => {
    const client = await (getDb() as any).connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('app.audit_purge', 'tenant-offboarding', true)")
      await client.query('DELETE FROM tenants WHERE tenant_id=$1', [tenantId])
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
    await closeDb()
  })

  it('lets administrators manage rules with validation, versioning and an append-only history', async () => {
    await api.get('/admin/validation-rules', agentToken).expect(403)
    const invalid = await api.post('/admin/validation-rules').send(rule({ ruleCode: 'BAD_RULE', condition: 'risk.(' })).expect(422)
    expect(JSON.stringify(invalid.body.details)).toMatch(/Condition:/)
    const screenWithoutStep = await api.post('/admin/validation-rules').send(rule({ ruleCode: 'NO_SCREEN', levels: ['screen'] })).expect(422)
    expect(screenWithoutStep.body.details.problems).toContain('Choose the screen a screen-level rule is shown on')

    const created = (await api.post('/admin/validation-rules').send(rule({ ruleCode: 'temp_rule', active: false })).expect(201)).body
    expect(created).toMatchObject({ ruleCode: 'TEMP_RULE', version: 1, stateCode: 'CA' })
    await api.post('/admin/validation-rules').send(rule({ ruleCode: 'TEMP_RULE' })).expect(409)
    const updated = (await api.put(`/admin/validation-rules/${created.ruleId}`).send(rule({ ruleCode: 'TEMP_RULE', message: 'Changed', active: false })).expect(200)).body
    expect(updated).toMatchObject({ version: 2, message: 'Changed' })
    await api.put(`/admin/validation-rules/${created.ruleId}`).send(rule({ ruleCode: 'OTHER_CODE', active: false })).expect(409)
    await api.delete(`/admin/validation-rules/${created.ruleId}`).expect(200)
    const history = (await api.get(`/admin/validation-rules/${created.ruleId}/history`).expect(200)).body.items
    expect(history.map((entry: any) => entry.action)).toEqual(['DELETED', 'UPDATED', 'CREATED'])
    expect(history[1]).toMatchObject({ before: expect.objectContaining({ message: 'Check this' }), after: expect.objectContaining({ message: 'Changed' }) })
    await expect(getDb()!.query('UPDATE validation_rule_audit SET actor=$1 WHERE rule_id=$2', ['forged', created.ruleId])).rejects.toThrow(/AUDIT_APPEND_ONLY/)

    const catalog = (await api.get('/admin/validation-rules/catalog?productCode=personal-auto').expect(200)).body.fields
    expect(catalog.map((field: any) => field.path)).toEqual(expect.arrayContaining(['applicant.email', 'transaction.reasonCode', 'risks.0.make']))
  })

  it('enforces rate, bind and issue rules for new business and Common rules for a cancellation', async () => {
    const create = (body: Record<string, unknown>) => api.post('/admin/validation-rules').send(body).expect(201)
    await create(rule({ ruleCode: 'RATE_PRIOR', kind: 'required', fieldPath: 'priorCarrier', condition: null, levels: ['rate'], transactionTypes: ['new_business'], severity: 'error', message: 'Prior carrier is required to rate' }))
    await create(rule({ ruleCode: 'RATE_HINT', condition: 'isSet(priorPolicyNumber)', levels: ['rate'], transactionTypes: ['new_business'], message: 'Prior policy number helps verify history' }))
    await create(rule({ ruleCode: 'BIND_PREMIUM', condition: 'premium.total < 1', levels: ['bind'], transactionTypes: ['new_business'], message: 'Confirm the premium with the insured' }))
    await create(rule({ ruleCode: 'ISSUE_COMMON', levels: ['issue'], transactionTypes: ['common'], message: 'Confirm documents were reviewed' }))
    await create(rule({ ruleCode: 'CANCEL_REASON', kind: 'required', fieldPath: 'transaction.reasonCode', condition: null, levels: ['issue'], transactionTypes: ['cancellation'], severity: 'error', message: 'Cancellation reason is required' }))
    // Another state's rule never applies to a California policy.
    await create(rule({ ruleCode: 'FL_ONLY', stateCode: 'FL', severity: 'error', levels: ['rate', 'bind', 'issue'], message: 'Florida only' }))

    // Rate: the required field stops rating; the warning comes back with the premium.
    const blocked = await api.post('/quotes').send(quotePayload()).expect(422)
    expect(blocked.body).toMatchObject({ code: 'VALIDATION_FAILED', details: { level: 'rate', transactionType: 'new_business', errors: [expect.objectContaining({ ruleCode: 'RATE_PRIOR', fieldPath: 'priorCarrier' })] } })
    const rated = await api.post('/quotes').send(quotePayload({ priorCarrier: 'Acme Insurance' })).expect(200)
    const quote = rated.body.data || rated.body
    expect(quote.validation.warnings.map((warning: any) => warning.ruleCode)).toEqual(['RATE_HINT'])

    // Bind: the warning must be acknowledged, and the acknowledgement is recorded.
    const bindWarn = await api.post(`/quotes/${quote.quoteId}/bind`).send({}).expect(409)
    expect(bindWarn.body).toMatchObject({ code: 'VALIDATION_WARNINGS_UNACKNOWLEDGED', details: { level: 'bind', pending: [expect.objectContaining({ ruleCode: 'BIND_PREMIUM' })] } })
    const bound = await api.post(`/quotes/${quote.quoteId}/bind`).send({ validationAcknowledgements: ['BIND_PREMIUM'] }).expect(200)
    const policyId = (bound.body.data || bound.body).policyId
    const quoteAcks = (await api.get(`/validation-acknowledgements?entityType=quote&entityId=${quote.quoteId}`).expect(200)).body.items
    expect(quoteAcks).toEqual([expect.objectContaining({ level: 'bind', transactionType: 'new_business', ruleCode: 'BIND_PREMIUM', ruleVersion: 1 })])

    // Issue: the Common warning applies to new business.
    const issueWarn = await api.post(`/policies/${policyId}/issue`).send({}).expect(409)
    expect(issueWarn.body.details.pending.map((warning: any) => warning.ruleCode)).toEqual(['ISSUE_COMMON'])
    await api.post(`/policies/${policyId}/issue`).send({ validationAcknowledgements: ['ISSUE_COMMON'] }).expect(200)

    // Cancellation: its own required reason, plus the same Common warning.
    const cancel = (body: Record<string, unknown>) => api.post(`/policies/${policyId}/cancel`).send({ effectiveDate: '2026-09-01', reason: 'Insured request', ...body })
    const missingReason = await cancel({ validationAcknowledgements: ['ISSUE_COMMON'] }).expect(422)
    expect(missingReason.body.details.errors).toEqual([expect.objectContaining({ ruleCode: 'CANCEL_REASON', fieldPath: 'transaction.reasonCode' })])
    const commonAgain = await cancel({ reasonCode: 'INSURED_REQUEST' }).expect(409)
    expect(commonAgain.body.details).toMatchObject({ transactionType: 'cancellation', pending: [expect.objectContaining({ ruleCode: 'ISSUE_COMMON' })] })
    await cancel({ reasonCode: 'INSURED_REQUEST', validationAcknowledgements: ['ISSUE_COMMON'] }).expect(200)

    const policyAcks = (await api.get(`/validation-acknowledgements?entityType=policy&entityId=${policyId}`).expect(200)).body.items
    expect(policyAcks.map((ack: any) => `${ack.level}:${ack.transactionType}:${ack.ruleCode}`).sort()).toEqual([
      'issue:cancellation:ISSUE_COMMON',
      'issue:new_business:ISSUE_COMMON',
    ])
    await expect(getDb()!.query('DELETE FROM validation_acknowledgements WHERE entity_id=$1', [policyId])).rejects.toThrow(/AUDIT_APPEND_ONLY/)
  })

  it('serves the rules for a screen to the wizard, scoped by product and state', async () => {
    await api.post('/admin/validation-rules').send(rule({ ruleCode: 'SCREEN_EMAIL', kind: 'required', fieldPath: 'applicant.email', condition: null, levels: ['screen', 'bind'], screen: 'insureds', transactionTypes: ['new_business', 'endorsement'], severity: 'error', message: 'Email required' })).expect(201)
    const forCa = (await api.get('/validation-rules/applicable?productCode=personal-auto&state=CA', agentToken).expect(200)).body.items
    expect(forCa.map((item: any) => item.ruleCode)).toContain('SCREEN_EMAIL')
    expect(forCa.map((item: any) => item.ruleCode)).not.toContain('FL_ONLY')
    const otherProduct = (await api.get('/validation-rules/applicable?productCode=homeowners&state=CA', agentToken).expect(200)).body.items
    expect(otherProduct).toEqual([])
  })
})
