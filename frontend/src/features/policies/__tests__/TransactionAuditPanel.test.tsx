import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import { vi } from 'vitest'

vi.mock('../../../api/client', () => ({
  apiDetails: {
    getVersionDetails: vi.fn().mockResolvedValue({
      payload: {},
      diffs: [{ path: '/coverages/0/limit', old: 100000, new: 250000 }],
    }),
  },
  api: {
    downloadPolicyDocument: vi.fn().mockResolvedValue(new Blob(['test'])),
  },
}))

import { TransactionAuditPanel } from '../TransactionAuditPanel'

beforeAll(() => {
  if (typeof URL.createObjectURL !== 'function') (URL as any).createObjectURL = vi.fn()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')
  if (typeof URL.revokeObjectURL !== 'function') (URL as any).revokeObjectURL = vi.fn()
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

const baseVersion = {
  versionId: 'v-1',
  transactionId: 'tx-1',
  transactionNumber: 'END-001',
  transactionType: 'Endorse',
  effectiveDate: '2026-01-01',
  policyEffectiveDate: '2026-01-01',
  updatedDate: '2026-01-02T10:00:00Z',
  updatedUser: 'jane.underwriter',
  uwDecision: 'Approve',
  uwOverride: true,
  overrideReason: 'Loss history acceptable',
  premium: {
    total: { amount: 1200, currency: 'USD' },
    fees: { amount: 25, currency: 'USD' },
    taxes: { amount: 50, currency: 'USD' },
    calcTrace: { base: 1000 },
  },
}

const baseTransaction = {
  transactionId: 'tx-1',
  status: 'Issued',
  createdBy: 'jane.underwriter',
  forms: [{ policyFormId: 'f-1', code: 'HO-3', name: 'Homeowners Form', edition: '01/26' }],
  documents: [{ documentId: 'd-1', type: 'POLICY_PACKET', metadata: { customerSafe: true } }],
  notes: [{ noteId: 'n-1', noteType: 'reason', noteText: 'Customer requested coverage increase' }],
}

const ledgerEvents = [
  { eventId: 'e-1', event: 'PolicyEndorsed', fromState: 'Issued', toState: 'Issued', occurredAt: '2026-01-02T10:00:00Z', actor: 'jane.underwriter' },
]

describe('TransactionAuditPanel', () => {
  test('renders actor, dates, UW decision, forms, documents, notes, and ledger events', async () => {
    render(
      <TransactionAuditPanel
        policyId="p-1"
        version={baseVersion as any}
        timelineTransaction={baseTransaction as any}
        ledgerEvents={ledgerEvents as any}
      />,
      { wrapper },
    )

    expect(screen.getAllByText('jane.underwriter').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Customer requested coverage increase/)).toBeInTheDocument()
    expect(screen.getByText(/Approve/)).toBeInTheDocument()
    expect(screen.getByText(/Loss history acceptable/)).toBeInTheDocument()
    expect(screen.getByText(/HO-3/)).toBeInTheDocument()
    expect(screen.getByText(/POLICY_PACKET/)).toBeInTheDocument()
    expect(screen.getByText('PolicyEndorsed')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText(/Coverages.*0.*Limit/i)).toBeInTheDocument()
    })
    expect(screen.getByText('100000')).toBeInTheDocument()
    expect(screen.getByText('250000')).toBeInTheDocument()
  })

  test('shows empty states when no transaction data is linked', () => {
    render(
      <TransactionAuditPanel
        policyId="p-1"
        version={{ versionId: 'v-2' } as any}
        timelineTransaction={null}
        ledgerEvents={[]}
      />,
      { wrapper },
    )
    expect(screen.getByText(/No forms or documents generated/i)).toBeInTheDocument()
    expect(screen.getByText(/No ledger events recorded/i)).toBeInTheDocument()
  })

  test('displays rebased transactions and retro premium impact for an out-of-sequence transaction', () => {
    const oosTransaction = {
      ...baseTransaction,
      metadata: {
        outOfSequence: true,
        rebasedTransactions: [
          { transactionType: 'ENDORSE', transactionNumber: 'END-002', effectiveDate: '2026-02-01' },
        ],
        retroAdjustment: { totalDelta: 42.5, feesDelta: 1.5, taxesDelta: 3 },
      },
    }
    render(
      <TransactionAuditPanel
        policyId="p-1"
        version={baseVersion as any}
        timelineTransaction={oosTransaction as any}
        ledgerEvents={[]}
      />,
      { wrapper },
    )
    expect(screen.getByTestId('out-of-sequence-flag')).toBeInTheDocument()
    expect(screen.getByTestId('out-of-sequence-rebased-list')).toHaveTextContent('END-002')
    expect(screen.getByTestId('out-of-sequence-retro-adjustment')).toHaveTextContent('$42.50')
  })

  test('opens a document via the download API on click', async () => {
    const { api } = await import('../../../api/client')
    render(
      <TransactionAuditPanel
        policyId="p-1"
        version={baseVersion as any}
        timelineTransaction={baseTransaction as any}
        ledgerEvents={[]}
      />,
      { wrapper },
    )
    fireEvent.click(screen.getByText('Open'))
    await waitFor(() => {
      expect((api as any).downloadPolicyDocument).toHaveBeenCalledWith('p-1', 'd-1')
    })
  })
})
