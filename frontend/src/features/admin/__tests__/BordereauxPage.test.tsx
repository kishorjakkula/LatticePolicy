import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { BordereauxPage } from '../BordereauxPage'

const useBordereauxBatchesMock = vi.fn()
const useBordereauxRowsMock = vi.fn()
const generateMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useBordereauxBatches: (...args: any[]) => useBordereauxBatchesMock(...args),
  useBordereauxRows: (...args: any[]) => useBordereauxRowsMock(...args),
  useGenerateBordereauxMutation: () => ({ mutateAsync: generateMutateMock, isPending: false }),
}))

describe('BordereauxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBordereauxBatchesMock.mockReturnValue({
      data: {
        items: [
          {
            batch_id: 'batch-1',
            bordereau_type: 'RISK',
            status: 'Generated',
            period_start: '2026-01-01',
            period_end: '2026-12-31',
            product_code: 'auto',
            row_count: 3,
            valid_row_count: 2,
            invalid_row_count: 1,
            version: 1,
            corrects_batch_id: null,
            generated_at: '2026-06-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    useBordereauxRowsMock.mockReturnValue({
      data: {
        items: [
          { rowNumber: 1, policyNumber: 'POL-1', isValid: true, validationErrors: [], data: { riskKind: 'Vehicle' } },
        ],
      },
      isLoading: false,
    })
  })

  it('renders generated batches with row counts', () => {
    render(<BordereauxPage />)
    expect(screen.getByText('Bordereaux')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'RISK' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Generated' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'auto' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '3' })).toBeInTheDocument()
  })

  it('shows an empty state when no batches exist', () => {
    useBordereauxBatchesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    render(<BordereauxPage />)
    expect(screen.getByText('No bordereaux batches generated yet')).toBeInTheDocument()
  })

  it('generates a new batch from the form', async () => {
    const user = userEvent.setup()
    render(<BordereauxPage />)

    await user.type(screen.getByLabelText('Period Start'), '2026-01-01')
    await user.type(screen.getByLabelText('Period End'), '2026-12-31')
    await user.type(screen.getByLabelText('Product Code'), 'auto')
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await waitFor(() => {
      expect(generateMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          bordereauType: 'RISK',
          periodStart: '2026-01-01',
          periodEnd: '2026-12-31',
          productCode: 'auto',
        })
      )
    })
  })

  it('toggles row detail view for a batch', async () => {
    const user = userEvent.setup()
    render(<BordereauxPage />)

    await user.click(screen.getByRole('button', { name: 'View rows' }))
    expect(await screen.findByText('POL-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Hide rows' }))
    expect(screen.queryByText('POL-1')).not.toBeInTheDocument()
  })
})
