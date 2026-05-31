import { randomUUID } from 'crypto'
import type { Request, Response } from 'express'
import pino from 'pino'
import { pinoHttp } from 'pino-http'

const logLevel = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

export const logger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash'
    ],
    censor: '[redacted]'
  }
})

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req: Request) => req.url === '/health'
  },
  genReqId: (req: Request, res: Response) => {
    const inbound = req.headers['x-request-id']
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || randomUUID()
    res.setHeader('x-request-id', requestId)
    return requestId
  },
  customLogLevel: (_req: Request, res: Response, err?: Error) => {
    if (err || res.statusCode >= 500) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  }
})

export function getRequestLogger(req?: Request, res?: Response) {
  return (res as any)?.log || (req as any)?.log || logger
}
