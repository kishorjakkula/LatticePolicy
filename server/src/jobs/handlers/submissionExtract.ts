import type { JobHandler } from '../registry.js'
import { runExtraction } from '../../services/submission-intake.service.js'

export interface SubmissionExtractPayload {
  submissionId: string
  runToken: string
  productHint?: string | null
}

/**
 * Reads one submission's documents with the configured extractor. Failures
 * are recorded on the submission (READ_FAILED) rather than retried: the
 * reviewer sees the error and chooses to retry or enter values by hand.
 */
export const submissionExtractHandler: JobHandler = async ({ run, requestPayload }) => {
  const payload = requestPayload as SubmissionExtractPayload
  const result = await runExtraction({
    tenantId: run.tenant_id,
    submissionId: payload.submissionId,
    runToken: payload.runToken,
    productHint: payload.productHint || null,
  })
  return { resultPayload: result }
}
