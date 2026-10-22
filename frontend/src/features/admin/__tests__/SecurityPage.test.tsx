import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@testing-library/jest-dom'
import { SecurityPage } from '../SecurityPage'
import { useAuthStore } from '../../../store/auth.store'

const mocks = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), remove: vi.fn(), userRoles: vi.fn() }))
const permissions = [
  { permissionCode: 'uw.referrals.decide', scope: 'api', resourceKey: 'uw.referrals', actionKey: 'decide', label: 'API: Approve Referrals', description: 'Approve underwriting referrals', sortOrder: 1 },
  { permissionCode: 'admin.users.read', scope: 'api', resourceKey: 'admin.users', actionKey: 'read', label: 'Admin API: Users Read', description: 'Read user accounts', sortOrder: 2 },
]
const roles = [
  { roleCode: 'admin', roleName: 'Administrator', isSystem: true, active: true, permissionCodes: permissions.map(p => p.permissionCode) },
  { roleCode: 'custom', roleName: 'Review team', isSystem: false, active: true, permissionCodes: [] },
]
vi.mock('../../../api/hooks', () => ({
  useSecurityPermissions: () => ({ data: permissions }),
  useSecurityRoles: () => ({ data: roles }),
  useSecurityRelationships: () => ({ data: null }),
  useCreateSecurityRoleMutation: () => ({ mutateAsync: mocks.create }),
  useUpdateSecurityRoleMutation: () => ({ mutateAsync: mocks.update }),
  useDeleteSecurityRoleMutation: () => ({ mutateAsync: mocks.remove }),
  useUpdateSecurityUserRolesMutation: () => ({ mutateAsync: mocks.userRoles }),
}))
const renderPage = () => render(<QueryClientProvider client={new QueryClient()}><SecurityPage /></QueryClientProvider>)

describe('Security permission matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: { id: 'admin', username: 'admin', tenantId: 'test', roles: ['admin'] } })
  })

  it('groups human-readable permissions with named cells and locks system roles', () => {
    renderPage()
    expect(screen.getByRole('region', { name: 'Role and permission matrix' })).toBeInTheDocument()
    expect(screen.getByText('Underwriting')).toBeInTheDocument()
    expect(screen.getByText('Administration')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Administrator: Approve referrals (api)' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Administrator: Approve referrals (api)' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save Role' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete Role' })).toBeDisabled()
  })

  it('filters permissions by human label, area, or original permission code', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Search permissions'), 'uw.referrals')
    expect(screen.getByRole('checkbox', { name: 'Administrator: Approve referrals (api)' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Administrator: Users read (api)' })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search permissions'))
    await user.type(screen.getByLabelText('Search permissions'), 'nothing matches')
    expect(screen.getByText('No permissions match your search.')).toBeInTheDocument()
  })

  it('stages custom-role matrix edits until Save Role', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Review team' }))
    const cell = screen.getByRole('checkbox', { name: 'Review team: Approve referrals (api)' })
    expect(cell).toBeEnabled()
    await user.click(cell)
    expect(mocks.update).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Save Role' }))
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith({ roleCode: 'custom', payload: expect.objectContaining({ permissionCodes: ['uw.referrals.decide'] }) }))
  })

  it('keeps New Role blank instead of auto-selecting an existing role', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'New Role' }))
    expect(screen.getByLabelText('Role Code')).toHaveValue('')
    await user.type(screen.getByLabelText('Role Code'), 'triage')
    await user.type(screen.getByLabelText('Role Name'), 'Triage')
    await user.click(screen.getByRole('checkbox', { name: 'Triage: Approve referrals (api)' }))
    await user.click(screen.getByRole('button', { name: 'Save Role' }))
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ roleCode: 'triage', permissionCodes: ['uw.referrals.decide'] })))
  })

  it('keeps custom role editing unavailable to a security reader', async () => {
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', tenantId: 'test', roles: [], permissions: ['admin.security.read'] } })
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'Review team' }))
    expect(screen.getByRole('checkbox', { name: 'Review team: Approve referrals (api)' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'New Role' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Role' })).toBeDisabled()
  })
})
