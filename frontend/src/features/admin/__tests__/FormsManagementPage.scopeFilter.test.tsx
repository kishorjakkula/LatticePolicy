import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormsManagementPage } from '../FormsManagementPage'

const base = { workflowStatus: 'Approved', editionDate: '2026-01-01', active: true, transactionTypes: ['Issue'], templateSource: 'Static PDF', hasApplicability: true, requireApprovedJurisdiction: true }
const fixtures = vi.hoisted(() => ({ summaries: [] as any[], refetch: vi.fn() }))
const api = vi.hoisted(() => ({ getForm: vi.fn(), listUnderwritingCompanies: vi.fn(), getFormAudit: vi.fn(), getFormTemplateAsset: vi.fn(), listFormTriggers: vi.fn() }))
vi.mock('../../../api/client', () => ({ apiAdmin: api }))
vi.mock('../../../api/hooks', () => ({
  useForms: () => ({ data: fixtures.summaries, isLoading: false, refetch: fixtures.refetch }),
  useForm: () => ({ data: undefined, refetch: fixtures.refetch }),
  useFormTemplateVariables: () => ({ data: { variables: [] }, isLoading: false }),
}))

describe('Forms catalog scope filters', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixtures.summaries = [
      { ...base, formId: 'f1', formNumber: 'EXPLICIT-AUTO-CA', formTitle: 'Explicit', lineOfBusiness: 'auto', jurisdictionCount: 1, productCodes: ['auto'], stateCodes: ['CA'] },
      { ...base, formId: 'f2', formNumber: 'NO-APP-AUTO', formTitle: 'Line fallback', lineOfBusiness: 'auto', hasApplicability: false, jurisdictionCount: 1, productCodes: [], stateCodes: ['ALL'] },
      { ...base, formId: 'f3', formNumber: 'ANY-PRODUCT', formTitle: 'Blank product rows', lineOfBusiness: 'property', jurisdictionCount: 0, productCodes: [], stateCodes: [], requireApprovedJurisdiction: false },
      { ...base, formId: 'f4', formNumber: 'NO-APP-PROPERTY', formTitle: 'Other line', lineOfBusiness: 'property', hasApplicability: false, jurisdictionCount: 1, productCodes: [], stateCodes: ['CA'] },
      { ...base, formId: 'f5', formNumber: 'AUTO-NY', formTitle: 'Other state', lineOfBusiness: 'auto', jurisdictionCount: 1, productCodes: ['auto'], stateCodes: ['NY'] },
      { ...base, formId: 'f6', formNumber: 'AUTO-NO-STATE', formTitle: 'Needs approval', lineOfBusiness: 'auto', jurisdictionCount: 0, productCodes: ['auto'], stateCodes: [] },
    ]
    api.listUnderwritingCompanies.mockResolvedValue([{ productCode: 'auto', country: 'US', state: 'CA' }, { productCode: 'property', country: 'US', state: 'NY' }])
    api.getFormAudit.mockResolvedValue([])
    api.getFormTemplateAsset.mockResolvedValue(null)
    api.listFormTriggers.mockResolvedValue([])
  })

  it('keeps line-of-business and ALL forms the generator would attach, and drops what it would not', async () => {
    render(<FormsManagementPage />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Product' }).querySelectorAll('option').length).toBeGreaterThan(1))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Product' }), 'auto')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'CA')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(screen.queryByRole('row', { name: /AUTO-NY/ })).not.toBeInTheDocument())
    for (const kept of ['EXPLICIT-AUTO-CA', 'NO-APP-AUTO']) {
      expect(screen.getByRole('row', { name: new RegExp(kept) })).toBeInTheDocument()
    }
    for (const dropped of ['ANY-PRODUCT', 'NO-APP-PROPERTY', 'AUTO-NY', 'AUTO-NO-STATE']) {
      expect(screen.queryByRole('row', { name: new RegExp(dropped) })).not.toBeInTheDocument()
    }
    expect(screen.getByRole('row', { name: /NO-APP-AUTO/ })).toHaveTextContent('All auto products')
    expect(screen.getByRole('row', { name: /NO-APP-AUTO/ })).toHaveTextContent('All states')
  })
})
