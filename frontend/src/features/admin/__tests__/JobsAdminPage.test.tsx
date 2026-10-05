import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { JobsAdminPage } from '../JobsAdminPage'

const useJobDefinitionsMock = vi.fn()
const useJobRunsMock = vi.fn()
const useJobRunMock = vi.fn()
const retryMutateMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useJobDefinitions: (...args: any[]) => useJobDefinitionsMock(...args),
  useJobRuns: (...args: any[]) => useJobRunsMock(...args),
  useJobRun: (...args: any[]) => useJobRunMock(...args),
  useRetryJobRunMutation: () => ({ mutateAsync: retryMutateMock, isPending: false }),
}))

describe('JobsAdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useJobDefinitionsMock.mockReturnValue({
      data: {
        items: [
          {
            job_code: 'policy.renewal.notice',
            description: 'Sends renewal notices',
            enabled: true,
            default_schedule: '0 6 * * *',
            default_max_attempts: 5,
            default_timeout_seconds: 300,
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    useJobRunsMock.mockReturnValue({
      data: {
        items: [
          {
            run_id: 'run-1',
            job_code: 'policy.renewal.notice',
            status: 'DeadLettered',
            attempts: 5,
            max_attempts: 5,
            last_error: 'Timed out',
            finished_at: '2026-01-02T00:00:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
          },
          {
            run_id: 'run-2',
            job_code: 'policy.renewal.notice',
            status: 'Succeeded',
            attempts: 1,
            max_attempts: 5,
            last_error: null,
            finished_at: '2026-01-01T00:05:00.000Z',
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    })
    useJobRunMock.mockReturnValue({
      data: { run: { last_error: 'Timed out' }, events: [] },
      isLoading: false,
      error: null,
    })
  })

  it('renders job definitions and run history', () => {
    render(<JobsAdminPage />)
    expect(screen.getByText('Job Queue')).toBeInTheDocument()
    expect(screen.getAllByText('policy.renewal.notice').length).toBeGreaterThan(0)
    expect(screen.getByText('Timed out')).toBeInTheDocument()
  })

  it('shows an empty state when there are no runs', () => {
    useJobRunsMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    render(<JobsAdminPage />)
    expect(screen.getByText('No job runs match the current filters.')).toBeInTheDocument()
  })

  it('shows an error state when runs fail to load', () => {
    useJobRunsMock.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') })
    render(<JobsAdminPage />)
    expect(screen.getByText('Error: boom')).toBeInTheDocument()
  })

  it('only shows a retry action for dead-lettered runs', () => {
    render(<JobsAdminPage />)
    const retryButtons = screen.getAllByRole('button', { name: 'Retry' })
    expect(retryButtons).toHaveLength(1)
  })

  it('retries a dead-lettered run', async () => {
    const user = userEvent.setup()
    render(<JobsAdminPage />)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => {
      expect(retryMutateMock).toHaveBeenCalledWith('run-1')
    })
  })

  it('opens run detail on view', async () => {
    const user = userEvent.setup()
    render(<JobsAdminPage />)
    await user.click(screen.getAllByRole('button', { name: 'View' })[0])
    expect(screen.getByText('Run Detail — run-1')).toBeInTheDocument()
  })
})
