import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PolicyDocumentsPanel } from '../PolicyDocumentsPanel'
import { usePolicyDocuments } from '../../../api/hooks'
import { api } from '../../../api/client'

vi.mock('../../../api/hooks', () => ({
  usePolicyDocuments: vi.fn(),
}))

vi.mock('../../../api/client', () => ({
  api: {
    downloadPolicyDocument: vi.fn(),
  },
}))

const mockUseDocuments = vi.mocked(usePolicyDocuments)
const mockDownload = vi.mocked(api.downloadPolicyDocument)

describe('PolicyDocumentsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    if (!('createObjectURL' in URL)) {
      ;(URL as any).createObjectURL = vi.fn()
      ;(URL as any).revokeObjectURL = vi.fn()
    } else {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    }
    vi.spyOn(window, 'open').mockImplementation(() => null)
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('shows a loading state', () => {
    mockUseDocuments.mockReturnValue({ data: undefined, isLoading: true, error: null } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('Loading documents...')).toBeInTheDocument()
  })

  it('shows an error state without rendering the table', () => {
    mockUseDocuments.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no documents', () => {
    mockUseDocuments.mockReturnValue({ data: { documents: [] }, isLoading: false, error: null } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('No documents have been generated for this policy yet.')).toBeInTheDocument()
  })

  it('renders document rows including type, transaction number and integrity status', () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: 'doc-1',
            displayName: 'POLICY_PACKET TX-1',
            type: 'POLICY_PACKET',
            transactionNumber: 'TX-1',
            integrityStatus: 'VERIFIED',
            generatedAt: '2026-07-01T00:00:00.000Z',
          },
          {
            documentId: 'doc-2',
            displayName: 'RATING_WORKSHEET TX-1',
            type: 'RATING_WORKSHEET',
            transactionNumber: 'TX-1',
            integrityStatus: 'FAILED',
            generatedAt: '2026-07-02T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('POLICY_PACKET TX-1')).toBeInTheDocument()
    expect(screen.getByText('RATING_WORKSHEET TX-1')).toBeInTheDocument()
    expect(screen.getByText('VERIFIED')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
    expect(screen.getAllByText('TX-1')).toHaveLength(2)
  })

  it('downloads/opens a document via the content endpoint when Open is clicked', async () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: 'doc-1',
            displayName: 'Policy Document Packet',
            type: 'POLICY_PACKET',
            integrityStatus: 'VERIFIED',
            generatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)
    mockDownload.mockResolvedValue(new Blob(['%PDF-1.4'], { type: 'application/pdf' }))

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(mockDownload).toHaveBeenCalledWith('policy-1', 'doc-1')
    expect(window.open).toHaveBeenCalled()
  })

  it('shows an alert when opening a document fails', async () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: 'doc-1',
            displayName: 'Policy Document Packet',
            type: 'POLICY_PACKET',
            integrityStatus: 'UNVERIFIED',
            generatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)
    mockDownload.mockRejectedValue(new Error('Document download failed 409'))

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(window.alert).toHaveBeenCalledWith('Document download failed 409')
  })
})
