import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { UsersPage } from '../UsersPage'

// WP-0004 REQ-2: user deletion, role edits, customer links and password resets
// collect input through the in-app dialogs instead of prompt()/confirm().

const updateMutate = vi.fn()
const deleteMutate = vi.fn()

vi.mock('../../../api/hooks', () => ({
  useUsers: () => ({ data: [{ id: 'u-1', username: 'jsmith', tenantId: 't', roles: ['agent'], customerKey: 'CUST-1' }], isLoading: false, error: null }),
  useSecurityRoles: () => ({ data: [{ roleCode: 'agent', roleName: 'Agent', active: true }, { roleCode: 'underwriter', roleName: 'Underwriter', active: true }], isLoading: false, error: null }),
  useCreateUserMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateUserMutation: () => ({ mutateAsync: updateMutate, isPending: false }),
  useDeleteUserMutation: () => ({ mutateAsync: deleteMutate, isPending: false }),
}))

const row = () => within(screen.getByRole('row', { name: /jsmith/ }))

beforeEach(() => {
  vi.clearAllMocks()
  updateMutate.mockResolvedValue({})
  deleteMutate.mockResolvedValue({})
})

describe('UsersPage dialogs', () => {
  it('confirms deletion in a danger dialog and cancelling deletes nothing', async () => {
    render(<UsersPage />)
    await userEvent.click(row().getByRole('button', { name: 'Delete' }))
    let dialog = screen.getByRole('dialog', { name: 'Delete user jsmith' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(deleteMutate).not.toHaveBeenCalled()

    await userEvent.click(row().getByRole('button', { name: 'Delete' }))
    dialog = screen.getByRole('dialog', { name: 'Delete user jsmith' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveClass('btn-danger')
    await userEvent.click(confirm)
    await waitFor(() => expect(deleteMutate).toHaveBeenCalledWith('u-1'))
  })

  it('edits roles from a prefilled field and still rejects unknown roles', async () => {
    render(<UsersPage />)
    await userEvent.click(row().getByRole('button', { name: 'Edit Roles' }))
    let dialog = screen.getByRole('dialog', { name: 'Edit roles for jsmith' })
    const field = within(dialog).getByLabelText('Roles (optional)')
    expect(field).toHaveValue('agent')
    await userEvent.clear(field)
    await userEvent.type(field, 'agent, superuser')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }))
    expect(await screen.findByText('Invalid role(s): superuser')).toBeInTheDocument()
    expect(updateMutate).not.toHaveBeenCalled()

    await userEvent.click(row().getByRole('button', { name: 'Edit Roles' }))
    dialog = screen.getByRole('dialog', { name: 'Edit roles for jsmith' })
    await userEvent.type(within(dialog).getByLabelText('Roles (optional)'), ',underwriter')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'u-1', patch: { roles: ['agent', 'underwriter'] } }))
  })

  it('clears the customer link when the field is left blank', async () => {
    render(<UsersPage />)
    await userEvent.click(row().getByRole('button', { name: 'Link Customer' }))
    const dialog = screen.getByRole('dialog', { name: 'Link customer to jsmith' })
    const field = within(dialog).getByLabelText('Linked customer (optional)')
    expect(field).toHaveValue('CUST-1')
    await userEvent.clear(field)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save link' }))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'u-1', patch: { customerRef: null } }))
  })

  it('requires a new password and Escape leaves the user unchanged', async () => {
    render(<UsersPage />)
    await userEvent.click(row().getByRole('button', { name: 'Reset Password' }))
    let dialog = screen.getByRole('dialog', { name: 'Reset password for jsmith' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a new password.')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(updateMutate).not.toHaveBeenCalled()

    await userEvent.click(row().getByRole('button', { name: 'Reset Password' }))
    dialog = screen.getByRole('dialog', { name: 'Reset password for jsmith' })
    await userEvent.type(within(dialog).getByLabelText('New password (required)'), 'Str0ng!Passw0rd')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: 'u-1', patch: { password: 'Str0ng!Passw0rd' } }))
  })
})
