import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '../errors/domain.errors.js'
import { validateMutationEnvelope } from '../contracts.js'

function invoke(method: string, body: unknown) {
  const next = vi.fn()
  validateMutationEnvelope({ method, body } as Request, {} as Response, next as NextFunction)
  return next
}

describe('mutation request envelope contract', () => {
  it('rejects array request bodies with a standardized validation error', () => {
    const next = invoke('POST', [])
    expect(next).toHaveBeenCalledWith(expect.any(ValidationError))
    expect(next.mock.calls[0][0]).toMatchObject({ code: 'CONTRACT_VALIDATION_FAILED', statusCode: 422 })
  })

  it('accepts JSON objects and body-less mutation actions', () => {
    expect(invoke('PATCH', { status: 'Active' })).toHaveBeenCalledWith()
    expect(invoke('POST', undefined)).toHaveBeenCalledWith()
  })

  it('does not apply mutation contracts to reads', () => {
    expect(invoke('GET', [])).toHaveBeenCalledWith()
  })
})
