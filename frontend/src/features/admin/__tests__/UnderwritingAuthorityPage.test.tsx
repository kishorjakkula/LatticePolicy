import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { UnderwritingAuthorityPage } from '../UnderwritingAuthorityPage'

const useUwAuthorityGrantsMock = vi.fn()
const createGrantMutateMock = vi.fn()
const updateGrantMutateMock = vi.fn()
const useAuthMock = vi.fn()
const hasPermissionMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useUwAuthorityGrants: (...args: any[]) => useUwAuthorityGrantsMock(...args),
  useCreateUwAuthorityGrantMutation: () => ({ mutateAsync: createGrantMutateMock, isPending: false }),
  useUpdateUwAuthorityGrantMutation: () => ({ mutateAsync: updateGrantMutateMock, isPending: false }),
}))

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../../auth/permissions', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}))

const activeGrant = {
  grant_id: 'grant-1',
  subject_type: 'ROLE',
  subject_id: 'underwriter',
  product_code: 'personal-auto',
  state_code: 'CA',
  transaction_types: ['NewBusiness', 'Renew'],
  max_premium: '50000',
  max_limit: '1000000',
  may_override: false,
  effective_date: '2026-01-01',
  expiration_date: null,
  active: true,
}

describe('UnderwritingAuthorityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({ user: { roles: ['admin'] } })
    hasPermissionMock.mockReturnValue(true)
  })

  it('renders the grants list', () => {
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [activeGrant] }, isLoading: false, error: null })
    render(<UnderwritingAuthorityPage />)
    expect(screen.getByText('Underwriting Authority')).toBeInTheDocument()
    expect(screen.getByText('ROLE: underwriter')).toBeInTheDocument()
    expect(screen.getByText('Personal Auto')).toBeInTheDocument()
    expect(screen.getByText('CA')).toBeInTheDocument()
  })

  it('shows the gating-off banner when no active grant applies to the checked scope', async () => {
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [activeGrant] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingAuthorityPage />)

    // Default scope (blank/blank) has no global grant configured -> banner shown.
    expect(screen.getByTestId('authority-gating-off-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('authority-gating-on-notice')).not.toBeInTheDocument()

    // Narrow the scope to the one that the existing active grant actually covers.
    await user.type(screen.getByLabelText('Scope product code'), 'personal-auto')
    await user.type(screen.getByLabelText('Scope state code'), 'CA')

    await waitFor(() => {
      expect(screen.queryByTestId('authority-gating-off-banner')).not.toBeInTheDocument()
      expect(screen.getByTestId('authority-gating-on-notice')).toBeInTheDocument()
    })
  })

  it('shows the gating-off banner for an uncovered scope even when other grants exist', async () => {
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [activeGrant] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingAuthorityPage />)

    await user.type(screen.getByLabelText('Scope product code'), 'homeowners')
    await user.type(screen.getByLabelText('Scope state code'), 'TX')

    await waitFor(() => {
      expect(screen.getByTestId('authority-gating-off-banner')).toBeInTheDocument()
    })
    expect(screen.getByText(/Homeowners/)).toBeInTheDocument()
  })

  it('does not show the gating-off banner when a matching active grant exists', () => {
    const globalGrant = { ...activeGrant, product_code: null, state_code: null }
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [globalGrant] }, isLoading: false, error: null })
    render(<UnderwritingAuthorityPage />)
    expect(screen.queryByTestId('authority-gating-off-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('authority-gating-on-notice')).toBeInTheDocument()
  })

  it('submits a new grant to the create endpoint', async () => {
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingAuthorityPage />)

    await user.selectOptions(screen.getByDisplayValue('ROLE'), 'ROLE')
    await user.type(screen.getByPlaceholderText('role code, user id, or producer id'), 'underwriter')
    await user.type(screen.getByPlaceholderText('blank = all products'), 'personal-auto')
    await user.type(screen.getByPlaceholderText('blank = all states'), 'ca')
    await user.click(screen.getByRole('checkbox', { name: 'NewBusiness' }))

    await user.click(screen.getByRole('button', { name: 'Save Grant' }))

    await waitFor(() => {
      expect(createGrantMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subjectType: 'ROLE',
          subjectId: 'underwriter',
          productCode: 'personal-auto',
          stateCode: 'CA',
          transactionTypes: ['NewBusiness'],
        }),
      )
    })
  })

  it('deactivates an existing grant', async () => {
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [activeGrant] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingAuthorityPage />)

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      expect(updateGrantMutateMock).toHaveBeenCalledWith({ grantId: 'grant-1', patch: { active: false } })
    })
  })

  it('hides the create form and row actions when the user lacks manage permission', () => {
    hasPermissionMock.mockImplementation((_user: any, code: string) => code !== 'uw.authority.manage')
    useUwAuthorityGrantsMock.mockReturnValue({ data: { items: [activeGrant] }, isLoading: false, error: null })
    render(<UnderwritingAuthorityPage />)

    expect(screen.queryByText('New authority grant')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
  })
})
