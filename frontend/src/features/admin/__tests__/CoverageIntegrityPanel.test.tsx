import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ result: { data: null as any, isLoading: false, error: null as unknown } }))
vi.mock('../../../api/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/hooks')>()),
  useCoverageIntegrity: () => state.result,
}))

import { CoverageIntegrityPanel } from '../OperationsDashboardPage'

const show = () =>
  render(
    <MemoryRouter>
      <CoverageIntegrityPanel />
    </MemoryRouter>,
  )

describe('Coverage Integrity panel', () => {
  it('lists records with the unexpected coverages and links to them', () => {
    state.result = {
      isLoading: false,
      error: null,
      data: {
        total: 2,
        truncated: false,
        items: [
          { kind: 'policy', id: 'p1', number: 'PC-1', productCode: 'personal-auto', status: 'Bound', unexpectedCodes: ['A', 'END_WB'], note: null, createdAt: '2026-10-18T03:16:00Z' },
          { kind: 'quote', id: 'q1', number: 'Q-1', productCode: 'homeowners', status: 'Rated', unexpectedCodes: ['DWELLING'], note: null, createdAt: '2026-10-11T00:00:00Z' },
        ],
      },
    }
    show()
    expect(screen.getByText(/Report only; nothing is changed/)).toBeInTheDocument()
    expect(screen.getByText('A, END_WB')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'PC-1' })).toHaveAttribute('href', '/policies/p1')
    expect(screen.getByRole('link', { name: 'Q-1' })).toHaveAttribute('href', '/wizard?quoteId=q1')
  })

  it('shows the empty state when every record is clean', () => {
    state.result = { isLoading: false, error: null, data: { items: [], total: 0, truncated: false } }
    show()
    expect(screen.getByText('All quotes and policies carry only coverages their product offers.')).toBeInTheDocument()
  })
})
