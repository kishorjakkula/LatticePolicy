import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QUALIFICATION_QUESTIONS } from '@lattice-policy/rules'
import { QuoteWizard } from '../QuoteWizard'

const mocks = vi.hoisted(() => ({
  getQuote: vi.fn(),
  updateQuoteDraft: vi.fn(),
  previewForms: vi.fn(),
}))

vi.mock('../../../api/client', () => ({
  api: {
    ...mocks,
    listProducts: vi.fn().mockResolvedValue({ items: [] }),
    getProductConfig: vi.fn().mockImplementation(async (product: string) => ({ product, coverages: [{ code: 'BI', name: 'Bodily Injury', limits: [100000, 250000] }] })),
    getProductForm: vi.fn().mockResolvedValue({ fields: [] }),
  },
  apiDetails: vi.fn(),
}))

vi.mock('../../../api/validation-rules.api', () => ({
  validationRulesApi: { applicable: vi.fn().mockResolvedValue({ items: [] }) },
  validationStopFrom: vi.fn(),
}))
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ user: { username: 'test-agent', roles: ['agent'] } }) }))
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Stable reference responses, with multiple products/states at the destination:
// the wizard must leave those choices empty instead of auto-selecting one.
vi.mock('../../../api/hooks', () => {
  const empty = { data: { items: [] }, isLoading: false }
  const companies = { data: { items: [
    { companyId: 'auto-tx', name: 'Auto Company', productCode: 'personal-auto', country: 'US', state: 'TX' },
    { companyId: 'home-tx', name: 'Other Company', productCode: 'homeowners', country: 'US', state: 'TX' },
    { companyId: 'cyber-ca', name: 'Other Company', productCode: 'cyber', country: 'US', state: 'CA' },
    { companyId: 'alternate-tx', name: 'Alternate Auto Company', productCode: 'personal-auto', country: 'US', state: 'TX' },
    { companyId: 'alternate-ca', name: 'Alternate Auto Company', productCode: 'personal-auto', country: 'US', state: 'CA' },
  ] }, isLoading: false }
  return {
    useUnderwritingCompanies: () => companies,
    useReferenceAgencies: () => empty,
    useUnderwriters: () => empty,
    useReferenceInsuranceCarriers: () => empty,
    useCancellationReasonCodes: () => empty,
    useAgencyContacts: () => empty,
  }
})

function party(firstName: string) {
  return {
    firstName, lastName: 'Example', displayName: `${firstName} Example`, dob: '1980-01-01', prefix: '',
    email: `${firstName.toLowerCase()}@example.test`, phone: '5550101000', customerId: `customer-${firstName}`, customerKey: `C-${firstName}`,
    address: { street: '10 Test Street', city: 'Austin', state: 'TX', zip: '78701' },
  }
}

function savedPayload() {
  return {
    productCode: 'personal-auto', underwritingCompanyId: 'auto-tx', underwritingCompanyName: 'Auto Company',
    country: 'US', state: 'TX', effectiveDate: '2026-11-01', termMonths: 12, policyOffering: 'Standard Personal Auto',
    applicant: { firstName: 'Pat', lastName: 'Example', email: 'pat@example.test' },
    insureds: { primary: party('Pat'), secondary: party('Sam'), additional: [party('Alex')] },
    uwAnswers: Object.fromEntries(QUALIFICATION_QUESTIONS['personal-auto'].filter(q => !q.showWhen).map(q => [q.key, true])),
    risks: [{ vin: '1HGCM82633A004352', year: 2021, make: 'Honda', model: 'Accord', garagingZip: '78701' }],
    coverages: [{ code: 'BI', selected: true, limit: 250000 }],
    agencyId: 'agency-test', agencyName: 'Test Agency', agencyCommissionPct: 12,
    priorPolicyNumber: 'PRIOR-123', priorCarrier: 'Test Carrier', priorExpirationDate: '2026-10-31', yearsWithPriorCarrier: '4',
    billingMethod: 'direct', paymentPlan: 'monthly',
    mailingAddress: { street: '20 Mailing Street', city: 'Austin', state: 'TX', zip: '78702' },
    additionalInterests: [{ id: 'interest-1', role: 'LOSS_PAYEE', name: 'Test Bank', loanNumber: 'LOAN-123', street: '30 Bank Street', city: 'Austin', state: 'TX', zip: '78703' }],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getQuote.mockResolvedValue({
    quoteId: 'quote-test', quoteNumber: 'Q-TEST', status: 'Rated', progressStep: 1, payload: savedPayload(),
    premium: { total: { amount: 1234, currency: 'USD' }, byCoverage: [] }, underwriting: { decision: 'Accept', reasons: [] },
  })
  mocks.updateQuoteDraft.mockImplementation(async (_id, _payload, options) => ({
    quoteId: 'quote-test', quoteNumber: 'Q-TEST', status: 'Rated', progressStep: options.progressStep,
  }))
  mocks.previewForms.mockResolvedValue([])
})

