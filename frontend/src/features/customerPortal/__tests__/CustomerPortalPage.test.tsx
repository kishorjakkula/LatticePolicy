import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CustomerPortalPage } from '../CustomerPortalPage'
import {
  useCustomerPortalPolicy,
  useCustomerPortalSummary,
} from '../../../api/hooks'

vi.mock('../../../api/hooks', () => ({
  useCustomerPortalSummary: vi.fn(),
  useCustomerPortalPolicy: vi.fn(),
}))

const mockUseSummary = vi.mocked(useCustomerPortalSummary)
const mockUsePolicy = vi.mocked(useCustomerPortalPolicy)

function renderPortal() {
  return render(
    <MemoryRouter>
      <CustomerPortalPage />
    </MemoryRouter>,
  )
}

describe('CustomerPortalPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the customer policy list and selected policy details', async () => {
    mockUseSummary.mockReturnValue({
      data: {
        customer: { customerName: 'Ada Lovelace' },
        policies: [
          {
            policyId: 'policy-1',
            policyNumber: 'PA-100',
            productCode: 'personal-auto',
            status: 'Issued',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)
    mockUsePolicy.mockReturnValue({
      data: {
        policy: {
          policyNumber: 'PA-100',
          productCode: 'personal-auto',
          status: 'Issued',
          premium: { amount: 1234.56, currency: 'USD' },
          term: {
            effectiveDate: '2026-07-01',
            expirationDate: '2027-07-01',
          },
        },
        declarations: {
          namedInsured: 'Lovelace Family',
          coverages: [
            {
              label: 'Bodily Injury',
              limit: '$100,000/$300,000',
              deductible: '',
              percent: '',
            },
          ],
        },
        idCard: {
          available: true,
          vehicles: [
            {
              index: 1,
              year: 2024,
              make: 'Toyota',
              model: 'Camry',
              vin: 'VIN123',
            },
          ],
        },
      },
      isLoading: false,
      error: null,
    } as any)

    renderPortal()

    expect(screen.getByRole('heading', { name: 'Customer Portal' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getAllByText('PA-100')).toHaveLength(2)
    expect(screen.getByText('Lovelace Family')).toBeInTheDocument()
    expect(screen.getByText('Toyota')).toBeInTheDocument()
    expect(screen.getByText('Camry')).toBeInTheDocument()
    expect(screen.getByText('Bodily Injury')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Declaration' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'View ID Cards' })).toBeEnabled()
  })

  it('shows an empty safe-view state when no issued policies are available', () => {
    mockUseSummary.mockReturnValue({
      data: { customer: { customerName: 'Ada Lovelace' }, policies: [] },
      isLoading: false,
      error: null,
    } as any)
    mockUsePolicy.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any)

    renderPortal()

    expect(screen.getByText('0 policies')).toBeInTheDocument()
    expect(screen.getByText('No issued policies are available.')).toBeInTheDocument()
    expect(screen.getByText('Select a policy to view details.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Declaration' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'View ID Cards' })).toBeDisabled()
  })

  it('surfaces portal load errors without rendering policy details', () => {
    mockUseSummary.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('portal unavailable'),
    } as any)
    mockUsePolicy.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as any)

    renderPortal()

    expect(screen.getByText('Error: portal unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'My Policies' })).not.toBeInTheDocument()
  })
})
