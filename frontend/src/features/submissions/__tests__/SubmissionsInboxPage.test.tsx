import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SubmissionsInboxPage } from '../SubmissionsInboxPage'
import { useAuth } from '../../../auth/AuthContext'

vi.mock('../../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const mockUseSubmissions = vi.fn()
vi.mock('../../../api/hooks', () => ({
  useSubmissions: (...args: any[]) => mockUseSubmissions(...args),
  useIntakeSettings: () => ({ data: {
    provider: 'builtin', model: null, label: 'Built-in reader (no AI model)', configured: true, problem: null,
    readsPdfAndImages: false, sendsDocumentsOffStack: false, maxDocuments: 10, maxDocumentBytes: 10485760,
    products: [{ code: 'commercial-auto', label: 'Commercial Auto', riskLabel: 'Fleet' }], attestation: 'x',
  } }),
  useCreateSubmission: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

const mockUseAuth = vi.mocked(useAuth)

const items = [
  { submissionId: 's1', submissionNumber: 'SUB-1', status: 'IN_REVIEW', channel: 'upload', insuredName: 'Northline Logistics LLC', brokerName: 'Brightway', productCode: 'commercial-auto', aiRun: { counts: {} }, assignedTo: 'uw1', receivedAt: '2026-10-17T09:42:00Z', fieldTotal: 18, fieldConfirmed: 12, fieldAttention: 4, fieldConflicts: 1, documentCount: 3 },
  { submissionId: 's2', submissionNumber: 'SUB-2', status: 'READING', channel: 'upload', insuredName: null, subject: 'harbor.pdf', productCode: null, aiRun: {}, receivedAt: '2026-10-17T09:58:00Z', fieldTotal: 0, documentCount: 1 },
]

describe('SubmissionsInboxPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSubmissions.mockReturnValue({ data: { items, total: 2, page: 1, pageSize: 25, statusCounts: { IN_REVIEW: 1, READING: 1 } }, isLoading: false })
  })

  it('shows the queue with progress, the reader in use, and stage filters', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u', roles: ['underwriter'], permissions: [] } } as any)
    render(<MemoryRouter><SubmissionsInboxPage /></MemoryRouter>)

    expect(screen.getByText(/documents stay in this system/)).toBeInTheDocument()
    expect(screen.getByText(/PDFs and images are kept but need an AI model/)).toBeInTheDocument()
    const queue = screen.getByRole('table')
    expect(within(queue).getByText((_, element) => element?.textContent === '12 of 18 confirmed')).toBeInTheDocument()
    expect(within(queue).getByText(/4 need attention · 1 conflict/)).toBeInTheDocument()
    expect(within(queue).getByText('AI reading')).toBeInTheDocument()
    expect(within(queue).getByRole('link', { name: /Review Northline Logistics LLC/ })).toHaveAttribute('href', '/submissions/s1')

    fireEvent.click(screen.getByRole('button', { name: /Ready for review/ }))
    expect(mockUseSubmissions).toHaveBeenLastCalledWith('READY_FOR_REVIEW')
    expect(screen.getByRole('button', { name: /Upload and read/ })).toBeDisabled()
  })

  it('hides the upload form from users who cannot manage submissions', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u', roles: ['read_only'], permissions: ['submissions.read'] } } as any)
    render(<MemoryRouter><SubmissionsInboxPage /></MemoryRouter>)
    expect(screen.queryByText('Drop a broker email or documents here')).not.toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})
