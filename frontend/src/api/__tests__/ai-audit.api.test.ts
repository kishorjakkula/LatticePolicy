import { beforeEach, expect, it, vi } from 'vitest'
import { aiAuditApi } from '../ai-audit.api'
import { request } from '../request'

vi.mock('../request', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('serializes zero offset, limit, exact identity filters and legacy actor without losing characters', () => {
  aiAuditApi.list({ offset: 0, limit: 25, actor: 'person', user: 'name+one', model: 'local/model v2', source: 'all' })
  const [method, path] = vi.mocked(request).mock.calls[0]
  expect(method).toBe('GET')
  const url = new URL(String(path), 'https://example.test')
  expect(Object.fromEntries(url.searchParams)).toEqual({ offset: '0', limit: '25', actor: 'person', user: 'name+one', model: 'local/model v2' })
})

it('serializes actorKind and date filters on export', () => {
  aiAuditApi.exportCsv({ actorKind: 'ai', from: '2026-10-20T00:00:00+05:30', to: undefined })
  const url = new URL(String(vi.mocked(request).mock.calls[0][1]), 'https://example.test')
  expect(url.pathname).toBe('/v1/admin/ai-audit/export')
  expect(Object.fromEntries(url.searchParams)).toEqual({ actorKind: 'ai', from: '2026-10-20T00:00:00+05:30' })
})
