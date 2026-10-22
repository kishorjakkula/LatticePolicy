import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { UwReferralDetail } from '../UwReferralDetail'
import { useAuth } from '../../../auth/AuthContext'
import { ToastProvider } from '../../../components/Toast'
import type { UwProposalSnapshot } from '../../../api/uw.api'

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

const mockUseUwReferral = vi.fn()
const mockDecide = vi.fn()
const mockAssign = vi.fn()
const mockComment = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useUwReferral: (...args: any[]) => mockUseUwReferral(...args),
  useDecideReferralMutation: () => ({ mutateAsync: mockDecide, isPending: false }),
  useAssignReferralMutation: () => ({ mutateAsync: mockAssign, isPending: false }),
  useAddReferralCommentMutation: () => ({ mutateAsync: mockComment, isPending: false }),
  useUnderwriters: () => ({ data: { items: [] } }),
}))

const mockUseAuth = vi.mocked(useAuth)

// Underwriter without the authority override, so authority referrals are blocked.
const UNDERWRITER = { id: 'uw-1', username: 'uw1', tenantId: 'sample-carrier', roles: [], permissions: ['page.uw_queue.view', 'uw.referrals.read', 'uw.referrals.decide'] }
const VIEWER = { id: 'viewer-1', username: 'viewer', tenantId: 'sample-carrier', roles: [], permissions: ['page.uw_queue.view', 'uw.referrals.read'] }

function proposalSnapshot(overrides: Partial<UwProposalSnapshot> = {}): UwProposalSnapshot {
  return {
    schemaVersion: 1,
    tenantId: 'sample-carrier',
    quoteId: 'quote-1',
    policyId: null,
    transactionType: 'NewBusiness',
    effectiveDate: '2026-08-01',
    reasons: ['Proposed roof age requires review'],
    baseVersion: { versionId: 'version-reviewed', versionNo: 3 },
    payload: {
      coverages: [{ code: 'Dwelling', limit: 1500000, deductible: 2500 }],
      risks: [{ address: '42 Proposed Lane', roofAge: 28 }],
      carrierExtension: { annualRevenue: 850000, hasSprinklers: false, locations: ['East', 'West'] },
      apiKey: { redactedSha256: 'a'.repeat(64) },
    },
    premium: { total: { amount: 925.50, currency: 'USD' }, fees: [{ amount: 25, currency: 'USD' }] },
    underwriting: { decision: 'Refer', ruleCode: 'ROOF_REVIEW' },
    authority: { allowed: false, maxLimit: 1000000 },
    ...overrides,
  }
}

function referral(overrides: Record<string, any> = {}) {
  return {
    referralId: 'ref-1',
    quoteId: 'quote-1',
    policyId: null,
    policyNumber: null,
    productCode: 'homeowners',
    insuredName: 'Daniel Kim',
    transactionType: 'NewBusiness',
    effectiveDate: '2026-07-01',
    status: 'Open',
    reasons: ['Roof age 20-30 (refer)'],
    assignedTo: null,
    premium: { amount: 775.21, currency: 'USD' },
    proposalHash: 'v1:proposal-reviewed',
    proposalSnapshot: proposalSnapshot(),
    createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    comments: [],
    ...overrides,
  }
}

function renderDetail() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/uw/queue/ref-1']}>
        <Routes>
          <Route path="/uw/queue" element={<div>Referral list route</div>} />
          <Route path="/uw/queue/:referralId" element={<UwReferralDetail />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>
  )
}

function serverError(status: number, code: string, message = 'refused') {
  return new Error(`API PATCH /v1/uw/referrals/ref-1/decide failed ${status}: ${JSON.stringify({ code, message })}`)
}

