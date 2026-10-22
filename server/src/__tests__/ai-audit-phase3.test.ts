import { beforeEach, describe, expect, it, vi } from 'vitest'
import { exportAiAuditCsv, listAiAudit } from '../services/ai-audit.service.js'
import { appendLlmAudit } from '../services/llm-release.service.js'

const { q } = vi.hoisted(() => ({ q: vi.fn() }))
vi.mock('../db.js', () => ({ withTenantTx: (_tenant: string, fn: (db: object) => unknown) => fn({}), toRawQuery: () => q }))
vi.mock('../services/llm-release.service.js', () => ({ appendLlmAudit: vi.fn(), llmActorRoles: vi.fn().mockResolvedValue(['admin']) }))

beforeEach(() => { vi.clearAllMocks() })
describe('AI audit query and export boundaries', () => {
  it('keeps the CSV 10,000 cap and ignores list limit/offset, including invalid paging inputs', async () => {
    q.mockResolvedValueOnce({ rows: [{ items: [], total: 12000 }] })
    const csv = await exportAiAuditCsv('tenant-test', 'actor-test', { limit: 999999, offset: -100, model: 'local-model' })
    expect(q.mock.calls[0][1]).toEqual(['tenant-test', 'local-model', 10000, 0])
    expect(csv).toBe('created_at,source,actor_kind,actor,actor_roles,action,subject,detail,request_id,entry_hash\n')
    expect(appendLlmAudit).toHaveBeenCalledWith(q, 'tenant-test', expect.objectContaining({ actorId: 'actor-test', actorType: 'user', action: 'AUDIT_EXPORTED' }))
  })
  it('retains CSV formula protection and original columns', async () => {
    q.mockResolvedValueOnce({ rows: [{ total: 1, items: [{ source: 'intake', event_id: 'event', chain_seq: 1, created_at: '2026-10-20T12:00:00Z', actor_kind: 'person', actor: '=formula', actor_roles: [], action: 'approved', subject: '+unsafe', detail: {}, entry_hash: 'hash' }] }] })
    const csv = await exportAiAuditCsv('tenant-test', 'actor-test', {})
    expect(csv).toContain('"\'=formula"')
    expect(csv).toContain('"\'+unsafe"')
    expect(csv.split('\n')[0].split(',')).toHaveLength(10)
  })
  it('uses parameterized literal search, filtered total and the default 25-row page', async () => {
    q.mockResolvedValueOnce({ rows: [{ items: [], total: 0 }] }).mockResolvedValueOnce({ rows: [] })
    expect(await listAiAudit('tenant-test', { search: '%_\\' })).toMatchObject({ items: [], total: 0 })
    expect(q.mock.calls[0][1]).toEqual(['tenant-test', '%\\%\\_\\\\%', 25, 0])
    expect(q.mock.calls[0][0]).toContain('count(*)::int FROM filtered')
  })
  it('rejects invalid list inputs before accessing the database', async () => {
    for (const filter of [{ offset: -1 }, { limit: 501 }, { user: ['one', 'two'] }, { model: { bad: true } }, { actor: 'person', actorKind: 'ai' }]) {
      await expect(listAiAudit('tenant-test', filter)).rejects.toMatchObject({ code: 'INVALID_AUDIT_FILTER', statusCode: 400 })
    }
    expect(q).not.toHaveBeenCalled()
  })
})
