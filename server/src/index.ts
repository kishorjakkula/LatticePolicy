import { createApp, createProbeApp } from './app.js'
import { getDb, initDb } from './db.js'
import { startAsyncMessageWorker } from './asyncMessageWorker.js'
import { registerBuiltinJobs } from './jobs/registerBuiltinJobs.js'
import { startJobWorker } from './jobs/worker.js'
import { logger } from './logger.js'
import { closeCache, initCache } from './cache.js'
import { warmPublishedRatingModelCache } from './ratingModelRegistry.js'
import { assertDeploymentConfig, getPinnedTenantId, getProcessRole, isManagedDeployment, planProcess, type ProcessPlan } from './config.js'
import { assertCarrierPackValid } from './lib/carrier-pack-validator.js'
import { closePdfRenderer } from './services/document-storage.service.js'
import { assertEventTransportConfig } from './events/transport.js'

const port = process.env.PORT ? Number(process.env.PORT) : 3000
let stopAsyncWorker: (() => void) | null = null
let stopJobWorker: (() => void) | null = null

function registerShutdown(stopServer: () => void) {
  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Shutdown requested')
    try { stopAsyncWorker?.() } catch {}
    try { stopJobWorker?.() } catch {}
    void Promise.all([closeCache(), closePdfRenderer()]).finally(stopServer)
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

let plan: ProcessPlan
try {
  assertDeploymentConfig()
  plan = planProcess(getProcessRole())
  // A process that delivers messages must know where to before it starts.
  if (plan.dispatcher) logger.info({ transport: assertEventTransportConfig() }, 'Event transport configured')
} catch (err) {
  logger.error({ err }, 'Invalid deployment configuration')
  process.exit(1)
}

registerBuiltinJobs()

// A carrier pack this release cannot load must stop the stack before it
// serves a request, in every environment.
try {
  const packValidation = assertCarrierPackValid(getPinnedTenantId())
  if (packValidation?.manifest) {
    logger.info(
      { carrier: packValidation.manifest.carrier, packVersion: packValidation.manifest.version, products: packValidation.products },
      'Carrier pack loaded'
    )
    for (const issue of packValidation.warnings) logger.warn({ file: issue.file }, `Carrier pack: ${issue.message}`)
  }
} catch (err) {
  logger.error({ err: (err as Error)?.message || err }, 'Carrier pack is not valid for this release')
  process.exit(1)
}

/** The API serves every route; a worker or dispatcher answers probes only. */
function listen() {
  const app = plan.http === 'api' ? createApp() : createProbeApp()
  const server = app.listen(port, () => {
    logger.info({ port, role: plan.role, database: Boolean(getDb()) }, 'LatticePolicy process listening')
  })
  registerShutdown(() => server.close(() => process.exit(0)))
}

initDb()
  .then(async () => {
    await initCache()
    await warmPublishedRatingModelCache()
    // In the `all` role each loop still obeys its own switch, as before. A
    // dedicated worker or dispatcher runs its loop unconditionally.
    const dedicated = plan.role !== 'all'
    if (plan.dispatcher) stopAsyncWorker = startAsyncMessageWorker({ force: dedicated })
    if (plan.jobWorker) stopJobWorker = startJobWorker({ force: dedicated })
    if (plan.requiresDatabase && !getDb()) {
      logger.error({ role: plan.role }, 'This process role needs DATABASE_URL')
      process.exit(1)
    }
    listen()
  })
  .catch(async (err) => {
    const details = (err as Error)?.message || err
    if (isManagedDeployment() || plan.requiresDatabase) {
      logger.error({ err: details, role: plan.role }, 'DB init failed')
      process.exit(1)
    }
    logger.warn({ err: details }, 'DB init failed; continuing without Postgres')
    await initCache()
    listen()
  })
