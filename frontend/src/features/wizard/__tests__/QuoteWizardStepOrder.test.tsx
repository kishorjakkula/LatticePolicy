import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QuoteWizard, referralReviewPath, Stepper, underwritingCompaniesFor } from '../QuoteWizard'

// WP-0004 REQ-8: step 1 asks product and term first, then company and agency;
// billing is asked on the Premium step; one progress indicator; a quote summary
// in the header.

const mocks = vi.hoisted(() => ({ getQuote: vi.fn(), updateQuoteDraft: vi.fn(), createQuoteDraft: vi.fn(), bindQuote: vi.fn(), role: 'admin' }))

vi.mock('../../../api/client', () => {
  const overrides: Record<string, unknown> = {
    getQuote: (...args: unknown[]) => mocks.getQuote(...args),
    updateQuoteDraft: (...args: unknown[]) => mocks.updateQuoteDraft(...args),
    createQuoteDraft: (...args: unknown[]) => mocks.createQuoteDraft(...args),
    bindQuote: (...args: unknown[]) => mocks.bindQuote(...args),
  }
  const api = new Proxy(overrides, {
    get: (target, prop: string) => {
      if (!(prop in target)) target[prop] = vi.fn(async () => ({ items: [] }))
      return target[prop]
    },
  })
  return { api, apiDetails: vi.fn(() => null) }
})

vi.mock('../../../api/quotes.api', () => ({ quoteIntakeApi: { get: vi.fn(async () => null) } }))
vi.mock('../../../api/validation-rules.api', () => ({
  validationRulesApi: { applicable: vi.fn(async () => ({ items: [] })) },
  validationStopFrom: vi.fn(() => null),
}))
vi.mock('../../../tenant/carrierBranding', () => ({ fetchCarrierBranding: vi.fn(async () => ({})) }))
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ show: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', username: 'agent1', tenantId: 'sample-carrier', roles: [mocks.role], permissions: [] } }),
}))

const companies = [
  { companyId: 'c-auto-tx', name: 'Acme Personal', productCode: 'personal-auto', country: 'US', state: 'TX' },
  { companyId: 'c-auto-ca', name: 'Acme Personal', productCode: 'personal-auto', country: 'US', state: 'CA' },
  { companyId: 'c-home-tx', name: 'Acme Property', productCode: 'homeowners', country: 'US', state: 'TX' },
  { companyId: 'c-both-auto', name: 'Both Lines Mutual', productCode: 'personal-auto', country: 'US', state: 'ALL' },
  { companyId: 'c-both-home', name: 'Both Lines Mutual', productCode: 'homeowners', country: 'US', state: 'TX' },
]

vi.mock('../../../api/hooks', () => ({
  useUnderwritingCompanies: () => ({ data: { items: companies }, isLoading: false }),
  useReferenceAgencies: () => ({ data: { items: [] }, isLoading: false }),
  useUnderwriters: () => ({ data: { items: [] }, isLoading: false }),
  useReferenceInsuranceCarriers: () => ({ data: { items: [] }, isLoading: false }),
  useCancellationReasonCodes: () => ({ data: { items: [] }, isLoading: false }),
  useAgencyContacts: () => ({ data: { items: [] }, isLoading: false }),
}))

function renderWizard(path = '/wizard') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/wizard" element={<QuoteWizard />} /></Routes>
    </MemoryRouter>
  )
}

function stepOneLabels(): string[] {
  const section = screen.getByRole('heading', { name: 'Product & term' }).closest('section')!.parentElement!
  return Array.from(section.querySelectorAll('.wizard-section'))
    .flatMap((group) => Array.from(group.querySelectorAll('label, .field-label')))
    .map((label) => (label.textContent || '').trim())
}

const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement
const optionTexts = (element: HTMLSelectElement) => Array.from(element.options).map((option) => option.textContent)

