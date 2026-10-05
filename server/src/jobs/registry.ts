import type { ZodTypeAny } from 'zod'
import type { JobRunRow } from './jobQueue.js'

export interface JobHandlerContext {
  run: JobRunRow
  requestPayload: unknown
  checkpoint: (data: unknown) => Promise<void>
}

export interface JobHandlerResult {
  resultPayload?: unknown
}

export type JobHandler = (ctx: JobHandlerContext) => Promise<JobHandlerResult>

export interface JobBackoffPolicy {
  baseSeconds: number
  maxSeconds: number
}

export interface JobDefinitionEntry {
  jobCode: string
  description: string
  handler: JobHandler
  payloadSchema?: ZodTypeAny
  defaultMaxAttempts: number
  backoff: JobBackoffPolicy
}

const registry = new Map<string, JobDefinitionEntry>()

export function registerJob(def: JobDefinitionEntry): void {
  registry.set(def.jobCode, def)
}

export function getJobDefinition(jobCode: string): JobDefinitionEntry | undefined {
  return registry.get(jobCode)
}

export function listRegisteredJobCodes(): string[] {
  return [...registry.keys()]
}

export function isJobCodeRegistered(jobCode: string): boolean {
  return registry.has(jobCode)
}

/**
 * Validates a job's request payload against its registered schema, if any.
 * Throws with a clear message for unknown job codes or invalid payloads so
 * callers (enqueue APIs, the worker) fail fast instead of persisting a run
 * that can never succeed.
 */
export function validateJobPayload(jobCode: string, payload: unknown): unknown {
  const def = registry.get(jobCode)
  if (!def) {
    throw new Error(`Unknown job code: ${jobCode}`)
  }
  if (!def.payloadSchema) return payload
  const parsed = def.payloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error(`Invalid payload for job ${jobCode}: ${parsed.error.message}`)
  }
  return parsed.data
}

/** Test-only: clears the registry so test files can register isolated fixtures. */
export function __clearRegistryForTests(): void {
  registry.clear()
}
