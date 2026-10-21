import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SubmissionReviewPage } from '../SubmissionReviewPage'
import { useAuth } from '../../../auth/AuthContext'
import type { SubmissionDetail, SubmissionField } from '../../../api/submissions.api'

vi.mock('../../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const mockUseSubmission = vi.fn()
const mockCustomerProblems = vi.fn(() => [] as string[])
const mockCustomerMatches = vi.fn(() => [] as any[])
const mockCompanies = vi.fn(() => [{ companyId: 'co-1', name: 'Acme Specialty' }])
const mockActionMutate = vi.fn()
vi.mock('../../../api/hooks', () => ({
  useSubmission: (...args: any[]) => mockUseSubmission(...args),
  useIntakeSettings: () => ({ data: {
    provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude (claude-sonnet-5-5)', configured: true, problem: null,
    readsPdfAndImages: true, sendsDocumentsOffStack: true, maxDocuments: 10, maxDocumentBytes: 10485760,
    products: [{ code: 'commercial-auto', label: 'Commercial Auto', riskLabel: 'Fleet' }],
    attestation: 'I checked the values against the source documents and approve creating the customer and draft quote.',
  } }),
  useSubmissionChecks: () => ({ data: {
    clearance: { customerMatches: mockCustomerMatches(), openSubmissions: [], newCustomerProblems: mockCustomerProblems() },
    appetite: { decision: 'Refer', reasons: ['Youngest driver under 21'], evaluated: true },
    missingRequired: [], unconfirmed: 0, readyToApprove: true, underwritingCompanies: mockCompanies(),
  } }),
  useSubmissionAction: (_id: string, action: (...args: any[]) => Promise<unknown>) => ({ mutateAsync: (...args: any[]) => { mockActionMutate(...args); return action(...args) }, isPending: false }),
  setSubmissionField: vi.fn(),
}))

const mockUpdateField = vi.fn()
const mockApprove = vi.fn()
const mockManualReview = vi.fn()
const mockRead = vi.fn()
vi.mock('../../../api/submissions.api', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    apiSubmissions: {
      ...actual.apiSubmissions,
      updateField: (...args: any[]) => mockUpdateField(...args),
      approve: (...args: any[]) => mockApprove(...args),
      manualReview: (...args: any[]) => mockManualReview(...args),
      read: (...args: any[]) => mockRead(...args),
      setCustomer: vi.fn(),
    },
  }
})

const mockUseAuth = vi.mocked(useAuth)

function field(overrides: Partial<SubmissionField>): SubmissionField {
  return {
    key: 'fein', section: 'Insured', label: 'FEIN', type: 'text', options: [], required: false,
    aiValue: '84-2219031', confidence: 'high', confidenceScore: 92, evidence: [{ documentId: 'doc-1', line: 1, page: null, quote: 'FEIN: 84-2219031', verified: true }],
    alternatives: [], reason: 'Stated on the application.', value: '84-2219031', status: 'pending', edited: false, decidedBy: null, decidedAt: null,
    ...overrides,
  }
}

