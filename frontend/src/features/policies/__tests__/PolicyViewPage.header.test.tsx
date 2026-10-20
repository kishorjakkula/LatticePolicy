import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { state, mutation } = vi.hoisted(() => ({
  state: { policy: null as any, versions: [] as any[] },
  mutation: () => ({ mutateAsync: () => Promise.resolve(), isPending: false }),
}))

vi.mock('../../../api/hooks', () => ({
  usePolicy: () => ({ data: state.policy, refetch: vi.fn() }),
  usePolicyVersions: () => ({ data: state.versions, refetch: vi.fn() }),
  useFullPolicy: () => ({ data: undefined, refetch: vi.fn() }),
  usePolicyTimeline: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
  usePolicyAiInsights: () => ({ data: undefined, error: null, refetch: vi.fn() }),
  usePolicyDocuments: () => ({ data: { documents: [] }, isLoading: false, error: null }),
  usePolicyAsOf: () => ({ data: undefined, isLoading: false, error: null }),
  useIssuePolicyMutation: mutation,
  useReinstatePolicyMutation: mutation,
  useNonRenewPolicyMutation: mutation,
  useReserveTransactionNumberMutation: mutation,
}))

vi.mock('../../../api/client', () => ({ api: {}, apiDetails: {} }))

import { PolicyViewPage } from '../PolicyViewPage'

const today = new Date()
const iso = (offsetDays: number) => new Date(today.getTime() + offsetDays * 86400000).toISOString().slice(0, 10)
const priorTerm = { policyEffectiveDate: iso(-400), expirationDate: iso(-35) }
const currentTerm = { policyEffectiveDate: iso(-35), expirationDate: iso(330) }

function basePolicy(overrides: Record<string, unknown> = {}) {
  return {
    policyId: 'pol-1',
    policyNumber: 'PC-47C2347B',
    status: 'Issued',
    productCode: 'personal-auto',
    term: { effectiveDate: currentTerm.policyEffectiveDate, expirationDate: currentTerm.expirationDate },
    payload: {},
    customer: { customerId: 'cust-9', customerKey: 'C-9', firstName: 'Daniel', lastName: 'Kim', name: '' },
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/policies/pol-1']}>
      <Routes>
        <Route path="/policies/:id" element={<PolicyViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PolicyViewPage header', () => {
  beforeEach(() => {
    state.policy = basePolicy()
    state.versions = [
      { versionId: 'v1', ...priorTerm, effectiveDate: priorTerm.policyEffectiveDate, transactionType: 'NB', transactionNumber: 'NB-1', processedDate: '2025-01-01T00:00:00Z', premium: { total: { amount: 500, currency: 'USD' } } },
      { versionId: 'v2', ...currentTerm, effectiveDate: currentTerm.policyEffectiveDate, transactionType: 'Renew', transactionNumber: 'RN-1', processedDate: '2026-01-01T00:00:00Z', updatedDate: '2026-01-01T15:30:00Z', premium: { total: { amount: 542.82, currency: 'USD' } } },
    ]
  })

  it('identifies the policy: insured link, product name, current term, status and term premium', () => {
    renderPage()
    const header = screen.getByTestId('policy-header')
    expect(within(header).getByRole('heading', { level: 1 })).toHaveTextContent('Policy PC-47C2347B')
    const insured = within(header).getByRole('link', { name: 'Daniel Kim' })
    expect(insured).toHaveAttribute('href', '/customers/cust-9')
    expect(within(header).getByText('Personal Auto')).toBeInTheDocument()
    expect(header).not.toHaveTextContent('personal-auto')
    const term = within(header).getByText('Term').nextElementSibling
    expect(term?.textContent).toContain('–')
    expect(term?.textContent).not.toBe('-')
    const status = within(header).getByText('In Force')
    expect(status).toHaveAttribute('title', 'Issued and the current term has started.')
    const premium = within(header).getByText('Premium this term').nextElementSibling
    expect(premium).toHaveTextContent('$542.82')
    // Not the sum of both terms.
    expect(premium).not.toHaveTextContent('$1,042.82')
    expect(within(header).getByLabelText('As of date')).toBeInTheDocument()
  })

  it('states when no insured is linked', () => {
    state.policy = basePolicy({ customer: null })
    renderPage()
    const header = screen.getByTestId('policy-header')
    expect(within(header).getByText('No insured linked')).toBeInTheDocument()
    expect(within(header).queryByRole('link', { name: /Kim/ })).not.toBeInTheDocument()
  })

  it('shows "Not rated" when the current term has no premium', () => {
    state.versions = []
    renderPage()
    const premium = within(screen.getByTestId('policy-header')).getByText('Premium this term').nextElementSibling
    expect(premium).toHaveTextContent('Not rated')
  })

  it('shows transaction types by name with one column per date meaning', () => {
    renderPage()
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent?.replace(/\s+[v^]$/, ''))
    expect(headers).toEqual(
      expect.arrayContaining(['Transaction #', 'Type', 'Transaction effective', 'Policy term', 'Updated', 'Updated by', 'Amount']),
    )
    expect(headers).not.toContain('Created Date')
    expect(headers.filter((h) => /Effective/i.test(h || ''))).toHaveLength(1)
    const renewalRow = screen.getByRole('button', { name: 'RN-1' }).closest('tr')!
    expect(within(renewalRow).getByText('Renewal')).toBeInTheDocument()
    expect(renewalRow).not.toHaveTextContent(/\bRenew\b/)
    // Updated is a date-time: two same-day transactions must be told apart.
    expect(renewalRow).toHaveTextContent(/\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} (AM|PM)/)
  })

  it('shows the product display name in the summary and drops the bare term number', () => {
    renderPage()
    expect(screen.getAllByText('Personal Auto').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText('personal-auto')).not.toBeInTheDocument()
  })
})
