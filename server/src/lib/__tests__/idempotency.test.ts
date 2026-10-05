import { EventEmitter } from 'events'
import { describe, expect, it, beforeEach } from 'vitest'
import { idempotencyMiddleware, resetIdempotencyStoreForTests } from '../idempotency.js'

class FakeRes extends EventEmitter {
  statusCode = 200
  private headers: Record<string, string> = {}
  body: unknown

  status(code: number) {
    this.statusCode = code
    return this
  }

  json(body?: unknown) {
    this.body = body
    queueMicrotask(() => this.emit('finish'))
    return this
  }

  getHeader(name: string) {
    return this.headers[name.toLowerCase()]
  }

  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value
  }
}

function fakeReq(overrides: Record<string, any> = {}) {
  const headers: Record<string, string> = overrides.headers || {}
  return {
    method: overrides.method || 'POST',
    originalUrl: overrides.path || '/api/v1/quotes',
    url: overrides.path || '/api/v1/quotes',
    body: overrides.body ?? { a: 1 },
    tenant: { tenantId: overrides.tenantId || 'tenant-1' },
    header: (name: string) => headers[name.toLowerCase()],
  } as any
}

describe('idempotencyMiddleware reservation and status handling', () => {
  beforeEach(() => {
    resetIdempotencyStoreForTests()
  })

  it('reserves ownership for the first request and blocks a concurrent duplicate while processing', async () => {
    const key = 'concurrent-key-1'
    let handlerCalls = 0
    let releaseFirstHandler: () => void = () => {}
    const firstHandlerStarted = new Promise<void>((resolve) => {
      releaseFirstHandler = resolve
    })

    const req1 = fakeReq({ headers: { 'idempotency-key': key } })
    const res1 = new FakeRes()
    const first = idempotencyMiddleware(req1, res1 as any, () => {
      handlerCalls += 1
      releaseFirstHandler()
    })

    await firstHandlerStarted

    const req2 = fakeReq({ headers: { 'idempotency-key': key } })
    const res2 = new FakeRes()
    await idempotencyMiddleware(req2, res2 as any, () => {
      handlerCalls += 1
    })

    expect(handlerCalls).toBe(1)
    expect(res2.statusCode).toBe(409)
    expect(res2.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_PROCESSING' })
    expect(res2.getHeader('Retry-After')).toBeTruthy()

    res1.status(200).json({ quoteId: 'q-1' })
    await first
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    const req3 = fakeReq({ headers: { 'idempotency-key': key } })
    const res3 = new FakeRes()
    let thirdHandlerCalled = false
    await idempotencyMiddleware(req3, res3 as any, () => {
      thirdHandlerCalled = true
    })

    expect(thirdHandlerCalled).toBe(false)
    expect(res3.statusCode).toBe(200)
    expect(res3.body).toEqual({ quoteId: 'q-1' })
  })

  it('returns a conflict for the same key with a different request body', async () => {
    const key = 'conflict-key-1'
    const req1 = fakeReq({ headers: { 'idempotency-key': key }, body: { a: 1 } })
    const res1 = new FakeRes()
    await idempotencyMiddleware(req1, res1 as any, () => {
      res1.status(200).json({ ok: true })
    })

    const req2 = fakeReq({ headers: { 'idempotency-key': key }, body: { a: 2 } })
    const res2 = new FakeRes()
    let handlerCalled = false
    await idempotencyMiddleware(req2, res2 as any, () => {
      handlerCalled = true
    })

    expect(handlerCalled).toBe(false)
    expect(res2.statusCode).toBe(409)
    expect(res2.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_CONFLICT' })
  })

  it('allows a matching retry to reclaim and re-execute after a failed attempt', async () => {
    const key = 'failed-retry-key-1'
    const req1 = fakeReq({ headers: { 'idempotency-key': key } })
    const res1 = new FakeRes()
    await idempotencyMiddleware(req1, res1 as any, () => {
      res1.status(500).json({ code: 'INTERNAL_ERROR' })
    })

    expect(res1.statusCode).toBe(500)

    const req2 = fakeReq({ headers: { 'idempotency-key': key } })
    const res2 = new FakeRes()
    let retryHandlerCalled = false
    await idempotencyMiddleware(req2, res2 as any, () => {
      retryHandlerCalled = true
      res2.status(200).json({ quoteId: 'q-retry' })
    })

    expect(retryHandlerCalled).toBe(true)
    expect(res2.statusCode).toBe(200)
    expect(res2.body).toEqual({ quoteId: 'q-retry' })
  })

  it('marks the reservation failed if the connection closes without a JSON response', async () => {
    const key = 'closed-connection-key-1'
    const req1 = fakeReq({ headers: { 'idempotency-key': key } })
    const res1 = new FakeRes()
    await idempotencyMiddleware(req1, res1 as any, () => {
      // Simulate the handler doing work and the client disconnecting before
      // a response is ever sent.
      res1.statusCode = 499
      res1.emit('close')
    })

    const req2 = fakeReq({ headers: { 'idempotency-key': key } })
    const res2 = new FakeRes()
    let retryHandlerCalled = false
    await idempotencyMiddleware(req2, res2 as any, () => {
      retryHandlerCalled = true
      res2.status(200).json({ quoteId: 'q-after-close' })
    })

    expect(retryHandlerCalled).toBe(true)
    expect(res2.body).toEqual({ quoteId: 'q-after-close' })
  })

  it('does not reserve keys across different tenants', async () => {
    const key = 'shared-key-cross-tenant'
    const req1 = fakeReq({ headers: { 'idempotency-key': key }, tenantId: 'tenant-a' })
    const res1 = new FakeRes()
    await idempotencyMiddleware(req1, res1 as any, () => {
      res1.status(200).json({ tenant: 'a' })
    })

    const req2 = fakeReq({ headers: { 'idempotency-key': key }, tenantId: 'tenant-b' })
    const res2 = new FakeRes()
    let handlerCalled = false
    await idempotencyMiddleware(req2, res2 as any, () => {
      handlerCalled = true
      res2.status(200).json({ tenant: 'b' })
    })

    expect(handlerCalled).toBe(true)
    expect(res2.body).toEqual({ tenant: 'b' })
  })
})