describe('UwReferralDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: UNDERWRITER } as any)
    mockUseUwReferral.mockReturnValue({ data: referral(), isLoading: false, error: null })
  })

  it('loads the referral from the route and shows reasons before key facts and the decision', () => {
    renderDetail()

    expect(mockUseUwReferral).toHaveBeenCalledWith('ref-1')
    const why = screen.getByRole('region', { name: 'Why this was referred' })
    const facts = screen.getByRole('region', { name: 'Key facts' })
    const decision = screen.getByRole('region', { name: 'Decision' })
    expect(why.compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(facts.compareDocumentPosition(decision) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(within(why).getByText('Roof age 20-30 (refer)')).toBeInTheDocument()
    expect(within(facts).getByText('Daniel Kim')).toBeInTheDocument()
    expect(within(facts).getByText('Homeowners')).toBeInTheDocument()
    expect(within(facts).getByText('$775.21')).toBeInTheDocument()
    expect(within(facts).getByText('07/01/2026')).toBeInTheDocument()
    expect(within(decision).getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(within(decision).getByRole('button', { name: 'Decline' })).toBeEnabled()
    expect(within(decision).getByRole('button', { name: 'Request info' })).toBeEnabled()
  })

  it('does not send Approve without a reason and shows "Enter a reason"', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve referral for Daniel Kim' })
    expect(within(dialog).getByLabelText('Reason (required)')).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason')
    await user.type(within(dialog).getByLabelText('Reason (required)'), '   ')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason')
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('approves with a reason, shows a toast and returns to the list', async () => {
    const user = userEvent.setup()
    mockDecide.mockResolvedValue(referral({ status: 'Approved' }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve referral for Daniel Kim' })
    await user.type(within(dialog).getByLabelText('Reason (required)'), '  Roof replaced in 2024  ')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

    expect(mockDecide).toHaveBeenCalledTimes(1)
    expect(mockDecide).toHaveBeenCalledWith({ referralId: 'ref-1', decision: 'Approved', reason: 'Roof replaced in 2024' })
    expect(await screen.findByText('Referral list route')).toBeInTheDocument()
    expect(screen.getByText('Referral approved')).toBeInTheDocument()
  })

  it('declines with a reason through a danger-styled dialog', async () => {
    const user = userEvent.setup()
    mockDecide.mockResolvedValue(referral({ status: 'Declined' }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Decline' }))
    const dialog = screen.getByRole('dialog', { name: 'Decline referral for Daniel Kim' })
    const confirm = within(dialog).getByRole('button', { name: 'Decline' })
    expect(confirm).toHaveClass('btn-danger')
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Outside appetite')
    await user.click(confirm)

    expect(mockDecide).toHaveBeenCalledWith({ referralId: 'ref-1', decision: 'Declined', reason: 'Outside appetite' })
    expect(await screen.findByText('Referral declined')).toBeInTheDocument()
  })

  it('lets Request info go without a comment', async () => {
    const user = userEvent.setup()
    mockDecide.mockResolvedValue(referral({ status: 'InfoRequested' }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Request info' }))
    const dialog = screen.getByRole('dialog', { name: 'Request information on referral for Daniel Kim' })
    expect(within(dialog).getByLabelText('Comment (optional)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Request info' }))

    expect(mockDecide).toHaveBeenCalledWith({ referralId: 'ref-1', decision: 'InfoRequested', reason: undefined })
    expect(await screen.findByText('Information requested')).toBeInTheDocument()
  })

  it.each([
    [403, 'AUTHORITY_OVERRIDE_REQUIRED', 'Above your authority limit. Request an override.'],
    [400, 'REASON_REQUIRED', 'Enter a reason.'],
    [400, 'REFERRAL_NOT_DECIDABLE', 'Referral is already Approved and cannot be decided again'],
  ])('keeps the dialog open with the server error for %s %s', async (status, code, expected) => {
    const user = userEvent.setup()
    mockDecide.mockRejectedValue(serverError(status, code, 'Referral is already Approved and cannot be decided again'))
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    const dialog = screen.getByRole('dialog', { name: 'Approve referral for Daniel Kim' })
    await user.type(within(dialog).getByLabelText('Reason (required)'), 'Reviewed')
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(expected)
    expect(screen.getByRole('dialog', { name: 'Approve referral for Daniel Kim' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Reason (required)')).toHaveValue('Reviewed')
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.queryByText('Referral list route')).not.toBeInTheDocument()
  })

  it('cancels with Escape without sending a decision', async () => {
    const user = userEvent.setup()
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Decline' }))
    await user.type(screen.getByLabelText('Reason (required)'), 'draft')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('makes Approve unavailable with the reason on an authority referral without override permission', () => {
    mockUseUwReferral.mockReturnValue({ data: referral({ reasons: ['AUTHORITY_LIMIT_EXCEEDED'] }), isLoading: false, error: null })
    renderDetail()

    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAccessibleDescription('Above your authority limit. Request an override.')
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
  })

  it('allows Approve on an authority referral with the override permission', () => {
    mockUseAuth.mockReturnValue({ user: { ...UNDERWRITER, permissions: [...UNDERWRITER.permissions, 'uw.authority.override'] } } as any)
    mockUseUwReferral.mockReturnValue({ data: referral({ reasons: ['AUTHORITY_LIMIT_EXCEEDED'] }), isLoading: false, error: null })
    renderDetail()

    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('shows the facts but no decision buttons without uw.referrals.decide', () => {
    mockUseAuth.mockReturnValue({ user: VIEWER } as any)
    renderDetail()

    expect(screen.getByRole('region', { name: 'Key facts' })).toHaveTextContent('Daniel Kim')
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request info' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign to me' })).not.toBeInTheDocument()
  })

  it('shows the recorded outcome instead of decision buttons once decided', () => {
    mockUseUwReferral.mockReturnValue({
      data: referral({ status: 'Declined', decision: 'Declined', decisionReason: 'Outside appetite', decidedBy: 'uw-1', decidedAt: '2026-07-02T15:30:00Z' }),
      isLoading: false,
      error: null,
    })
    renderDetail()

    const decision = screen.getByRole('region', { name: 'Decision' })
    expect(within(decision).getByText('Outside appetite')).toBeInTheDocument()
    expect(within(decision).getByText('You')).toBeInTheDocument()
    for (const name of ['Approve', 'Decline', 'Request info']) {
      expect(within(decision).queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('assigns the referral to me from the detail view', async () => {
    const user = userEvent.setup()
    mockAssign.mockResolvedValue(referral({ assignedTo: 'uw-1' }))
    renderDetail()

    await user.click(screen.getByRole('button', { name: 'Assign to me' }))
    expect(mockAssign).toHaveBeenCalledWith({ referralId: 'ref-1', assignedTo: 'uw-1' })
  })

  it('shows "Not rated" when the referral has no premium', () => {
    mockUseUwReferral.mockReturnValue({ data: referral({ premium: null }), isLoading: false, error: null })
    renderDetail()

    expect(screen.getByRole('region', { name: 'Key facts' })).toHaveTextContent('Not rated')
  })

  it.each(['NewBusiness', 'Endorsement', 'Renewal', 'Rewrite'])(
    'separates immutable %s proposal facts from current context', (transactionType) => {
      const snapshot = proposalSnapshot({ transactionType, policyId: 'policy-1' })
      mockUseUwReferral.mockReturnValue({
        data: referral({ policyId: 'policy-1', policyNumber: 'HO-123', proposalSnapshot: snapshot }),
        isLoading: false, error: null,
      })
      renderDetail()

      const current = screen.getByRole('region', { name: 'Key facts' })
      const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
      expect(current).toHaveTextContent('Current policy context')
      expect(current).toHaveTextContent('Current policy premium$775.21')
      expect(current).toHaveTextContent('Referral effective date07/01/2026')
      expect(current).not.toHaveTextContent('$925.50')
      expect(proposal).toHaveTextContent('Reviewed proposed premium$925.50 USD')
      expect(proposal).toHaveTextContent('Proposed effective date08/01/2026')
      expect(proposal).not.toHaveTextContent('$775.21')
      expect(proposal).not.toHaveTextContent('07/01/2026')
      expect(proposal).toHaveTextContent('v1:proposal-reviewed')
      expect(proposal).toHaveTextContent('Proposal reasonsProposed roof age requires review')
      expect(proposal).toHaveTextContent('CoveragesCodeDwellingLimit1500000Deductible2500')
      expect(proposal).toHaveTextContent('RisksAddress42 Proposed LaneRoof Age28')
      expect(proposal).toHaveTextContent('Annual Revenue850000Has SprinklersNoLocationsEastWest')
      expect(proposal).toHaveTextContent('Base policy version at reviewVersion Idversion-reviewedVersion No3')
      expect(proposal).toHaveTextContent('Reviewed underwriting evaluationDecisionReferRule CodeROOF_REVIEW')
      expect(proposal).toHaveTextContent('Reviewed authority evaluationAllowedNoMax Limit1000000')
      expect(proposal).toHaveTextContent('Api KeyRedacted (sensitive value)')
      expect(proposal).not.toHaveTextContent('a'.repeat(64))
      expect(within(proposal).queryByRole('textbox')).not.toBeInTheDocument()
      expect(within(proposal).queryByRole('spinbutton')).not.toBeInTheDocument()
      expect(snapshot).toEqual(proposalSnapshot({ transactionType, policyId: 'policy-1' }))
    },
  )

  it('keeps quote context labelled separately and allows keyboard collapse and expansion of reviewed facts', async () => {
    const user = userEvent.setup()
    renderDetail()
    expect(screen.getByRole('region', { name: 'Key facts' })).toHaveTextContent('Current quote premium$775.21')
    const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    const toggle = within(proposal).getByRole('button', { name: 'Collapse section' })
    const body = document.getElementById(toggle.getAttribute('aria-controls')!)!
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(body).toBeVisible()
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(body).not.toBeVisible()
    await user.keyboard(' ')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(body).toBeVisible()
    expect(proposal).toHaveTextContent('1500000')
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it.each(['Open', 'Approved'])('shows unknown legacy evidence and fresh-review requirement for %s history', (status) => {
    mockUseUwReferral.mockReturnValue({
      data: referral({ status, proposalHash: null, proposalSnapshot: null, decisionReason: 'Historical review' }),
      isLoading: false, error: null,
    })
    renderDetail()
    const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    expect(within(proposal).getByRole('note')).toHaveTextContent('Proposal evidence is unknown or incomplete. A fresh proposal review is required')
    expect(proposal).not.toHaveTextContent('$775.21')
    expect(within(proposal).queryByText('Reviewed proposed premium')).not.toBeInTheDocument()
    if (status === 'Open') {
      expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Approve' })).toHaveAccessibleDescription(/fresh proposal review is required/)
      expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled()
    } else {
      expect(screen.getByRole('region', { name: 'Decision' })).toHaveTextContent('Historical review')
    }
    expect(mockDecide).not.toHaveBeenCalled()
  })

  it('does not substitute current premium or date for missing proposed facts', () => {
    mockUseUwReferral.mockReturnValue({
      data: referral({ proposalSnapshot: proposalSnapshot({ effectiveDate: null, premium: null, baseVersion: null, payload: { emptyList: [], emptyObject: {}, zero: 0, enabled: true, nullable: null } }) }),
      isLoading: false, error: null,
    })
    renderDetail()
    const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    expect(proposal).toHaveTextContent('Reviewed proposed premiumUnknown (not recorded)')
    expect(proposal).toHaveTextContent('Proposed effective dateUnknown (not recorded)')
    expect(proposal).not.toHaveTextContent('$775.21')
    expect(proposal).not.toHaveTextContent('07/01/2026')
    expect(proposal).toHaveTextContent('Empty ListNone recordedEmpty ObjectNo fields recordedZero0EnabledYesNullableUnknown (not recorded)')
  })

  it('renders a zero proposed premium in its recorded currency', () => {
    mockUseUwReferral.mockReturnValue({
      data: referral({ proposalSnapshot: proposalSnapshot({ premium: { total: { amount: 0, currency: 'EUR' } } }) }),
      isLoading: false, error: null,
    })
    renderDetail()
    expect(screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })).toHaveTextContent('Reviewed proposed premium€0.00 EUR')
  })

  it.each([
    { proposalHash: null },
    { proposalSnapshot: null },
    { proposalHash: undefined, proposalSnapshot: undefined },
  ])('requires fresh review for incomplete evidence: %j', (overrides) => {
    mockUseUwReferral.mockReturnValue({ data: referral(overrides), isLoading: false, error: null })
    renderDetail()
    expect(screen.getByRole('note')).toHaveTextContent('A fresh proposal review is required')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it('renders arbitrary nested carrier strings as text, not markup', () => {
    const markup = '<img src=x onerror="alert(1)">'
    mockUseUwReferral.mockReturnValue({
      data: referral({ proposalSnapshot: proposalSnapshot({ payload: { custom_business: { notes: [markup], secret: { redactedSha256: 'b'.repeat(64) } } } }) }),
      isLoading: false, error: null,
    })
    renderDetail()
    const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    expect(proposal).toHaveTextContent(`Custom businessNotes${markup}`)
    expect(within(proposal).queryByRole('img')).not.toBeInTheDocument()
    expect(proposal).toHaveTextContent('SecretRedacted (sensitive value)')
    expect(proposal).not.toHaveTextContent('nested-digest')
  })

  it('cannot hide sibling material facts with a client redaction-marker field', () => {
    mockUseUwReferral.mockReturnValue({
      data: referral({ proposalSnapshot: proposalSnapshot({ payload: {
        redactedSha256: 'c'.repeat(64), risks: [{ territory: 'CA' }], coverages: [{ limit: 9000000 }],
      } }) }), isLoading: false, error: null,
    })
    renderDetail()
    const proposal = screen.getByRole('region', { name: 'Reviewed proposal (immutable)' })
    expect(proposal).toHaveTextContent('RisksTerritoryCA')
    expect(proposal).toHaveTextContent('CoveragesLimit9000000')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
  })
})
