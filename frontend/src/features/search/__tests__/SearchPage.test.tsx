import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SearchPage } from '../SearchPage'
import { api, adminApi } from '../../../api/client'
import { useAuth } from '../../../auth/AuthContext'

vi.mock('../../../api/client', () => ({
  api: {
    searchPolicies: vi.fn(),
    searchQuotes: vi.fn(),
  },
  adminApi: {
    searchCustomers: vi.fn(),
  },
}))

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../../api/hooks', () => ({
  useCopyQuoteMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateCustomerMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

const mockSearchPolicies = vi.mocked(api.searchPolicies)
const mockSearchCustomers = vi.mocked(adminApi.searchCustomers)
const mockUseAuth = vi.mocked(useAuth)

function renderSearch(path = '/search?page=1&pageSize=20&mode=policies&sortBy=effectiveDate&sortDir=desc') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/search" element={<SearchPage />} />
        <Route path="/policies/:policyId" element={<div>Policy detail route</div>} />
        <Route path="/wizard" element={<div>Wizard route</div>} />
        <Route path="/customers/:customerId" element={<div>Customer detail route</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: {
        id: 'agent-1',
        username: 'agent',
        tenantId: 'sample-carrier',
        roles: ['agent'],
      },
    } as any)
  })

  it('loads policy results with url sort and pagination options', async () => {
    mockSearchPolicies.mockResolvedValue({
      items: [
        {
          policyId: 'policy-1',
          policyNumber: 'PA-100',
          insuredName: 'Ada Lovelace',
          productCode: 'personal-auto',
          status: 'Issued',
          internalStatus: 'Issued',
          term: {
            effectiveDate: '2026-07-01',
            expirationDate: '2027-07-01',
          },
          premium: { total: { amount: 1234.56 } },
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-02T10:00:00.000Z',
        },
      ],
      total: 1,
    })

    renderSearch('/search?q=Ada&page=1&pageSize=20&mode=policies&sortBy=effectiveDate&sortDir=desc')

    await waitFor(() => expect(mockSearchPolicies).toHaveBeenCalledTimes(1))
    expect(mockSearchPolicies).toHaveBeenCalledWith('Ada', {
      product: '',
      status: '',
      page: 1,
      pageSize: 20,
      sortBy: 'effectiveDate',
      sortDir: 'desc',
      effectiveFrom: undefined,
      effectiveTo: undefined,
    })
    expect(screen.getByRole('button', { name: 'PA-100' })).toBeInTheDocument()
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(screen.getByText('personal-auto')).toBeInTheDocument()
    expect(screen.getByText('$1,234.56')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Customers/i })).not.toBeInTheDocument()
  })

  it('renders the policy empty state when no policies match', async () => {
    mockSearchPolicies.mockResolvedValue({ items: [], total: 0 })

    renderSearch('/search?q=missing&page=1&pageSize=20&mode=policies')

    await waitFor(() => expect(mockSearchPolicies).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText('No policies found').length).toBeGreaterThan(0)
    expect(screen.getByText('Try adjusting your search filters')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear all filters' })).toBeInTheDocument()
  })

  it('allows admins to search customers from the customers tab', async () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: 'admin-1',
        username: 'admin',
        tenantId: 'sample-carrier',
        roles: ['admin'],
      },
    } as any)
    mockSearchCustomers.mockResolvedValue([
      {
        customerId: 'customer-1',
        customerKey: 'CUST-100',
        entityType: 'INDIVIDUAL',
        name: 'Grace Hopper',
        status: 'ACTIVE',
        policyCount: 2,
        lastUpdated: '2026-06-03T10:00:00.000Z',
      },
    ] as any)

    renderSearch('/search?mode=customers&q=Grace&page=1&pageSize=20')

    await waitFor(() => expect(mockSearchCustomers).toHaveBeenCalledTimes(1))
    expect(mockSearchCustomers).toHaveBeenCalledWith({
      q: 'Grace',
      status: undefined,
      limit: 500,
    })
    expect(screen.getByRole('tab', { name: /Customers/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('link', { name: 'CUST-100' })).toBeInTheDocument()
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
    expect(screen.getByText('ACTIVE')).toBeInTheDocument()
  })

  it('surfaces policy search errors', async () => {
    mockSearchPolicies.mockRejectedValue(new Error('search failed'))

    renderSearch('/search?page=1&pageSize=20&mode=policies')

    await waitFor(() => expect(mockSearchPolicies).toHaveBeenCalledTimes(1))
    expect(screen.getByText('search failed')).toBeInTheDocument()
  })
})
