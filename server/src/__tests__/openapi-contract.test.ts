import { describe, expect, it } from 'vitest'
import { buildOpenApiSpec, getCompleteRouteDefs, routeDefs } from '../openapi.js'
import { collectRegisteredRoutes, countUnregisteredMountedRouters } from '../route-registry.js'
import { routes } from '../routes/index.js'

describe('OpenAPI contract drift checks', () => {
  const spec = buildOpenApiSpec('http://localhost:3300') as any

  it('keeps route keys and generated operation ids unique', () => {
    const routeKeys = routeDefs.map((route) => `${route.method} ${route.path}`)
    expect(new Set(routeKeys).size).toBe(routeKeys.length)
    const operationIds = Object.values(spec.paths).flatMap((path: any) =>
      Object.values(path).map((operation: any) => operation.operationId),
    )
    expect(new Set(operationIds).size).toBe(operationIds.length)
  })

  it('documents every registered Express API route', () => {
    const documented = new Set(Object.entries(spec.paths).flatMap(([path, operations]: [string, any]) =>
      Object.keys(operations).map((method) => `${method.toUpperCase()} ${path}`),
    ))
    const registered = collectRegisteredRoutes(routes, '/v1')
    for (const route of registered) {
      expect(documented.has(`${route.method.toUpperCase()} ${route.path}`), `${route.method} ${route.path}`).toBe(true)
    }
    expect(getCompleteRouteDefs().length).toBeGreaterThan(routeDefs.length)
  })

  it('requires nested routers to participate in the route registry', () => {
    expect(countUnregisteredMountedRouters(routes)).toBe(0)
  })

  it('rejects stale manually documented API operations', () => {
    const registered = new Set(collectRegisteredRoutes(routes, '/v1').map((route) =>
      `${route.method.toUpperCase()} ${route.path}`,
    ))
    const stale = routeDefs
      .filter((route) => route.path.startsWith('/v1'))
      .map((route) => `${route.method.toUpperCase()} ${route.path}`)
      .filter((key) => !registered.has(key))
    expect(stale).toEqual([])
  })

  it('publishes a request contract for every JSON mutation', () => {
    for (const [path, operations] of Object.entries(spec.paths) as [string, any][]) {
      for (const method of ['post', 'patch', 'put']) {
        const operation = operations[method]
        if (!operation) continue
        expect(operation.requestBody, `${method.toUpperCase()} ${path}`).toBeTruthy()
        expect(operation.requestBody.content['application/json'].schema).toBeTruthy()
      }
    }
  })

  it('uses detailed contracts for import and reinsurance mutations', () => {
    expect(spec.paths['/v1/admin/import/batches'].post.requestBody.content['application/json'].schema.$ref)
      .toBe('#/components/schemas/DataImportBatchRequest')
    expect(spec.paths['/v1/admin/reinsurance/treaties'].post.requestBody.content['application/json'].schema.$ref)
      .toBe('#/components/schemas/ReinsuranceTreatyRequest')
  })

  it('documents strict customer-safe portal projections', () => {
    expect(spec.paths['/v1/customer-portal/summary'].get.responses['200'].content['application/json'].schema.$ref)
      .toBe('#/components/schemas/PortalSummaryResponse')
    expect(spec.components.schemas.PortalPolicySummary.additionalProperties).toBe(false)
    expect(spec.components.schemas.PortalPolicySummary.properties.premium.nullable).toBe(true)
    expect(spec.components.schemas.PortalPolicyDetailResponse.properties.declarations.additionalProperties).toBe(false)
    expect(spec.components.schemas.PortalPolicyDetailResponse.properties.idCard.additionalProperties).toBe(false)
    expect(spec.components.schemas.PortalDocumentsResponse.additionalProperties).toBe(false)
    expect(spec.components.schemas.PortalDocumentsResponse.properties.documents.items.properties.transaction.additionalProperties)
      .toBe(false)
  })

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

  it('documents structured errors for transaction routes', () => {
    for (const path of [
      '/v1/policies/{id}/issue',
      '/v1/policies/{id}/endorse/preview',
      '/v1/policies/{id}/endorse',
      '/v1/policies/{id}/cancel',
      '/v1/policies/{id}/reinstate',
      '/v1/policies/{id}/rewrite',
      '/v1/policies/{id}/renew',
      '/v1/policies/{id}/renew/preview',
      '/v1/policies/{id}/non-renew',
      '/v1/policies/{id}/endorse/reserve-number',
      '/v1/policies/{id}/transactions/reserve-number',
    ]) {
      const operation = spec.paths[path]?.post
      expect(operation, `${path} should be in OpenAPI`).toBeTruthy()
      expect(operation.responses['400'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ValidationErrorResponse'
      )
      expect(operation.responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ErrorResponse'
      )
      expect(operation.responses['500'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ErrorResponse'
      )
    }
  })

  it('keeps expected high-value API routes represented in the spec', () => {
    for (const route of [
      '/v1/quotes',
      '/v1/quotes/{id}/bind',
      '/v1/policies/{id}',
      '/v1/policies/{id}/versions',
      '/v1/customer-portal/summary',
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
