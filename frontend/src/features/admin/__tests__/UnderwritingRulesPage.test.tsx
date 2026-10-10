import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { UnderwritingRulesPage } from '../UnderwritingRulesPage'

const useAdminUnderwritingRuleFieldsMock = vi.fn()
const useAdminUnderwritingRulesMock = vi.fn()
const createRuleMutateMock = vi.fn()
const updateRuleMutateMock = vi.fn()
const seedRulesMutateMock = vi.fn()
const useAuthMock = vi.fn()
const hasPermissionMock = vi.fn()
const listProductsMock = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useAdminUnderwritingRuleFields: (...args: any[]) => useAdminUnderwritingRuleFieldsMock(...args),
  useAdminUnderwritingRules: (...args: any[]) => useAdminUnderwritingRulesMock(...args),
  useCreateAdminUnderwritingRuleMutation: () => ({ mutateAsync: createRuleMutateMock, isPending: false }),
  useUpdateAdminUnderwritingRuleMutation: () => ({ mutateAsync: updateRuleMutateMock, isPending: false }),
  useSeedAdminUnderwritingRulesMutation: () => ({ mutateAsync: seedRulesMutateMock, isPending: false }),
}))

vi.mock('../../../api/client', () => ({
  api: {
    listProducts: (...args: any[]) => listProductsMock(...args),
  },
}))

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => useAuthMock(),
}))

vi.mock('../../../auth/permissions', () => ({
  hasPermission: (...args: any[]) => hasPermissionMock(...args),
}))

const ageField = {
  fieldPath: 'driver.age',
  label: 'Driver Age',
  description: 'Age of the primary driver',
  dataType: 'number',
  allowedOperators: ['less_than', 'greater_than_or_equal', 'equals'],
}

const priorLossField = {
  fieldPath: 'risk.priorLossesCount',
  label: 'Prior Losses Count',
  description: 'Count of prior losses',
  dataType: 'number',
  allowedOperators: ['greater_than', 'greater_than_or_equal'],
}

const hasPriorViolationField = {
  fieldPath: 'driver.hasPriorViolation',
  label: 'Has Prior Violation',
  description: 'Whether the driver has a prior violation',
  dataType: 'boolean',
  allowedOperators: ['is_true', 'is_false'],
}

