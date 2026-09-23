import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisConstructor = vi.fn()
const connect = vi.fn(async () => undefined)

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    connect = connect
    on = vi.fn()

    constructor(url: string, options: unknown) {
      redisConstructor(url, options)
    }
  }
}))

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn()
  }
}))

describe('cache initialization', () => {
  beforeEach(() => {
    vi.resetModules()
    redisConstructor.mockClear()
    connect.mockClear()
    process.env.CACHE_ENABLED = 'true'
    process.env.REDIS_URL = 'redis://localhost:6379'
  })

  it('keeps RESP2 semantics when using ioredis 6', async () => {
    const { initCache } = await import('../lib/cache.js')

    await initCache()

    expect(redisConstructor).toHaveBeenCalledWith(
      'redis://localhost:6379',
      expect.objectContaining({ protocol: 2 })
    )
  })
})
