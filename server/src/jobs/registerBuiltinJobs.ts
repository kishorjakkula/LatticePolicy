import { z } from 'zod'
import { registerJob } from './registry.js'
import { asyncOutboxDeliveryRetryHandler } from './handlers/asyncOutboxDeliveryRetry.js'
import { renewalCandidateScanHandler } from './handlers/renewalCandidateScan.js'

const asyncOutboxDeliveryRetryPayloadSchema = z.object({}).passthrough()
const renewalCandidateScanPayloadSchema = z.object({ windowDays: z.number().int().positive().optional() }).passthrough()

let registered = false

/**
 * Registers all built-in job handlers. Idempotent and safe to call multiple
 * times (tests call it directly; server startup calls it once before the
 * worker starts).
 */
export function registerBuiltinJobs(): void {
  if (registered) return
  registered = true

  registerJob({
    jobCode: 'async_outbox_delivery_retry',
    description: 'Claims due async_message_outbox rows and dispatches them through the configured delivery adapter.',
    handler: asyncOutboxDeliveryRetryHandler,
    payloadSchema: asyncOutboxDeliveryRetryPayloadSchema,
    defaultMaxAttempts: 5,
    backoff: { baseSeconds: 10, maxSeconds: 600 },
  })

  registerJob({
    jobCode: 'renewal_candidate_scan',
    description: "Scans a tenant's in-force policies for upcoming renewals and creates a renewal-reminder notification intent per candidate.",
    handler: renewalCandidateScanHandler,
    payloadSchema: renewalCandidateScanPayloadSchema,
    defaultMaxAttempts: 3,
    backoff: { baseSeconds: 60, maxSeconds: 3600 },
  })
}
