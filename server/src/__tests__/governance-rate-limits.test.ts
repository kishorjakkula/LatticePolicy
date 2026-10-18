import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ permission: vi.fn() }))
vi.mock('../auth.js', () => ({
  requirePermission: () => (_req: any, _res: any, next: any) => {
    mocks.permission()
    next()
  },
}))
vi.mock('../db.js', () => ({ getDb: () => null, withTenantTx: vi.fn(), toRawQuery: vi.fn() }))

describe('governance route-specific rate limits', () => {
  it('limits read, expensive audit and credential/approval requests before authorization or DB access', async () => {
    // Fresh router module instances keep each budget local to this harness.
    vi.resetModules()
    const { aiAuditRoutes } = await import('../routes/ai-audit.routes.js')
    const { llmReleaseRoutes } = await import('../routes/llm-releases.routes.js')
    const app = express()
    app.use(aiAuditRoutes, llmReleaseRoutes)

    for (const [route, limit] of [
      ['/admin/ai-audit', 120],
      ['/admin/ai-audit/integrity', 20],
      ['/admin/llm/releases', 120],
    ] as const) {
      for (let i = 0; i < limit; i++) await request(app).get(route).expect(503)
      const before = mocks.permission.mock.calls.length
      const response = await request(app).get(route).expect(429)
      expect(response.headers['retry-after']).toBeDefined()
      expect(mocks.permission.mock.calls.length).toBe(before)
    }
    // Integrity/export share the expensive-action budget, not the read budget.
    await request(app).get('/admin/ai-audit/export').expect(429)
    for (let i = 0; i < 60; i++)
      await request(app).post('/admin/llm/releases').set('Authorization', 'Bearer lpa_invalid').expect(503)
    await request(app).post('/admin/llm/releases').expect(429)
    await request(app).post('/admin/llm/releases/example/authorize-production').expect(429)
    await request(app).post('/admin/llm/credentials').expect(429)
    await request(app).put('/admin/llm/policy').expect(429)
  })
})
