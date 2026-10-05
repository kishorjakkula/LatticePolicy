import { describe, expect, it, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  registerJob,
  getJobDefinition,
  isJobCodeRegistered,
  listRegisteredJobCodes,
  validateJobPayload,
  __clearRegistryForTests,
} from '../registry.js'

describe('job registry', () => {
  beforeEach(() => {
    __clearRegistryForTests()
  })

  it('registers and retrieves a job definition', () => {
    registerJob({
      jobCode: 'sample_job',
      description: 'sample',
      handler: async () => ({}),
      defaultMaxAttempts: 3,
      backoff: { baseSeconds: 1, maxSeconds: 10 },
    })
    expect(isJobCodeRegistered('sample_job')).toBe(true)
    expect(getJobDefinition('sample_job')?.description).toBe('sample')
    expect(listRegisteredJobCodes()).toEqual(['sample_job'])
  })

  it('rejects an unknown job code when validating a payload', () => {
    expect(() => validateJobPayload('does_not_exist', {})).toThrow(/Unknown job code/)
  })

  it('passes payload through unchanged when no schema is registered', () => {
    registerJob({
      jobCode: 'no_schema_job',
      description: 'no schema',
      handler: async () => ({}),
      defaultMaxAttempts: 3,
      backoff: { baseSeconds: 1, maxSeconds: 10 },
    })
    const payload = { anything: true }
    expect(validateJobPayload('no_schema_job', payload)).toBe(payload)
  })

  it('validates a payload against its registered schema and rejects invalid payloads', () => {
    registerJob({
      jobCode: 'schema_job',
      description: 'has schema',
      handler: async () => ({}),
      payloadSchema: z.object({ tenantScope: z.string() }),
      defaultMaxAttempts: 3,
      backoff: { baseSeconds: 1, maxSeconds: 10 },
    })
    expect(validateJobPayload('schema_job', { tenantScope: 'sample-carrier' })).toEqual({ tenantScope: 'sample-carrier' })
    expect(() => validateJobPayload('schema_job', { tenantScope: 42 })).toThrow(/Invalid payload/)
  })
})
