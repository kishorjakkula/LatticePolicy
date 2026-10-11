import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// Mock all the heavy dependencies so we can test the health endpoint in isolation
vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  initDb: vi.fn(() => Promise.resolve()),
  getSchemaStatus: vi.fn(),
  withTenantTx: vi.fn()
}))
vi.mock('../cache.js', () => ({
  getCache: vi.fn(() => null),
  initCache: vi.fn(() => Promise.resolve()),
  closeCache: vi.fn(() => Promise.resolve()),
  cacheGetJson: vi.fn(() => Promise.resolve(null)),
  cacheSetJson: vi.fn(() => Promise.resolve()),
  cacheDeleteKey: vi.fn(() => Promise.resolve()),
  cacheDeletePrefix: vi.fn(() => Promise.resolve(0))
}))
vi.mock('../auth.js', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  issueDocsToken: () => 'docs-token',
  handleLogin: (_req: any, res: any) => res.json({ token: 'test' }),
  handleMfaVerify: (_req: any, res: any) => res.json({}),
  handleMfaSetupConfirm: (_req: any, res: any) => res.json({})
}))
vi.mock('../tenancy.js', () => ({
  tenancyMiddleware: (_req: any, _res: any, next: any) => next(),
  requireTenant: (_req: any, _res: any, next: any) => next()
}))
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  httpLogger: (_req: any, _res: any, next: any) => next()
}))
vi.mock('../routes/index.js', () => ({ routes: express.Router() }))
vi.mock('../admin.js', () => ({ adminRoutes: express.Router() }))
vi.mock('../ratingWorkbench.js', () => ({ ratingRoutes: express.Router() }))
vi.mock('../customerPortal.js', () => ({ customerPortalRoutes: express.Router() }))
vi.mock('../policyInterests.js', () => ({ interestsRoutes: express.Router() }))
vi.mock('../openapi.js', () => ({
  buildOpenApiSpec: vi.fn(() => ({})),
  swaggerUiHtml: vi.fn(() => '<html/>')
}))

import { createApp, createProbeApp } from '../app.js'
import { getDb, getSchemaStatus } from '../db.js'
import { getCache } from '../cache.js'

describe('GET /version', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the release version and schema level without authentication', async () => {
    vi.mocked(getSchemaStatus).mockResolvedValue({ appliedVersion: 58, releaseVersion: 58, schemaAhead: false })
    const res = await request(createApp()).get('/version')
    expect(res.status).toBe(200)
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(res.body).toHaveProperty('commit')
    expect(res.body.schema).toEqual({ appliedVersion: 58, releaseVersion: 58, schemaAhead: false })
  })

  it('still answers when the schema level cannot be read', async () => {
    vi.mocked(getSchemaStatus).mockRejectedValue(new Error('connection refused'))
    const res = await request(createApp()).get('/version')
    expect(res.status).toBe(200)
    expect(res.body.schema).toEqual({ appliedVersion: null, releaseVersion: null, schemaAhead: false })
  })
})

describe('probe-only app for worker and dispatcher processes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('answers /health and /version and nothing else', async () => {
    vi.mocked(getDb).mockReturnValue({ query: vi.fn().mockResolvedValue({ rows: [] }) } as any)
    vi.mocked(getCache).mockReturnValue(null)
    vi.mocked(getSchemaStatus).mockResolvedValue({ appliedVersion: 58, releaseVersion: 58, schemaAhead: false })
    const app = createProbeApp()

    const health = await request(app).get('/health')
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ status: 'ok', db: true })

    const version = await request(app).get('/version')
    expect(version.status).toBe(200)
    expect(version.body).toMatchObject({ role: 'all', schema: { appliedVersion: 58 } })

    for (const path of ['/api/v1/policies', '/auth/login', '/openapi.json']) {
      const res = await request(app).post(path).send({})
      expect(res.status, path).toBe(404)
    }
  })
})

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 503 with degraded status when DB is unavailable', async () => {
    vi.mocked(getDb).mockReturnValue(null)
    vi.mocked(getCache).mockReturnValue(null)
    const app = createApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body).toMatchObject({ status: 'degraded', db: false, cache: false })
    expect(res.body).toHaveProperty('ts')
  })

  it('returns 200 with ok status when DB is available', async () => {
    const mockPool = { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) }
    vi.mocked(getDb).mockReturnValue(mockPool as any)
    vi.mocked(getCache).mockReturnValue(null)
    const app = createApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'ok', db: true, cache: false })
  })

  it('returns degraded if DB query throws', async () => {
    const mockPool = { query: vi.fn().mockRejectedValue(new Error('connection refused')) }
    vi.mocked(getDb).mockReturnValue(mockPool as any)
    vi.mocked(getCache).mockReturnValue(null)
    const app = createApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(503)
    expect(res.body.db).toBe(false)
  })
})
