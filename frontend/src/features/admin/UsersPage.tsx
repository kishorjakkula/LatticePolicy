import { FormEvent, useMemo, useState } from 'react'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import {
  useUsers,
  useSecurityRoles,
  useCreateUserMutation,
  useUpdateUserMutation,
  useDeleteUserMutation,
} from '../../api/hooks'

type User = {
  id: string
  username: string
  tenantId: string
  roles: string[]
  disabled?: boolean
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
}
type SecurityRole = { roleCode: string; roleName: string; active: boolean }

export function UsersPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['agent'])
  const [customerRef, setCustomerRef] = useState('')

  const { data: usersData, isLoading: usersLoading, error: usersError } = useUsers()
  const { data: rolesData, isLoading: rolesLoading, error: rolesError } = useSecurityRoles()

  const users: User[] = usersData ?? []
  const availableRoles: SecurityRole[] = useMemo(() => {
    return (rolesData ?? [])
      .filter((x: SecurityRole) => x.active !== false)
      .map((x: SecurityRole) => ({ roleCode: x.roleCode, roleName: x.roleName, active: x.active }))
      .sort((a: SecurityRole, b: SecurityRole) => a.roleCode.localeCompare(b.roleCode))
  }, [rolesData])

  const pagination = useClientPagination(users, 10)

  const createMutation = useCreateUserMutation()
  const updateMutation = useUpdateUserMutation()
  const deleteMutation = useDeleteUserMutation()

  const loading = usersLoading || rolesLoading || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending
  const error = formError || (usersError ? String(usersError) : null) || (rolesError ? String(rolesError) : null)

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      const nextCustomerRef = customerRef.trim()
      await createMutation.mutateAsync({ username, password, roles: selectedRoles, ...(nextCustomerRef ? { customerRef: nextCustomerRef } : {}) })
      setUsername(''); setPassword(''); setCustomerRef(''); setSelectedRoles(availableRoles.length ? [availableRoles[0].roleCode] : ['agent'])
    } catch (e: any) { setFormError(e.message || String(e)) }
  }

  const onUpdate = async (id: string, patch: any) => {
    setFormError(null)
    try { await updateMutation.mutateAsync({ id, patch }) } catch (e: any) { setFormError(e.message || String(e)) }
  }

  const onDelete = async (id: string) => {
    if (!confirm('Delete user?')) return
    setFormError(null)
    try { await deleteMutation.mutateAsync(id) } catch (e: any) { setFormError(e.message || String(e)) }
  }

  const toggleSelectedRole = (roleCode: string) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev)
      if (next.has(roleCode)) next.delete(roleCode)
      else next.add(roleCode)
      return Array.from(next).sort((a, b) => a.localeCompare(b))
    })
  }

  const onEditRoles = async (user: User) => {
    const suggested = user.roles.join(',')
    const raw = prompt('Roles (comma):', suggested)
    if (raw == null) return
    const requested = raw.split(',').map((x) => x.trim()).filter(Boolean)
    const available = new Set(availableRoles.map((x) => x.roleCode))
    const invalid = requested.filter((x) => !available.has(x))
    if (invalid.length) {
      setFormError(`Invalid role(s): ${invalid.join(', ')}`)
      return
    }
    await onUpdate(user.id, { roles: requested })
  }

  const onEditCustomerLink = async (user: User) => {
    const suggested = user.customerKey || user.customerId || ''
    const raw = prompt('Linked customer (Customer # or customer UUID). Leave blank to clear.', suggested)
    if (raw == null) return
    const nextRef = raw.trim()
    await onUpdate(user.id, { customerRef: nextRef || null })
  }

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Users</h2></div>
      </div>
      {error && <p className="error">{error}</p>}
      <form onSubmit={onCreate} className="row" style={{ marginBottom: 12 }}>
        <div className="col"><label>Username</label><input value={username} onChange={e=>setUsername(e.target.value)} /></div>
        <div className="col"><label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} /></div>
        <div className="col">
          <label>Roles</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {availableRoles.map((role) => (
              <label key={role.roleCode} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role.roleCode)}
                  onChange={() => toggleSelectedRole(role.roleCode)}
                />
                <span>{role.roleCode}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="col">
          <label>Linked Customer # / ID (optional)</label>
          <input
            value={customerRef}
            onChange={e=>setCustomerRef(e.target.value)}
            placeholder="CUST-2026-000001 or UUID"
          />
        </div>
        <div className="col" style={{ alignSelf:'end' }}>
          <button type="submit" disabled={loading || !username || !password || selectedRoles.length === 0}>Add User</button>
        </div>
      </form>
      <div className="ps-table-card" style={{ marginTop: 16 }}>
        <table className="table">
        <thead><tr><th>Username</th><th>Roles</th><th>Linked Customer</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {users.length === 0 && <tr><td colSpan={5} className="muted">No users</td></tr>}
          {pagination.rows.map(u => (
            <tr key={u.id}>
              <td>{u.username}</td>
              <td>{u.roles.join(', ')}</td>
              <td>
                {u.customerKey || u.customerId ? (
                  <div style={{ display:'grid', gap:2 }}>
                    <span>{u.customerKey || u.customerId}</span>
                    {u.customerName && <span className="muted">{u.customerName}</span>}
                  </div>
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
              <td>{u.disabled ? 'Disabled' : 'Active'}</td>
              <td style={{ display:'flex', gap:8 }}>
                <button className="btn-secondary" onClick={()=>onEditRoles(u)}>Edit Roles</button>
                <button className="btn-secondary" onClick={()=>onEditCustomerLink(u)}>Link Customer</button>
                <button className="btn-secondary" onClick={()=>{ const pw = prompt('New password:'); if (pw) onUpdate(u.id, { password: pw }) }}>Reset Password</button>
                <button className="btn-secondary" onClick={()=>onUpdate(u.id, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>
                <button className="btn-secondary" onClick={()=>onDelete(u.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {users.length > 0 && (
        <TablePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </div>
  )
}
