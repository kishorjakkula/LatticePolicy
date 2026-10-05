import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortalDocumentsPanel } from '../PortalDocumentsPanel'
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

describe('PortalDocumentsPanel', () => {
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
  })

  it('shows a loading state', () => {
    mockUseDocuments.mockReturnValue({ data: undefined, isLoading: true, error: null } as any)

    render(<PortalDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('Loading documents...')).toBeInTheDocument()
  })

  it('shows an error state without rendering the table', () => {
    mockUseDocuments.mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') } as any)

    render(<PortalDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('Error: boom')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('shows an empty state when there are no documents', () => {
    mockUseDocuments.mockReturnValue({ data: { documents: [] }, isLoading: false, error: null } as any)

    render(<PortalDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('No documents are available for this policy yet.')).toBeInTheDocument()
  })

  it('renders customer-safe document rows and opens a document on demand', async () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: 'doc-1',
            displayName: 'Policy Document Packet',
            type: 'POLICY_PACKET',
            generatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)
    mockDownload.mockResolvedValue(new Blob(['<html></html>'], { type: 'text/html' }))

    render(<PortalDocumentsPanel policyId="policy-1" />)

    expect(screen.getByText('Policy Document Packet')).toBeInTheDocument()
    expect(screen.getByText('POLICY_PACKET')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(mockDownload).toHaveBeenCalledWith('policy-1', 'doc-1')
  })

  it('does not render internal-only fields such as storage URIs or tenant identifiers', () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            documentId: 'doc-1',
            displayName: 'Policy Document Packet',
            type: 'POLICY_PACKET',
            generatedAt: '2026-07-01T00:00:00.000Z',
            // The backend never sends these for portal callers, but this
            // guards against a future regression rendering them if it did.
            tenantId: 'sample-carrier',
            storageUri: 'file:///internal/path',
          },
        ],
      },
      isLoading: false,
      error: null,
    } as any)

    render(<PortalDocumentsPanel policyId="policy-1" />)

    expect(screen.queryByText('sample-carrier')).not.toBeInTheDocument()
    expect(screen.queryByText('file:///internal/path')).not.toBeInTheDocument()
  })
})