async function goTo(name: RegExp) {
  const button = screen.getByRole('button', { name })
  fireEvent.click(button)
  await waitFor(() => expect(button).toHaveAttribute('aria-current', 'step'))
}

async function showDocuments() {
  await goTo(/08 Forms & Documents/)
  fireEvent.click(screen.getByRole('button', { name: /^Documents$/ }))
}

async function openRatedQuote() {
  render(<MemoryRouter initialEntries={['/quote?quoteId=quote-test']}><QuoteWizard /></MemoryRouter>)
  await waitFor(() => expect(screen.getByLabelText('Underwriting Company')).toHaveValue('Auto Company'))
  // Establish both derived states before attempting a company change. This
  // prevents a missing/invalid fixture from making the invalidation test pass.
  await showDocuments()
  expect(screen.getByText('Quote Summary #Q-TEST')).toBeInTheDocument()
  expect(screen.getByText('Rating Worksheet')).toBeInTheDocument()
  await goTo(/01 Product/)
}

async function savePayload() {
  mocks.updateQuoteDraft.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }))
  await waitFor(() => expect(mocks.updateQuoteDraft).toHaveBeenCalledTimes(1))
  return mocks.updateQuoteDraft.mock.calls[0][1]
}

function requestChange(company = 'Other Company') {
  fireEvent.change(screen.getByLabelText('Underwriting Company'), { target: { value: company } })
  expect(screen.getByRole('dialog', { name: `Change underwriting company to ${company}?` })).toBeInTheDocument()
}

describe('company change in the quote wizard (WP-0002)', () => {
  it.each(['Keep', 'Escape'])('%s preserves qualification, risks, coverages, insureds, common data and rated documents', async (dismiss) => {
    await openRatedQuote()
    const before = await savePayload()
    expect(before.qualificationAnswers.noMajorViolations3Years).toBe('yes')
    expect(before.risks).toEqual(savedPayload().risks)
    expect(before.coverages).toMatchObject(savedPayload().coverages)
    requestChange()
    if (dismiss === 'Keep') fireEvent.click(screen.getByRole('button', { name: 'Keep Personal Auto' }))
    else fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Underwriting Company')).toHaveValue('Auto Company')
    expect(await savePayload()).toEqual(before)
    await showDocuments()
    expect(screen.getByText('Quote Summary #Q-TEST')).toBeInTheDocument()
    expect(screen.getByText('Rating Worksheet')).toBeInTheDocument()
  })

  it('confirmation clears product data and invalidates rating/documents but retains insureds and common data', async () => {
    await openRatedQuote()
    const before = await savePayload()
    requestChange()
    fireEvent.click(screen.getByRole('button', { name: 'Change company' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Underwriting Company')).toHaveValue('Other Company')
    const after = await savePayload()
    expect(after).toMatchObject({
      underwritingCompanyId: 'home-tx', underwritingCompanyName: 'Other Company', productCode: '', state: '', policyOffering: '',
      qualificationAnswers: {}, risks: [], coverages: [], uwAnswers: {},
    })
    for (const key of ['applicant', 'insureds', 'effectiveDate', 'termMonths', 'agencyId', 'agencyName', 'agencyCommissionPct',
      'priorPolicyNumber', 'priorCarrier', 'priorExpirationDate', 'yearsWithPriorCarrier', 'billingMethod', 'paymentPlan', 'mailingAddress', 'additionalInterests']) {
      expect(after[key], key).toEqual(before[key])
    }
    // Complete the new setup through real controls before inspecting output.
    // No re-rate: the old premium and quote summary must not be reusable.
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'cyber' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'CA' } })
    await showDocuments()
    expect(screen.getByText('No generated documents available for this transaction yet.')).toBeInTheDocument()
    expect(screen.queryByText('Quote Summary #Q-TEST')).not.toBeInTheDocument()
    expect(screen.queryByText('Rating Worksheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Bind/ })).toBeDisabled()
  })

  it('invalidates rated output even when the destination auto-selects the same product', async () => {
    await openRatedQuote()
    requestChange('Alternate Auto Company')
    fireEvent.click(screen.getByRole('button', { name: 'Change company' }))
    const after = await savePayload()
    expect(after.productCode).toBe('personal-auto')
    expect(after.coverages).toEqual([])
    expect(after.risks).not.toEqual(savedPayload().risks)
    expect(Object.values(after.qualificationAnswers).every(value => value === '')).toBe(true)
    // Only restore jurisdiction. Calling the manual product handler here would
    // independently clear rating and could hide a broken company reset.
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'TX' } })
    await showDocuments()
    expect(screen.getByText('No generated documents available for this transaction yet.')).toBeInTheDocument()
    expect(screen.queryByText('Quote Summary #Q-TEST')).not.toBeInTheDocument()
    expect(screen.queryByText('Rating Worksheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Bind/ })).toBeDisabled()
  })
})