function submission(fields: SubmissionField[], overrides: Partial<SubmissionDetail> = {}): SubmissionDetail {
  return {
    submissionId: 'sub-1', submissionNumber: 'SUB-20261017-AB12', status: 'IN_REVIEW', channel: 'upload', subject: 'Northline',
    brokerName: 'Brightway', brokerEmail: null, insuredName: 'Northline Logistics LLC', productCode: 'commercial-auto', notes: null,
    assignedTo: 'uw1', aiRun: { provider: 'anthropic', label: 'Claude (claude-sonnet-5-5)', summary: 'Regional dry goods carrier.', counts: { averageScore: 84, drafted: 2 }, documentsRead: 1, documentsTotal: 1 },
    customerChoice: {}, readError: null, approvedBy: null, approvedAt: null, declinedBy: null, declineReason: null,
    customerId: null, quoteId: null, quoteNumber: null, receivedAt: '2026-10-17T09:42:00Z', updatedAt: '2026-10-17T09:43:00Z',
    documents: [{ documentId: 'doc-1', fileName: 'acord125.txt', contentType: 'text/plain', sizeBytes: 400, readableWithoutAi: true, lines: ['Applicant: NORTHLINE LOGISTICS LLC', 'FEIN: 84-2219031', 'Primary Garaging ZIP: 43215'] }],
    fields,
    events: [{ actorType: 'ai', actor: 'Claude (claude-sonnet-5-5)', action: 'drafted', detail: { drafted: 2, fields: 3, needsAttention: 1 }, createdAt: '2026-10-17T09:43:00Z' }],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/submissions/sub-1']}>
        <Routes><Route path="/submissions/:id" element={<SubmissionReviewPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const underwriter = { user: { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: ['underwriter'], permissions: [] } } as any
const agent = { user: { id: 'ag-1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'], permissions: [] } } as any

describe('SubmissionReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue(underwriter)
  })

  it('labels private model output as an AI draft and retains the review gate', () => {
    mockUseSubmission.mockReturnValue({ data: submission([field({})], { aiRun: { provider: 'private', label: 'Private document processor' } }), isLoading: false })
    renderPage()
    expect(screen.getAllByText('AI draft').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Continue to approval' })).toBeDisabled()
    expect(screen.queryByText(/does not understand free text/)).not.toBeInTheDocument()
  })

  it('labels AI drafts, shows confidence in words, and highlights the source line of the selected value', () => {
    mockUseSubmission.mockReturnValue({ data: submission([
      field({}),
      field({ key: 'risk.garagingZip', section: 'Fleet', label: 'Garaging ZIP', required: true, aiValue: null, value: null, confidence: 'conflict', confidenceScore: null, evidence: [],
        alternatives: [{ value: '43215', documentId: 'doc-1', line: 2, page: null, quote: 'Primary Garaging ZIP: 43215', verified: true }, { value: '43219', documentId: 'doc-1', line: null, page: 2, quote: 'ZIP 43219', verified: false }],
        reason: 'Two documents disagree.' }),
    ]), isLoading: false })
    renderPage()
    // Review opens on "Needs attention"; the high-confidence FEIN is under "All values".
    fireEvent.click(screen.getByRole('button', { name: /^All values/ }))

    expect(screen.getAllByText('AI draft').length).toBeGreaterThan(0)
    expect(screen.getByText('Average confidence 84%')).toBeInTheDocument()
    expect(screen.getByText('High confidence')).toBeInTheDocument()
    expect(screen.getByText('Documents disagree')).toBeInTheDocument()
    // The conflict needs attention, so it is selected first and its source line is highlighted.
    expect(screen.getByText('Source for Garaging ZIP')).toBeInTheDocument()
    expect(screen.getByText(/Two documents disagree/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show where FEIN came from' }))
    expect(screen.getByText('Source for FEIN')).toBeInTheDocument()
    expect(screen.getByText(/Quote checked against the document/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Confidence 92 percent' })).toBeInTheDocument()
    expect(screen.getByText('Confidence 92%')).toBeInTheDocument()
    expect(screen.getByText(/high: 85% or more/)).toBeInTheDocument()

    const confirmZip = screen.getByRole('button', { name: /Confirm Garaging ZIP/ })
    expect(confirmZip).toBeDisabled()
  })

  it('keeps approval locked until every value is confirmed, and sends edits with the reviewer value', async () => {
    mockUpdateField.mockResolvedValue(field({ status: 'accepted' }))
    mockUseSubmission.mockReturnValue({ data: submission([field({})]), isLoading: false })
    renderPage()

    expect(screen.getByRole('button', { name: 'Continue to approval' })).toBeDisabled()
    expect(screen.getByText('0 of 1 values confirmed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^All values/ }))
    fireEvent.change(screen.getByLabelText('FEIN'), { target: { value: '84-2219032' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm FEIN/ }))
    await waitFor(() => expect(mockUpdateField).toHaveBeenCalledWith('sub-1', 'fein', { action: 'accept', value: '84-2219032' }))
  })

  it('shows the changes, the rules outcome, and the plan, and approves only after the attestation', async () => {
    mockApprove.mockResolvedValue({ quoteId: 'q-1', quoteNumber: 'Q-1', customerId: 'c-1', customerAction: 'customer_created' })
    mockUseSubmission.mockReturnValue({ data: submission([
      field({ status: 'accepted' }),
      field({ key: 'insuredName', label: 'Named insured', aiValue: 'NORTHLINE LOGISTICS LLC', value: 'Northline Logistics, LLC', edited: true, status: 'accepted' }),
      field({ key: 'productCode', label: 'Product', type: 'select', options: ['commercial-auto'], aiValue: 'commercial-auto', value: 'commercial-auto', status: 'accepted' }),
    ]), isLoading: false })
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Continue to approval' }))
    const dialog = screen.getByRole('dialog', { name: /Approve Northline Logistics, LLC/ })
    expect(within(dialog).getByText('NORTHLINE LOGISTICS LLC')).toBeInTheDocument()
    expect(within(dialog).getByText(/Underwriting rules: referral/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Create a draft Commercial Auto quote with Acme Specialty/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Underwriting company')).toHaveValue('co-1')
    expect(within(dialog).getByText(/A new customer/)).toBeInTheDocument()

    const approve = within(dialog).getByRole('button', { name: 'Approve and create quote' })
    expect(approve).toBeDisabled()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(approve).toBeEnabled()
    fireEvent.click(approve)
    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('sub-1', 'co-1'))
  })

  it('blocks approval and says why when the values cannot make a new customer', () => {
    mockCustomerProblems.mockReturnValue(['At least one contact method or address is required'])
    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })]), isLoading: false })
    renderPage()
    expect(screen.getByText(/New customer:/).parentElement).toHaveTextContent('At least one contact method or address is required')
    fireEvent.click(screen.getByRole('button', { name: 'Continue to approval' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/cannot be created yet/)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('button', { name: 'Approve and create quote' })).toBeDisabled()
    mockCustomerProblems.mockReturnValue([])
  })

  it('requires choosing the existing customer when the insured may already be one', () => {
    mockCustomerMatches.mockReturnValue([{ customerId: 'c-9', customerKey: 'CUST-9', displayName: 'Keystone Software Inc.', status: 'ACTIVE', matchScore: 95, reasons: ['FEIN last4 match'] }])
    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })]), isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to approval' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText(/Create a new customer/)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('radio', { name: /Keystone Software Inc\. \(CUST-9\)/ })).not.toBeChecked()
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(within(dialog).getByRole('button', { name: 'Approve and create quote' })).toBeDisabled()
    expect(within(dialog).getByText('Choose the customer above before approving.')).toBeInTheDocument()
    mockCustomerMatches.mockReturnValue([])
  })

  it('makes the reviewer choose the underwriting company when more than one writes the product', () => {
    mockCompanies.mockReturnValue([{ companyId: 'co-1', name: 'Acme Mutual Casualty' }, { companyId: 'co-2', name: 'Acme Specialty' }])
    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })]), isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to approval' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('checkbox'))
    const approve = within(dialog).getByRole('button', { name: 'Approve and create quote' })
    expect(approve).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Underwriting company'), { target: { value: 'co-2' } })
    expect(approve).toBeEnabled()
    mockCompanies.mockReturnValue([])
    mockCompanies.mockImplementation(() => [{ companyId: 'co-1', name: 'Acme Specialty' }])
  })

  it('lets a reviewer without approval permission prepare but not approve', () => {
    mockUseAuth.mockReturnValue(agent)
    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })]), isLoading: false })
    renderPage()
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to approval' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/can review but not approve/)).toBeInTheDocument()
    expect(within(dialog).getByRole('checkbox')).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Approve and create quote' })).toBeDisabled()
  })

  it('shows the reading state, the failure reason, and the created quote', () => {
    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READING' }), isLoading: false })
    const { unmount } = renderPage()
    expect(screen.getByRole('status')).toHaveTextContent(/is reading 1 document/)
    unmount()

    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READ_FAILED', readError: 'The AI model did not answer in time.' }), isLoading: false })
    const failed = renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('The AI model did not answer in time.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    failed.unmount()

    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })], { status: 'COMPLETED', quoteId: 'q-1', quoteNumber: 'Q-2026-1', approvedBy: 'uw1' }), isLoading: false })
    renderPage()
    expect(screen.getByRole('link', { name: 'Open quote Q-2026-1' })).toHaveAttribute('href', '/wizard?quoteId=q-1')
    expect(screen.queryByRole('button', { name: 'Continue to approval' })).not.toBeInTheDocument()
  })

  it('allows failed-read manual recovery and retries with the selected product', async () => {
    mockManualReview.mockResolvedValue({ status: 'IN_REVIEW' })
    mockRead.mockResolvedValue({ status: 'READING' })
    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READ_FAILED' }), isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Enter values by hand' }))
    await waitFor(() => expect(mockManualReview).toHaveBeenCalledWith('sub-1'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('sub-1', 'commercial-auto'))
  })

  it('requires a warning before retrying a failed read with existing confirmations', async () => {
    mockUseSubmission.mockReturnValue({ data: submission([field({ status: 'accepted' })], { status: 'READ_FAILED' }), isLoading: false })
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Reading again discards 1 confirmation.')).toBeInTheDocument()
    expect(mockRead).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    await waitFor(() => expect(mockRead).toHaveBeenCalled())
  })

  it('offers restart only for a stale read and hides recovery from read-only users', () => {
    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READING', aiRun: { startedAt: new Date().toISOString() } }), isLoading: false })
    const fresh = renderPage()
    expect(screen.queryByRole('button', { name: 'Read again' })).not.toBeInTheDocument()
    fresh.unmount()
    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READING', aiRun: { startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() } }), isLoading: false })
    const stale = renderPage()
    expect(screen.getByRole('button', { name: 'Read again' })).toBeEnabled()
    stale.unmount()
    mockUseAuth.mockReturnValue({ user: { id: 'reader', roles: [], permissions: ['submissions.read'] } } as any)
    mockUseSubmission.mockReturnValue({ data: submission([], { status: 'READ_FAILED' }), isLoading: false })
    renderPage()
    expect(screen.queryByRole('button', { name: 'Enter values by hand' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  describe('review defaults (WP-0004 REQ-9)', () => {
    const missing = (key: string, section: string, label: string, type: SubmissionField['type'] = 'text') =>
      field({ key, section, label, type, options: type === 'select' ? ['direct', 'agency'] : [], aiValue: null, value: null, confidence: 'missing', confidenceScore: null, evidence: [], reason: null })

    it('opens on "Needs attention", hiding high-confidence values until "All values" is chosen', () => {
      mockUseSubmission.mockReturnValue({ data: submission([
        field({}),
        field({ key: 'phone', label: 'Insured phone', confidence: 'medium', confidenceScore: 70 }),
      ]), isLoading: false })
      renderPage()
      expect(screen.getByRole('button', { name: 'Needs attention (1)' })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', { name: 'All values (2)' })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByLabelText('Insured phone')).toBeInTheDocument()
      expect(screen.queryByLabelText('FEIN')).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'All values (2)' }))
      expect(screen.getByLabelText('FEIN')).toBeInTheDocument()
    })

    it('summarises each group as found of total and starts groups with nothing found collapsed', () => {
      mockUseSubmission.mockReturnValue({ data: submission([
        field({ section: 'Insured', confidence: 'medium' }),
        missing('phone', 'Insured', 'Insured phone'),
        missing('email', 'Insured', 'Insured email'),
        // A conflict was found in the documents (twice), so it counts as found.
        field({ key: 'priorPolicyNumber', section: 'Prior insurance', label: 'Prior policy number', aiValue: null, value: null, confidence: 'conflict', evidence: [],
          alternatives: [{ value: 'P-1', documentId: 'doc-1', line: 0, page: null, quote: 'P-1', verified: true }, { value: 'P-2', documentId: 'doc-1', line: 1, page: null, quote: 'P-2', verified: true }] }),
        missing('billingMethod', 'Billing', 'Billing method', 'select'),
        missing('paymentPlan', 'Billing', 'Payment plan', 'select'),
      ]), isLoading: false })
      renderPage()
      const group = (title: string) => screen.getByText(title, { selector: '.si-section-title > span:first-child' }).closest('section')!
      expect(within(group('Insured')).getByText('1 of 3 found · 0 confirmed')).toBeInTheDocument()
      expect(within(group('Prior insurance')).getByText('1 of 1 found · 0 confirmed')).toBeInTheDocument()
      expect(within(group('Billing')).getByText('0 of 2 found · 0 confirmed')).toBeInTheDocument()
      expect(within(group('Insured')).getByRole('button', { name: 'Collapse section' })).toHaveAttribute('aria-expanded', 'true')
      const billingToggle = within(group('Billing')).getByRole('button', { name: 'Expand section' })
      expect(billingToggle).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByLabelText('Billing method')).not.toBeVisible()
      fireEvent.click(billingToggle)
      expect(screen.getByLabelText('Billing method')).toBeVisible()
    })

    it('uses a short placeholder for values not found and keeps "Not found" in the badge', () => {
      mockUseSubmission.mockReturnValue({ data: submission([missing('phone', 'Insured', 'Insured phone'), missing('billingMethod', 'Insured', 'Billing method', 'select')]), isLoading: false })
      renderPage()
      expect(screen.getByLabelText('Insured phone')).toHaveAttribute('placeholder', 'Enter value')
      expect(screen.getByLabelText('Billing method').querySelector('option[value=""]')).toHaveTextContent(/^Choose…$/)
      expect(screen.queryByText(/Not in the documents/)).not.toBeInTheDocument()
      expect(screen.getAllByText('Not found')).toHaveLength(2)
    })

    it('states how many values "Accept all high confidence" will accept and changes nothing until confirmed', async () => {
      const acceptHigh = vi.fn().mockResolvedValue({ count: 12 })
      const { apiSubmissions } = await import('../../../api/submissions.api')
      const original = apiSubmissions.acceptHighConfidence
      ;(apiSubmissions as any).acceptHighConfidence = acceptHigh
      try {
        const high = Array.from({ length: 12 }, (_, index) => field({ key: `high-${index}`, label: `High ${index}` }))
        // Not counted: already accepted, edited away from the AI value, or not high confidence.
        const others = [
          field({ key: 'done', label: 'Done', status: 'accepted' }),
          field({ key: 'edited', label: 'Edited', value: 'changed', edited: true }),
          field({ key: 'medium', label: 'Medium', confidence: 'medium' }),
        ]
        mockUseSubmission.mockReturnValue({ data: submission([...high, ...others]), isLoading: false })
        renderPage()
        fireEvent.click(screen.getByRole('button', { name: 'Accept all high confidence (12)' }))
        const dialog = screen.getByRole('dialog', { name: 'Accept 12 high-confidence values?' })
        expect(acceptHigh).not.toHaveBeenCalled()
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        expect(acceptHigh).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Accept all high confidence (12)' }))
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept 12' }))
        await waitFor(() => expect(acceptHigh).toHaveBeenCalledTimes(1))
        expect(acceptHigh).toHaveBeenCalledWith('sub-1')
      } finally {
        ;(apiSubmissions as any).acceptHighConfidence = original
      }
    })
  })
})
