import express from 'express'
import type { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { tenancyMiddleware, requireTenant } from './tenancy.js'
import { authMiddleware, handleLogin, handleMfaSetupConfirm, handleMfaVerify } from './auth.js'
import { routes } from './routes/index.js'
import { httpLogger, logger } from './logger.js'
import { getCache } from './cache.js'
import { getDb } from './db.js'
import { buildOpenApiSpec, swaggerUiHtml } from './openapi.js'
import { AppError } from './errors/domain.errors.js'

export function createApp() {
  const app = express()

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }))
  app.use(cors())
  app.use(express.json({ limit: '25mb' }))
  app.use(httpLogger)

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { code: 'RATE_LIMITED', message: 'Too many login attempts, please try again later' }
  })
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false
  })

  app.use(authMiddleware)

  function requireAdminDocs(req: express.Request, res: express.Response, next: express.NextFunction) {
    const roles = Array.isArray(req.user?.roles) ? req.user!.roles : []
    if (roles.includes('admin')) return next()
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Admin user required for API Docs' })
  }

  app.get('/openapi.json', requireAdminDocs, (req, res) => {
    const serverUrl = `${req.protocol}://${req.get('host') || 'localhost:3000'}`
    res.json(buildOpenApiSpec(serverUrl))
  })
  app.get('/api-docs', requireAdminDocs, (req, res) => {
    const token = String((req.query as any)?.token || '').trim()
    const serverUrl = `${req.protocol}://${req.get('host') || 'localhost:3000'}`
    const specUrl = `${serverUrl}/openapi.json${token ? `?token=${encodeURIComponent(token)}` : ''}`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(swaggerUiHtml(specUrl))
  })

  app.use(tenancyMiddleware)
  app.use((req, res, next) => {
    const reqLog = (req as any).log
    if (reqLog?.child) {
      const child = reqLog.child({
        tenantId: req.tenant?.tenantId || req.user?.tenantId || null,
        userId: req.user?.id || null
      })
      ;(req as any).log = child
      ;(res as any).log = child
    }
    next()
  })

  app.get('/health', async (_req, res) => {
    const db = getDb()
    let dbOk = false
    let cacheOk = false
    try { if (db) { await db.query('SELECT 1'); dbOk = true } } catch {}
    try { const cache = getCache(); if (cache) { await cache.ping(); cacheOk = true } } catch {}
    const status = dbOk ? 'ok' : 'degraded'
    res.status(dbOk ? 200 : 503).json({ status, db: dbOk, cache: cacheOk, ts: new Date().toISOString() })
  })

  app.post('/auth/login', loginLimiter, handleLogin)
  app.post('/auth/mfa/verify', authLimiter, handleMfaVerify)
  app.post('/auth/mfa/setup/confirm', authLimiter, handleMfaSetupConfirm)

  app.use('/api/v1', requireTenant, routes)

  // Global error handler — must be last middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      })
    }
    logger.error({ err }, 'Unhandled error')
    return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' })
  })

  return app
}
