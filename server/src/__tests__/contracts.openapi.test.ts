import { describe, expect, it } from 'vitest'
import { validateQuote, validateQuoteContract } from '../contracts.js'
import { buildOpenApiSpec } from '../openapi.js'

function validQuotePayload(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'sample-carrier',
    productCode: 'personal-auto',
    effectiveDate: '2026-07-01',
    termMonths: 12,
    state: 'CA',
    applicant: {
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
    },
    risks: [
      {
        type: 'autoVehicle',
        year: 2023,
        make: 'Toyota',
        model: 'Camry',
        garagingZip: '94105',
        usage: 'commute',
      },
    ],
    coverages: [{ code: 'BI', selected: true, limit: 100000 }],
    ...overrides,
  }
}

describe('JSON Schema contract validation', () => {
  it('accepts valid quote contract payloads', () => {
    expect(validateQuoteContract(validQuotePayload())).toEqual({ valid: true, errors: [] })
  })

  it('returns structured errors for missing required fields and invalid nested values', () => {
    const result = validateQuoteContract(
      validQuotePayload({
        effectiveDate: undefined,
        applicant: { firstName: 'Ada', email: 'not-an-email' },
        risks: [{ type: 'autoVehicle', year: '2023', make: 'Toyota', model: 'Camry' }],
      })
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/',
          keyword: 'required',
          schemaSource: expect.stringContaining('quote.request.schema.json#'),
        }),
        expect.objectContaining({
          path: '/applicant',
          keyword: 'required',
        }),
        expect.objectContaining({
          path: '/applicant/email',
          keyword: 'format',
        }),
        expect.objectContaining({
          path: '/risks/0/year',
          keyword: 'type',
        }),
      ])
    )
  })

  it('preserves API quote validation compatibility for tenant header based requests', () => {
    const payload = validQuotePayload()
    delete (payload as Record<string, unknown>).tenantId

    expect(validateQuote(payload)).toBe(true)
    expect(validateQuote({ productCode: 'personal-auto' })).toBe(false)
  })

  it('allows unknown root fields until schemas opt into additionalProperties false', () => {
    expect(validateQuoteContract(validQuotePayload({ integrationTrace: 'abc-123' })).valid).toBe(true)
  })
})

describe('OpenAPI contract drift checks', () => {
  const spec = buildOpenApiSpec('http://localhost:3300')

  it('documents trace-aware standard error schemas', () => {
    expect(spec.components.schemas.ErrorResponse).toMatchObject({
      required: expect.arrayContaining(['code', 'message', 'traceId']),
      properties: {
        code: expect.any(Object),
        message: expect.any(Object),
        traceId: expect.objectContaining({ type: 'string' }),
        details: expect.any(Object),
      },
    })
    expect(spec.components.schemas.ValidationErrorResponse).toBeTruthy()
    expect(spec.components.schemas.IdempotencyConflictErrorResponse).toBeTruthy()
    expect(spec.components.schemas.ContractValidationError).toMatchObject({
      required: ['path', 'keyword', 'message', 'schemaSource'],
    })
  })

  it('keeps critical route groups represented in the generated spec', () => {
    expect(spec.paths['/v1/quotes']?.post?.requestBody?.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/QuoteRateRequest',
    })
    expect(spec.paths['/v1/policies/{id}/transactions/reserve-number']?.post).toBeTruthy()
    expect(spec.paths['/v1/admin/onboarding/jobs/{jobId}/validate']?.post).toBeTruthy()
  })

  it('attaches reusable error contracts to every operation', () => {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
        expect(operation.responses, `${method.toUpperCase()} ${path}`).toMatchObject({
          '401': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
          '409': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/IdempotencyConflictErrorResponse' } },
            },
          },
          '422': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } },
            },
          },
          '500': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
          },
        })
      }
    }
  })
})
