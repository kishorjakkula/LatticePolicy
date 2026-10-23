import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QUALIFICATION_QUESTIONS } from '@lattice-policy/rules'
import { QuoteWizard, buildWizardQuotePayload } from '../QuoteWizard'

const mocks = vi.hoisted(() => ({
  getQuote: vi.fn(),
  updateQuoteDraft: vi.fn(),
  previewForms: vi.fn(),
  getCustomer: vi.fn(),
}))

vi.mock('../../../api/client', () => ({
  api: {
    ...mocks,
    listProducts: vi.fn().mockResolvedValue({ items: [] }),
    getProductConfig: vi.fn().mockImplementation(async (product: string) => ({ product, coverages: [{ code: product === 'personal-auto' ? 'BI' : 'CYBER', name: 'Liability', limits: [100000, 250000] }] })),
    getProductForm: vi.fn().mockResolvedValue({ fields: [] }),
  },
  apiDetails: vi.fn(),
}))

vi.mock('../../../api/validation-rules.api', () => ({
  validationRulesApi: { applicable: vi.fn().mockResolvedValue({ items: [] }) },
  validationStopFrom: vi.fn(),
}))
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ user: { username: 'test-agent', roles: ['agent'], permissions: ['admin.customers.read'] } }) }))
vi.mock('../../../api/quotes.api', () => ({ quoteIntakeApi: { getCustomer: mocks.getCustomer } }))
vi.mock('../../../components/Toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Multiple compatible companies keep deselection observable. Other products,
// states and countries must never leak into the selected product's company list.
vi.mock('../../../api/hooks', () => {
  const empty = { data: { items: [] }, isLoading: false }
  const companies = { data: { items: [
    { companyId: 'auto-tx', name: 'Auto Company', productCode: 'personal-auto', country: 'US', state: 'TX' },
    { companyId: 'home-tx', name: 'Other Company', productCode: 'homeowners', country: 'US', state: 'TX' },
    { companyId: 'cyber-ca', name: 'Other Company', productCode: 'cyber', country: 'US', state: 'CA' },
    { companyId: 'cyber-tx', name: 'Cyber Company', productCode: 'cyber', country: 'US', state: 'TX' },
    { companyId: 'alternate-tx', name: 'Alternate Auto Company', productCode: 'personal-auto', country: 'US', state: 'TX' },
    { companyId: 'alternate-ca', name: 'Alternate Auto Company', productCode: 'personal-auto', country: 'US', state: 'CA' },
    { companyId: 'ca-only', name: 'California Only Company', productCode: 'personal-auto', country: 'US', state: 'CA' },
    { companyId: 'canada-only', name: 'Canada Only Company', productCode: 'personal-auto', country: 'CA', state: 'ALL' },
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
  mocks.getCustomer.mockResolvedValue(null)
})

it.each(['updated@example.com', ''])('primary contact email %j is authoritative for the saved notification recipient projection', email => {
  const state = savedPayload()
  state.insureds.primary.email = email
  expect(buildWizardQuotePayload(state as any, state.insureds).applicant.email).toBe(email)
})

it('closing a pending read-only contact popup cannot overwrite a newly edited contact address', async () => {
  await openRatedQuote()
  await goTo(/03 Insureds/)
  let resolve!: (value: any) => void
  mocks.getCustomer.mockImplementation(() => new Promise(r => { resolve = r }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Pat' })[0])
  await waitFor(() => expect(mocks.getCustomer).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  fireEvent.change(screen.getAllByLabelText('Apartment, suite or unit')[0], { target: { value: 'APT 99' } })
  await act(async () => resolve({ addresses: [{ line1: 'STALE READ', city: 'Austin', state: 'TX', postalCode: '78701' }] }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getAllByLabelText('Apartment, suite or unit')[0]).toHaveValue('APT 99')
  expect((await savePayload()).insureds.primary.addresses[0].line2).toBe('APT 99')
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

function requestProductChange() {
  fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'cyber' } })
  expect(screen.getByRole('dialog', { name: 'Change product to Cyber?' })).toBeInTheDocument()
}

async function expectRatingInvalidated() {
  expect(screen.getByTestId('wizard-quote-summary')).not.toHaveTextContent('$1,234.00')
  await goTo(/07 Premium/)
  expect(screen.queryByText('Coverage Premium Allocation')).not.toBeInTheDocument()
  expect(screen.getByText('Rate premium in the Rating step to continue.')).toBeInTheDocument()
  await showDocuments()
  expect(screen.getByText('No generated documents available for this transaction yet.')).toBeInTheDocument()
  expect(screen.queryByText('Quote Summary #Q-TEST')).not.toBeInTheDocument()
  expect(screen.queryByText('Rating Worksheet')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^Bind/ })).toBeDisabled()
}

const commonFields = ['applicant', 'insureds', 'country', 'state', 'effectiveDate', 'termMonths', 'agencyId', 'agencyName', 'agencyCommissionPct',
  'priorPolicyNumber', 'priorCarrier', 'priorExpirationDate', 'yearsWithPriorCarrier', 'billingMethod', 'paymentPlan', 'mailingAddress', 'additionalInterests']

describe('product-first company changes in the quote wizard (WP-0004)', () => {
  it('offers only companies compatible with the selected product, country and state', async () => {
    await openRatedQuote()
    expect(screen.getByLabelText('Product')).toHaveValue('personal-auto')
    expect(screen.getByLabelText('State')).toHaveValue('TX')
    const company = screen.getByLabelText('Underwriting Company') as HTMLSelectElement
    expect(Array.from(company.options, option => option.text)).toEqual(['Select underwriting company', 'Alternate Auto Company', 'Auto Company'])
  })

  it.each(['Keep', 'Escape'])('%s preserves qualification, risks, coverages, insureds, common data and rated documents', async (dismiss) => {
    await openRatedQuote()
    const before = await savePayload()
    expect(before.qualificationAnswers.noMajorViolations3Years).toBe('yes')
    expect(before.risks).toEqual(savedPayload().risks)
    expect(before.coverages).toMatchObject(savedPayload().coverages)
    requestProductChange()
    if (dismiss === 'Keep') fireEvent.click(screen.getByRole('button', { name: 'Keep Personal Auto' }))
    else fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Underwriting Company')).toHaveValue('Auto Company')
    expect(await savePayload()).toEqual(before)
    expect(screen.getByTestId('wizard-quote-summary')).toHaveTextContent('$1,234.00')
    await showDocuments()
    expect(screen.getByText('Quote Summary #Q-TEST')).toBeInTheDocument()
    expect(screen.getByText('Rating Worksheet')).toBeInTheDocument()
  })

  it('confirmed product change clears product-specific data and rated output but retains insureds and all common fields', async () => {
    await openRatedQuote()
    const before = await savePayload()
    requestProductChange()
    fireEvent.click(screen.getByRole('button', { name: 'Change product' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const after = await savePayload()
    expect(after).toMatchObject({
      productCode: 'cyber', policyOffering: '', coverages: [],
    })
    expect(after.risks).not.toEqual(before.risks)
    expect(after.risks).not.toEqual(expect.arrayContaining([expect.objectContaining({ vin: savedPayload().risks[0].vin })]))
    expect(after.qualificationAnswers).not.toHaveProperty('noMajorViolations3Years')
    expect(Object.values(after.qualificationAnswers).every(value => value === '')).toBe(true)
    expect(after.uwAnswers).not.toHaveProperty('noMajorViolations3Years')
    for (const key of commonFields) {
      expect(after[key], key).toEqual(before[key])
    }
    expect(screen.getByTestId('wizard-quote-summary')).not.toHaveTextContent('$1,234.00')
    // The incompatible old company is cleared; finish setup through its real control.
    fireEvent.change(screen.getByLabelText('Underwriting Company'), { target: { value: 'Cyber Company' } })
    await expectRatingInvalidated()
  })

  it.each([
    ['Alternate Auto Company', ''],
    ['', ''],
  ])('company selection %j preserves every business field without confirmation and invalidates rated output', async (company, companyId) => {
    await openRatedQuote()
    const before = await savePayload()
    expect(before.qualificationAnswers.noMajorViolations3Years).toBe('yes')
    expect(before.risks).toEqual(savedPayload().risks)
    expect(before.coverages).toMatchObject(savedPayload().coverages)
    for (const key of commonFields) {
      if (key === 'insureds') {
        expect(before.insureds).toMatchObject(savedPayload().insureds)
        expect(before.insureds.primary.addresses).toHaveLength(1)
      } else expect(before[key], key).toEqual(savedPayload()[key as keyof ReturnType<typeof savedPayload>])
    }
    expect(screen.getByTestId('wizard-quote-summary')).toHaveTextContent('$1,234.00')
    fireEvent.change(screen.getByLabelText('Underwriting Company'), { target: { value: company } })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Underwriting Company')).toHaveValue(company)
    const after = await savePayload()
    expect(after).toEqual({ ...before, underwritingCompanyId: companyId, underwritingCompanyName: company })
    expect(screen.getByTestId('wizard-quote-summary')).not.toHaveTextContent('$1,234.00')
    // Setup validation blocks navigation with no company. Verify premium is
    // already gone before reselecting; do not re-rate or touch product/state.
    if (!company) fireEvent.change(screen.getByLabelText('Underwriting Company'), { target: { value: 'Auto Company' } })
    // Do not invoke product/state handlers: they could mask missing company invalidation.
    await expectRatingInvalidated()
  })
})