describe('new quote wizard step 1 (REQ-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks product and term first, then company and agency, then prior insurance, with no billing', () => {
    renderWizard()
    expect(screen.getAllByRole('heading').map((heading) => heading.textContent).filter((text) => ['Product & term', 'Company & agency', 'Prior Insurance'].includes(text || '')))
      .toEqual(['Product & term', 'Company & agency', 'Prior Insurance'])
    const labels = stepOneLabels()
    expect(labels.slice(0, 10)).toEqual([
      'Country', 'State', 'Product', 'Effective Date', 'Term', 'Policy Offering',
      'Underwriting Company', 'Agency', 'Agency Contact', 'Commission %',
    ])
    expect(labels.indexOf('Prior Policy Number')).toBeGreaterThan(labels.indexOf('Commission %'))
    expect(screen.queryByText('Billing Method')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Payment Plan')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Billing' })).not.toBeInTheDocument()
    // The stepper names the step; the dot row beside the buttons is gone.
    expect(screen.getByRole('button', { name: /Product & term/ })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByText('1 of 8')).toBeInTheDocument()
    expect(document.querySelector('.wizard-nav-progress-dots, .wizard-nav-dot')).toBeNull()
  })

  it('keeps product dependent on country and state, and offers only the companies that write the product there', async () => {
    renderWizard()
    expect(select('Product')).toBeDisabled()
    expect(select('Product').options[0].textContent).toBe('Select country and state first')
    fireEvent.change(select('Country'), { target: { value: 'US' } })
    fireEvent.change(select('State'), { target: { value: 'TX' } })
    expect(select('Product')).toBeEnabled()
    fireEvent.change(select('Product'), { target: { value: 'homeowners' } })
    await waitFor(() => expect(optionTexts(select('Underwriting Company'))).toEqual(['Select underwriting company', 'Acme Property', 'Both Lines Mutual']))
  })

  it('clears a company that does not write the newly chosen product, and says why', async () => {
    renderWizard()
    fireEvent.change(select('Country'), { target: { value: 'US' } })
    fireEvent.change(select('State'), { target: { value: 'TX' } })
    fireEvent.change(select('Product'), { target: { value: 'personal-auto' } })
    await waitFor(() => expect(optionTexts(select('Underwriting Company'))).toEqual(['Select underwriting company', 'Acme Personal', 'Both Lines Mutual']))
    fireEvent.change(select('Underwriting Company'), { target: { value: 'Acme Personal' } })
    expect(select('Underwriting Company')).toHaveValue('Acme Personal')

    fireEvent.change(select('Product'), { target: { value: 'homeowners' } })
    const change = screen.queryByRole('button', { name: 'Change product' })
    if (change) fireEvent.click(change)

    await waitFor(() => expect(select('Underwriting Company')).toHaveValue(''))
    expect(screen.getByText('Acme Personal does not write Homeowners in TX, so it was cleared.')).toHaveAttribute('role', 'status')
    // Product, state and country are kept: the company no longer resets them.
    expect(select('Product')).toHaveValue('homeowners')
    expect(select('State')).toHaveValue('TX')

    fireEvent.change(select('Underwriting Company'), { target: { value: 'Both Lines Mutual' } })
    expect(select('Underwriting Company')).toHaveValue('Both Lines Mutual')
    expect(screen.queryByText(/so it was cleared/)).not.toBeInTheDocument()
  })

  it('keeps a company that still writes the new product', async () => {
    renderWizard()
    fireEvent.change(select('Country'), { target: { value: 'US' } })
    fireEvent.change(select('State'), { target: { value: 'TX' } })
    fireEvent.change(select('Product'), { target: { value: 'personal-auto' } })
    fireEvent.change(select('Underwriting Company'), { target: { value: 'Both Lines Mutual' } })
    fireEvent.change(select('Product'), { target: { value: 'homeowners' } })
    const change = screen.queryByRole('button', { name: 'Change product' })
    if (change) fireEvent.click(change)
    await waitFor(() => expect(select('Product')).toHaveValue('homeowners'))
    expect(select('Underwriting Company')).toHaveValue('Both Lines Mutual')
    expect(screen.queryByText(/so it was cleared/)).not.toBeInTheDocument()
  })

  it('shows a quote summary in the header instead of repeating the effective date', () => {
    renderWizard()
    fireEvent.change(select('Country'), { target: { value: 'US' } })
    fireEvent.change(select('State'), { target: { value: 'TX' } })
    fireEvent.change(select('Product'), { target: { value: 'homeowners' } })
    fireEvent.change(screen.getByLabelText('Effective Date'), { target: { value: '2026-11-19' } })
    const summary = screen.getByTestId('wizard-quote-summary')
    expect(summary).toHaveTextContent(/^QuoteHomeowners · TX · Effective 11\/19\/2026$/)
    expect(screen.queryByText('Quote Effective')).not.toBeInTheDocument()
  })
})

