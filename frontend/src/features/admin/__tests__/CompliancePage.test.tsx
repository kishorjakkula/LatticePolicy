import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { CompliancePage } from '../CompliancePage'

const useEligibilityMock = vi.fn()
const useOfacScreensMock = vi.fn()
const createEligibilityMutateMock = vi.fn()
const updateEligibilityMutateMock = vi.fn()
const dispositionMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useEligibility: (...args: any[]) => useEligibilityMock(...args),
  useCreateEligibilityMutation: () => ({ mutateAsync: createEligibilityMutateMock, isPending: false }),
  useUpdateEligibilityMutation: () => ({ mutateAsync: updateEligibilityMutateMock, isPending: false }),
  useOfacScreens: (...args: any[]) => useOfacScreensMock(...args),
  useDispositionOfacScreenMutation: () => ({ mutateAsync: dispositionMutateMock, isPending: false }),
}))

describe('CompliancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useEligibilityMock.mockReturnValue({
      data: {
        items: [
          {
            eligibility_id: 'elig-1',
            product_code: 'personal-auto',
            state_code: 'NY',
            status: 'ACTIVE',
            admitted: true,
            notes: 'Approved',
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    useOfacScreensMock.mockReturnValue({
      data: {
        items: [
          {
            screen_id: 'screen-1',
            party_name: 'Jane Doe',
            result: 'POTENTIAL_HIT',
            screen_date: '2026-01-01T00:00:00.000Z',
            match_details: [{ entryId: 'x' }],
            disposition: 'PENDING',
            disposition_reason: null,
          },
        ],
      },
      isLoading: false,
      error: null,
    })
  })

  it('renders eligibility records by default', () => {
    render(<CompliancePage />)
    expect(screen.getByText('Compliance')).toBeInTheDocument()
    expect(screen.getByText('personal-auto')).toBeInTheDocument()
    expect(screen.getByText('NY')).toBeInTheDocument()
  })

  it('creates a new eligibility record from the form', async () => {
    const user = userEvent.setup()
    render(<CompliancePage />)

    await user.type(screen.getByPlaceholderText('personal-auto'), 'homeowners')
    await user.type(screen.getByPlaceholderText('CA'), 'tx')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(createEligibilityMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({ productCode: 'homeowners', stateCode: 'TX', status: 'ACTIVE' }),
      )
    })
  })

  it('switches to the OFAC review queue and dispositions a screen', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'prompt').mockReturnValue('Reviewed and confirmed different individual')
    render(<CompliancePage />)

    await user.click(screen.getByRole('button', { name: 'OFAC Review Queue' }))
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await waitFor(() => {
      expect(dispositionMutateMock).toHaveBeenCalledWith({
        screenId: 'screen-1',
        disposition: 'CLEARED',
        reason: 'Reviewed and confirmed different individual',
      })
    })
  })

  it('does not disposition a screen when the reviewer cancels the reason prompt', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    render(<CompliancePage />)

    await user.click(screen.getByRole('button', { name: 'OFAC Review Queue' }))
    await user.click(screen.getByRole('button', { name: 'Block' }))

    expect(dispositionMutateMock).not.toHaveBeenCalled()
  })
})
