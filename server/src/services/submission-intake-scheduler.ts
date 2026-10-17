import { getProcessRole } from '../config.js'
import { enqueueJob } from '../jobs/jobQueue.js'
import { logger } from '../logger.js'
import { runExtraction, SUBMISSION_EXTRACT_JOB, type ExtractionScheduler } from './submission-intake.service.js'

/**
 * Where submission reading runs.
 *
 * - `job`: queued as a `submission_extract` job for the batch worker. Used
 *   when the worker is a separate process (LATTICE_ROLE=api) or the
 *   in-process worker is on (JOB_WORKER_ENABLED).
 * - `inline`: run in this API process right after the request returns, for
 *   single-process deployments without a job worker.
 *
 * INTAKE_EXTRACTION_MODE=job|inline overrides the choice.
 */
export function intakeExtractionMode(env: NodeJS.ProcessEnv = process.env): 'job' | 'inline' {
  const explicit = String(env.INTAKE_EXTRACTION_MODE || '').trim().toLowerCase()
  if (explicit === 'job' || explicit === 'inline') return explicit
  if (getProcessRole() === 'api') return 'job'
  if (['1', 'true', 'yes', 'on'].includes(String(env.JOB_WORKER_ENABLED || '').trim().toLowerCase())) return 'job'
  return 'inline'
}

export const scheduleExtraction: ExtractionScheduler = async (job) => {
  if (intakeExtractionMode() === 'job') {
    await enqueueJob({
      tenantId: job.tenantId,
      jobCode: SUBMISSION_EXTRACT_JOB,
      idempotencyKey: `${SUBMISSION_EXTRACT_JOB}:${job.runToken}`,
      requestPayload: { submissionId: job.submissionId, runToken: job.runToken, productHint: job.productHint },
      maxAttempts: 1,
    })
    return
  }
  setImmediate(() => {
    runExtraction(job).catch((err) => {
      logger.error({ tenantId: job.tenantId, submissionId: job.submissionId, err: String(err?.message || err) }, '[intake] in-process extraction crashed')
    })
  })
}
