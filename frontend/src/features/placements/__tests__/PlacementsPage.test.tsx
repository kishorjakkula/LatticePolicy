import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
})
