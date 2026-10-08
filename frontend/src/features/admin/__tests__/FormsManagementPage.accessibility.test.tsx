import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormsManagementPage } from '../FormsManagementPage'

vi.mock('../../../api/hooks', () => ({
  useForms: () => ({
    data: [
      {
        formId: 'form-1',
        formNumber: 'PA-100',
        formTitle: 'Personal Auto Coverage Form',
        editionDate: '2026-01-01',
        workflowStatus: 'Approved',
        active: true,
        jurisdictionCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  }),
  useForm: () => ({ data: undefined, refetch: vi.fn() }),
  useFormTemplateVariables: () => ({ data: { variables: [] }, isLoading: false }),
}))

vi.mock('../../../api/client', () => ({ apiAdmin: {} }))

describe('FormsManagementPage accessibility', () => {
  it('names icon-only row actions and renders no unnamed buttons', () => {
    render(<FormsManagementPage />)

    expect(screen.getByRole('button', { name: 'View PA-100' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit PA-100' })).toBeInTheDocument()
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName()
    }
  })
})
