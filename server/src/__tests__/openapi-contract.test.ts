import { describe, expect, it } from 'vitest'
import { buildOpenApiSpec } from '../openapi.js'

describe('OpenAPI contract drift checks', () => {
  const spec = buildOpenApiSpec('http://localhost:3300') as any

  it('documents standard traceable error responses', () => {
    expect(spec.components.schemas.ErrorResponse).toMatchObject({
      required: ['code', 'message', 'traceId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        traceId: expect.objectContaining({ type: 'string' }),
        details: expect.any(Object),
      },
    })
    expect(spec.components.schemas.ValidationErrorResponse).toBeTruthy()
    expect(spec.components.schemas.ContractValidationError).toMatchObject({
      required: ['path', 'keyword', 'message', 'schema'],
    })
  })

  it('keeps common route error responses tied to schemas', () => {
    const quotePost = spec.paths['/v1/quotes'].post

    expect(quotePost.responses['400'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ValidationErrorResponse'
    )
    expect(quotePost.responses['422'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ValidationErrorResponse'
    )
    expect(quotePost.responses['409'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ErrorResponse'
    )
  })

  it('keeps expected high-value API routes represented in the spec', () => {
    for (const route of [
      '/v1/quotes',
      '/v1/quotes/{id}/bind',
      '/v1/policies/{id}',
      '/v1/policies/{id}/versions',
      '/v1/customer-portal/policies',
    ]) {
      expect(spec.paths[route], `${route} should be in OpenAPI`).toBeTruthy()
    }
  })
})
