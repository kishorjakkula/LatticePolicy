import crypto from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb, initDb } from '../db.js'
import { createApp } from '../app.js'
import { createUser } from '../users.js'
import { checkStateEligibility, screenOfac } from '../lib/policy-compliance.js'

const app = createApp()
const tenantId = 'sample-carrier'
const password = 'password'

function suffix() {
  return crypto.randomUUID().slice(0, 8)
}

function q(text: string, params?: any[]) {
  return getDb()!.query(text, params)
}

async function ensureTenant() {
  const db = getDb()
  await db!.query(
    `INSERT INTO tenants (tenant_id, name, default_locale, default_currency)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
    [tenantId, 'Sample Carrier', 'en-US', 'USD'],
  )
}

async function login(username: string) {
  const res = await request(app)
    .post('/auth/login')
    .send({ tenantId, username, password })
    .expect(200)
  expect(res.body.token).toBeTruthy()
  return res.body.token as string
}

function authReq(method: 'get' | 'post' | 'patch', path: string, token: string) {
  return (request(app) as any)[method](path)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Tenant', tenantId)
}

describe('compliance admin: eligibility and OFAC review (database path)', () => {
  beforeAll(async () => {
    await initDb()
    expect(getDb()).toBeTruthy()
    await ensureTenant()
  })

  afterAll(async () => {
    await closeDb()
  })

  it('admin can create/update eligibility and it drives quote-time enforcement', async () => {
    const run = suffix()
    const productCode = `test-product-${run}`
    const stateCode = 'NY'

    await createUser({ username: `compliance-admin-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`compliance-admin-${run}`)

    // No record yet: blocked by default (safety fallback).
    const beforeCreate = await checkStateEligibility(q, tenantId, productCode, stateCode)
    expect(beforeCreate.eligible).toBe(false)

    const created = await authReq('post', '/api/v1/admin/compliance/eligibility', token)
      .send({ productCode, stateCode, status: 'ACTIVE', notes: 'Approved for pilot' })
      .expect(201)
    expect(created.body).toMatchObject({ product_code: productCode, state_code: stateCode, status: 'ACTIVE' })

    const afterCreate = await checkStateEligibility(q, tenantId, productCode, stateCode)
    expect(afterCreate.eligible).toBe(true)

    const suspended = await authReq('patch', `/api/v1/admin/compliance/eligibility/${created.body.eligibility_id}`, token)
      .send({ status: 'SUSPENDED' })
      .expect(200)
    expect(suspended.body.status).toBe('SUSPENDED')

    const afterSuspend = await checkStateEligibility(q, tenantId, productCode, stateCode)
    expect(afterSuspend.eligible).toBe(false)
    expect(afterSuspend.status).toBe('SUSPENDED')

    const list = await authReq('get', `/api/v1/admin/compliance/eligibility?productCode=${productCode}`, token).expect(200)
    expect(list.body.items).toHaveLength(1)
  })

  it('denies eligibility management to a user without admin.compliance.manage', async () => {
    const run = suffix()
    await createUser({ username: `compliance-agent-${run}`, password, tenantId, roles: ['agent'] })
    const token = await login(`compliance-agent-${run}`)

    await authReq('post', '/api/v1/admin/compliance/eligibility', token)
      .send({ productCode: `test-product-${run}`, stateCode: 'CA', status: 'ACTIVE' })
      .expect(403)
  })

  it('reviews and dispositions an OFAC potential hit, then auto-clears repeat matches', async () => {
    const run = suffix()
    const partyName = `Test Sanctioned Party ${run}`

    await getDb()!.query(
      `INSERT INTO ofac_sdn_list (name, normalized_name, aliases, country, list_type)
       VALUES ($1,$2,'[]'::jsonb,'XX','SDN')`,
      [partyName, `TEST SANCTIONED PARTY ${run.toUpperCase()}`],
    )

    await createUser({ username: `compliance-reviewer-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`compliance-reviewer-${run}`)

    const first = await screenOfac(q, tenantId, partyName, {})
    expect(first.result).toBe('POTENTIAL_HIT')

    const queue = await authReq('get', '/api/v1/admin/compliance/ofac/screens', token).expect(200)
    expect(queue.body.items.some((item: any) => item.screen_id === first.screenId)).toBe(true)

    const cleared = await authReq('patch', `/api/v1/admin/compliance/ofac/screens/${first.screenId}`, token)
      .send({ disposition: 'CLEARED', reason: 'Confirmed different individual after manual review' })
      .expect(200)
    expect(cleared.body).toMatchObject({ disposition: 'CLEARED' })

    // A later bind-time screen for the same party name is auto-cleared based
    // on the reviewer's precedent instead of blocking bind again.
    const second = await screenOfac(q, tenantId, partyName, {})
    expect(second.result).toBe('CLEAR')

    const clearedQueue = await authReq('get', '/api/v1/admin/compliance/ofac/screens?disposition=CLEARED', token).expect(200)
    expect(clearedQueue.body.items.some((item: any) => item.screen_id === first.screenId)).toBe(true)
  })

  it('does not treat an automatic CLEAR screen as reviewer clearance for future SDN matches', async () => {
    const run = suffix()
    const partyName = `Later Listed Party ${run}`

    const first = await screenOfac(q, tenantId, partyName, {})
    expect(first.result).toBe('CLEAR')

    await getDb()!.query(
      `INSERT INTO ofac_sdn_list (name, normalized_name, aliases, country, list_type)
       VALUES ($1,$2,'[]'::jsonb,'XX','SDN')`,
      [partyName, `LATER LISTED PARTY ${run.toUpperCase()}`],
    )

    const second = await screenOfac(q, tenantId, partyName, {})
    expect(second.result).toBe('POTENTIAL_HIT')
  })

  it('carries forward a BLOCKED disposition to force future holds', async () => {
    const run = suffix()
    const partyName = `Blocked Test Party ${run}`

    await getDb()!.query(
      `INSERT INTO ofac_sdn_list (name, normalized_name, aliases, country, list_type)
       VALUES ($1,$2,'[]'::jsonb,'XX','SDN')`,
      [partyName, `BLOCKED TEST PARTY ${run.toUpperCase()}`],
    )

    await createUser({ username: `compliance-blocker-${run}`, password, tenantId, roles: ['admin'] })
    const token = await login(`compliance-blocker-${run}`)

    const first = await screenOfac(q, tenantId, partyName, {})
    expect(first.result).toBe('POTENTIAL_HIT')

    await authReq('patch', `/api/v1/admin/compliance/ofac/screens/${first.screenId}`, token)
      .send({ disposition: 'BLOCKED', reason: 'Confirmed match to sanctioned entity' })
      .expect(200)

    const second = await screenOfac(q, tenantId, partyName, {})
    expect(second.result).toBe('CONFIRMED_HIT')
  })
})
