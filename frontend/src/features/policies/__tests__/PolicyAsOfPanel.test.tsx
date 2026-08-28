import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import { vi } from 'vitest'

const getPolicyState = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    getPolicyState: (...args: any[]) => getPolicyState(...args),
  },
}))

import { PolicyAsOfPanel } from '../PolicyAsOfPanel'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('PolicyAsOfPanel', () => {
  beforeEach(() => {
    getPolicyState.mockReset()
  })

  test('does not call the API until a date is submitted', () => {
    render(<PolicyAsOfPanel policyId="p-1" />, { wrapper })
    expect(getPolicyState).not.toHaveBeenCalled()
  })

  test('fetches and displays the as-of snapshot once a date is submitted', async () => {
    getPolicyState.mockResolvedValue({
      policyId: 'p-1',
      policyNumber: 'POL-1',
      asOf: '2026-02-01',
      segmentStart: '2026-01-01',
      segmentEnd: '2026-06-30',
      premium: {
        total: { amount: 1200, currency: 'USD' },
        fees: { amount: 25, currency: 'USD' },
        taxes: { amount: 50, currency: 'USD' },
      },
    })

    render(<PolicyAsOfPanel policyId="p-1" />, { wrapper })

    fireEvent.click(screen.getByText('View policy as of a date'))
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByText('View as of'))

    await waitFor(() => {
      expect(getPolicyState).toHaveBeenCalledWith('p-1', '2026-02-01')
    })
    await waitFor(() => {
      expect(screen.getByTestId('policy-asof-result')).toBeInTheDocument()
    })
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
  })

  test('clearing resets the query and hides the result', async () => {
    getPolicyState.mockResolvedValue({
      policyId: 'p-1',
      policyNumber: 'POL-1',
      asOf: '2026-02-01',
      segmentStart: '2026-01-01',
      segmentEnd: '2026-06-30',
      premium: { total: { amount: 1200, currency: 'USD' } },
    })

    render(<PolicyAsOfPanel policyId="p-1" />, { wrapper })
    fireEvent.click(screen.getByText('View policy as of a date'))
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByText('View as of'))

    await waitFor(() => {
      expect(screen.getByTestId('policy-asof-result')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByTestId('policy-asof-result')).not.toBeInTheDocument()
  })
})
