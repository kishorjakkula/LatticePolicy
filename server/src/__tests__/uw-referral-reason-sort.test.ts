import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'

// WP-0004 REQ-1 / REQ-17. Unlike uw-referral-routes.test.ts, the real referral
// service runs here behind a scripted query function, so the assertions cover
// the service rules the three decide routes share (reason required for
// Approved/Declined) and the list sort, without a database. The real-database
// behaviour is covered in uw-referral.integration.test.ts.
vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { AppError } from '../errors/domain.errors.js'
import { tenancyMiddleware, requireTenant } from '../tenancy.js'
import { uwRoutes } from '../routes/uw.routes.js'
import { defaultReferralSort, listReferrals } from '../services/uw-referral.service.js'

const UW_DECIDER = {
  id: '33333333-3333-4333-a333-333333333333',
  username: 'uw-decider',
  tenantId: 'sample-carrier',
  roles: [] as string[],
  permissions: ['uw.referrals.read', 'uw.referrals.decide']
}

const REFERRAL_ID = '55555555-5555-4555-a555-555555555555'

type Call = { sql: string; params: any[] }
let calls: Call[] = []
let referralRow: Record<string, any> | null

function scriptedQuery() {
  return async (sql: string, params: any[] = []) => {
    calls.push({ sql, params })
    if (/^\s*SELECT \* FROM underwriting_referrals WHERE tenant_id=\$1 AND referral_id=\$2/.test(sql)) {
      const match = referralRow && params[0] === referralRow.tenant_id && params[1] === referralRow.referral_id
      return { rows: match ? [referralRow] : [], rowCount: match ? 1 : 0 }
    }
    if (/^\s*UPDATE underwriting_referrals/.test(sql)) {
      const updated = { ...referralRow, status: params[0], decision: params[0], decision_reason: params[2] }
      return { rows: [updated], rowCount: 1 }
    }
    if (/count\(\*\)/.test(sql)) return { rows: [{ total: 0 }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = { ...UW_DECIDER } as any
    next()
  })
  app.use(tenancyMiddleware)
  app.use('/api/v1', requireTenant, uwRoutes)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ code: err.code, message: err.message })
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message })
  })
  return app
}

function updates() {
  return calls.filter((call) => /^\s*UPDATE underwriting_referrals/.test(call.sql))
}

beforeEach(() => {
  vi.clearAllMocks()
  calls = []
  referralRow = {
    referral_id: REFERRAL_ID,
    tenant_id: 'sample-carrier',
    status: 'Open',
    reasons: ['Annual miles > 35k (refer)'],
    comments: []
  }
  vi.mocked(getDb).mockReturnValue({} as any)
  vi.mocked(withTenantTx).mockImplementation(async (_tenantId: string, fn: any) => fn({} as any))
  vi.mocked(toRawQuery).mockImplementation(() => scriptedQuery() as any)
})

const DECISION_ROUTES = [
  { label: '/decide Approved', path: 'decide', body: { decision: 'Approved' } },
  { label: '/decide Declined', path: 'decide', body: { decision: 'Declined' } },
  { label: '/approve', path: 'approve', body: {} },
  { label: '/decline', path: 'decline', body: {} }
]

