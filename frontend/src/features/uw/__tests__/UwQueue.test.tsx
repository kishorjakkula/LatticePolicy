import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UwQueue } from '../UwQueue'
import { useAuth } from '../../../auth/AuthContext'
import { ToastProvider } from '../../../components/Toast'

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockUseUwReferrals = vi.fn()
const mockAssignMutateAsync = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useUwReferrals: (...args: any[]) => mockUseUwReferrals(...args),
  useAssignReferralMutation: () => ({ mutateAsync: mockAssignMutateAsync, isPending: false }),
  useUnderwriters: () => ({ data: { items: [{ userId: 'uw-2', username: 'uw2', displayName: 'Dana Underwriter' }] } }),
}))

const mockUseAuth = vi.mocked(useAuth)

const UNDERWRITER = { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] }
const AGENT = { id: 'agent-1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'], permissions: ['page.uw_queue.view', 'uw.referrals.read'] }

const DAY = 86_400_000

function referral(overrides: Record<string, any> = {}) {
  return {
    referralId: 'ref-1',
    quoteId: 'quote-1',
    policyId: null,
    policyNumber: null,
    productCode: 'homeowners',
    insuredName: 'Daniel Kim',
    transactionType: 'NewBusiness',
    effectiveDate: '2026-07-01',
    status: 'Open',
    reasons: ['Roof age 20-30 (refer)'],
    assignedTo: null,
    premium: { amount: 775.21, currency: 'USD' },
    createdAt: new Date(Date.now() - 5 * DAY - 3_600_000).toISOString(),
    comments: [],
    ...overrides,
  }
}

