import { createApp } from './app.js'
import { initDb } from './db.js'
import { startAsyncMessageWorker } from './asyncMessageWorker.js'
import { registerBuiltinJobs } from './jobs/registerBuiltinJobs.js'
import { startJobWorker } from './jobs/worker.js'
import { logger } from './logger.js'
import { closeCache, initCache } from './cache.js'
import { warmPublishedRatingModelCache } from './ratingModelRegistry.js'
import { assertDeploymentConfig, isManagedDeployment } from './config.js'

const app = createApp()
const port = process.env.PORT ? Number(process.env.PORT) : 3000
let stopAsyncWorker: (() => void) | null = null
let stopJobWorker: (() => void) | null = null

function registerShutdown(stopServer: () => void) {
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutdown requested')
    try { stopAsyncWorker?.() } catch {}
    try { stopJobWorker?.() } catch {}
    void closeCache()
    stopServer()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

try {
  assertDeploymentConfig()
} catch (err) {
  logger.error({ err }, 'Invalid deployment configuration')
  process.exit(1)
}

registerBuiltinJobs()

initDb()
  .then(async () => {
    await initCache()
    await warmPublishedRatingModelCache()
    stopAsyncWorker = startAsyncMessageWorker()
    stopJobWorker = startJobWorker()
    const server = app.listen(port, () => {
      logger.info({ port }, 'LatticePolicy server listening')
    })
    registerShutdown(() => server.close(() => process.exit(0)))
  })
  .catch(async (err) => {
    const details = (err as Error)?.message || err
    if (isManagedDeployment()) {
      logger.error({ err: details }, 'DB init failed in managed deployment')
      process.exit(1)
    }
    logger.warn({ err: details }, 'DB init failed; continuing without Postgres')
    await initCache()
    const server = app.listen(port, () => {
      logger.info({ port }, 'LatticePolicy server (no DB) listening')
    })
    registerShutdown(() => server.close(() => process.exit(0)))
  })
