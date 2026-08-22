import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ExposurePage } from '../ExposurePage'

const useExposureSummaryMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useExposureSummary: (...args: any[]) => useExposureSummaryMock(...args),
}))

describe('ExposurePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows a loading message while the summary is loading', () => {
    useExposureSummaryMock.mockReturnValue({ data: undefined, isLoading: true, error: null })
    render(<ExposurePage />)
    expect(screen.getByText('Loading exposure summary…')).toBeInTheDocument()
  })

  it('shows an error message when the summary query fails', () => {
    useExposureSummaryMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('network down') })
    render(<ExposurePage />)
    expect(screen.getByText('Error: network down')).toBeInTheDocument()
  })

  it('shows empty-state messaging for each group when there is no exposure data', () => {
    useExposureSummaryMock.mockReturnValue({
      data: { policyCount: 0, asOf: '2026-01-01', totalTiv: 0, byProduct: [], byState: [], byClassOrIndustry: [] },
      isLoading: false,
      error: null,
    })
    render(<ExposurePage />)
    expect(screen.getByText('By Product')).toBeInTheDocument()
    expect(screen.getByText('By State')).toBeInTheDocument()
    expect(screen.getByText('By Class / Industry')).toBeInTheDocument()
    expect(screen.getAllByText('No exposure data for the current filters.')).toHaveLength(3)
  })

  it('renders grouped exposure rows when data is present', () => {
    useExposureSummaryMock.mockReturnValue({
      data: {
        policyCount: 42,
        asOf: '2026-01-01',
        totalTiv: 1000000,
        byProduct: [{ key: 'homeowners', policyCount: 10, totalTiv: 500000, totalVehicleFleetCount: 0, totalCyberAnnualRevenue: 0 }],
        byState: [],
        byClassOrIndustry: [],
      },
      isLoading: false,
      error: null,
    })
    render(<ExposurePage />)
    expect(screen.getByText('42', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'homeowners' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '500,000' })).toBeInTheDocument()
  })
})
