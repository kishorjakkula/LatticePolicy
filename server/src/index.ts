import { createApp } from './app.js'
import { initDb } from './db.js'
import { startAsyncMessageWorker } from './asyncMessageWorker.js'
import { logger } from './logger.js'
import { closeCache, initCache } from './cache.js'
import { warmPublishedRatingModelCache } from './ratingModelRegistry.js'

const app = createApp()
const port = process.env.PORT ? Number(process.env.PORT) : 3000
let stopAsyncWorker: (() => void) | null = null

function registerShutdown(stopServer: () => void) {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown requested')
    try { stopAsyncWorker?.() } catch {}
    void closeCache()
    stopServer()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

initDb()
  .then(async () => {
    await initCache()
    await warmPublishedRatingModelCache()
    stopAsyncWorker = startAsyncMessageWorker()
    const server = app.listen(port, () => {
      logger.info({ port }, 'LatticePolicy server listening')
    })
    registerShutdown(() => server.close(() => process.exit(0)))
  })
  .catch(async (err) => {
    const details = (err as Error)?.message || err
    logger.warn({ err: details }, 'DB init failed; continuing without Postgres')
    await initCache()
    const server = app.listen(port, () => {
      logger.info({ port }, 'LatticePolicy server (no DB) listening')
    })
    registerShutdown(() => server.close(() => process.exit(0)))
  })
