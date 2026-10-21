import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DashboardPage } from '../DashboardPage'
import { api, adminApi, apiUw } from '../../../api/client'
import { apiSubmissions } from '../../../api/submissions.api'
import { resetTenantDatePreferences } from '../../../shared/dateDisplay'
import { useAuthStore } from '../../../store/auth.store'

const auth = vi.hoisted(() => ({ user: { id: 'person', username: 'dashboard-tester', tenantId: 'carrier', roles: [], permissions: [] as string[] } }))
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => auth }))

const clients: QueryClient[] = []
function mount(path = '/dashboard') {
  useAuthStore.setState({ token: 'synthetic-test-token', user: auth.user })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  clients.push(client)
  const result = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><DashboardPage /></MemoryRouter></QueryClientProvider>)
  return { ...result, client }
}

const actual = { monthKey: '2026-10', monthLabel: 'Oct', quotes: 8, policies: 3, cancellations: 0 }
const prediction = (monthKey: string) => ({ monthKey, monthLabel: monthKey, projectedQuotes: 11, projectedPolicies: 6, projectedCancellations: 1 })
beforeEach(() => {
  resetTenantDatePreferences()
  vi.mocked(window.matchMedia).mockImplementation((media) => ({
    matches: false, media, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
  auth.user.permissions = ['page.search.view', 'page.policy.view', 'page.wizard.view', 'page.uw_queue.view', 'uw.referrals.read', 'page.submissions.view', 'submissions.read']
  vi.spyOn(api, 'searchPolicies').mockResolvedValue({ items: [{ policyId: 'renew', policyNumber: 'POL-1', internalStatus: 'Issued', term: { effectiveDate: '2025-11-01', expirationDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) } }], total: 1 })
  vi.spyOn(api, 'searchQuotes').mockResolvedValue({ items: [{ quoteId: 'q1', effectiveDate: '2026-10-01' }, { quoteId: 'q2' }], total: 2 })
  vi.spyOn(adminApi, 'searchCustomers').mockResolvedValue([])
  vi.spyOn(apiUw, 'listReferrals').mockResolvedValue({ items: [], total: 4 })
  vi.spyOn(apiSubmissions, 'list').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 1, statusCounts: {} })
  vi.spyOn(api, 'getDashboardAiInsights').mockResolvedValue({ aiInsights: { enabled: true, provider: 'existing', modelVersion: 'carrier-model', trend: { historical: [actual], forecast: [prediction('2026-09'), prediction('2026-10'), prediction('2099-01')] } } })
})
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.setState({ token: null, user: null })
  vi.restoreAllMocks()
})

