import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
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
const ready = { status: 'READY', available: true, byteSize: 100, contentType: 'application/pdf', integrityStatus: 'VERIFIED' }

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
    vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null, location: { href: '' }, close: vi.fn() }) as unknown as Window)
    vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  it('does not request content when the browser blocks the reserved tab', async () => {
    mockUseDocuments.mockReturnValue({ data: { documents: [{ ...ready, documentId: 'doc-1', type: 'POLICY_PACKET' }] }, isLoading: false, error: null } as any)
    vi.mocked(window.open).mockReturnValue(null)
    render(<PolicyDocumentsPanel policyId="policy-1" />)
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(mockDownload).not.toHaveBeenCalled()
    expect(window.alert).toHaveBeenCalledWith('Allow pop-ups to open policy documents.')
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

    // Name cell and type cell both read the display name; no transaction type is known here.
    expect(screen.getAllByText('Policy packet')).toHaveLength(2)
    expect(screen.getAllByText('Rating worksheet')).toHaveLength(2)
    expect(screen.queryByText(/POLICY_PACKET|RATING_WORKSHEET/)).not.toBeInTheDocument()
    expect(screen.getByText('VERIFIED')).toBeInTheDocument()
    expect(screen.getByText('FAILED')).toBeInTheDocument()
    expect(screen.getAllByText('TX-1')).toHaveLength(2)
  })

  it('names documents by type and transaction, with the format as the type', () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          { ...ready, documentId: 'doc-rn', displayName: 'POLICY_PACKET (Renew) RN-20261020-1', type: 'POLICY_PACKET', transactionType: 'Renew', transactionNumber: 'RN-20261020-1', versionId: 'ver-rn', transactionId: 'tx-rn' },
          { ...ready, documentId: 'doc-nb', displayName: 'RATING_WORKSHEET (NB) NB-20261020-1', type: 'RATING_WORKSHEET', transactionType: 'NB', transactionNumber: 'NB-20261020-1', contentType: 'text/html' },
          { ...ready, documentId: 'doc-form', displayName: 'Auto Declarations (Endorse) [PA-DEC] (Endorse) EN-1', type: 'POLICY_FORM_DOCUMENT', transactionType: 'Endorse', transactionNumber: 'EN-1', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          { ...ready, documentId: 'doc-legacy', displayName: 'Legacy upload', type: '' },
        ],
      },
      isLoading: false,
      error: null,
    } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    const names = screen.getAllByTestId('policy-document-name').map((node) => node.textContent)
    expect(names).toEqual([
      'Policy packet — Renewal',
      'Rating worksheet — New business',
      'Auto Declarations (Endorse) [PA-DEC] — Endorsement',
      'Legacy upload',
    ])
    const renewalRow = screen.getByText('Policy packet — Renewal').closest('tr')!
    expect(within(renewalRow).getByText('RN-20261020-1')).toBeInTheDocument()
    expect(within(renewalRow).getByText('PDF')).toBeInTheDocument()
    expect(within(renewalRow).getByText('Policy packet')).toBeInTheDocument()
    expect(renewalRow).not.toHaveTextContent(/POLICY_PACKET|\bRenew\b/)
    const worksheetRow = screen.getByText('Rating worksheet — New business').closest('tr')!
    expect(within(worksheetRow).getByText('HTML')).toBeInTheDocument()
  })

  it('shows version and transaction IDs only after Details is expanded', async () => {
    mockUseDocuments.mockReturnValue({
      data: { documents: [{ ...ready, documentId: 'doc-1', type: 'POLICY_PACKET', transactionType: 'NB', versionId: 'ver-123', transactionId: 'tx-456' }] },
      isLoading: false,
      error: null,
    } as any)

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    expect(screen.queryByText(/ver-123/)).not.toBeInTheDocument()
    expect(screen.queryByText(/tx-456/)).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: 'Details for Policy packet — New business' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Version ver-123')).toBeInTheDocument()
    expect(screen.getByText('Transaction ID tx-456')).toBeInTheDocument()

    await userEvent.click(toggle)
    expect(screen.queryByText('Version ver-123')).not.toBeInTheDocument()
  })

  it('offers no Details toggle when a document has no version or transaction ID', () => {
    mockUseDocuments.mockReturnValue({
      data: { documents: [{ ...ready, documentId: 'doc-1', type: 'POLICY_PACKET' }] },
      isLoading: false,
      error: null,
    } as any)
    render(<PolicyDocumentsPanel policyId="policy-1" />)
    expect(screen.queryByRole('button', { name: /^Details/ })).not.toBeInTheDocument()
  })

  it('downloads/opens a document via the content endpoint when Open is clicked', async () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            ...ready,
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

    expect(mockDownload).toHaveBeenCalledWith('policy-1', 'doc-1', undefined)
    expect(window.open).toHaveBeenCalled()
  })

  it('shows an alert when opening a document fails', async () => {
    mockUseDocuments.mockReturnValue({
      data: {
        documents: [
          {
            ...ready,
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
    mockDownload.mockRejectedValue(new Error('Document download failed 409'))

    render(<PolicyDocumentsPanel policyId="policy-1" />)

    await userEvent.click(screen.getByRole('button', { name: 'Open' }))

    expect(window.alert).toHaveBeenCalledWith('Document download failed 409')
  })

  it.each([
    { integrityStatus: 'FAILED' }, { integrityStatus: 'UNVERIFIED' },
    { status: 'PENDING' }, { status: 'UNKNOWN' }, { available: false },
    { byteSize: 0 }, { contentType: null },
  ])('never opens an unavailable archive: %j', async (overrides) => {
    mockUseDocuments.mockReturnValue({ data: { documents: [{ ...ready, ...overrides, documentId: 'doc' }] }, isLoading: false } as any)
    render(<PolicyDocumentsPanel policyId="policy" />)
    const open = screen.getByRole('button', { name: 'Open' })
    expect(open).toBeDisabled()
    await userEvent.click(open)
    expect(mockDownload).not.toHaveBeenCalled()
  })

  it('retains exact version and transaction references on archive retrieval', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    mockUseDocuments.mockReturnValue({ data: { documents: [{ ...ready, documentId: 'doc', versionId: 'v1', transactionId: 'tx1', transactionNumber: 'END-1', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }] }, isLoading: false } as any)
    mockDownload.mockResolvedValue(new Blob(['native bytes']))
    render(<PolicyDocumentsPanel policyId="policy" />)
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(mockDownload).toHaveBeenCalledWith('policy', 'doc', { versionId: 'v1', transactionId: 'tx1' })
    expect(screen.queryByText('Version v1')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Details for/ }))
    expect(screen.getByText('Version v1')).toBeInTheDocument()
    expect(click).toHaveBeenCalled()
    expect(window.open).not.toHaveBeenCalled()
    click.mockRestore()
  })
})