function renderQueue() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/uw/queue']}>
        <Routes>
          <Route path="/uw/queue" element={<UwQueue />} />
          <Route path="/uw/queue/:referralId" element={<div>Referral detail route</div>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

function listResult(items: any[], total = items.length) {
  return { data: { items, total, page: 1, pageSize: 20 }, isLoading: false, error: null }
}

describe('UwQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: UNDERWRITER } as any)
  })

  it('shows the triage columns: age, insured, product, premium, reasons and assignee', () => {
    mockUseUwReferrals.mockReturnValue(listResult([
      referral(),
      referral({ referralId: 'ref-2', insuredName: 'Ana Ruiz', productCode: 'personal-auto', premium: null, assignedTo: 'uw-2', reasons: ['AUTHORITY_LIMIT_EXCEEDED'] }),
    ]))

    renderQueue()

    const table = screen.getByRole('table')
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent?.trim())
    expect(headers).toEqual(['Age', 'Insured', 'Product', 'Premium', 'Reasons', 'Status', 'Assigned', 'Actions'])

    const [, first, second] = within(table).getAllByRole('row')
    expect(within(first).getByText('5d')).toBeInTheDocument()
    expect(within(first).getByText('Daniel Kim')).toBeInTheDocument()
    expect(within(first).getByText('Homeowners')).toBeInTheDocument()
    expect(within(first).getByText('$775.21')).toBeInTheDocument()
    expect(within(first).getByText('Roof age 20-30 (refer)')).toBeInTheDocument()
    expect(within(first).getByText('Unassigned')).toBeInTheDocument()

    expect(within(second).getByText('Personal Auto')).toBeInTheDocument()
    expect(within(second).getByText('Not rated')).toBeInTheDocument()
    expect(within(second).getByText('Authority: limit exceeded')).toBeInTheDocument()
    expect(within(second).getByText('Dana Underwriter')).toBeInTheDocument()
  })

  it('defaults to Open, oldest first, and switches to newest first for decided statuses', async () => {
    const user = userEvent.setup()
    mockUseUwReferrals.mockReturnValue(listResult([referral()]))

    renderQueue()

    expect(mockUseUwReferrals).toHaveBeenLastCalledWith(1, 20, 'Open', 'oldest')
    expect(screen.getByLabelText('Status')).toHaveValue('Open')
    expect(screen.getByLabelText('Sort')).toHaveValue('oldest')
    expect(screen.getByRole('columnheader', { name: 'Age' })).toHaveAttribute('aria-sort', 'descending')

    await user.selectOptions(screen.getByLabelText('Status'), 'Approved')
    expect(mockUseUwReferrals).toHaveBeenLastCalledWith(1, 20, 'Approved', 'newest')

    await user.selectOptions(screen.getByLabelText('Sort'), 'oldest')
    expect(mockUseUwReferrals).toHaveBeenLastCalledWith(1, 20, 'Approved', 'oldest')
  })

  it('offers only Open on a row: no Approve, Decline or Review, and no New Quote', async () => {
    const user = userEvent.setup()
    mockUseUwReferrals.mockReturnValue(listResult([referral()]))

    renderQueue()

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]
    expect(within(row).queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /decline/i })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /review/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new quote/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/new quote/i)).not.toBeInTheDocument()

    await user.click(within(row).getByRole('link', { name: 'Open' }))
    expect(screen.getByText('Referral detail route')).toBeInTheDocument()
  })

  it('assigns a referral to the signed-in underwriter', async () => {
    const user = userEvent.setup()
    mockUseUwReferrals.mockReturnValue(listResult([referral()]))
    mockAssignMutateAsync.mockResolvedValue(referral({ assignedTo: 'uw-1' }))

    renderQueue()
    await user.click(screen.getByRole('button', { name: 'Assign to me' }))

    expect(mockAssignMutateAsync).toHaveBeenCalledWith({ referralId: 'ref-1', assignedTo: 'uw-1' })
    expect(await screen.findByText('Referral assigned to you')).toBeInTheDocument()
  })

  it('shows "You" and no assign action on a referral already assigned to me', () => {
    mockUseUwReferrals.mockReturnValue(listResult([referral({ assignedTo: 'uw-1' })]))

    renderQueue()

    expect(within(screen.getByRole('table')).getByText('You')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
  })

  it('shows an assign error as a toast and keeps the row', async () => {
    const user = userEvent.setup()
    mockUseUwReferrals.mockReturnValue(listResult([referral()]))
    mockAssignMutateAsync.mockRejectedValue(new Error('API PATCH /v1/uw/referrals/ref-1/assign failed 404: {"code":"REFERRAL_NOT_FOUND","message":"x"}'))

    renderQueue()
    await user.click(screen.getByRole('button', { name: 'Assign to me' }))

    expect(await screen.findByText('This referral no longer exists.')).toBeInTheDocument()
    expect(screen.getByText('Daniel Kim')).toBeInTheDocument()
  })

  it('hides Assign to me without decide permission but still offers Open', () => {
    mockUseAuth.mockReturnValue({ user: AGENT } as any)
    mockUseUwReferrals.mockReturnValue(listResult([referral()]))

    renderQueue()

    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open' })).toBeInTheDocument()
  })

  it('pages with the shared Pagination component', async () => {
    const user = userEvent.setup()
    mockUseUwReferrals.mockReturnValue(listResult([referral()], 45))

    renderQueue()

    const pager = screen.getByRole('navigation', { name: 'Pagination' })
    expect(within(pager).getByText(/Page 1 of 3/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← Prev$/ })).not.toBeInTheDocument()
    await user.click(within(pager).getByRole('button', { name: 'Go to next page' }))
    expect(mockUseUwReferrals).toHaveBeenLastCalledWith(2, 20, 'Open', 'oldest')
    await user.selectOptions(within(pager).getByLabelText('Results per page'), '50')
    expect(mockUseUwReferrals).toHaveBeenLastCalledWith(1, 50, 'Open', 'oldest')
  })

  it('shows the empty state for an empty Open queue', () => {
    mockUseUwReferrals.mockReturnValue(listResult([]))

    renderQueue()

    expect(screen.getByText('No open referrals. Referred quotes appear here.')).toBeInTheDocument()
  })
})