describe('companies for a product and state', () => {
  it('narrows by product, country and state, treats ALL as every state, and ignores unset choices', () => {
    const names = (selection: Parameters<typeof underwritingCompaniesFor>[1]) => underwritingCompaniesFor(companies, selection).map((item) => item.companyId)
    expect(names({})).toHaveLength(companies.length)
    expect(names({ country: 'US', state: 'TX', productCode: 'homeowners' })).toEqual(['c-home-tx', 'c-both-home'])
    expect(names({ country: 'US', state: 'NY', productCode: 'personal-auto' })).toEqual(['c-both-auto'])
    expect(names({ country: 'CA', state: 'ON', productCode: 'personal-auto' })).toEqual([])
    expect(names({ productCode: 'cyber' })).toEqual([])
  })
})

describe('billing on the Premium step (REQ-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reopens a draft saved with billing in step 1 and shows its billing on the Premium step', async () => {
    // A draft saved before the change: billing lived in step 1, payload fields are unchanged.
    mocks.getQuote.mockResolvedValue({
      quoteId: 'q-old', quoteNumber: 'Q20261001-OLD1', status: 'Draft', progressStep: 7,
      payload: {
        productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: '2026-11-01', termMonths: 12,
        underwritingCompanyName: 'Acme Property', billingMethod: 'agency', paymentPlan: 'quarterly',
        insureds: { primary: { firstName: 'Old', lastName: 'Draft' } },
      },
    })
    mocks.updateQuoteDraft.mockResolvedValue({ quoteId: 'q-old', quoteNumber: 'Q20261001-OLD1', status: 'Draft', progressStep: 1 })
    renderWizard('/wizard?quoteId=q-old')

    await waitFor(() => expect(screen.getByText('7 of 8')).toBeInTheDocument())
    const payment = screen.getByRole('heading', { name: 'Payment' }).closest('.wizard-section') as HTMLElement
    expect(within(payment).getByRole('radio', { name: 'Agency bill' })).toBeChecked()
    expect(within(payment).getByRole('radio', { name: /Direct bill/ })).not.toBeChecked()
    expect(within(payment).getByLabelText('Payment Plan')).toHaveValue('quarterly')

    // Step 1 no longer asks billing, and the saved product setup is intact there.
    fireEvent.click(screen.getByRole('button', { name: /Product & term/ }))
    await waitFor(() => expect(screen.getByText('1 of 8')).toBeInTheDocument())
    expect(screen.queryByText('Billing Method')).not.toBeInTheDocument()
    expect(select('Product')).toHaveValue('homeowners')
    expect(select('Underwriting Company')).toHaveValue('Acme Property')
  })

  it('keeps the rating when billing is changed on the Premium step, and shows the premium in the header', async () => {
    mocks.getQuote.mockResolvedValue({
      quoteId: 'q-rated', quoteNumber: 'Q20261020-RAT1', status: 'Rated', progressStep: 7,
      payload: { productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: '2026-11-01', termMonths: 12, underwritingCompanyId: 'c-home-tx', underwritingCompanyName: 'Acme Property', paymentPlan: 'annual' },
      premium: { total: { amount: 1234.5, currency: 'USD' }, fees: { amount: 0, currency: 'USD' }, taxes: { amount: 0, currency: 'USD' } },
      underwriting: { decision: 'Accept' },
    })
    renderWizard('/wizard?quoteId=q-rated')

    await waitFor(() => expect(screen.getByText('7 of 8')).toBeInTheDocument())
    const summary = screen.getByTestId('wizard-quote-summary')
    expect(summary).toHaveTextContent('Quote premium')
    expect(summary).toHaveTextContent(/Homeowners · TX · \$1,234\.50/)
    const payment = screen.getByRole('heading', { name: 'Payment' }).closest('.wizard-section') as HTMLElement
    expect(within(payment).getByLabelText('Payment Plan')).toHaveValue('annual')
    fireEvent.change(within(payment).getByLabelText('Payment Plan'), { target: { value: 'monthly' } })
    expect(within(payment).getByLabelText('Payment Plan')).toHaveValue('monthly')
    // Billing does not change the premium, so the rated result stays.
    expect(screen.queryByText('Rate premium in the Rating step to continue.')).not.toBeInTheDocument()
    expect(screen.getByTestId('wizard-quote-summary')).toHaveTextContent('$1,234.50')
  })

  it('lets billing be chosen on the Premium step and saves it with the quote', async () => {
    mocks.getQuote.mockResolvedValue({
      quoteId: 'q-new', quoteNumber: 'Q20261020-NEW1', status: 'Draft', progressStep: 7,
      payload: { productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: '2026-11-01', termMonths: 12, underwritingCompanyName: 'Acme Property' },
    })
    mocks.updateQuoteDraft.mockResolvedValue({ quoteId: 'q-new', quoteNumber: 'Q20261020-NEW1', status: 'Draft', progressStep: 7 })
    renderWizard('/wizard?quoteId=q-new')

    await waitFor(() => expect(screen.getByText('7 of 8')).toBeInTheDocument())
    const payment = screen.getByRole('heading', { name: 'Payment' }).closest('.wizard-section') as HTMLElement
    fireEvent.click(within(payment).getByRole('radio', { name: /Direct bill/ }))
    fireEvent.change(within(payment).getByLabelText('Payment Plan'), { target: { value: 'monthly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
    await waitFor(() => expect(mocks.updateQuoteDraft).toHaveBeenCalled())
    const calls = mocks.updateQuoteDraft.mock.calls
    const [quoteId, payload] = calls[calls.length - 1]
    expect(quoteId).toBe('q-new')
    expect(payload).toMatchObject({ billingMethod: 'direct', paymentPlan: 'monthly' })
  })
})

describe('detail-only referral decisions (REQ-1)', () => {
  const referralId = '55555555-5555-4555-a555-555555555555'
  const rejection = new Error(`API POST /v1/quotes/q-ref/bind failed 400: ${JSON.stringify({
    code: 'UW_REFERRAL_REQUIRED', message: `This transaction requires underwriter approval before bind. Referral ${referralId} is open.`, traceId: 'test-trace',
  })}`)

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.role = 'admin'
    mocks.getQuote.mockResolvedValue({
      quoteId: 'q-ref', quoteNumber: 'Q-REF', status: 'Rated', progressStep: 7,
      payload: { productCode: 'homeowners', country: 'US', state: 'TX', effectiveDate: '2026-11-01', termMonths: 12, underwritingCompanyId: 'c-home-tx', underwritingCompanyName: 'Acme Property' },
      underwriting: { decision: 'Refer', reasons: ['Risk requires review'] },
      premium: { total: { amount: 1234.5, currency: 'USD' } },
    })
    mocks.bindQuote.mockRejectedValue(rejection)
    mocks.updateQuoteDraft.mockResolvedValue({ quoteId: 'q-ref', quoteNumber: 'Q-REF', status: 'Rated', progressStep: 8 })
  })

  it.each(['admin', 'underwriter', 'agent'])('%s cannot approve in the wizard, can submit for review and retry after approval', async (role) => {
    mocks.role = role
    renderWizard('/wizard?quoteId=q-ref')
    await waitFor(() => expect(screen.getByText('7 of 8')).toBeInTheDocument())
    expect(screen.queryByText(/Override Reason/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit for UW' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Forms & Documents' }))
    const bind = await screen.findByRole('button', { name: 'Bind' })
    expect(bind).toBeEnabled()
    fireEvent.click(bind)
    const notice = await screen.findByRole('alert')
    expect(notice).toHaveTextContent('Awaiting underwriting approval')
    expect(mocks.bindQuote).toHaveBeenLastCalledWith('q-ref', undefined)
    if (role === 'agent') {
      expect(within(notice).queryByRole('link')).not.toBeInTheDocument()
      expect(notice).toHaveTextContent('Contact your underwriter')
    } else {
      expect(within(notice).getByRole('link', { name: 'Open referral detail' })).toHaveAttribute('href', `/uw/queue/${referralId}`)
    }
    // Approval is performed separately; the wizard retries the ordinary bind API.
    mocks.bindQuote.mockResolvedValueOnce({ policyId: 'p-approved', policyNumber: 'P-APPROVED' })
    fireEvent.click(bind)
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(mocks.bindQuote).toHaveBeenCalledTimes(2)
    expect(mocks.bindQuote).toHaveBeenLastCalledWith('q-ref', undefined)
  })

  it('uses only referral-required errors for review links and safely falls back to the queue', () => {
    expect(referralReviewPath(rejection)).toBe(`/uw/queue/${referralId}`)
    expect(referralReviewPath({ code: 'UW_REFERRAL_REQUIRED', message: 'Review required' })).toBe('/uw/queue')
    expect(referralReviewPath(new Error('API failed: {broken JSON'))).toBeNull()
    expect(referralReviewPath(new Error('UW_REFERRAL_REQUIRED'))).toBeNull()
    expect(referralReviewPath({ code: 'OTHER_ERROR', message: `Referral ${referralId}` })).toBeNull()
    expect(referralReviewPath(null)).toBeNull()
  })
})

