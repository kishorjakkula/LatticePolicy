import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormsManagementPage } from '../../FormsManagementPage'

const fixtures = vi.hoisted(() => {
  const summaries = [
    { formId: 'form-1', formNumber: 'PR-1', formTitle: 'Property conditions', workflowStatus: 'Draft', editionDate: '2026-01-01', jurisdictionCount: 1, active: false, productCodes: ['property'], stateCodes: ['CA'], transactionTypes: ['Issue'], templateSource: 'Static PDF' },
    { formId: 'form-2', formNumber: 'AU-2', formTitle: 'Auto conditions', workflowStatus: 'Approved', editionDate: '2026-01-01', jurisdictionCount: 1, active: true, productCodes: ['auto'], stateCodes: ['NY'], transactionTypes: ['Quote'], templateSource: 'Uploaded DOCX' },
  ]
  const details = summaries.map((form, index) => ({ form: { ...form, editLock: true }, jurisdictions: [{ jurisdictionId: `state-${index}`, stateCode: index ? 'NY' : 'CA', regulatoryStatus: 'Approved' }], applicability: [{ applicabilityId: `app-${index}`, productCode: index ? 'auto' : 'property', transactionTypes: ['Issue'], riskUnitAssociation: 'Policy' }], output: { templateSource: 'Static PDF' }, delivery: null, security: null }))
  return { summaries, details, refetch: vi.fn(), formIds: [] as string[] }
})
const api = vi.hoisted(() => ({ getForm: vi.fn(), listUnderwritingCompanies: vi.fn(), getFormAudit: vi.fn(), getFormTemplateAsset: vi.fn(), listFormTriggers: vi.fn(), getFormAttachmentFields: vi.fn(), updateForm: vi.fn(), updateFormOutput: vi.fn(), updateFormDelivery: vi.fn() }))
vi.mock('../../../../api/client', () => ({ apiAdmin: api }))
vi.mock('../../../../api/hooks', () => ({
  useForms: () => ({ data: fixtures.summaries, isLoading: false, refetch: fixtures.refetch }),
  useForm: (id: string) => {
    fixtures.formIds.push(id)
    return { data: fixtures.details.find((row) => row.form.formId === id), refetch: fixtures.refetch }
  },
  useFormTemplateVariables: () => ({ data: { variables: [] }, isLoading: false }),
}))

describe('Forms management approved workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fixtures.formIds.length = 0
    api.listUnderwritingCompanies.mockResolvedValue([{ productCode: 'property', country: 'US', state: 'CA' }, { productCode: 'auto', country: 'US', state: 'NY' }])
    api.getFormAudit.mockResolvedValue([])
    api.getFormTemplateAsset.mockResolvedValue(null)
    api.listFormTriggers.mockResolvedValue([])
    api.getFormAttachmentFields.mockResolvedValue({ fields: [], contextRoots: [] })
    api.updateForm.mockResolvedValue({ form: { formId: 'form-1' } })
    api.updateFormOutput.mockResolvedValue({})
    api.updateFormDelivery.mockResolvedValue({})
  })
  it('has four keyboard-accessible steps, real attachment editor and supported upload types', async () => {
    render(<FormsManagementPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit PR-1' }))
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Details & scope', 'Template', 'Attachment', 'Test & publish'])
    const details = screen.getByRole('tab', { name: 'Details & scope' })
    details.focus()
    fireEvent.keyDown(details, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Template' })).toHaveFocus()
    expect(screen.getByLabelText('Upload Template (PDF or Word .docx)')).toHaveAttribute('accept', expect.not.stringContaining('xlsx'))
    await userEvent.click(screen.getByRole('tab', { name: 'Attachment' }))
    expect(await screen.findByRole('button', { name: 'Add rule' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled())
    await userEvent.click(screen.getByRole('tab', { name: 'Test & publish' }))
    expect(screen.getByLabelText('Synthetic scenario JSON')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument()
  })
  it('renders and filters list summaries without hydrating any form details', async () => {
    render(<FormsManagementPage />)
    expect(screen.getByRole('row', { name: /AU-2/ })).toHaveTextContent('Uploaded DOCX')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Product' }).querySelectorAll('option')).toHaveLength(3))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Product' }), 'property')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'CA')
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit AU-2' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Edit PR-1' })).toBeInTheDocument()
    expect(api.getForm).not.toHaveBeenCalled()
    expect(fixtures.formIds.every((id) => id === '')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Edit PR-1' }))
    expect(fixtures.formIds).toContain('form-1')
    expect(fixtures.formIds).not.toContain('form-2')
  })
  it('keeps approved edition locks and allows creating a new edition', async () => {
    render(<FormsManagementPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit AU-2' }))
    expect(screen.getByRole('button', { name: 'Save Form' })).toBeDisabled()
    expect(screen.getByLabelText('Form Number')).toBeDisabled()
    await userEvent.click(screen.getByRole('tab', { name: 'Attachment' }))
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    await userEvent.click(screen.getByRole('tab', { name: 'Test & publish' }))
    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create new edition' })).toBeEnabled()
  })
  it('saves the real draft before continuing, without submitting or activating it', async () => {
    render(<FormsManagementPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit PR-1' }))
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Save & continue' }))
    await waitFor(() => expect(api.updateForm).toHaveBeenCalledWith('form-1', expect.objectContaining({ formNumber: 'PR-1' })))
    expect(screen.getByRole('tab', { name: 'Template' })).toHaveAttribute('aria-selected', 'true')
  })
  it('refreshes unchanged list filters, selected detail and catalog scope', async () => {
    render(<FormsManagementPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit PR-1' }))
    const auditCalls = api.getFormAudit.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(fixtures.refetch).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.getFormAudit.mock.calls.length).toBe(auditCalls + 1))
    expect(api.getForm).not.toHaveBeenCalled()
  })
})
