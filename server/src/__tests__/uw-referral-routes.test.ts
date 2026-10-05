import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'

// Keep this test at the route layer: the database and the referral service are
// stubbed so the assertions are about request validation, permission
// enforcement, and tenant scoping rather than persistence. The DB-backed
// referral workflow is covered by uw-referral.integration.test.ts.
vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

vi.mock('../services/uw-referral.service.js', () => ({
  listReferrals: vi.fn(),
  getReferral: vi.fn(),
  assignReferral: vi.fn(),
  addReferralComment: vi.fn(),
  decideReferral: vi.fn()
}))

import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { decideReferral } from '../services/uw-referral.service.js'
import { AppError } from '../errors/domain.errors.js'
import { tenancyMiddleware, requireTenant } from '../tenancy.js'
import { uwRoutes } from '../routes/uw.routes.js'

type TestUser = {
  id: string
  username: string
  tenantId: string
  roles: string[]
  permissions?: string[]
}

// Role-based identities resolve their permissions through the real RBAC role
// map (see lib/rbac.ts). `underwriter` carries uw.referrals.decide; `agent`
// carries neither uw.referrals permission.
const UNDERWRITER_ROLE: TestUser = {
  id: '22222222-2222-4222-a222-222222222222',
  username: 'uw1',
  tenantId: 'sample-carrier',
  roles: ['underwriter']
}

const AGENT_ROLE: TestUser = {
  id: '11111111-1111-4111-a111-111111111111',
  username: 'agent1',
  tenantId: 'sample-carrier',
  roles: ['agent']
}

// Token-scoped identities carry explicit permission codes and no roles, the
// way issueToken() embeds them. Permission resolution short-circuits for these,
// so they keep the decide/validate assertions independent of RBAC storage.
const UW_DECIDER: TestUser = {
  id: '33333333-3333-4333-a333-333333333333',
  username: 'uw-decider',
  tenantId: 'sample-carrier',
  roles: [],
  permissions: ['uw.referrals.read', 'uw.referrals.decide']
}

const UW_VIEWER: TestUser = {
  id: '44444444-4444-4444-a444-444444444444',
  username: 'uw-viewer',
  tenantId: 'sample-carrier',
  roles: [],
  permissions: ['uw.referrals.read']
}

// Mirrors the production middleware order in app.ts: auth populates req.user,
// tenancy derives req.tenant from X-Tenant, then requireTenant guards the API.
function buildApp(user: TestUser | null) {
  const app = express()
  app.use(express.json())
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (user) req.user = { ...user } as any
    next()
  })
  app.use(tenancyMiddleware)
  app.use('/api/v1', requireTenant, uwRoutes)
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ code: err.code, message: err.message })
    }
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' })
  })
  return app
}

const REFERRAL_ID = 'ref-1001'
const DECIDE_URL = `/api/v1/uw/referrals/${REFERRAL_ID}/decide`

describe('PATCH /uw/referrals/:referralId/decide', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getDb).mockReturnValue(null)
    vi.mocked(toRawQuery).mockReturnValue((async () => ({ rows: [] })) as any)
  })

  // Turns on database mode so a request can reach the referral service.
  function withDatabase() {
    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(withTenantTx).mockImplementation(async (_tenantId: string, fn: any) => fn({} as any))
  }

  describe('authorization', () => {
    it('returns 401 when the request is unauthenticated', async () => {
      const res = await request(buildApp(null))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'Approved' })

      expect(res.status).toBe(401)
      expect(res.body.code).toBe('UNAUTHENTICATED')
      expect(decideReferral).not.toHaveBeenCalled()
    })

    it('returns 403 for the agent role, which lacks uw.referrals.decide', async () => {
      const res = await request(buildApp(AGENT_ROLE))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'Approved' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('FORBIDDEN')
      expect(res.body.message).toContain('uw.referrals.decide')
      expect(decideReferral).not.toHaveBeenCalled()
    })

    it('lets the underwriter role past the decide permission gate', async () => {
      const res = await request(buildApp(UNDERWRITER_ROLE))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'Approved' })

      // The permission gate passes, so the request reaches the route's own
      // database-mode guard instead of being rejected as forbidden.
      expect(res.status).not.toBe(403)
      expect(res.body.code).toBe('NO_DB')
    })

    it('does not let uw.referrals.read alone authorize a decision', async () => {
      const app = buildApp(UW_VIEWER)

      const readRes = await request(app)
        .get('/api/v1/uw/referrals')
        .set('X-Tenant', 'sample-carrier')
      expect(readRes.status).toBe(200)

      const decideRes = await request(app)
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'Approved' })

      expect(decideRes.status).toBe(403)
      expect(decideRes.body.code).toBe('FORBIDDEN')
      expect(decideReferral).not.toHaveBeenCalled()
    })

    it('rejects the request before validating the payload', async () => {
      const res = await request(buildApp(AGENT_ROLE))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'NotADecision' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('FORBIDDEN')
    })
  })

  describe('request validation', () => {
    it.each([
      ['an unsupported decision', { decision: 'Maybe' }],
      ['an empty decision', { decision: '  ' }],
      ['a missing decision', {}],
      ['a lowercase decision', { decision: 'approved' }]
    ])('returns 400 for %s', async (_label, body) => {
      const res = await request(buildApp(UW_DECIDER))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send(body)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('INVALID_DECISION')
      expect(decideReferral).not.toHaveBeenCalled()
    })

    it.each(['Approved', 'Declined', 'InfoRequested'])(
      'accepts the supported decision %s',
      async (decision) => {
        withDatabase()
        vi.mocked(decideReferral).mockResolvedValue({ referralId: REFERRAL_ID, status: decision } as any)

        const res = await request(buildApp(UW_DECIDER))
          .patch(DECIDE_URL)
          .set('X-Tenant', 'sample-carrier')
          .send({ decision, reason: 'Reviewed by underwriting' })

        expect(res.status).toBe(200)
        expect(res.body).toEqual({ referralId: REFERRAL_ID, status: decision })
        expect(decideReferral).toHaveBeenCalledWith(
          expect.anything(),
          'sample-carrier',
          REFERRAL_ID,
          expect.objectContaining({ decision, reason: 'Reviewed by underwriting', isUnderwriter: true })
        )
      }
    )
  })

  describe('tenant scoping', () => {
    it('runs the decision inside the requested tenant transaction', async () => {
      withDatabase()
      vi.mocked(decideReferral).mockResolvedValue({ referralId: REFERRAL_ID } as any)

      await request(buildApp(UW_DECIDER))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'sample-carrier')
        .send({ decision: 'Approved' })

      expect(withTenantTx).toHaveBeenCalledWith('sample-carrier', expect.any(Function))
      expect(decideReferral).toHaveBeenCalledWith(
        expect.anything(),
        'sample-carrier',
        REFERRAL_ID,
        expect.objectContaining({ decidedBy: UW_DECIDER.id })
      )
    })

    it('returns 403 when the request tenant differs from the token tenant', async () => {
      const res = await request(buildApp(UW_DECIDER))
        .patch(DECIDE_URL)
        .set('X-Tenant', 'other-carrier')
        .send({ decision: 'Approved' })

      expect(res.status).toBe(403)
      expect(res.body.code).toBe('TENANT_MISMATCH')
      expect(withTenantTx).not.toHaveBeenCalled()
      expect(decideReferral).not.toHaveBeenCalled()
    })
  })
})
