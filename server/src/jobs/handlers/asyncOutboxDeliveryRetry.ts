import { getDb } from '../../db.js'
import { claimOutboxRows, dispatchOutboxRow, loadConfig as loadAsyncPushConfig } from '../../asyncMessageWorker.js'
import type { JobHandler } from '../registry.js'

/**
 * First job type per docs/JOB_QUEUE_DESIGN.md: claims due
 * async_message_outbox rows and dispatches them through the existing
 * delivery adapter (server/src/asyncMessageWorker.ts). Reuses the same
 * claim query and dispatch function as the standalone outbox worker so
 * behavior stays identical whether outbox delivery runs via the legacy
 * always-on worker (ASYNC_PUSH_ENABLED) or via this job (manually enqueued
 * or scheduled through the job queue).
 */
export const asyncOutboxDeliveryRetryHandler: JobHandler = async ({ checkpoint }) => {
  const pool = getDb()
  if (!pool) {
    throw new Error('Database not initialized')
  }

  const config = loadAsyncPushConfig()
  const batch = await claimOutboxRows(pool, config.batchSize)

  let sent = 0
  let retriedOrFailed = 0
  const claimedMessageIds: string[] = []

  for (const row of batch) {
    claimedMessageIds.push(row.message_id)
    const ok = await dispatchOutboxRow(pool, row, config)
    if (ok) {
      sent += 1
    } else {
      retriedOrFailed += 1
    }
  }

  await checkpoint({ claimedCount: batch.length, claimedMessageIds })

  return {
    resultPayload: {
      claimed: batch.length,
      sent,
      retriedOrFailed,
    },
  }
}
