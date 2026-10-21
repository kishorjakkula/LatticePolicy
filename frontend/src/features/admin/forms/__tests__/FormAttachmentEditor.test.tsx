import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FormAttachmentEditor } from '../FormAttachmentEditor'

const api = vi.hoisted(() => ({ listFormTriggers: vi.fn(), getFormAttachmentFields: vi.fn(), addFormTrigger: vi.fn(), updateFormTrigger: vi.fn(), deleteFormTrigger: vi.fn() }))
vi.mock('../../../../api/client', () => ({ apiAdmin: api }))
const rule = { triggerId: 'rule-1', triggerType: 'Expression', conditionExpression: 'payload.building.yearBuilt < 1980', suppressExpression: 'policy.cancelled == true', priority: 10, active: true }

describe('Form attachment rule authoring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.listFormTriggers.mockResolvedValue([])
    api.getFormAttachmentFields.mockResolvedValue({ contextRoots: ['payload', 'policy', 'premium'], fields: [{ path: 'building.yearBuilt', expressionPath: 'payload.building.yearBuilt', label: 'Year built', type: 'number', group: 'Application' }] })
    api.addFormTrigger.mockResolvedValue({})
    api.updateFormTrigger.mockResolvedValue({})
    api.deleteFormTrigger.mockResolvedValue({})
  })
  const open = async (canEdit = true) => {
    render(<FormAttachmentEditor formId="form-1" productCode="commercial-property" canEdit={canEdit} onChange={vi.fn()} />)
    await waitFor(() => {
      if (canEdit) expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled()
      else expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    })
  }

  it('saves an Always rule through the API with the correct suppression property', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Never attach the form when (optional)'), { target: { value: 'premium.total > 50000' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(api.addFormTrigger).toHaveBeenCalledWith('form-1', { triggerType: 'Always', conditionExpression: '', suppressExpression: 'premium.total > 50000', priority: 100, active: true }))
  })

  it('uses catalog expressionPath for arbitrary application fields and saves Expression rules', async () => {
    await open()
    await userEvent.click(screen.getByText('Application field catalog'))
    await userEvent.click(await screen.findByRole('button', { name: 'Use Year built' }))
    expect(screen.getByLabelText('Condition expression')).toHaveValue('isSet(payload.building.yearBuilt)')
    fireEvent.change(screen.getByLabelText('Condition expression'), { target: { value: 'payload.building.yearBuilt < 1980 && premium.total > 100' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    await waitFor(() => expect(api.addFormTrigger).toHaveBeenCalledWith('form-1', expect.objectContaining({ triggerType: 'Expression', conditionExpression: 'payload.building.yearBuilt < 1980 && premium.total > 100' })))
  })

  it('rejects scripts using the shared compiler without sending a mutation', async () => {
    await open()
    await userEvent.click(screen.getByRole('radio', { name: 'Policy-data condition' }))
    fireEvent.change(screen.getByLabelText('Condition expression'), { target: { value: 'window.alert(1)' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(api.addFormTrigger).not.toHaveBeenCalled()
  })

  it('validates suppression expressions as well as conditions', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Never attach the form when (optional)'), { target: { value: 'premium.total =' } })
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(api.addFormTrigger).not.toHaveBeenCalled()
  })

  it('updates and deletes existing triggers without changing other rules', async () => {
    api.listFormTriggers.mockResolvedValue([rule])
    await open()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit rule priority 10' }))
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: '20' } })
    await userEvent.click(screen.getByRole('button', { name: 'Update rule' }))
    await waitFor(() => expect(api.updateFormTrigger).toHaveBeenCalledWith('form-1', 'rule-1', expect.objectContaining({ priority: 20, suppressExpression: rule.suppressExpression })))
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule priority 10' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete attachment rule priority 10' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.deleteFormTrigger).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete rule priority 10' }))
    dialog = screen.getByRole('dialog', { name: 'Delete attachment rule priority 10' })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteFormTrigger).toHaveBeenCalledWith('form-1', 'rule-1'))
  })

  it('locks mutations for a noneditable edition', async () => {
    api.listFormTriggers.mockResolvedValue([rule])
    await open(false)
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit rule priority 10' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete rule priority 10' })).toBeDisabled()
  })

  it('shows server failures and never treats unavailable rules as an empty editable list', async () => {
    api.listFormTriggers.mockRejectedValue(new Error('Forbidden'))
    render(<FormAttachmentEditor formId="form-1" productCode="commercial-property" canEdit onChange={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Forbidden')
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled()
  })
})
