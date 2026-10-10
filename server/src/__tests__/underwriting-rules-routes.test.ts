import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'
import type { Request, Response, NextFunction } from 'express'

// Route-layer test: the database is stubbed with an in-memory single-row
// "table" so assertions stay focused on how the PATCH handler translates a
// request body into column values -- specifically, whether it can clear a
// nullable column (state_code, expiration_date) back to null, versus leaving
// it untouched when the field is omitted from the request.
vi.mock('../db.js', () => ({
  getDb: vi.fn(),
  withTenantTx: vi.fn(),
  toRawQuery: vi.fn()
}))

import { getDb, withTenantTx, toRawQuery } from '../db.js'
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

const ADMIN: TestUser = {
  id: '55555555-5555-4555-a555-555555555555',
  username: 'admin1',
  tenantId: 'sample-carrier',
  roles: [],
  permissions: ['admin.underwriting_rules.read', 'admin.underwriting_rules.manage']
}

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

const RULE_ID = '66666666-6666-4666-a666-666666666666'
const RULE_URL = `/api/v1/admin/underwriting-rules/${RULE_ID}`

describe('PATCH /admin/underwriting-rules/:ruleId', () => {
  let storedRule: Record<string, any>

  beforeEach(() => {
    vi.clearAllMocks()
    storedRule = {
      rule_id: RULE_ID,
      tenant_id: 'sample-carrier',
      product_code: 'homeowners',
      state_code: 'CA',
      field_path: 'risks[0].roofAgeYears',
      operator: 'greater_than',
      comparison_value: 25,
      outcome: 'Refer',
      reason_code: 'HO-ROOF-AGE',
      reason_description: 'Roof age > 25 (refer)',
      active: true,
      effective_date: '2026-01-01',
      expiration_date: '2026-12-31'
    }

    vi.mocked(getDb).mockReturnValue({} as any)
    vi.mocked(withTenantTx).mockImplementation(async (_tenantId: string, fn: any) => fn({} as any))
    vi.mocked(toRawQuery).mockReturnValue((async (sql: string, params: any[]) => {
      // hydratePermissions' role lookup also goes through this mock; it
      // matches neither branch below and falls through to an empty result,
      // which is fine since the test user's permissions come from the token
      // (req.user.permissions), not a DB role lookup.
      if (sql.includes('SELECT * FROM underwriting_rules') && sql.includes('FOR UPDATE')) {
        return { rows: [storedRule], rowCount: 1 }
      }
      if (sql.includes('UPDATE underwriting_rules SET')) {
        const [, , nextStateCode, nextFieldPath, nextOperator, nextComparisonValue,
          nextOutcome, nextReasonCode, nextReasonDescription, nextActive,
          nextEffectiveDate, nextExpirationDate] = params
        storedRule = {
          ...storedRule,
          state_code: nextStateCode,
          field_path: nextFieldPath,
          operator: nextOperator,
          comparison_value: JSON.parse(nextComparisonValue),
          outcome: nextOutcome,
          reason_code: nextReasonCode,
          reason_description: nextReasonDescription,
          active: nextActive,
          effective_date: nextEffectiveDate,
          expiration_date: nextExpirationDate
        }
        return { rows: [storedRule], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }) as any)
  })

  it('clears stateCode back to "all states" (null) when the admin explicitly sends null', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(RULE_URL)
      .set('X-Tenant', 'sample-carrier')
      .send({ stateCode: null })

    expect(res.status).toBe(200)
    expect(res.body.state_code).toBeNull()
  })

  it('leaves stateCode untouched when the field is omitted from the request', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(RULE_URL)
      .set('X-Tenant', 'sample-carrier')
      .send({ active: false })

    expect(res.status).toBe(200)
    expect(res.body.state_code).toBe('CA')
    expect(res.body.active).toBe(false)
  })

  it('clears expirationDate when the admin explicitly sends null', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(RULE_URL)
      .set('X-Tenant', 'sample-carrier')
      .send({ expirationDate: null })

    expect(res.status).toBe(200)
    expect(res.body.expiration_date).toBeNull()
  })

  it('leaves expirationDate untouched when the field is omitted', async () => {
    const res = await request(buildApp(ADMIN))
      .patch(RULE_URL)
      .set('X-Tenant', 'sample-carrier')
      .send({ reasonDescription: 'Updated description' })

    expect(res.status).toBe(200)
    expect(res.body.expiration_date).toBe('2026-12-31')
    expect(res.body.reason_description).toBe('Updated description')
  })

  it('returns 404 for a rule that does not exist', async () => {
    vi.mocked(toRawQuery).mockReturnValue((async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [], rowCount: 0 }
      return { rows: [], rowCount: 0 }
    }) as any)

    const res = await request(buildApp(ADMIN))
      .patch(RULE_URL)
      .set('X-Tenant', 'sample-carrier')
      .send({ active: false })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })
})
