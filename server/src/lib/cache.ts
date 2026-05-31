import { createHash } from 'crypto'
import { Redis } from 'ioredis'
import { logger } from '../logger.js'

let redis: Redis | null = null
let cacheReady = false

const DEFAULT_TTL_SECONDS = 120

export async function initCache(): Promise<void> {
  const cacheEnabled = parseBoolean(process.env.CACHE_ENABLED, true)
  const redisUrl = (process.env.REDIS_URL || '').trim()

  if (!cacheEnabled) {
    logger.info('Cache disabled by CACHE_ENABLED')
    return
  }

  if (!redisUrl) {
    logger.info('Cache disabled: REDIS_URL not configured')
    return
  }

  const client = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false
  })
  client.on('error', (err: unknown) => {
    logger.warn({ err: asErrorMessage(err) }, 'Redis client error')
  })

  try {
    await client.connect()
    redis = client
    cacheReady = true
    logger.info({ redisUrl }, 'Redis cache connected')
  } catch (err) {
    cacheReady = false
    redis = null
    logger.warn({ err: asErrorMessage(err), redisUrl }, 'Redis cache unavailable; continuing without cache')
    try { client.disconnect() } catch {}
  }
}

export function getCache(): Redis | null {
  return redis
}

export async function closeCache(): Promise<void> {
  if (!redis) return
  const client = redis
  redis = null
  cacheReady = false
  try {
    await client.quit()
  } catch {
    try { client.disconnect() } catch {}
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  if (!cacheReady || !redis) return null
  try {
    const raw = await redis.get(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch (err) {
    logger.warn({ err: asErrorMessage(err), key }, 'Cache get failed')
    return null
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  if (!cacheReady || !redis) return
  try {
    await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, ttlSeconds))
  } catch (err) {
    logger.warn({ err: asErrorMessage(err), key }, 'Cache set failed')
  }
}

export async function cacheDeleteKey(key: string): Promise<void> {
  if (!cacheReady || !redis) return
  try {
    await redis.del(key)
  } catch (err) {
    logger.warn({ err: asErrorMessage(err), key }, 'Cache delete failed')
  }
}

export async function cacheDeletePrefix(prefix: string): Promise<number> {
  if (!cacheReady || !redis) return 0
  let cursor = '0'
  let deleted = 0
  const pattern = `${prefix}*`

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200)
      if (keys.length > 0) {
        deleted += await redis.del(...keys)
      }
      cursor = nextCursor
    } while (cursor !== '0')
    return deleted
  } catch (err) {
    logger.warn({ err: asErrorMessage(err), prefix }, 'Cache prefix delete failed')
    return deleted
  }
}

export function buildCacheKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => sanitizeKeyPart(part))
    .join(':')
}

export function hashCacheInput(value: unknown): string {
  const normalized = stableStringify(value)
  return createHash('sha256').update(normalized).digest('hex').slice(0, 24)
}

function sanitizeKeyPart(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value)
  return raw.trim().replace(/[\s:]+/g, '_') || 'na'
}

function stableStringify(value: unknown): string {
  if (value == null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(String(value))
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}
