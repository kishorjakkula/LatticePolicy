import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

vi.mock('../db.js', () => ({ getDb: vi.fn(() => null), withTenantTx: vi.fn() }))
vi.mock('../cache.js', () => ({ getCache: vi.fn(() => null) }))
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  httpLogger: (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../tenancy.js', () => ({
  tenancyMiddleware: (_req: any, _res: any, next: any) => next(),
  requireTenant: (_req: any, _res: any, next: any) => next(),
}))
vi.mock('../routes/index.js', () => ({ routes: express.Router() }))
vi.mock('../openapi.js', () => ({
  buildOpenApiSpec: vi.fn(() => ({ openapi: '3.0.3' })),
  swaggerUiHtml: vi.fn((url: string) => `<html>${url}</html>`),
}))
vi.mock('../auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    const bearer = String(req.header('Authorization') || '')
    const cookie = String(req.header('Cookie') || '')
    if (bearer === 'Bearer admin-token' || cookie.includes('lp_docs_session=docs-token')) {
      req.user = { id: 'admin-id', username: 'admin', tenantId: 'sample-carrier', roles: ['admin'], permissions: [] }
    }
    next()
  },
  issueDocsToken: vi.fn(() => 'docs-token'),
  handleLogin: vi.fn(),
  handleMfaVerify: vi.fn(),
  handleMfaSetupConfirm: vi.fn(),
}))

import { createApp } from '../app.js'

describe('API Docs browser authentication', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a short-lived HttpOnly docs session for an admin', async () => {
    const response = await request(createApp())
      .post('/api-docs/session')
      .set('Authorization', 'Bearer admin-token')

    expect(response.status).toBe(200)
    expect(response.body.url).toMatch(/\/api-docs$/)
    expect(response.headers['set-cookie'][0]).toContain('lp_docs_session=docs-token')
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly')
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=300')
  })

  it('serves Swagger and OpenAPI through the docs cookie', async () => {
    const app = createApp()
    const docs = await request(app).get('/api-docs').set('Cookie', 'lp_docs_session=docs-token')
    const spec = await request(app).get('/openapi.json').set('Cookie', 'lp_docs_session=docs-token')

    expect(docs.status).toBe(200)
    expect(docs.text).toContain('/openapi.json')
    expect(spec.status).toBe(200)
    expect(spec.body.openapi).toBe('3.0.3')
  })

  it('rejects unauthenticated documentation requests', async () => {
    const response = await request(createApp()).get('/api-docs').set('Accept', 'application/json')
    expect(response.status).toBe(403)
  })

  it('redirects unauthenticated browser navigation to the frontend handoff', async () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:5173'
    const response = await request(createApp()).get('/api-docs').set('Accept', 'text/html')
    expect(response.status).toBe(302)
    expect(response.headers.location).toBe('http://localhost:5173/api-docs')
  })
})
