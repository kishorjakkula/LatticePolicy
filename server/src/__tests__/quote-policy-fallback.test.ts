import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  initDb: vi.fn(() => Promise.resolve()),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn(),
}))

vi.mock('../cache.js', () => ({
  getCache: vi.fn(() => null),
  initCache: vi.fn(() => Promise.resolve()),
  closeCache: vi.fn(() => Promise.resolve()),
  cacheGetJson: vi.fn(() => Promise.resolve(null)),
  cacheSetJson: vi.fn(() => Promise.resolve()),
  cacheDeleteKey: vi.fn(() => Promise.resolve()),
  cacheDeletePrefix: vi.fn(() => Promise.resolve(0)),
  buildCacheKey: vi.fn((parts: any[]) => parts.filter(Boolean).join(':')),
  hashCacheInput: vi.fn(() => 'hash'),
}))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  httpLogger: (_req: any, _res: any, next: any) => next(),
  getRequestLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../openapi.js', () => ({
  buildOpenApiSpec: vi.fn(() => ({})),
  swaggerUiHtml: vi.fn(() => '<html/>'),
}))

vi.mock('../auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = {
      id: 'test-user',
      username: 'agent1',
      tenantId: req.header('X-User-Tenant') || req.header('X-Tenant') || undefined,
      roles: ['agent'],
      permissions: ['page.wizard.view', 'page.search.view', 'page.policy.view', 'customer.portal.read'],
    }
    next()
  },
  handleLogin: (_req: any, res: any) => res.json({ token: 'test-token' }),
  handleMfaVerify: (_req: any, res: any) => res.json({ ok: true }),
  handleMfaSetupConfirm: (_req: any, res: any) => res.json({ ok: true }),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
  hasPermission: () => true,
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import { createApp } from '../app.js'

function quotePayload(overrides: Record<string, any> = {}) {
  return {
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    risks: [{ type: 'autoVehicle', year: 2023, make: 'Toyota', model: 'Camry', garagingZip: '94105', symbol: 'A', usage: 'commute' }],
    coverages: [
      { code: 'BI', selected: true, limit: 100000 },
      { code: 'PD', selected: true, limit: 50000 },
    ],
    ...overrides,
  }
}

