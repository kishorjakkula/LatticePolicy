import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AiAuditPage } from '../AiAuditPage'
import { aiAuditApi } from '../../../api/ai-audit.api'

vi.mock('../../../api/ai-audit.api', () => ({ aiAuditApi: { list: vi.fn(), integrity: vi.fn(), exportCsv: vi.fn() } }))
const counts = { ai: 500, automation: 0, person: 0, system: 0 }
const entry = {
  source: 'intake' as const, eventId: 'event-one', chainSeq: 1, createdAt: '2026-10-20T12:00:00Z',
  actorKind: 'ai' as const, actor: 'private-reader', actorRoles: [], action: 'drafted',
  subject: 'SUB-ONE', subjectId: 'submission-one', detail: { drafted: 3, fields: 4, needsAttention: 1 },
  requestId: 'request-one', entryHash: 'a'.repeat(64), model: 'private-v2',
  modelProvenance: { model: 'private-v2', profileId: 'submission', profileVersion: '2.0', releaseId: 'release-one' },
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}><AiAuditPage /></QueryClientProvider>)
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(aiAuditApi.list).mockResolvedValue({ items: [entry], counts, total: 500 })
  vi.mocked(aiAuditApi.integrity).mockResolvedValue({ checkedAt: entry.createdAt, intake: { intact: true, firstBrokenEntry: null, entries: 500 }, releases: { intact: true, firstBrokenEntry: null, entries: 0 } })
})
describe('WP-0004 audit paging, filters and detail', () => {
  it('requests 25 server rows and resets the offset for every applied filter', async () => {
    mount()
    await screen.findByText(/Page 1 of 20/)
    expect(aiAuditApi.list).toHaveBeenLastCalledWith({ source: 'all', actorKind: 'all', offset: 0, limit: 25 })
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findByText(/Page 2 of 20/)
    expect(aiAuditApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25, limit: 25 }))
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'private-v2' } })
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'underwriter' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(aiAuditApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, model: 'private-v2', user: 'underwriter' })))
    await screen.findByText(/Page 1 of 20/)
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findByText(/Page 2 of 20/)
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })
    await waitFor(() => expect(aiAuditApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, from: new Date('2026-10-01T00:00:00').toISOString() })))
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-20' } })
    await waitFor(() => expect(aiAuditApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ to: new Date('2026-10-20T23:59:59.999').toISOString() })))
    fireEvent.click(screen.getByRole('radio', { name: 'Person' }))
    await waitFor(() => expect(aiAuditApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ actorKind: 'person', offset: 0 })))
  })
  it('opens the side panel, traps focus, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    mount()
    const trigger = await screen.findByRole('button', { name: /3 of 4 fields drafted/ })
    await user.click(trigger)
    const panel = screen.getByRole('dialog', { name: 'Entry Details' })
    expect(panel).toHaveFocus()
    expect(within(panel).getByText('private-v2', { selector: 'dd' })).toBeInTheDocument()
    expect(within(panel).getByText(/"profileVersion": "2.0"/)).toBeInTheDocument()
    expect(screen.getByText('AI Audit Trail').closest('[inert]')).toBeInTheDocument()
    await user.tab()
    expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(panel).getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(trigger).toHaveFocus()
  })
  it('shows empty and retry states without stale entries', async () => {
    vi.mocked(aiAuditApi.list).mockRejectedValueOnce(new Error('Audit unavailable'))
    vi.mocked(aiAuditApi.list).mockResolvedValue({ items: [], total: 0, counts })
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent('Audit unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No activity matches these filters.')).toBeInTheDocument()
    expect(screen.getByText('No results')).toBeInTheDocument()
  })
  it('exports applied filters without a page limit or offset', async () => {
    vi.mocked(aiAuditApi.exportCsv).mockRejectedValue(new Error('Export unavailable'))
    mount()
    await screen.findByText(/Page 1 of 20/)
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    await screen.findByText(/Page 2 of 20/)
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'not applied' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(aiAuditApi.exportCsv).toHaveBeenCalledWith({ source: 'all', actorKind: 'all' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Export unavailable')
  })
})