const existingRule = {
  ruleId: 'rule-1',
  productCode: 'personal-auto',
  stateCode: 'CA',
  fieldPath: 'driver.age',
  operator: 'less_than',
  comparisonValue: 21,
  outcome: 'Decline',
  reasonCode: 'YOUNG_DRIVER',
  reasonDescription: 'Driver under minimum age',
  active: true,
  effectiveDate: '2026-01-01',
  expirationDate: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('UnderwritingRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthMock.mockReturnValue({ user: { roles: ['admin'] } })
    hasPermissionMock.mockReturnValue(true)
    listProductsMock.mockResolvedValue({ items: [] })
    useAdminUnderwritingRuleFieldsMock.mockReturnValue({
      data: { fields: [ageField, priorLossField, hasPriorViolationField] },
      isLoading: false,
      error: null,
    })
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [existingRule] }, isLoading: false, error: null })
  })

  it('renders the rule list for the selected product', () => {
    render(<UnderwritingRulesPage />)
    expect(screen.getByText('Underwriting Rules')).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getByText('Driver Age')).toBeInTheDocument()
    expect(within(table).getByText('YOUNG_DRIVER')).toBeInTheDocument()
    expect(within(table).getByText('Decline')).toBeInTheDocument()
    expect(within(table).getByText('CA')).toBeInTheDocument()
  })

  it('shows the rules-engine-active notice when rules exist for the product', () => {
    render(<UnderwritingRulesPage />)
    expect(screen.getByTestId('rules-engine-on-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('rules-engine-off-banner')).not.toBeInTheDocument()
  })

  it('shows the no-rules-configured banner when the product has no rules', () => {
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    render(<UnderwritingRulesPage />)
    expect(screen.getByTestId('rules-engine-off-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('rules-engine-on-notice')).not.toBeInTheDocument()
  })

  it('narrows the operator dropdown to the selected field\'s allowed operators', async () => {
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    const fieldSelect = screen.getByLabelText('Field') as HTMLSelectElement
    const operatorSelect = screen.getByLabelText('Operator') as HTMLSelectElement

    // Before a field is chosen, the operator dropdown has no field-specific options.
    expect(screen.queryByRole('option', { name: 'Greater Than' })).not.toBeInTheDocument()

    await user.selectOptions(fieldSelect, 'risk.priorLossesCount')

    expect(within(operatorSelect).getByRole('option', { name: 'Greater Than' })).toBeInTheDocument()
    expect(within(operatorSelect).getByRole('option', { name: 'Greater Than Or Equal' })).toBeInTheDocument()
    expect(within(operatorSelect).queryByRole('option', { name: 'Less Than' })).not.toBeInTheDocument()
    expect(within(operatorSelect).queryByRole('option', { name: 'Equals' })).not.toBeInTheDocument()

    await user.selectOptions(fieldSelect, 'driver.age')
    expect(within(operatorSelect).getByRole('option', { name: 'Equals' })).toBeInTheDocument()
    expect(within(operatorSelect).queryByRole('option', { name: 'Greater Than' })).not.toBeInTheDocument()
  })

  it('shows a Yes/No toggle for boolean fields instead of a free-text value input', async () => {
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    await user.selectOptions(screen.getByLabelText('Field'), 'driver.hasPriorViolation')

    const valueControl = screen.getByLabelText('Comparison value')
    expect(valueControl.tagName).toBe('SELECT')
    expect(within(valueControl as HTMLSelectElement).getByRole('option', { name: 'Yes' })).toBeInTheDocument()
    expect(within(valueControl as HTMLSelectElement).getByRole('option', { name: 'No' })).toBeInTheDocument()
  })

  it('surfaces a specific field/operator rejection error from a 400 response', async () => {
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    createRuleMutateMock.mockRejectedValue(
      new Error(
        'API POST /v1/admin/underwriting-rules failed 400: {"error":"Operator \'equals\' is not allowed for field \'risk.priorLossesCount\' (dataType number allows: greater_than, greater_than_or_equal)"}'
      )
    )
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    await user.selectOptions(screen.getByLabelText('Field'), 'risk.priorLossesCount')
    await user.type(screen.getByLabelText('Comparison value'), '3')
    await user.type(screen.getByPlaceholderText('e.g. HIGH_RISK_AGE'), 'TOO_MANY_LOSSES')
    await user.click(screen.getByRole('button', { name: 'Create Rule' }))

    await waitFor(() => {
      expect(
        screen.getByText(
          "Operator 'equals' is not allowed for field 'risk.priorLossesCount' (dataType number allows: greater_than, greater_than_or_equal)"
        )
      ).toBeInTheDocument()
    })
  })

  it('submits a new rule to the create endpoint', async () => {
    useAdminUnderwritingRulesMock.mockReturnValue({ data: { items: [] }, isLoading: false, error: null })
    createRuleMutateMock.mockResolvedValue({ ...existingRule, ruleId: 'rule-2' })
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    await user.selectOptions(screen.getByLabelText('Field'), 'risk.priorLossesCount')
    await user.selectOptions(screen.getByLabelText('Operator'), 'greater_than')
    await user.type(screen.getByLabelText('Comparison value'), '2')
    await user.type(screen.getByPlaceholderText('e.g. HIGH_RISK_AGE'), 'TOO_MANY_LOSSES')
    await user.type(screen.getByPlaceholderText('Shown to the underwriter on referral'), 'Too many prior losses')
    await user.click(screen.getByRole('button', { name: 'Create Rule' }))

    await waitFor(() => {
      expect(createRuleMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          productCode: 'personal-auto',
          fieldPath: 'risk.priorLossesCount',
          operator: 'greater_than',
          comparisonValue: 2,
          reasonCode: 'TOO_MANY_LOSSES',
          reasonDescription: 'Too many prior losses',
        })
      )
    })
  })

  it('deactivates an existing rule', async () => {
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      expect(updateRuleMutateMock).toHaveBeenCalledWith({ ruleId: 'rule-1', patch: { active: false } })
    })
  })

  it('runs the seed action and shows the result message', async () => {
    seedRulesMutateMock.mockResolvedValue({ created: [{ ruleId: 'new-1' }, { ruleId: 'new-2' }] })
    const user = userEvent.setup()
    render(<UnderwritingRulesPage />)

    await user.click(screen.getByRole('button', { name: 'Seed Default Rules' }))

    await waitFor(() => {
      expect(seedRulesMutateMock).toHaveBeenCalled()
      expect(screen.getByTestId('seed-result-message')).toHaveTextContent('2 new rule(s) created')
    })
  })

  it('hides the create form and row actions when the user lacks manage permission', () => {
    hasPermissionMock.mockImplementation((_user: any, code: string) => code !== 'admin.underwriting_rules.manage')
    render(<UnderwritingRulesPage />)

    expect(screen.queryByText(/New rule/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
  })
})
