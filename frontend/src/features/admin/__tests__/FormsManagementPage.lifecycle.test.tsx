import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { FormsManagementPage } from '../FormsManagementPage'
import { useAuthStore } from '../../../store/auth.store'

// Detail fixture is swapped per test; the hook returns the same object across renders
// so the page's detail re-hydration effect does not loop.
const fixture = vi.hoisted(() => ({ detail: null as any }))

vi.mock('../../../api/hooks', () => ({
  useForms: () => ({ data: [{ formId: 'form-1', formNumber: 'PA-100', formTitle: 'Coverage Form', editionDate: '2026-01-01', workflowStatus: fixture.detail.form.workflowStatus, active: fixture.detail.form.active, jurisdictionCount: 1 }], isLoading: false, refetch: vi.fn() }),
  useForm: () => ({ data: fixture.detail, refetch: vi.fn() }),
  useFormTemplateVariables: () => ({ data: [], isLoading: false }),
}))

vi.mock('../../../api/client', () => ({
  apiAdmin: {
    getFormAudit: vi.fn(async () => []),
    getFormTemplateAsset: vi.fn(async () => null),
    getFormTriggers: vi.fn(async () => []),
    getFormAttachmentFields: vi.fn(async () => ({ fields: [], contextRoots: [] })),
  },
}))

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

afterEach(() => useAuthStore.setState({ token: null, user: null }))

describe('forms lifecycle actions', () => {
  it('lets a compliance admin activate an approved, edit-locked edition', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: false, editLock: true }, ['compliance_admin'])
    expect(screen.getByRole('button', { name: 'Activate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })

  it('lets a compliance admin deactivate an active, edit-locked edition', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: true, editLock: true }, ['compliance_admin'])
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled()
  })

  it('enables approval only for a reviewed edition', async () => {
    await openLifecycle({ workflowStatus: 'Reviewed', active: false, editLock: false }, ['compliance_admin'])
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Activate' })).toBeDisabled()
  })

  it('keeps lifecycle actions disabled for a forms editor without compliance authority', async () => {
    await openLifecycle({ workflowStatus: 'Approved', active: false, editLock: true }, ['forms_admin'])
    for (const name of ['Approve', 'Activate', 'Deactivate', 'Delete']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
  })
})