describe('reason required for Approved and Declined (all decide routes)', () => {
  const BLANK_REASONS: Array<[string, Record<string, unknown>]> = [
    ['missing', {}],
    ['empty', { reason: '' }],
    ['whitespace only', { reason: '   \n\t ' }],
    ['null', { reason: null }],
    // The old e2e helper sent "notes"; a reason under another key is not a reason.
    ['sent under another key', { notes: 'Verified payment plan' }]
  ]

  for (const route of DECISION_ROUTES) {
    it.each(BLANK_REASONS)(`${route.label}: returns 400 REASON_REQUIRED when the reason is %s`, async (_label, extra) => {
      const res = await request(buildApp())
        .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/${route.path}`)
        .set('X-Tenant', 'sample-carrier')
        .send({ ...route.body, ...extra })

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('REASON_REQUIRED')
      expect(updates()).toHaveLength(0)
    })

    it(`${route.label}: records a trimmed reason`, async () => {
      const res = await request(buildApp())
        .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/${route.path}`)
        .set('X-Tenant', 'sample-carrier')
        .send({ ...route.body, reason: '  Reviewed loss history  ' })

      expect(res.status).toBe(200)
      expect(updates()).toHaveLength(1)
      expect(updates()[0].params[2]).toBe('Reviewed loss history')
    })
  }

  it('keeps the comment optional for InfoRequested', async () => {
    const res = await request(buildApp())
      .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/decide`)
      .set('X-Tenant', 'sample-carrier')
      .send({ decision: 'InfoRequested' })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('InfoRequested')
    expect(updates()).toHaveLength(1)
    expect(updates()[0].params[2]).toBeNull()
  })

  it('keeps AUTHORITY_OVERRIDE_REQUIRED for an authority referral approved without override permission', async () => {
    referralRow!.reasons = ['AUTHORITY_LIMIT_AUTHORITY_EXCEEDED']
    const res = await request(buildApp())
      .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/approve`)
      .set('X-Tenant', 'sample-carrier')
      .send({ reason: 'Within appetite' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('AUTHORITY_OVERRIDE_REQUIRED')
    expect(updates()).toHaveLength(0)
  })

  it('keeps the authority 403 (not 400) when an authority referral is approved with a blank reason', async () => {
    referralRow!.reasons = ['AUTHORITY_LIMIT_AUTHORITY_EXCEEDED']
    const res = await request(buildApp())
      .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/decide`)
      .set('X-Tenant', 'sample-carrier')
      .send({ decision: 'Approved', reason: ' ' })

    expect(res.status).toBe(403)
    expect(res.body.code).toBe('AUTHORITY_OVERRIDE_REQUIRED')
  })

  it("returns 404 for a referral id that is not in the caller's tenant, with no update", async () => {
    referralRow!.tenant_id = 'other-carrier'
    const res = await request(buildApp())
      .patch(`/api/v1/uw/referrals/${REFERRAL_ID}/decline`)
      .set('X-Tenant', 'sample-carrier')
      .send({ reason: 'Outside appetite' })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('REFERRAL_NOT_FOUND')
    expect(updates()).toHaveLength(0)
  })
})

describe('GET /uw/referrals sort', () => {
  function listSql() {
    return calls.find((call) => call.sql.includes('FROM underwriting_referrals r'))!.sql
  }

  it.each([
    ['random'],
    ['OLDEST'],
    ['created_at; DROP TABLE underwriting_referrals'],
    ['']
  ])('returns 400 INVALID_SORT for sort=%s without querying', async (sort) => {
    const res = await request(buildApp())
      .get('/api/v1/uw/referrals')
      .query({ status: 'Open', sort })
      .set('X-Tenant', 'sample-carrier')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_SORT')
    expect(calls.some((call) => call.sql.includes('underwriting_referrals'))).toBe(false)
  })

  it('rejects a repeated sort parameter', async () => {
    const res = await request(buildApp())
      .get('/api/v1/uw/referrals?sort=oldest&sort=newest')
      .set('X-Tenant', 'sample-carrier')

    expect(res.status).toBe(400)
    expect(res.body.code).toBe('INVALID_SORT')
  })

  it('defaults to oldest first for Open', async () => {
    const res = await request(buildApp())
      .get('/api/v1/uw/referrals?status=Open')
      .set('X-Tenant', 'sample-carrier')

    expect(res.status).toBe(200)
    expect(res.body.sort).toBe('oldest')
    expect(listSql()).toContain('ORDER BY r.created_at ASC')
  })

  it.each([['Approved'], ['Declined'], ['InfoRequested'], [undefined]])('defaults to newest first for status=%s', async (status) => {
    const res = await request(buildApp())
      .get('/api/v1/uw/referrals')
      .query(status ? { status } : {})
      .set('X-Tenant', 'sample-carrier')

    expect(res.status).toBe(200)
    expect(res.body.sort).toBe('newest')
    expect(listSql()).toContain('ORDER BY r.created_at DESC')
  })

  it('honours an explicit sort over the status default', async () => {
    const res = await request(buildApp())
      .get('/api/v1/uw/referrals?status=Open&sort=newest')
      .set('X-Tenant', 'sample-carrier')

    expect(res.status).toBe(200)
    expect(res.body.sort).toBe('newest')
    expect(listSql()).toContain('ORDER BY r.created_at DESC')
  })

  it('scopes every premium join to the tenant', async () => {
    await request(buildApp()).get('/api/v1/uw/referrals?status=Open').set('X-Tenant', 'sample-carrier')
    const sql = listSql()
    expect(sql).toMatch(/v\.tenant_id = r\.tenant_id AND v\.policy_id = r\.policy_id/)
    expect(sql).toMatch(/qt\.quote_id = r\.quote_id AND qt\.tenant_id = r\.tenant_id/)
    expect(sql).toMatch(/p\.policy_id = r\.policy_id AND p\.tenant_id = r\.tenant_id/)
  })
})

describe('listReferrals premium', () => {
  async function listWith(rows: any[]) {
    vi.mocked(toRawQuery).mockImplementation(() => (async (sql: string) =>
      /count\(\*\)/.test(sql) ? { rows: [{ total: rows.length }] } : { rows }) as any)
    return listReferrals({} as any, 'sample-carrier', { status: 'Open', page: 1, pageSize: 20 })
  }

  it('uses the latest policy version premium when the referral has a policy', async () => {
    const result = await listWith([{
      referral_id: 'r1', latest_premium_amount: '1234.50', latest_premium_currency: 'usd',
      quote_premium: { total: { amount: 999, currency: 'USD' } }
    }])
    expect(result.items[0].premium).toEqual({ amount: 1234.5, currency: 'USD' })
  })

  it('falls back to the rated quote total for a pre-bind referral', async () => {
    const result = await listWith([{ referral_id: 'r1', latest_premium_amount: null, quote_premium: { total: { amount: 775.21, currency: 'USD' } } }])
    expect(result.items[0].premium).toEqual({ amount: 775.21, currency: 'USD' })
  })

  it.each([
    ['no policy and no quote', { latest_premium_amount: null, quote_premium: null }],
    ['an unrated quote', { latest_premium_amount: null, quote_premium: {} }],
    ['a non-numeric quote total', { latest_premium_amount: null, quote_premium: { total: { amount: 'n/a', currency: 'USD' } } }]
  ])('returns null for %s', async (_label, row) => {
    const result = await listWith([{ referral_id: 'r1', ...row }])
    expect(result.items[0].premium).toBeNull()
  })

  it('keeps pagination fields', async () => {
    const result = await listWith([])
    expect(result).toMatchObject({ items: [], total: 0, page: 1, pageSize: 20, sort: 'oldest' })
  })

  it('defaultReferralSort is oldest only for Open', () => {
    expect(defaultReferralSort('Open')).toBe('oldest')
    expect(defaultReferralSort('InfoRequested')).toBe('newest')
    expect(defaultReferralSort(null)).toBe('newest')
  })
})
