import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { FormsManagementPage } from '../FormsManagementPage'
import { useAuthStore } from '../../../store/auth.store'

// WP-0004 REQ-2: lifecycle reasons, the new edition date and deletion use the
// in-app dialogs; the API calls and their arguments are unchanged.

const fixture = vi.hoisted(() => ({ detail: null as any }))
const api = vi.hoisted(() => ({
  getFormAudit: vi.fn(async () => []),
  getFormTemplateAsset: vi.fn(async () => null),
  getFormTriggers: vi.fn(async () => []),
  listFormTriggers: vi.fn(async () => []),
  getFormAttachmentFields: vi.fn(async () => ({ fields: [], contextRoots: [] })),
  approveForm: vi.fn(async () => ({})),
  activateForm: vi.fn(async () => ({})),
  deactivateForm: vi.fn(async () => ({})),
  cloneForm: vi.fn(async () => ({ form: { formId: 'form-2' } })),
  deleteForm: vi.fn(async () => ({})),
}))

vi.mock('../../../api/hooks', () => ({
  useForms: () => ({ data: [{ formId: 'form-1', formNumber: 'PA-100', formTitle: 'Coverage Form', editionDate: '2026-01-01', workflowStatus: fixture.detail.form.workflowStatus, active: fixture.detail.form.active, jurisdictionCount: 1 }], isLoading: false, refetch: vi.fn() }),
  useForm: () => ({ data: fixture.detail, refetch: vi.fn() }),
  useFormTemplateVariables: () => ({ data: [], isLoading: false }),
}))

vi.mock('../../../api/client', () => ({ apiAdmin: api }))

function detail(form: Record<string, unknown>) {
  return {
    form: { formId: 'form-1', formNumber: 'PA-100', formTitle: 'Coverage Form', workflowStatus: 'Approved', active: false, editLock: true, ...form },
    jurisdictions: [], applicability: [],
    output: { templateSource: 'Static PDF', templateUri: '', outputFormat: 'PDF', mergeScope: 'policy', packetPlacement: 'End', sortOrder: 100, active: true },
    templateAsset: null,
    delivery: { deliveryMethods: [], visibility: [], acknowledgementRequired: false, esignRequired: false, active: true },
    security: { allowedRoles: [], editRoles: [], viewRoles: [] },
  }
}

async function openLifecycle(form: Record<string, unknown>, roles: string[]) {
  fixture.detail = detail(form)
  useAuthStore.setState({ token: 'token', user: { username: 'tester', roles } as any })
  render(<FormsManagementPage />)
  await userEvent.click(screen.getByRole('button', { name: 'Edit PA-100' }))
  await userEvent.click(screen.getByRole('tab', { name: /Test & publish/ }))
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => useAuthStore.setState({ token: null, user: null }))

describe('forms management dialogs', () => {
  it('requires an activation reason in a labelled dialog and sends it trimmed', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: false, editLock: true }, ['compliance_admin'])
    await userEvent.click(screen.getByRole('button', { name: 'Activate' }))
    const dialog = screen.getByRole('dialog', { name: 'Activate form PA-100' })
    const field = within(dialog).getByLabelText('Reason (required)')
    expect(field).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Activate' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason.')
    expect(api.activateForm).not.toHaveBeenCalled()
    await userEvent.type(field, '  Filed and approved  ')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(api.activateForm).toHaveBeenCalledWith('form-1', 'Filed and approved'))
  })

  it('deactivation uses the danger style and Escape sends nothing', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: true, editLock: true }, ['compliance_admin'])
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    const dialog = screen.getByRole('dialog', { name: 'Deactivate form PA-100' })
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toHaveClass('btn-danger')
    await userEvent.type(within(dialog).getByLabelText('Reason (required)'), 'Withdrawn filing')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Deactivate form PA-100' })).not.toBeInTheDocument()
    expect(api.deactivateForm).not.toHaveBeenCalled()
  })

  it('validates the new edition date as MM/YYYY before cloning', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: true, editLock: true }, ['forms_admin', 'compliance_admin'])
    await userEvent.click(screen.getByRole('button', { name: 'Create new edition' }))
    const dialog = screen.getByRole('dialog', { name: 'Create new edition of form PA-100' })
    const field = within(dialog).getByLabelText('Edition date (required)')
    expect(within(dialog).getByText('MM/YYYY')).toBeInTheDocument()

    for (const bad of ['13/2026', '00/2026', '4/2026', '2026-04', '04/2026 extra']) {
      await userEvent.clear(field)
      await userEvent.type(field, bad)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Create edition' }))
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Enter the edition date as MM/YYYY')
      expect(field).toHaveAttribute('aria-invalid', 'true')
    }
    expect(api.cloneForm).not.toHaveBeenCalled()

    await userEvent.clear(field)
    await userEvent.type(field, '04/2027')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create edition' }))
    await waitFor(() => expect(api.cloneForm).toHaveBeenCalledWith('form-1', { editionDate: '04/2027' }))
    expect(screen.queryByRole('dialog', { name: 'Create new edition of form PA-100' })).not.toBeInTheDocument()
  })

  it('cancelling the edition date dialog does not clone', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: true, editLock: true }, ['forms_admin', 'compliance_admin'])
    await userEvent.click(screen.getByRole('button', { name: 'Create new edition' }))
    const dialog = screen.getByRole('dialog', { name: 'Create new edition of form PA-100' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Create new edition of form PA-100' })).not.toBeInTheDocument()
    expect(api.cloneForm).not.toHaveBeenCalled()
  })
})