describe('DashboardPage', () => {
  it('leads with real authorized counts and working filtered destinations, retaining zero', async () => {
    mount()
    const work = screen.getByRole('region', { name: 'My work' })
    await waitFor(() => expect(within(work).getByRole('link', { name: 'Open referrals 4' })).toHaveAttribute('href', '/uw/queue?status=Open'))
    expect(within(work).getByRole('link', { name: 'Open quotes 2' })).toHaveAttribute('href', '/search?mode=quotes')
    expect(within(work).getByRole('link', { name: 'Submissions to review 0 Ready for review' })).toHaveAttribute('href', '/dashboard?work=submissions')
    expect(within(work).getByRole('link', { name: 'Renewals due 1 Next 30 days' })).toHaveAttribute('href', '/dashboard?work=renewals')
    expect(apiUw.listReferrals).toHaveBeenCalledWith(1, 1, 'Open')
    expect(apiSubmissions.list).toHaveBeenCalledWith('READY_FOR_REVIEW', 1, 1)
    expect(adminApi.searchCustomers).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Draft: 0').querySelector('.dashboard-bar-fill')).toHaveStyle({ width: '0%' })
    expect(screen.getByText(/Last refreshed:/)).toHaveTextContent(/\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} (AM|PM)/)
  })

  it('hides unauthorized work/actions and makes no protected count/customer requests', async () => {
    auth.user.permissions = ['page.search.view']
    mount()
    await screen.findByRole('link', { name: 'Open quotes 2' })
    expect(screen.queryByRole('link', { name: /Open referrals|Submissions to review|Renewals due/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New Quote' })).not.toBeInTheDocument()
    expect(apiUw.listReferrals).not.toHaveBeenCalled()
    expect(apiSubmissions.list).not.toHaveBeenCalled()
    expect(adminApi.searchCustomers).not.toHaveBeenCalled()
  })

  it('does not show zero during loading or after failure; Refresh retries shared counts', async () => {
    vi.mocked(apiUw.listReferrals).mockRejectedValue(new Error('offline'))
    mount()
    expect(screen.getByRole('link', { name: 'Open referrals Loading...' })).toBeInTheDocument()
    await screen.findByRole('link', { name: 'Open referrals Unavailable' })
    expect(screen.getByText(/Some dashboard data could not be refreshed/)).toHaveAttribute('role', 'alert')
    vi.mocked(apiUw.listReferrals).mockResolvedValue({ items: [], total: 6 })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('link', { name: 'Open referrals 6' })
  })

  it('renders actual and forecast in their own months without pairing by array position', async () => {
    mount()
    const table = await screen.findByRole('region', { name: 'Actual and future forecast by month' })
    const october = within(table).getByRole('row', { name: /Oct 2026/ })
    expect(within(october).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['8', '3', '0', '-', '-', '-'])
    const future = within(table).getByRole('row', { name: /Jan 2099/ })
    expect(within(future).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['-', '-', '-', '11', '6', '1'])
    expect(within(table).queryByText('Sep 2026')).not.toBeInTheDocument()
  })

  it('uses the dashboard-owned expiration filter with real policy detail links', async () => {
    mount('/dashboard?work=renewals')
    expect(await screen.findByRole('link', { name: 'POL-1' })).toHaveAttribute('href', '/policies/renew')
  })

  it('opens the ready-for-review list and links to submission review', async () => {
    vi.mocked(apiSubmissions.list).mockResolvedValue({ items: [{ submissionId: 's1', submissionNumber: 'SUB-1', insuredName: 'Sample insured', productCode: 'personal-auto' } as any], total: 1, page: 1, pageSize: 100, statusCounts: {} })
    mount('/dashboard?work=submissions')
    expect(await screen.findByRole('link', { name: 'Sample insured' })).toHaveAttribute('href', '/submissions/s1')
    expect(apiSubmissions.list).toHaveBeenCalledWith('READY_FOR_REVIEW', 1, 100)
  })

  it('marks retained data stale after a refresh failure and never fabricates AI data', async () => {
    const { client } = mount()
    await screen.findByRole('link', { name: 'Open quotes 2' })
    vi.mocked(api.searchQuotes).mockRejectedValue(new Error('offline'))
    vi.mocked(api.getDashboardAiInsights).mockRejectedValue(new Error('offline'))
    await act(async () => { await client.refetchQueries({ type: 'active' }) })
    await screen.findByRole('link', { name: 'Open quotes Unavailable' })
    expect(screen.getByText(/Some dashboard data could not be refreshed/)).toHaveTextContent('stale')
    expect(screen.getByText('AI insights unavailable. Refresh to retry.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Model predictions' })).not.toBeInTheDocument()
  })

  it('collapses portfolio on phones while keeping My work open', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ ...window.matchMedia('(max-width: 600px)'), matches: true })
    mount()
    const portfolio = screen.getByRole('heading', { name: 'Portfolio' }).closest('section')!
    expect(within(portfolio).getByRole('button', { name: 'Expand section' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(screen.getByRole('region', { name: 'My work' })).getByRole('button', { name: 'Collapse section' })).toHaveAttribute('aria-expanded', 'true')
    await screen.findByRole('link', { name: 'Open quotes 2' })
  })

  it('shows a new tenant-formatted time only after a successful refresh', async () => {
    mount()
    await waitFor(() => expect(screen.getByText(/Last refreshed:/)).toHaveTextContent(/AM|PM/))
    const before = screen.getByText(/Last refreshed:/).textContent
    const later = Date.now() + 120_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText(/Last refreshed:/).textContent).not.toBe(before))
    expect(screen.getByText(/Last refreshed:/)).toHaveTextContent(/\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} (AM|PM)/)
  })

  it('does not expose a filtered submission list without permission even through a direct URL', async () => {
    auth.user.permissions = ['page.search.view']
    mount('/dashboard?work=submissions')
    await screen.findByRole('link', { name: 'Open quotes 2' })
    expect(screen.queryByRole('region', { name: 'Filtered work' })).not.toBeInTheDocument()
    expect(apiSubmissions.list).not.toHaveBeenCalled()
  })

  it('does not invent predictions when the existing model is disabled or omits values', async () => {
    const { client } = mount()
    const predictions = await screen.findByRole('region', { name: 'Model predictions' })
    expect(within(predictions).getAllByRole('cell').slice(1, 6).map((cell) => cell.textContent)).toEqual(['-', '-', '-', '-', '-'])
    vi.mocked(api.getDashboardAiInsights).mockResolvedValue({ aiInsights: { enabled: false } })
    await act(async () => { await client.refetchQueries({ type: 'active' }) })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Model predictions' })).not.toBeInTheDocument())
    expect(screen.getByText('AI insights are not enabled or available.')).toBeInTheDocument()
  })
})
