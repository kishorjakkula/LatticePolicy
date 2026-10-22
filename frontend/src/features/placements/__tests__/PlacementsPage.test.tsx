import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { PlacementsPage } from '../PlacementsPage'
import { useAuth } from '../../../auth/AuthContext'

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockUsePlacements = vi.fn()
const mockCreateMutateAsync = vi.fn()
const mockTransitionMutateAsync = vi.fn()

vi.mock('../../../api/hooks', () => ({
  usePlacements: (...args: any[]) => mockUsePlacements(...args),
  useCreatePlacementMutation: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useTransitionPlacementStatusMutation: () => ({ mutateAsync: mockTransitionMutateAsync }),
}))

const mockUseAuth = vi.mocked(useAuth)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/placements']}>
      <Routes>
        <Route path="/placements" element={<PlacementsPage />} />
      </Routes>
    </MemoryRouter>
  )
}

const submissionPlacement = {
  placementId: 'placement-1',
  insuredName: 'Acme Manufacturing Co',
  productCode: 'commercial-property',
  facilityReference: 'FAC-2026-001',
  effectiveDate: '2026-09-01',
  status: 'Submission',
}

describe('PlacementsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows next-status actions for a user with placement.manage permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({
      data: { items: [submissionPlacement], total: 1 },
      isLoading: false,
      error: null,
    })

    renderPage()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Acme Manufacturing Co')).toBeInTheDocument()
    expect(table.getByText('Submission')).toBeInTheDocument()
    expect(table.getByRole('button', { name: 'Indication' })).toBeInTheDocument()
    expect(table.getByRole('button', { name: 'Declined' })).toBeInTheDocument()
    expect(table.getByRole('button', { name: 'Withdrawn' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New Placement' })).toBeInTheDocument()
  })

  it('hides management actions for a user without placement.manage permission', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'agent-1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'], permissions: [] },
    } as any)
    mockUsePlacements.mockReturnValue({
      data: { items: [submissionPlacement], total: 1 },
      isLoading: false,
      error: null,
    })

    renderPage()

    expect(screen.queryByRole('button', { name: '+ New Placement' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Indication' })).not.toBeInTheDocument()
  })

  it('shows no transition actions once a placement reaches a terminal status', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({
      data: { items: [{ ...submissionPlacement, status: 'Issued' }], total: 1 },
      isLoading: false,
      error: null,
    })

    renderPage()

    const table = within(screen.getByRole('table'))
    expect(table.getByText('Issued')).toBeInTheDocument()
    expect(table.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no placements', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
    })

    renderPage()

    expect(screen.getByText('No placements found')).toBeInTheDocument()
  })

  it('asks for an optional decline reason in an in-app dialog and sends it', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({ data: { items: [submissionPlacement], total: 1 }, isLoading: false, error: null })
    mockTransitionMutateAsync.mockResolvedValue({})
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Declined' }))
    const dialog = screen.getByRole('dialog', { name: 'Decline placement for Acme Manufacturing Co' })
    const field = within(dialog).getByLabelText('Reason (optional)')
    expect(field).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Decline' })).toHaveClass('btn-danger')
    await userEvent.type(field, 'Market declined')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }))

    expect(mockTransitionMutateAsync).toHaveBeenCalledWith({ placementId: 'placement-1', toStatus: 'Declined', reason: 'Market declined' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('withdraws without a reason when left blank, and Escape cancels without a transition', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({ data: { items: [submissionPlacement], total: 1 }, isLoading: false, error: null })
    mockTransitionMutateAsync.mockResolvedValue({})
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Withdrawn' }))
    expect(screen.getByRole('dialog', { name: 'Withdraw placement for Acme Manufacturing Co' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockTransitionMutateAsync).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Withdrawn' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Withdraw' }))
    expect(mockTransitionMutateAsync).toHaveBeenCalledWith({ placementId: 'placement-1', toStatus: 'Withdrawn', reason: undefined })
  })

  it('moves to a non-terminal status without asking for a reason', async () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: ['placement.manage'] },
    } as any)
    mockUsePlacements.mockReturnValue({ data: { items: [submissionPlacement], total: 1 }, isLoading: false, error: null })
    mockTransitionMutateAsync.mockResolvedValue({})
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'Indication' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockTransitionMutateAsync).toHaveBeenCalledWith({ placementId: 'placement-1', toStatus: 'Indication', reason: undefined })
  })
})
