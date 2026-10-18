import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ValidationRulesPage } from '../ValidationRulesPage'
import { validationRulesApi } from '../../../api/validation-rules.api'

const state = vi.hoisted(() => ({
  rules: { data: null as any, isPending: false, error: null, refetch: vi.fn() },
  products: { data: { items: [{ code: 'personal-auto', label: 'Personal Auto' }] }, isPending: false, error: null, refetch: vi.fn() },
  catalog: { data: { fields: [{ path: 'applicant.email', label: 'Applicant email', area: 'Insured' }] }, isPending: false, error: null, refetch: vi.fn() },
  history: { data: { items: [] }, isPending: false, error: null, refetch: vi.fn() },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === 'validation-rules' ? state.rules : queryKey[0] === 'products' ? state.products : queryKey[0] === 'validation-catalog' ? state.catalog : state.history,
}))
vi.mock('../../../api/validation-rules.api', () => ({
  validationRulesApi: { list: vi.fn(), catalog: vi.fn(), history: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}))
vi.mock('../../../api/references.api', () => ({ listProducts: vi.fn() }))
vi.mock('../../../store/auth.store', () => ({
  useAuthStore: (select: (value: any) => unknown) => select({ user: { roles: ['admin'], permissions: ['admin.validation_rules.manage'] } }),
}))

const stored = (overrides: Record<string, unknown>) => ({
  ruleId: Math.random().toString(36),
  ruleCode: 'RULE',
  name: 'Rule',
  kind: 'required',
  fieldPath: 'applicant.email',
  levels: ['bind'],
  transactionTypes: ['new_business'],
  productCode: null,
  stateCode: null,
  screen: null,
  severity: 'error',
  message: 'Message',
  active: true,
  version: 1,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.rules.data = {
    items: [
      stored({ ruleCode: 'COMMON_ISSUE', levels: ['issue'], transactionTypes: ['common'], severity: 'warning', message: 'Review documents' }),
      stored({ ruleCode: 'CANCEL_REASON', levels: ['issue'], transactionTypes: ['cancellation'], productCode: 'personal-auto', stateCode: 'CA' }),
      stored({ ruleCode: 'OLD_RULE', active: false }),
    ],
  }
  state.rules.refetch.mockResolvedValue({})
})

describe('validation rules admin', () => {
  it('shows coverage by transaction and level, counting Common rules for every transaction', () => {
    render(<ValidationRulesPage />)
    expect(screen.getByRole('button', { name: 'Cancellation, Issue / process: 2 rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Endorsement, Issue / process: 1 rules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New business, Bind: 0 rules' })).toBeInTheDocument()
  })

  it('filters the list from a coverage cell and hides inactive rules by default', () => {
    render(<ValidationRulesPage />)
    expect(screen.queryByText('OLD_RULE')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Endorsement, Issue / process: 1 rules' }))
    const table = screen.getAllByRole('table')[1]
    expect(within(table).getByText('COMMON_ISSUE')).toBeInTheDocument()
    expect(within(table).queryByText('CANCEL_REASON')).not.toBeInTheDocument()
  })

  it('checks a rule before saving and sends a normalized rule', async () => {
    vi.mocked(validationRulesApi.create).mockResolvedValue({} as any)
    render(<ValidationRulesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'New Rule' }))
    fireEvent.change(screen.getByLabelText('Rule code'), { target: { value: 'cancel reason' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Cancellation reason' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }))
    expect(await screen.findByText('Enter a valid field path, for example applicant.email or risks[*].vin')).toBeInTheDocument()
    expect(validationRulesApi.create).not.toHaveBeenCalled()

    // Common covers every transaction, so the individual ones are disabled.
    fireEvent.click(screen.getByLabelText('Common (all transactions)'))
    expect(screen.getByLabelText('Endorsement')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Field path'), { target: { value: 'transaction.reasonCode' } })
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'A reason is required' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'ca' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }))
    await waitFor(() =>
      expect(validationRulesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ruleCode: 'CANCEL_REASON',
          kind: 'required',
          fieldPath: 'transaction.reasonCode',
          transactionTypes: ['common'],
          levels: ['screen', 'rate', 'bind'],
          screen: 'insureds',
          stateCode: 'CA',
          severity: 'error',
          condition: null,
        }),
      ),
    )
  })

  it('validates condition syntax in the browser', async () => {
    render(<ValidationRulesPage />)
    fireEvent.click(screen.getByRole('button', { name: 'New Rule' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Condition must be true' }))
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'risk.age >' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Rule' }))
    expect(await screen.findByText(/^Condition:/)).toBeInTheDocument()
  })
})
