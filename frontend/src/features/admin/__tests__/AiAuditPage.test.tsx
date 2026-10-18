import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AiAuditPage } from '../AiAuditPage'
import { aiAuditApi } from '../../../api/ai-audit.api'

const state = vi.hoisted(() => ({
  trail: { data: null as any, isPending: false, error: null, refetch: vi.fn() },
  integrity: { data: null as any, isPending: false, error: null, refetch: vi.fn() },
  keys: [] as unknown[],
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    state.keys.push(queryKey)
    return queryKey[0] === 'ai-audit' ? state.trail : state.integrity
  },
}))
vi.mock('../../../api/ai-audit.api', () => ({
  aiAuditApi: { list: vi.fn(), integrity: vi.fn(), exportCsv: vi.fn() },
}))

const entry = (overrides: Record<string, unknown>) => ({
  source: 'intake',
  eventId: Math.random().toString(36),
  chainSeq: 1,
  createdAt: '2026-10-17T12:00:00.000Z',
  actorKind: 'ai',
  actor: 'Private model',
  actorRoles: [],
  action: 'drafted',
  subject: 'SUB-0001',
  subjectId: 's1',
  detail: { drafted: 12, fields: 20, needsAttention: 3, processing: { model: 'local-v1', releaseId: 'abcdef123456' } },
  requestId: 'req-1',
  entryHash: 'f'.repeat(64),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.keys = []
  state.trail.data = {
    counts: { ai: 1, automation: 0, person: 1, system: 0 },
    items: [
      entry({}),
      entry({ actorKind: 'person', actor: 'underwriter', action: 'approved', detail: { values: 20, changedFromAi: 2 } }),
    ],
  }
  state.integrity.data = {
    checkedAt: '2026-10-17T12:00:00.000Z',
    intake: { intact: true, firstBrokenEntry: null, entries: 2 },
    releases: { intact: true, firstBrokenEntry: null, entries: 5 },
  }
})

describe('AI audit trail', () => {
  it('separates what the AI did from what people did', () => {
    render(<AiAuditPage />)
    expect(screen.getByText('Drafted values from documents')).toBeInTheDocument()
    expect(screen.getByText(/12 of 20 fields drafted, 3 need attention · model local-v1/)).toBeInTheDocument()
    expect(screen.getByText('Approved the submission')).toBeInTheDocument()
    expect(screen.getByText('20 values, 2 changed from the AI draft')).toBeInTheDocument()
    const badges = screen.getAllByText(/^(AI|Person)$/, { selector: '.ai-audit__badge' })
    expect(badges.map((badge) => badge.textContent)).toEqual(['AI', 'Person'])
  })
  it('shows the verified chain status and flags a broken chain', () => {
    const { unmount } = render(<AiAuditPage />)
    expect(screen.getByText(/Audit chain intact · 7 entries verified/)).toBeInTheDocument()
    unmount()
    state.integrity.data = { ...state.integrity.data, releases: { intact: false, firstBrokenEntry: 4, entries: 5 } }
    render(<AiAuditPage />)
    expect(screen.getByText(/Audit chain broken · model releases at entry 4/)).toBeInTheDocument()
  })
  it('filters by who acted from the summary cards', () => {
    render(<AiAuditPage />)
    fireEvent.click(screen.getByRole('button', { name: /^1\s*AI/ }))
    expect(state.keys[state.keys.length - 2]).toEqual(['ai-audit', expect.any(String), { source: 'all', actor: 'ai' }])
  })
  it('shows the recorded detail and hash for an entry', () => {
    render(<AiAuditPage />)
    fireEvent.click(screen.getByRole('button', { name: /12 of 20 fields drafted/ }))
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument()
    expect(screen.getByText(/"releaseId": "abcdef123456"/)).toBeInTheDocument()
  })
  it('exports the filtered trail as CSV', async () => {
    vi.mocked(aiAuditApi.exportCsv).mockResolvedValue('created_at\n')
    const createObjectURL = vi.fn(() => 'blob:csv')
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<AiAuditPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(aiAuditApi.exportCsv).toHaveBeenCalledWith({ source: 'all', actor: 'all', search: undefined }))
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled())
    vi.unstubAllGlobals()
  })
})
