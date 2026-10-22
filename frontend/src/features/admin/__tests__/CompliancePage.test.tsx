import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { CompliancePage } from '../CompliancePage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '../../../store/auth.store'
import { request } from '../../../api/request'

vi.mock('../../../api/request', () => ({ request: vi.fn() }))
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><CompliancePage /></QueryClientProvider>)

const useEligibilityMock = vi.fn()
const useOfacScreensMock = vi.fn()
const createEligibilityMutateMock = vi.fn()
const dispositionMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useEligibility: (...args: any[]) => useEligibilityMock(...args),
  useCreateEligibilityMutation: () => ({ mutateAsync: createEligibilityMutateMock, isPending: false }),
  useOfacScreens: (...args: any[]) => useOfacScreensMock(...args),
  useDispositionOfacScreenMutation: () => ({ mutateAsync: dispositionMutateMock, isPending: false }),
}))

describe('CompliancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'admin', username: 'admin', tenantId: 'test', roles: ['admin'] } })
    vi.mocked(request).mockResolvedValue({ updated: 1 })
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
    renderPage()
    expect(screen.getByText('Compliance')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Personal Auto' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'NY' })).toBeInTheDocument()
  })

  it('creates a new eligibility record from the form', async () => {
    const user = userEvent.setup()
    renderPage()

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
    renderPage()

    await user.click(screen.getByRole('button', { name: 'OFAC Review Queue' }))
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    const dialog = screen.getByRole('dialog', { name: 'Clear OFAC screen for Jane Doe' })
    const reasonField = within(dialog).getByLabelText('Reason (required)')
    expect(reasonField).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason.')
    expect(dispositionMutateMock).not.toHaveBeenCalled()
    await user.type(reasonField, 'Reviewed and confirmed different individual')
    await user.click(within(dialog).getByRole('button', { name: 'Clear' }))

    await waitFor(() => {
      expect(dispositionMutateMock).toHaveBeenCalledWith({
        screenId: 'screen-1',
        disposition: 'CLEARED',
        reason: 'Reviewed and confirmed different individual',
      })
    })
  })

  it('does not disposition a screen when the reviewer cancels the reason dialog', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'OFAC Review Queue' }))
    await user.click(screen.getByRole('button', { name: 'Block' }))
    const dialog = screen.getByRole('dialog', { name: 'Block OFAC screen for Jane Doe' })
    expect(within(dialog).getByRole('button', { name: 'Block' })).toHaveClass('btn-danger')
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Not needed')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(dispositionMutateMock).not.toHaveBeenCalled()
  })

  it('requires a reason and sends one bounded bulk request for the selected states', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: 'Select Personal Auto NY' }))
    await user.selectOptions(screen.getByLabelText('New status'), 'CLOSED')
    await user.click(screen.getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog', { name: 'Change 1 eligibility records' })
    await user.click(within(dialog).getByRole('button', { name: 'Change status' }))
    expect(request).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason.')
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Filing withdrawn')
    await user.click(within(dialog).getByRole('button', { name: 'Change status' }))
    await waitFor(() => expect(request).toHaveBeenCalledWith('POST', '/v1/admin/compliance/eligibility/bulk', { ids: ['elig-1'], status: 'CLOSED', reason: 'Filing withdrawn' }))
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('retains a failed batch in the dialog for retry and cancels without another write', async () => {
    vi.mocked(request).mockRejectedValueOnce(new Error('Records are busy'))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Select all visible eligibility records' }))
    await user.click(screen.getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Review')
    await user.click(within(dialog).getByRole('button', { name: 'Change status' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Records are busy')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('clears hidden selections when filters change and shows the no-exceptions state', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Select Personal Auto NY' }))
    await user.click(screen.getByRole('checkbox', { name: 'Exceptions only' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 selected')
    expect(screen.getByText('Every state is active.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled()
  })

  it('hides eligibility mutation controls from readers', () => {
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', tenantId: 'test', roles: [], permissions: ['admin.compliance.read'] } })
    renderPage()
    expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select Personal Auto NY' })).not.toBeInTheDocument()
  })

  it('does not change an existing status through the unaudited creation form', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByPlaceholderText('personal-auto'), 'personal-auto')
    await user.type(screen.getByPlaceholderText('CA'), 'NY')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(createEligibilityMutateMock).not.toHaveBeenCalled()
    expect(screen.getByText(/already exist/)).toBeInTheDocument()
  })

  it('limits selection to 500 and does not silently truncate select-all', async () => {
    useEligibilityMock.mockReturnValue({ data: { items: Array.from({ length: 501 }, (_, index) => ({
      eligibility_id: `elig-${index}`, product_code: `product-${index}`, state_code: 'NY', status: 'ACTIVE',
    })) }, isLoading: false })
    renderPage()
    expect(screen.getByRole('checkbox', { name: 'Select all visible eligibility records' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Change status' })).toBeDisabled()
  })

  it('keeps a submitted batch busy and sends no duplicate request', async () => {
    let finish!: (value: unknown) => void
    vi.mocked(request).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('checkbox', { name: 'Select Personal Auto NY' }))
    await user.click(screen.getByRole('button', { name: 'Change status' }))
    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Reviewed')
    await user.dblClick(within(dialog).getByRole('button', { name: 'Change status' }))
    expect(within(dialog).getByRole('button', { name: 'Change status' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    finish({ updated: 1 })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
