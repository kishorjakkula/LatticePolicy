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
      '/v1/admin/exposure/summary',
      '/v1/admin/exposure/export.csv',
    ]) {
      expect(spec.paths[route], `${route} should be in OpenAPI`).toBeTruthy()
    }
  })

  it('documents the exposure management route family (issue #63) without drift', () => {
    // Exposure management (server/src/routes/exposure.routes.ts) shipped
    // with no OpenAPI coverage at all - this test locks in that the route
    // family, its methods, and its tag stay registered as the routes evolve.
    const summaryOp = spec.paths['/v1/admin/exposure/summary']?.get
    expect(summaryOp, 'GET /v1/admin/exposure/summary should be documented').toBeTruthy()
    expect(summaryOp.tags, 'summary route should carry the Admin - Exposure tag').toContain('Admin - Exposure')
    expect(
      summaryOp.responses?.['500']?.content?.['application/json']?.schema?.$ref,
      'summary route should document its 500 response against ErrorResponse like every other route'
    ).toBe('#/components/schemas/ErrorResponse')

    const exportOp = spec.paths['/v1/admin/exposure/export.csv']?.get
    expect(exportOp, 'GET /v1/admin/exposure/export.csv should be documented').toBeTruthy()
    expect(exportOp.tags, 'export route should carry the Admin - Exposure tag').toContain('Admin - Exposure')

    expect(spec.tags.map((t: any) => t.name), 'Admin - Exposure should be a registered spec tag').toContain(
      'Admin - Exposure'
    )
  })
})