describe('compact phone stepper (REQ-14)', () => {
  const steps = [{ id: 1, title: 'Product & term' }, { id: 2, title: 'Qualification Questions' }]

  it('starts collapsed on phones, toggles the list and collapses after selecting a step', () => {
    const original = window.matchMedia
    const listeners = new Set<() => void>()
    const media = { matches: true, addEventListener: (_type: string, callback: () => void) => listeners.add(callback), removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback) }
    window.matchMedia = vi.fn(() => media) as any
    try {
      const onSelect = vi.fn()
      const { rerender, unmount } = render(<div className="wizard-shell"><Stepper steps={steps} active={1} onSelect={onSelect} /></div>)
      const toggle = screen.getByRole('button', { name: 'Step 1 of 2: Product & term' })
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      const list = document.getElementById(toggle.getAttribute('aria-controls')!)!
      expect(list).toHaveAttribute('hidden')
      expect(screen.queryByRole('button', { name: /02 Qualification/ })).not.toBeInTheDocument()
      fireEvent.click(toggle)
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(screen.getByRole('button', { name: /02 Qualification/ }))
      expect(onSelect).toHaveBeenCalledWith(2)
      expect(list).toHaveAttribute('hidden')
      rerender(<div className="wizard-shell"><Stepper steps={steps} active={2} onSelect={onSelect} /></div>)
      expect(screen.getByRole('button', { name: 'Step 2 of 2: Qualification Questions' })).toHaveAttribute('aria-expanded', 'false')
      unmount()
      expect(listeners.size).toBe(0)
    } finally {
      window.matchMedia = original
    }
  })

  it('keeps the desktop list visible without a phone toggle', () => {
    const original = window.matchMedia
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as any
    try {
      render(<Stepper steps={steps} active={1} onSelect={vi.fn()} />)
      expect(screen.getByText('1 of 2')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Step 1 of 2/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /01 Product & term/ })).toHaveAttribute('aria-current', 'step')
      expect(screen.getByRole('button', { name: /02 Qualification/ })).toBeVisible()
    } finally {
      window.matchMedia = original
    }
  })
})
