import React from 'react'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import FormsAdmin from '../FormsAdmin'

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('FormsAdmin', () => {
  test('renders New Form Template button', () => {
    render(<FormsAdmin />, { wrapper })
    expect(screen.getByText(/New Form Template/i)).toBeInTheDocument()
  })
})
