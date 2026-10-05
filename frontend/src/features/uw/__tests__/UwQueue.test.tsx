import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UwQueue } from '../UwQueue'
import { useAuth } from '../../../auth/AuthContext'

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockUseUwReferrals = vi.fn()
const mockDecideMutateAsync = vi.fn()
const mockAssignMutateAsync = vi.fn()
const mockCommentMutateAsync = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useUwReferrals: (...args: any[]) => mockUseUwReferrals(...args),
  useDecideReferralMutation: () => ({ mutateAsync: mockDecideMutateAsync }),
  useAssignReferralMutation: () => ({ mutateAsync: mockAssignMutateAsync, isPending: false }),
  useAddReferralCommentMutation: () => ({ mutateAsync: mockCommentMutateAsync, isPending: false }),
}))

const mockUseAuth = vi.mocked(useAuth)

function renderQueue() {
  return render(
    <MemoryRouter initialEntries={['/uw']}>
      <Routes>
        <Route path="/uw" element={<UwQueue />} />
        <Route path="/policies/:policyId" element={<div>Policy detail route</div>} />
      </Routes>
    </MemoryRouter>
  )
}

const openReferral = {
  referralId: 'ref-1',
  quoteId: 'quote-1',
  policyId: null,
  productCode: 'personal-auto',
  transactionType: 'NewBusiness',
  effectiveDate: '2026-07-01',
  status: 'Open',
  reasons: ['Driver age under 18 (refer)'],
  assignedTo: null,
  comments: [{ by: 'agent-1', text: 'Please review the driver history.', at: '2026-06-30T12:00:00Z' }],
  policyNumber: null,
}

describe('UwQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Approve/Decline for an underwriter on an open referral', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] },
    } as any)
    mockUseUwReferrals.mockReturnValue({
      data: { items: [openReferral], total: 1 },
      isLoading: false,
      error: null,
    })

    renderQueue()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Pre-bind (quote)')).toBeInTheDocument()
    expect(table.getByText('personal-auto')).toBeInTheDocument()
    expect(table.getByText('Open')).toBeInTheDocument()
    expect(table.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(table.getByRole('button', { name: 'Decline' })).toBeEnabled()
  })

  it('disables decision buttons for a user without decide permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'agent-1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'], permissions: [] },
    } as any)
    mockUseUwReferrals.mockReturnValue({
      data: { items: [openReferral], total: 1 },
      isLoading: false,
      error: null,
    })

    renderQueue()

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeDisabled()
  })

  it('hides decision actions once a referral is already decided', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] },
    } as any)
    mockUseUwReferrals.mockReturnValue({
      data: { items: [{ ...openReferral, status: 'Approved' }], total: 1 },
      isLoading: false,
      error: null,
    })

    renderQueue()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Approved')).toBeInTheDocument()
    expect(table.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(table.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no referrals', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] },
    } as any)
    mockUseUwReferrals.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
    })

    renderQueue()

    expect(screen.getByText('No referrals found')).toBeInTheDocument()
  })

  it('assigns a referral from the review dialog', async () => {
    const user = userEvent.setup()
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] },
    } as any)
    mockUseUwReferrals.mockReturnValue({ data: { items: [openReferral], total: 1 }, isLoading: false, error: null })
    const assigneeId = '22222222-2222-4222-8222-222222222222'
    mockAssignMutateAsync.mockResolvedValue({ ...openReferral, assignedTo: assigneeId })

    renderQueue()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    await user.type(screen.getByLabelText('Assignee user UUID'), assigneeId)
    await user.click(screen.getByRole('button', { name: 'Assign' }))

    expect(mockAssignMutateAsync).toHaveBeenCalledWith({ referralId: 'ref-1', assignedTo: assigneeId })
    expect(screen.getByLabelText('Assignee user UUID')).toHaveValue(assigneeId)
  })

  it('shows existing comments and adds a new comment', async () => {
    const user = userEvent.setup()
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['uw.referrals.decide'] },
    } as any)
    mockUseUwReferrals.mockReturnValue({ data: { items: [openReferral], total: 1 }, isLoading: false, error: null })
    mockCommentMutateAsync.mockResolvedValue({
      ...openReferral,
      comments: [...openReferral.comments, { by: 'uw-1', text: 'Reviewed loss runs.', at: '2026-07-01T12:00:00Z' }],
    })

    renderQueue()
    await user.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByText('Please review the driver history.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Add comment'), 'Reviewed loss runs.')
    await user.click(screen.getByRole('button', { name: 'Add comment' }))

    expect(mockCommentMutateAsync).toHaveBeenCalledWith({ referralId: 'ref-1', text: 'Reviewed loss runs.' })
    expect(screen.getByText('Reviewed loss runs.')).toBeInTheDocument()
    expect(screen.getByLabelText('Add comment')).toHaveValue('')
  })
})
