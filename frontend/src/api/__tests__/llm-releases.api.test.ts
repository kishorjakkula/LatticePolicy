import { describe, expect, it, vi } from 'vitest'

const request = vi.fn(async (..._args: any[]) => ({}))
vi.mock('../request', () => ({ request: (...args: any[]) => request(...args) }))

import { llmReleasesApi } from '../llm-releases.api'

describe('llmReleasesApi', () => {
  it('calls the versioned release governance endpoints the API serves', async () => {
    await llmReleasesApi.list('r 1')
    await llmReleasesApi.contact('tech@carrier.example')
    await llmReleasesApi.transition('r1', 'start-validation')
    expect(request.mock.calls).toEqual([
      ['GET', '/v1/admin/llm/releases?release=r%201'],
      ['PUT', '/v1/admin/llm/contact', { email: 'tech@carrier.example' }],
      ['POST', '/v1/admin/llm/releases/r1/start-validation', {}],
    ])
  })
})
