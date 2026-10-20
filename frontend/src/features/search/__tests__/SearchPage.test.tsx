import { describe, expect, it, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SearchPage, parseSearchPageSize, searchPageSizeOptions } from '../SearchPage'
import { api, adminApi } from '../../../api/client'
import { useAuth } from '../../../auth/AuthContext'

vi.mock('../../../api/client', () => ({
  api: {
    searchPolicies: vi.fn(),
    searchQuotes: vi.fn(),
    exportPoliciesCsv: vi.fn(),
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
const mockExportPoliciesCsv = vi.mocked(api.exportPoliciesCsv)
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
    const row = screen.getByRole('button', { name: 'PA-100' }).closest('tr') as HTMLElement
    expect(within(row).getByText('Personal Auto')).toBeInTheDocument()
    expect(within(row).getByText('07/01/2026')).toBeInTheDocument()
    expect(within(row).getByText('07/01/2027')).toBeInTheDocument()
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
    expect(await screen.findByText('search failed')).toBeInTheDocument()
  })

  describe('REQ-13 page size, headers, product names and status legend', () => {
    beforeEach(() => {
      localStorage.clear()
      // jsdom has no layout; the pager scrolls the table into view after a change.
      Element.prototype.scrollIntoView = vi.fn()
    })

    function policies(count: number, productCode = 'personal-auto') {
      return Array.from({ length: count }, (_, i) => ({
        policyId: `policy-${i + 1}`,
        policyNumber: `PA-${String(i + 1).padStart(3, '0')}`,
        insuredName: `Insured ${i + 1}`,
        productCode,
        status: 'Issued',
        internalStatus: 'Issued',
        term: { effectiveDate: '2026-07-01', expirationDate: '2027-07-01' },
      }))
    }

    it('shows the page size actually used in the picker, the count and the pager', async () => {
      mockSearchPolicies.mockResolvedValue({ items: policies(20), total: 183 })
      renderSearch('/search?page=1&pageSize=20&mode=policies')

      await screen.findByRole('button', { name: 'PA-001' })
      expect(mockSearchPolicies).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 1, pageSize: 20 }))
      const picker = screen.getByRole('combobox', { name: 'Results per page' }) as HTMLSelectElement
      expect(picker.value).toBe('20')
      expect(within(picker).getByRole('option', { name: '20 per page' })).toHaveProperty('selected', true)
      expect(screen.getByText('Page 1 of 10')).toBeInTheDocument()
      expect(screen.getByText((_, el) => el?.className === 'ps-table-count' && el.textContent === 'Showing 1-20 of 183 policies')).toBeInTheDocument()
    })

    it('defaults to 20 per page when the URL has no page size', async () => {
      mockSearchPolicies.mockResolvedValue({ items: policies(20), total: 183 })
      renderSearch('/search?mode=policies')

      await screen.findByRole('button', { name: 'PA-001' })
      expect(mockSearchPolicies).toHaveBeenLastCalledWith('', expect.objectContaining({ pageSize: 20 }))
      expect((screen.getByRole('combobox', { name: 'Results per page' }) as HTMLSelectElement).value).toBe('20')
      expect(screen.getByText('Page 1 of 10')).toBeInTheDocument()
    })

    it('changing the picker refetches with that size and the pager follows', async () => {
      mockSearchPolicies.mockResolvedValue({ items: policies(20), total: 183 })
      renderSearch('/search?page=1&pageSize=20&mode=policies')
      await screen.findByRole('button', { name: 'PA-001' })

      fireEvent.change(screen.getByRole('combobox', { name: 'Results per page' }), { target: { value: '50' } })

      await waitFor(() => expect(mockSearchPolicies).toHaveBeenLastCalledWith('', expect.objectContaining({ page: 1, pageSize: 50 })))
      expect((screen.getByRole('combobox', { name: 'Results per page' }) as HTMLSelectElement).value).toBe('50')
      expect(await screen.findByText('Page 1 of 4')).toBeInTheDocument()
    })

    it('reads hostile or out-of-range URL page sizes safely', () => {
      expect(parseSearchPageSize(null)).toBe(20)
      expect(parseSearchPageSize('')).toBe(20)
      expect(parseSearchPageSize('0')).toBe(20)
      expect(parseSearchPageSize('-5')).toBe(20)
      expect(parseSearchPageSize('12.5')).toBe(20)
      expect(parseSearchPageSize('abc')).toBe(20)
      expect(parseSearchPageSize('1e9')).toBe(100)
      expect(parseSearchPageSize('500')).toBe(100)
      expect(parseSearchPageSize('37')).toBe(37)
      expect(searchPageSizeOptions(20)).toEqual([10, 20, 25, 50, 100])
      expect(searchPageSizeOptions(37)).toEqual([10, 20, 25, 37, 50, 100])
    })

    it('clamps an oversized URL page size and shows it in the picker', async () => {
      mockSearchPolicies.mockResolvedValue({ items: policies(5), total: 183 })
      renderSearch('/search?page=1&pageSize=500&mode=policies')
      await screen.findByRole('button', { name: 'PA-001' })
      expect(mockSearchPolicies).toHaveBeenLastCalledWith('', expect.objectContaining({ pageSize: 100 }))
      expect((screen.getByRole('combobox', { name: 'Results per page' }) as HTMLSelectElement).value).toBe('100')
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    })

    it('shows product display names, not codes, in policy rows', async () => {
      mockSearchPolicies.mockResolvedValue({
        items: [...policies(1, 'commercial-auto'), { ...policies(2, 'farm-owners')[1] }],
        total: 2,
      })
      renderSearch()
      await screen.findByRole('button', { name: 'PA-001' })
      const table = screen.getByRole('grid')
      expect(within(table).getByText('Commercial Auto')).toBeInTheDocument()
      // Unknown codes are humanized rather than shown raw.
      expect(within(table).getByText('Farm Owners')).toBeInTheDocument()
      expect(within(table).queryByText('commercial-auto')).not.toBeInTheDocument()
      expect(within(table).queryByText('farm-owners')).not.toBeInTheDocument()
    })

    it('uses a short dates header with the full label as a tooltip', async () => {
      mockSearchPolicies.mockResolvedValue({ items: policies(1), total: 1 })
      renderSearch()
      await screen.findByRole('button', { name: 'PA-001' })
      const header = screen.getByRole('button', { name: /Effective - Expiration/ })
      expect(header).toHaveAttribute('title', 'Effective - Expiration')
      expect(screen.queryByText('Effective Date - Expiration Date')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Created/ })).toHaveAttribute('title', 'Created')
    })

    it('explains Issued vs In Force in a status legend and a status tooltip', async () => {
      const [inForce, issued] = policies(2)
      mockSearchPolicies.mockResolvedValue({
        items: [
          { ...inForce, term: { effectiveDate: '2000-01-01', expirationDate: '2999-01-01' } },
          { ...issued, term: { effectiveDate: '2998-01-01', expirationDate: '2999-01-01' } },
        ],
        total: 2,
      })
      renderSearch()
      await screen.findByRole('button', { name: 'PA-001' })

      const legend = screen.getByTestId('policy-status-legend')
      expect(within(legend).getByText('What the statuses mean')).toBeInTheDocument()
      expect(within(legend).getByText('Documents issued; the term has not started yet.')).toBeInTheDocument()
      expect(within(legend).getByText('Issued and the current term has started.')).toBeInTheDocument()

      const statusCell = (policyNumber: string) =>
        (screen.getByRole('button', { name: policyNumber }).closest('tr') as HTMLElement)
          .querySelector('td[data-col="status"]') as HTMLElement
      expect(within(statusCell('PA-001')).getByText('In Force')).toBeInTheDocument()
      expect(statusCell('PA-001')).toHaveAttribute('title', 'Issued and the current term has started.')
      expect(within(statusCell('PA-002')).getByText('Issued')).toBeInTheDocument()
      expect(statusCell('PA-002')).toHaveAttribute('title', 'Documents issued; the term has not started yet.')
    })
  })

  describe('results toolbar', () => {
    const onePolicy = {
      items: [
        {
          policyId: 'policy-1',
          policyNumber: 'PA-100',
          insuredName: 'Ada Lovelace',
          productCode: 'personal-auto',
          status: 'Issued',
          internalStatus: 'Issued',
          term: { effectiveDate: '2026-07-01', expirationDate: '2027-07-01' },
          premium: { total: { amount: 1234.56 } },
          createdAt: '2026-06-01T10:00:00.000Z',
          updatedAt: '2026-06-02T10:00:00.000Z',
        },
      ],
      total: 1,
    }

    beforeEach(() => {
      localStorage.clear()
      mockSearchPolicies.mockResolvedValue(onePolicy)
      ;(URL as any).createObjectURL = vi.fn(() => 'blob:export')
      ;(URL as any).revokeObjectURL = vi.fn()
    })

    it('Export CSV requests the export for the active filters and sort, and downloads it', async () => {
      mockExportPoliciesCsv.mockResolvedValue(new Blob(['policyNumber\nPA-100'], { type: 'text/csv' }))
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

      renderSearch('/search?q=Ada&status=Issued&product=personal-auto&page=1&pageSize=20&mode=policies&sortBy=premium&sortDir=asc')
      await screen.findByRole('button', { name: 'PA-100' })
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

      await waitFor(() => expect(mockExportPoliciesCsv).toHaveBeenCalledTimes(1))
      expect(mockExportPoliciesCsv).toHaveBeenCalledWith(expect.objectContaining({
        q: 'Ada',
        product: 'personal-auto',
        sortBy: 'premium',
        sortDir: 'asc',
      }))
      // Export is for the whole result set, so it must not carry paging.
      expect(mockExportPoliciesCsv.mock.calls[0][0]).not.toHaveProperty('page')
      await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
      click.mockRestore()
    })

    it('shows the failure when the export request fails', async () => {
      mockExportPoliciesCsv.mockRejectedValue(new Error('Export failed 500'))
      renderSearch()
      await screen.findByRole('button', { name: 'PA-100' })
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
      expect(await screen.findByText('Export failed 500')).toBeInTheDocument()
    })

    it('disables Export CSV when there is nothing to export', async () => {
      mockSearchPolicies.mockResolvedValue({ items: [], total: 0 })
      renderSearch()
      await waitFor(() => expect(mockSearchPolicies).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled())
    })

    it('Columns menu hides and restores a column in both header and rows, and remembers the choice', async () => {
      const first = renderSearch()
      await screen.findByRole('button', { name: 'PA-100' })
      expect(screen.getByRole('button', { name: 'Premium' })).toBeInTheDocument()
      expect(screen.getByText('$1,234.56')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
      const menu = screen.getByRole('group', { name: 'Visible columns' })
      expect(menu).toBeInTheDocument()
      fireEvent.click(screen.getByRole('checkbox', { name: 'Premium' }))

      expect(screen.queryByRole('button', { name: 'Premium' })).not.toBeInTheDocument()
      expect(screen.queryByText('$1,234.56')).not.toBeInTheDocument()
      // The identifying column is never hideable.
      expect(screen.queryByRole('checkbox', { name: /Policy #/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'PA-100' })).toBeInTheDocument()

      // Persisted across a remount.
      first.unmount()
      renderSearch()
      await screen.findByRole('button', { name: 'PA-100' })
      expect(screen.queryByText('$1,234.56')).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Columns' }))
      fireEvent.click(screen.getByRole('checkbox', { name: 'Premium' }))
      expect(screen.getByText('$1,234.56')).toBeInTheDocument()
    })
  })
})
