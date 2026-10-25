import express from 'express'
import request from 'supertest'
import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('../../auth.js', () => ({ requirePermission: () => (_req: any, _res: any, next: any) => next() }))
vi.mock('../../db.js', async importOriginal => ({ ...await importOriginal<typeof import('../../db.js')>(), getDb: () => ({}) }))
vi.mock('../../lib/validation-gate.js', () => ({ runValidationGate: async () => ({ warnings: [] }) }))
vi.mock('../quote.service.js', () => ({
  normalizeQuotePayload: (value: any) => value,
  createOrRateQuote: vi.fn(async () => ({ quoteId: 'synthetic-quote', status: 'Rated' })),
}))

import { quoteRoutes } from '../../routes/quotes.routes.js'
import { createOrRateQuote } from '../quote.service.js'

const actorId = '11111111-1111-4111-8111-111111111111'
beforeEach(() => vi.mocked(createOrRateQuote).mockClear())

it('forwards only the authenticated server user ID, never body actorId or audit username', async () => {
  const app = express()
  app.use(express.json())
  app.use((req: any, _res, next) => {
    req.user = { id: actorId, username: 'audit-username' }
    req.tenant = { tenantId: 'synthetic-bop' }
    req.tx = (fn: any) => fn({})
    next()
  })
  app.use(quoteRoutes)
  await request(app).post('/quotes').send({
    productCode: 'businessowners', effectiveDate: '2026-10-23', termMonths: 12,
    state: 'OH', risks: [], coverages: [], actorId: 'attacker-selected-id',
  }).expect(200)
  expect(createOrRateQuote).toHaveBeenCalledWith(
    expect.any(Object), 'synthetic-bop', expect.any(Object), null, 'audit-username',
    { previousPayload: undefined, actorId },
  )
})
