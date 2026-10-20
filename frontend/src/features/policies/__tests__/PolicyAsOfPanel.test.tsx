import React, { useState } from 'react'
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

import { PolicyAsOfControl, PolicyAsOfResult } from '../PolicyAsOfPanel'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

// The header control and the result card share the page's as-of state.
function AsOfHarness() {
  const [asOf, setAsOf] = useState<string | null>(null)
  return (
    <>
      <PolicyAsOfControl asOf={asOf} onChange={setAsOf} />
      <PolicyAsOfResult policyId="p-1" asOf={asOf} />
    </>
  )
}

const snapshot = {
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
}

describe('Policy as-of control and result', () => {
  beforeEach(() => {
    getPolicyState.mockReset()
  })

  test('does not call the API or render a result until a date is submitted', () => {
    render(<AsOfHarness />, { wrapper })
    expect(getPolicyState).not.toHaveBeenCalled()
    expect(screen.queryByTestId('policy-asof-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View as of' })).toBeDisabled()
  })

  test('fetches and displays the as-of snapshot once a date is submitted', async () => {
    getPolicyState.mockResolvedValue(snapshot)
    render(<AsOfHarness />, { wrapper })

    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'View as of' }))

    await waitFor(() => {
      expect(getPolicyState).toHaveBeenCalledWith('p-1', '2026-02-01')
    })
    await waitFor(() => {
      expect(screen.getByTestId('policy-asof-result')).toBeInTheDocument()
    })
    expect(screen.getByText('$1,200.00')).toBeInTheDocument()
  })

  test('clearing resets the query and hides the result', async () => {
    getPolicyState.mockResolvedValue(snapshot)
    render(<AsOfHarness />, { wrapper })
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'View as of' }))

    await waitFor(() => {
      expect(screen.getByTestId('policy-asof-result')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByTestId('policy-asof-result')).not.toBeInTheDocument()
    expect(screen.getByLabelText('As of date')).toHaveValue('')
  })

  test('reports a failed snapshot instead of showing stale data', async () => {
    getPolicyState.mockRejectedValue(new Error('boom'))
    render(<AsOfHarness />, { wrapper })
    fireEvent.change(screen.getByLabelText('As of date'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'View as of' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load policy state as of')
    expect(screen.queryByTestId('policy-asof-result')).not.toBeInTheDocument()
  })
})
