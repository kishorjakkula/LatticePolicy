import { describe, it, expect, vi, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../db.js', () => ({
  getDb: vi.fn(() => null),
  initDb: vi.fn(),
  withTenantTx: vi.fn()
}))
vi.mock('../cache.js', () => ({
  getCache: vi.fn(() => null),
  initCache: vi.fn(),
  closeCache: vi.fn(),
  cacheGetJson: vi.fn(() => null),
  cacheSetJson: vi.fn(),
  cacheDeleteKey: vi.fn(),
  cacheDeletePrefix: vi.fn(() => 0)
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
vi.mock('../openapi.js', () => ({ buildOpenApiSpec: vi.fn(() => ({})), swaggerUiHtml: vi.fn(() => '') }))

// Mock auth to control login behavior
vi.mock('../auth.js', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  handleLogin: vi.fn((_req: any, res: any) => res.json({ token: 'valid-token', user: { id: '1', username: 'test' } })),
  handleMfaVerify: vi.fn((_req: any, res: any) => res.json({ ok: true })),
  handleMfaSetupConfirm: vi.fn((_req: any, res: any) => res.json({ ok: true }))
}))

import { createApp } from '../app.js'
import { handleLogin } from '../auth.js'

describe('POST /auth/login', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls handleLogin and returns 200 on valid credentials', async () => {
    const app = createApp()
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'test', password: 'password' })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('token')
    expect(handleLogin).toHaveBeenCalled()
  })

  it('returns 401 when handleLogin sets it', async () => {
    vi.mocked(handleLogin as any).mockImplementationOnce((_req: any, res: any) => {
      res.status(401).json({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' })
    })
    const app = createApp()
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'wrong', password: 'bad' })
    expect(res.status).toBe(401)
    expect(res.body.code).toBe('INVALID_CREDENTIALS')
  })

  it('rate limits after 20 rapid requests', async () => {
    const app = createApp()
    const promises = Array.from({ length: 25 }, () =>
      request(app).post('/auth/login').send({ username: 'test', password: 'x' })
    )
    const results = await Promise.all(promises)
    const rateLimited = results.filter(r => r.status === 429)
    expect(rateLimited.length).toBeGreaterThan(0)
  })
})
