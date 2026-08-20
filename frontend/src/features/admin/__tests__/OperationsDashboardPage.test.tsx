import React from 'react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { OperationsDashboardPage } from '../OperationsDashboardPage'

const useDashboardSummaryMock = vi.fn()
const useDashboardOutboxMock = vi.fn()
const useDashboardNotificationsMock = vi.fn()
const useOfacScreensMock = vi.fn()
const useUwReferralsMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useDashboardSummary: (...args: any[]) => useDashboardSummaryMock(...args),
  useDashboardOutbox: (...args: any[]) => useDashboardOutboxMock(...args),
  useDashboardNotifications: (...args: any[]) => useDashboardNotificationsMock(...args),
  useOfacScreens: (...args: any[]) => useOfacScreensMock(...args),
  useUwReferrals: (...args: any[]) => useUwReferralsMock(...args),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <OperationsDashboardPage />
    </MemoryRouter>,
  )
}

describe('OperationsDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDashboardSummaryMock.mockReturnValue({
      data: { outbox: { Failed: 2, Pending: 1 }, ofac: { PENDING: 1 }, referrals: { Open: 3 }, notifications: { Failed: 1, Suppressed: 0 } },
      isLoading: false,
      error: null,
    })
    useDashboardOutboxMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    useDashboardNotificationsMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    useOfacScreensMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    useUwReferralsMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
  })

  it('renders summary counts from aggregated data', () => {
    renderPage()
    expect(screen.getByText('Outbox Failed')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('UW Referrals Open')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('shows empty states when panels have no data', () => {
    renderPage()
    expect(screen.getByText('No pending or failed outbox messages.')).toBeInTheDocument()
    expect(screen.getByText('No failed or suppressed notifications.')).toBeInTheDocument()
    expect(screen.getByText('No pending OFAC reviews.')).toBeInTheDocument()
    expect(screen.getByText('No open underwriting referrals.')).toBeInTheDocument()
  })

  it('renders an outbox failure row with a link to the source policy when a notification has one', () => {
    useDashboardNotificationsMock.mockReturnValue({
      data: {
        items: [
          {
            notification_id: 'n1',
            policy_id: 'policy-123',
            transaction_id: null,
            event_type: 'POLICY_ISSUED',
            channel: 'EMAIL',
            status: 'Failed',
            attempts: 4,
            last_error: 'smtp timeout',
            created_at: new Date().toISOString(),
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    renderPage()
    expect(screen.getByText('POLICY_ISSUED')).toBeInTheDocument()
    expect(screen.getByText('smtp timeout')).toBeInTheDocument()
    const link = screen.getByText('Open')
    expect(link.closest('a')).toHaveAttribute('href', '/policies/policy-123')
  })

  it('shows an error message when the summary query fails', () => {
    useDashboardSummaryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('network down') })
    renderPage()
    expect(screen.getByText('Error: network down')).toBeInTheDocument()
  })
})
