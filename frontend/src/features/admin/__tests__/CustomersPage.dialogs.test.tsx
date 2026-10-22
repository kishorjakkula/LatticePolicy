import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { CustomersPage } from '../CustomersPage'

// WP-0004 REQ-2: customer approvals, deactivation, deletion and PII reveals
// collect reasons through the in-app dialogs; the API payloads are unchanged.

const api = vi.hoisted(() => {
  const fns: Record<string, any> = {}
  return new Proxy(fns, {
    get(target, key: string) {
      if (!target[key]) target[key] = vi.fn(async () => [])
      return target[key]
    },
  })
})

vi.mock('../../../api/client', () => ({ adminApi: api }))
vi.mock('../../../api/hooks', () => ({
  useCustomerSettings: () => ({ data: null }),
  useUpdateCustomerSettingsMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'admin-1', username: 'admin', tenantId: 't', roles: ['admin'] } }),
}))

const customer = { customerId: 'cid-1', customerKey: 'CUST-1', status: 'ACTIVE', entityType: 'INDIVIDUAL', identity: { person: { firstName: 'Dana', lastName: 'Lee' } } }

function renderEdit() {
  return render(
    <MemoryRouter initialEntries={['/admin/customers/edit/CUST-1']}>
      <Routes>
        <Route path="/admin/customers/*" element={<CustomersPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function openCustomer() {
  renderEdit()
  await waitFor(() => expect(api.getCustomer).toHaveBeenCalledWith('CUST-1'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled())
}

beforeEach(() => {
  for (const key of Object.keys(api)) (api as any)[key].mockReset?.()
  ;(api as any).getCustomer.mockImplementation(async () => customer)
  ;(api as any).deactivateCustomer.mockImplementation(async () => ({ customer: { ...customer, status: 'INACTIVE' } }))
  ;(api as any).deleteCustomer.mockImplementation(async () => ({}))
  ;(api as any).reactivateCustomer.mockImplementation(async () => ({}))
})

describe('CustomersPage dialogs', () => {
  it('deactivation asks for a required reason, then the effective date, and sends both', async () => {
    await openCustomer()
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    let dialog = screen.getByRole('dialog', { name: 'Deactivate customer CUST-1' })
    const reason = within(dialog).getByLabelText('Reason (required)')
    expect(reason).toHaveValue('CUSTOMER_REQUEST')
    await userEvent.clear(reason)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a reason.')
    await userEvent.type(reason, 'Moved out of state')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }))

    dialog = await screen.findByRole('dialog', { name: 'Deactivate customer CUST-1' })
    const date = within(dialog).getByLabelText('Effective date (optional)')
    await userEvent.clear(date)
    await userEvent.type(date, '2026-11-01')
    const confirm = within(dialog).getByRole('button', { name: 'Deactivate' })
    expect(confirm).toHaveClass('btn-danger')
    await userEvent.click(confirm)

    await waitFor(() => expect(api.deactivateCustomer).toHaveBeenCalledWith('cid-1', { reason: 'Moved out of state', effectiveDate: '2026-11-01' }))
  })

  it('cancelling the effective date step does not deactivate', async () => {
    await openCustomer()
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue' }))
    await screen.findByLabelText('Effective date (optional)')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.deactivateCustomer).not.toHaveBeenCalled()
  })

  it('reactivation falls back to the REOPEN code when the reason is cleared', async () => {
    await openCustomer()
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }))
    const dialog = screen.getByRole('dialog', { name: 'Reactivate customer CUST-1' })
    await userEvent.clear(within(dialog).getByLabelText('Reason (optional)'))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }))
    await waitFor(() => expect(api.reactivateCustomer).toHaveBeenCalledWith('cid-1', { reason: 'REOPEN' }))
  })

  it('deletes only after the danger confirmation', async () => {
    await openCustomer()
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' })
    await userEvent.click(deleteButtons[deleteButtons.length - 1])
    let dialog = screen.getByRole('dialog', { name: 'Delete customer CUST-1' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(api.deleteCustomer).not.toHaveBeenCalled()

    await userEvent.click(deleteButtons[deleteButtons.length - 1])
    dialog = screen.getByRole('dialog', { name: 'Delete customer CUST-1' })
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveClass('btn-danger')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteCustomer).toHaveBeenCalledWith('cid-1', { reason: 'DELETE' }))
  })
})