describe('quote and policy fallback API', () => {
  let app: ReturnType<typeof createApp>
  let tenantId: string

  beforeEach(() => {
    app = createApp()
    tenantId = `api-test-${crypto.randomUUID()}`
  })

  async function createBoundPolicy() {
    const quoteRes = await request(app)
      .post('/api/v1/quotes')
      .set('X-Tenant', tenantId)
      .send(quotePayload())

    expect(quoteRes.status).toBe(200)

    const bindRes = await request(app)
      .post(`/api/v1/quotes/${quoteRes.body.quoteId}/bind`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(bindRes.status).toBe(200)
    return bindRes.body as { policyId: string; policyNumber: string; status: string }
  }

  it('requires tenant context for versioned API routes', async () => {
    const res = await request(app).get('/api/v1/quotes')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('TENANT_REQUIRED')
  })

  it('rejects requests where authenticated tenant does not match request tenant', async () => {
    const res = await request(app)
      .get('/api/v1/quotes')
      .set('X-Tenant', tenantId)
      .set('X-User-Tenant', `${tenantId}-other`)

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('TENANT_MISMATCH')
  })

  it('creates, fetches, copies, and lists rated quotes in fallback mode', async () => {
    const createRes = await request(app)
      .post('/api/v1/quotes')
      .set('X-Tenant', tenantId)
      .send(quotePayload())

    expect(createRes.status).toBe(200)
    expect(createRes.body.quoteId).toBeTruthy()
    expect(createRes.body.status).toBe('Rated')
    expect(createRes.body.premium.total.amount).toBeGreaterThan(0)

    const getRes = await request(app)
      .get(`/api/v1/quotes/${createRes.body.quoteId}`)
      .set('X-Tenant', tenantId)

    expect(getRes.status).toBe(200)
    expect(getRes.body.id).toBe(createRes.body.quoteId)
    expect(getRes.body.payload.productCode).toBe('personal-auto')

    const copyRes = await request(app)
      .post(`/api/v1/quotes/${createRes.body.quoteId}/copy`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(copyRes.status).toBe(200)
    expect(copyRes.body.quoteId).toBeTruthy()
    expect(copyRes.body.quoteId).not.toBe(createRes.body.quoteId)

    const listRes = await request(app)
      .get('/api/v1/quotes')
      .query({ q: '', page: 1, pageSize: 20 })
      .set('X-Tenant', tenantId)

    expect(listRes.status).toBe(200)
    expect(listRes.body.total).toBeGreaterThanOrEqual(2)
    expect(listRes.body.items.map((item: any) => item.quoteId || item.id)).toContain(createRes.body.quoteId)
  })

  it('creates and updates draft quotes in fallback mode', async () => {
    const draftRes = await request(app)
      .post('/api/v1/quotes/draft')
      .set('X-Tenant', tenantId)
      .send({
        productCode: 'homeowners',
        effectiveDate: '2026-08-01',
        status: 'Draft',
        progressStep: 2,
        payload: quotePayload({ productCode: 'homeowners', risks: [{ type: 'dwelling', address: '1 Main St', construction: 'frame', yearBuilt: 2010 }] }),
      })

    expect(draftRes.status).toBe(200)
    expect(draftRes.body.status).toBe('Draft')
    expect(draftRes.body.progressStep).toBe(2)

    const patchRes = await request(app)
      .patch(`/api/v1/quotes/${draftRes.body.quoteId}/draft`)
      .set('X-Tenant', tenantId)
      .send({
        status: 'Draft',
        progressStep: 4,
        payload: quotePayload({ productCode: 'homeowners', effectiveDate: '2026-08-15', risks: [{ type: 'dwelling', address: '2 Main St', construction: 'masonry', yearBuilt: 2018 }] }),
      })

    expect(patchRes.status).toBe(200)
    expect(patchRes.body.quoteId).toBe(draftRes.body.quoteId)
    expect(patchRes.body.progressStep).toBe(4)
  })

  it('binds a rated quote and exposes the resulting policy in fallback mode', async () => {
    const quoteRes = await request(app)
      .post('/api/v1/quotes')
      .set('X-Tenant', tenantId)
      .send(quotePayload())

    const bindRes = await request(app)
      .post(`/api/v1/quotes/${quoteRes.body.quoteId}/bind`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(bindRes.status).toBe(200)
    expect(bindRes.body.policyId).toBeTruthy()
    expect(bindRes.body.policyNumber).toBeTruthy()
    expect(bindRes.body.status).toBe('Bound')

    const policyRes = await request(app)
      .get(`/api/v1/policies/${bindRes.body.policyId}`)
      .set('X-Tenant', tenantId)

    expect(policyRes.status).toBe(200)
    expect(policyRes.body.policyId).toBe(bindRes.body.policyId)
    expect(policyRes.body.policyNumber).toBe(bindRes.body.policyNumber)
    expect(policyRes.body.status).toBe('Bind')

    const listRes = await request(app)
      .get('/api/v1/policies')
      .set('X-Tenant', tenantId)
      .query({ q: bindRes.body.policyNumber, page: 1, pageSize: 20 })

    expect(listRes.status).toBe(200)
    expect(listRes.body.total).toBe(1)
    expect(listRes.body.items[0].policyId).toBe(bindRes.body.policyId)
  })

  it('keeps fallback policies isolated by tenant for detail, state, versions, and transactions', async () => {
    const policy = await createBoundPolicy()
    const otherTenant = `${tenantId}-other`

    const detailRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}`)
      .set('X-Tenant', otherTenant)

    expect(detailRes.status).toBe(404)
    expect(detailRes.body.code).toBe('POLICY_NOT_FOUND')

    const stateRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}/state`)
      .set('X-Tenant', otherTenant)

    expect(stateRes.status).toBe(404)
    expect(stateRes.body.code).toBe('POLICY_NOT_FOUND')

    const versionsRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}/versions`)
      .set('X-Tenant', otherTenant)

    expect(versionsRes.status).toBe(404)
    expect(versionsRes.body.code).toBe('POLICY_NOT_FOUND')

    const issueRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/issue`)
      .set('X-Tenant', otherTenant)
      .send({})

    expect(issueRes.status).toBe(404)
    expect(issueRes.body.code).toBe('POLICY_NOT_FOUND')

    const listRes = await request(app)
      .get('/api/v1/policies')
      .set('X-Tenant', otherTenant)
      .query({ q: policy.policyNumber, page: 1, pageSize: 20 })

    expect(listRes.status).toBe(200)
    expect(listRes.body.total).toBe(0)
    expect(listRes.body.items).toEqual([])
  })

  it('rejects invalid quote payloads before rating', async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('X-Tenant', tenantId)
      .send({ productCode: 'personal-auto' })

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_QUOTE')
  })

  it('issues bound policies and exposes fallback policy state and versions', async () => {
    const policy = await createBoundPolicy()

    const issueRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/issue`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(issueRes.status).toBe(200)
    expect(issueRes.body).toMatchObject({
      policyId: policy.policyId,
      policyNumber: policy.policyNumber,
      status: 'Issued',
    })

    const stateRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}/state`)
      .query({ asOf: '2026-08-01' })
      .set('X-Tenant', tenantId)

    expect(stateRes.status).toBe(200)
    expect(stateRes.body.ok).toBe(true)
    expect(stateRes.body.data.policyId).toBe(policy.policyId)
    expect(stateRes.body.data.asOf).toBe('2026-08-01')
    expect(stateRes.body.data.premium.total.amount).toBeGreaterThan(0)

    const versionsRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}/versions`)
      .set('X-Tenant', tenantId)

    expect(versionsRes.status).toBe(200)
    expect(versionsRes.body.ok).toBe(true)
    expect(versionsRes.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionType: 'Issue',
          policyEffectiveDate: '2026-07-01',
          updatedUser: 'system',
        }),
      ])
    )
  })

  it('reserves transaction numbers and validates reservation modes', async () => {
    const policy = await createBoundPolicy()

    const endorseRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/endorse/reserve-number`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(endorseRes.status).toBe(200)
    expect(endorseRes.body.transactionNumber).toMatch(/^EN-/)

    const cancelRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/transactions/reserve-number`)
      .set('X-Tenant', tenantId)
      .send({ mode: 'cancel' })

    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.transactionNumber).toMatch(/^CN-/)

    const invalidRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/transactions/reserve-number`)
      .set('X-Tenant', tenantId)
      .send({ mode: 'void' })

    expect(invalidRes.status).toBe(400)
    expect(invalidRes.body.code).toBe('INVALID_MODE')
  })

  it('cancels and reinstates issued policies with state validation', async () => {
    const policy = await createBoundPolicy()
    await request(app)
      .post(`/api/v1/policies/${policy.policyId}/issue`)
      .set('X-Tenant', tenantId)
      .send({})
      .expect(200)

    const cancelRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/cancel`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-10-01', reason: 'insured request' })

    expect(cancelRes.status).toBe(200)
    expect(cancelRes.body.transactionType).toBe('Cancel')
    expect(cancelRes.body.transactionNumber).toMatch(/^CN-/)
    expect(cancelRes.body.premium.total.amount).toBeLessThanOrEqual(0)

    const duplicateCancelRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/cancel`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-10-15', reason: 'duplicate' })

    expect(duplicateCancelRes.status).toBe(400)
    expect(duplicateCancelRes.body.code).toBe('INVALID_STATE')

    const reinstateRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/reinstate`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-10-15', reason: 'payment restored' })

    expect(reinstateRes.status).toBe(200)
    expect(reinstateRes.body.transactionType).toBe('Reinstate')
    expect(reinstateRes.body.transactionNumber).toMatch(/^RI-/)
    expect(reinstateRes.body.premium.total.amount).toBeGreaterThanOrEqual(0)
  })

  it('previews renewal, renews policies, and records non-renewal notices', async () => {
    const policy = await createBoundPolicy()
    await request(app)
      .post(`/api/v1/policies/${policy.policyId}/issue`)
      .set('X-Tenant', tenantId)
      .send({})
      .expect(200)

    const previewRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/renew/preview`)
      .set('X-Tenant', tenantId)
      .send({})

    expect(previewRes.status).toBe(200)
    expect(previewRes.body.nextEffectiveDate).toBe('2027-07-01')
    expect(previewRes.body.nextExpirationDate).toBe('2028-07-01')
    expect(previewRes.body.premium.total.amount).toBeGreaterThan(0)

    const renewRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/renew`)
      .set('X-Tenant', tenantId)
      .send({ transactionNumber: 'RN-TEST' })

    expect(renewRes.status).toBe(200)
    expect(renewRes.body.transactionType).toBe('Renew')
    expect(renewRes.body.transactionNumber).toBe('RN-TEST')

    const nonRenewRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/non-renew`)
      .set('X-Tenant', tenantId)
      .send({ noticeDate: '2027-01-01', reasonCode: 'UNDERWRITING' })

    expect(nonRenewRes.status).toBe(200)
    expect(nonRenewRes.body).toMatchObject({
      ok: true,
      policyId: policy.policyId,
      reasonCode: 'UNDERWRITING',
    })
  })

  it('rewrites cancelled policies and reports database-only fallback boundaries', async () => {
    const policy = await createBoundPolicy()
    await request(app)
      .post(`/api/v1/policies/${policy.policyId}/issue`)
      .set('X-Tenant', tenantId)
      .send({})
      .expect(200)
    await request(app)
      .post(`/api/v1/policies/${policy.policyId}/cancel`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-10-01', reason: 'insured request' })
      .expect(200)

    const rewriteRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/rewrite`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-11-01', transactionNumber: 'RW-TEST' })

    expect(rewriteRes.status).toBe(200)
    expect(rewriteRes.body.transactionType).toBe('Rewrite')
    expect(rewriteRes.body.transactionNumber).toBe('RW-TEST')
    expect(rewriteRes.body.premium.total.amount).toBeGreaterThan(0)

    const endorsePreviewRes = await request(app)
      .post(`/api/v1/policies/${policy.policyId}/endorse/preview`)
      .set('X-Tenant', tenantId)
      .send({ effectiveDate: '2026-12-01', changes: [] })

    expect(endorsePreviewRes.status).toBe(400)
    expect(endorsePreviewRes.body.code).toBe('NO_DB')

    const timelineRes = await request(app)
      .get(`/api/v1/policies/${policy.policyId}/timeline`)
      .set('X-Tenant', tenantId)

    expect(timelineRes.status).toBe(501)
    expect(timelineRes.body.code).toBe('NO_DB')
  })

  it('reports customer portal as database-only in fallback mode', async () => {
    const summaryRes = await request(app)
      .get('/api/v1/customer-portal/summary')
      .set('X-Tenant', tenantId)

    expect(summaryRes.status).toBe(501)
    expect(summaryRes.body.code).toBe('NO_DB')

    const detailRes = await request(app)
      .get(`/api/v1/customer-portal/policies/${crypto.randomUUID()}`)
      .set('X-Tenant', tenantId)

    expect(detailRes.status).toBe(501)
    expect(detailRes.body.code).toBe('NO_DB')
  })
})
