import express, { type Request, type Response, type NextFunction } from 'express'
import request from 'supertest'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { addressRoutes } from '../routes/addresses.routes.js'
import { AppError } from '../errors/domain.errors.js'
import { idempotencyMiddleware } from '../lib/idempotency.js'
const fetcher = vi.fn()
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockReset(); vi.stubEnv('ADDRESS_CHECK_PROVIDER', 'census'); vi.stubEnv('ADDRESS_CHECK_ALLOWED_TENANTS', 'demo') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function app(permissions: string[] | null = ['page.wizard.view'], roles: string[] = [], tenant = 'demo', principal = crypto.randomUUID()) {
  const a = express(); a.use(express.json())
  a.use((req: Request, _res, next) => { req.tenant = { tenantId: tenant } as any; if (permissions) req.user = { id: principal, username: 'synthetic', tenantId: tenant, roles, permissions } as any; next() })
  a.use(idempotencyMiddleware, addressRoutes)
  a.use((error: AppError, _req: Request, res: Response, _next: NextFunction) => res.status(error.statusCode || 500).json({ code: error.code || 'ERROR' }))
  return a
}
const address = { line1: '20 Test St', line2: 'UNIT 4', city: 'Boston', state: 'MA', postalCode: '02108', country: 'US' }
it('requires authentication and existing edit capability; denies portal identities', async () => {
  await request(app(null)).get('/addresses/capabilities').expect(401)
  await request(app([])).post('/addresses/check').send({ address }).expect(403)
  await request(app(['page.wizard.view'], ['customer'])).get('/addresses/capabilities').expect(403)
  expect(fetcher).not.toHaveBeenCalled()
})
it('is default disabled for other tenants without outbound requests or retained provider responses', async () => {
  await request(app(['page.wizard.view'], [], 'other')).post('/addresses/check').set('Idempotency-Key', 'no-retention').send({ address }).expect(200).then(r => { expect(r.body.outcome).toBe('disabled'); expect(r.headers['cache-control']).toBe('no-store') })
  expect(fetcher).not.toHaveBeenCalled()
})
it('accepts customer-contact edit permission and rejects unknown personal fields', async () => {
  await request(app(['admin.customers.contact.manage'])).get('/addresses/capabilities').expect(200)
  await request(app()).post('/addresses/check').send({ address: { ...address, phone: '2025550148' } }).expect(400)
  expect(fetcher).not.toHaveBeenCalled()
})

it.each(['/addresses/check', '/addresses/check/', '/ADDRESSES/CHECK'])('never retains/replays %s under a supplied idempotency key', async path => {
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ result: { addressMatches: [] } })))
  const key = crypto.randomUUID()
  await request(app()).post(path).set('Idempotency-Key', key).send({ address }).expect(200).then(r => expect(r.headers['cache-control']).toBe('no-store'))
  await request(app([])).post(path).set('Idempotency-Key', key).send({ address }).expect(403)
  vi.stubEnv('ADDRESS_CHECK_PROVIDER', '')
  await request(app()).post(path).set('Idempotency-Key', key).send({ address }).expect(200).then(r => expect(r.body.outcome).toBe('disabled'))
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('limits each tenant/principal independently and rejects excess checks before outbound traffic', async () => {
  vi.stubEnv('ADDRESS_CHECK_ALLOWED_TENANTS', 'demo,other')
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ result: { addressMatches: [] } })))
  const principal = crypto.randomUUID()
  const editor = app(['page.wizard.view'], [], 'demo', principal)
  for (let i = 0; i < 20; i++) await request(editor).post('/addresses/check').send({ address }).expect(200)
  await request(editor).post('/addresses/check').send({ address }).expect(429)
  expect(fetcher).toHaveBeenCalledTimes(20)
  await request(app(['page.wizard.view'], [], 'other', principal)).post('/addresses/check').send({ address }).expect(200)
  await request(app()).post('/addresses/check').send({ address }).expect(200)
  expect(fetcher).toHaveBeenCalledTimes(22)
})
