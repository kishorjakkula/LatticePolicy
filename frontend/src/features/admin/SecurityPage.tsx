import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  useSecurityPermissions,
  useSecurityRoles,
  useSecurityRelationships,
  useCreateSecurityRoleMutation,
  useUpdateSecurityRoleMutation,
  useDeleteSecurityRoleMutation,
  useUpdateSecurityUserRolesMutation,
} from '../../api/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { useConfirmDialog } from '../../components/Dialog'
import { hasPermission } from '../../auth/permissions'
import { useAuthStore } from '../../store/auth.store'
import './compliance-security.css'

type PermissionDef = {
  permissionCode: string
  scope: 'menu' | 'page' | 'api'
  resourceKey: string
  actionKey: string
  label: string
  description: string
  sortOrder: number
}

type RoleRow = {
  roleCode: string
  roleName: string
  description?: string
  isSystem: boolean
  active: boolean
  permissionCodes: string[]
  userCount?: number
}

type RoleDraft = {
  roleCode: string
  roleName: string
  description: string
  active: boolean
  permissionCodes: string[]
}

type RelationshipRoleRow = {
  roleCode: string
  roleName: string
  active: boolean
  isSystem: boolean
  userCount: number
  permissionCount: number
  menuPermissionCount: number
  pagePermissionCount: number
  apiPermissionCount: number
}

type RelationshipUserRow = {
  userId: string
  username: string
  disabled: boolean
  roleCodes: string[]
  permissionCount: number
  menuPermissionCount: number
  pagePermissionCount: number
  apiPermissionCount: number
}

type RelationshipPayload = {
  generatedAt: string
  roleMappings: RelationshipRoleRow[]
  userMappings: RelationshipUserRow[]
}

const emptyDraft: RoleDraft = {
  roleCode: '',
  roleName: '',
  description: '',
  active: true,
  permissionCodes: []
}

function sortCodes(values: string[]): string[] {
  return Array.from(new Set((values || []).filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

function sameCodes(a: string[], b: string[]): boolean {
  const left = sortCodes(a)
  const right = sortCodes(b)
  if (left.length !== right.length) return false
  return left.every((code, index) => code === right[index])
}

function permissionName(permission: PermissionDef): string {
  const label = permission.label.replace(/^(Admin API|API|Admin Menu|Menu|Page):\s*/i, '')
    .replace(/\bUW\b/g, 'Underwriting').replace(/[_-]/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase()
}

function permissionArea(permission: PermissionDef): string {
  const resource = permission.resourceKey.toLowerCase().replace(/_/g, '.')
  if (/portal/.test(resource)) return 'Portal'
  if (/\bai\b|llm|submission/.test(resource)) return 'AI'
  if (/\buw\b|underwrit/.test(resource)) return 'Underwriting'
  if (/rating/.test(resource)) return 'Rating'
  if (/admin|security|config/.test(resource)) return 'Administration'
  return 'Policies'
}

export function SecurityPage() {
  const user = useAuthStore(state => state.user)
  const canManage = hasPermission(user, 'admin.security.manage')
  const [permissionSearch, setPermissionSearch] = useState('')
  const [userRoleDrafts, setUserRoleDrafts] = useState<Record<string, string[]>>({})
  const [selectedRoleCode, setSelectedRoleCode] = useState<string>('')
  const [draft, setDraft] = useState<RoleDraft>(emptyDraft)
  const [isNewRole, setIsNewRole] = useState(false)
  const [saving, setSaving] = useState(false)
  const { dialog: confirmDialog, askConfirm } = useConfirmDialog()
  const [savingUserId, setSavingUserId] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const qc = useQueryClient()

  const { data: permissionsData, isLoading: permissionsLoading } = useSecurityPermissions()
  const { data: rolesData, isLoading: rolesLoading } = useSecurityRoles()
  const { data: relationshipsData, isLoading: relLoading } = useSecurityRelationships()

  const permissions: PermissionDef[] = permissionsData ?? []
  const roles: RoleRow[] = useMemo(
    () => [...(rolesData ?? [])].sort((a, b) => a.roleCode.localeCompare(b.roleCode)),
    [rolesData]
  )
  const relationships: RelationshipPayload | null = relationshipsData ?? null
  const loading = permissionsLoading || rolesLoading || relLoading
  const systemRole = !isNewRole && roles.some(role => role.roleCode === draft.roleCode && role.isSystem)
  const readOnly = !canManage || systemRole || saving

  // Initialize user role drafts when relationships load
  useEffect(() => {
    const initialDrafts: Record<string, string[]> = {}
    for (const user of (relationships?.userMappings || [])) {
      initialDrafts[user.userId] = sortCodes(user.roleCodes || [])
    }
    setUserRoleDrafts(initialDrafts)
  }, [relationships])

  const createRoleMutation = useCreateSecurityRoleMutation()
  const updateRoleMutation = useUpdateSecurityRoleMutation()
  const deleteRoleMutation = useDeleteSecurityRoleMutation()
  const updateUserRolesMutation = useUpdateSecurityUserRolesMutation()

  const groupedPermissions = useMemo(() => {
    const buckets: Record<string, PermissionDef[]> = {}
    for (const item of permissions) {
      if (permissionSearch && !`${permissionName(item)} ${item.description} ${item.permissionCode} ${permissionArea(item)}`.toLowerCase().includes(permissionSearch.toLowerCase())) continue
      const key = permissionArea(item)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(item)
    }
    Object.values(buckets).forEach((arr) => arr.sort((a, b) => (a.sortOrder - b.sortOrder) || a.label.localeCompare(b.label)))
    return buckets
  }, [permissions, permissionSearch])

  const assignableRoles = useMemo(
    () => roles.filter((role) => role.active !== false).sort((a, b) => a.roleCode.localeCompare(b.roleCode)),
    [roles]
  )

  const relationshipUsers = useMemo(
    () => (relationships?.userMappings || []).slice().sort((a, b) => a.username.localeCompare(b.username)),
    [relationships]
  )

  const relationshipRoles = useMemo(
    () => (relationships?.roleMappings || []).slice().sort((a, b) => a.roleCode.localeCompare(b.roleCode)),
    [relationships]
  )

  function applyRole(role: RoleRow, asNew: boolean) {
    setSelectedRoleCode(role.roleCode)
    setIsNewRole(asNew)
    setDraft({
      roleCode: role.roleCode,
      roleName: role.roleName,
      description: role.description || '',
      active: role.active !== false,
      permissionCodes: sortCodes(role.permissionCodes || [])
    })
  }

  // Auto-select first role when roles load and keep selected role synced with refreshed data
  useEffect(() => {
    if (isNewRole) return
    if (!selectedRoleCode && roles.length) {
      applyRole(roles[0], false)
      return
    }
    if (selectedRoleCode) {
      const existing = roles.find((x) => x.roleCode === selectedRoleCode)
      if (existing) applyRole(existing, false)
    }
  }, [roles, selectedRoleCode, isNewRole])

  const beginNewRole = () => {
    setIsNewRole(true)
    setSelectedRoleCode('')
    setDraft({ ...emptyDraft })
  }

  const togglePermission = (permissionCode: string) => {
    setDraft((prev) => {
      const current = new Set(prev.permissionCodes || [])
      if (current.has(permissionCode)) current.delete(permissionCode)
      else current.add(permissionCode)
      return { ...prev, permissionCodes: sortCodes(Array.from(current)) }
    })
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault()
    if (readOnly) return
    setSaving(true)
    setError(null)
    try {
      if (isNewRole) {
        await createRoleMutation.mutateAsync({
          roleCode: draft.roleCode,
          roleName: draft.roleName,
          description: draft.description,
          active: draft.active,
          permissionCodes: draft.permissionCodes
        })
      } else {
        await updateRoleMutation.mutateAsync({
          roleCode: draft.roleCode,
          payload: {
            roleName: draft.roleName,
            description: draft.description,
            active: draft.active,
            permissionCodes: draft.permissionCodes
          }
        })
      }
      await qc.invalidateQueries({ queryKey: queryKeys.security.roles() })
      const latestRoles = (qc.getQueryData<RoleRow[]>(queryKeys.security.roles()) ?? [])
      const latest = latestRoles.find((x: RoleRow) => x.roleCode === draft.roleCode)
      if (latest) applyRole(latest, false)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async () => {
    if (!draft.roleCode || readOnly) return
    if (!(await askConfirm({ title: `Delete role ${draft.roleCode}`, confirmLabel: 'Delete', danger: true }))) return
    setSaving(true)
    setError(null)
    try {
      await deleteRoleMutation.mutateAsync(draft.roleCode)
      setDraft({ ...emptyDraft })
      setSelectedRoleCode('')
      setIsNewRole(false)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleUserRole = (userId: string, roleCode: string) => {
    setUserRoleDrafts((prev) => {
      const current = new Set(prev[userId] || [])
      if (current.has(roleCode)) current.delete(roleCode)
      else current.add(roleCode)
      return {
        ...prev,
        [userId]: sortCodes(Array.from(current))
      }
    })
  }

  const saveUserRoleMapping = async (userId: string) => {
    if (!canManage) return
    setSavingUserId(userId)
    setError(null)
    try {
      await updateUserRolesMutation.mutateAsync({ userId, roleCodes: sortCodes(userRoleDrafts[userId] || []) })
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setSavingUserId('')
    }
  }

  return (
    <div className="ps-admin-page">
      {confirmDialog}
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Security</h2>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="security-layout">
        <CollapsibleSection className="security-roles card">
          <div className="panel-header">
            <h3>Roles</h3>
            {canManage && <button type="button" onClick={beginNewRole}>New Role</button>}
          </div>
          <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
          <table className="table table-sticky-header">
            <thead>
              <tr>
                <th>Role Code</th>
                <th>Name</th>
                <th>Users</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!roles.length && (
                <tr>
                  <td colSpan={4} className="muted">{loading ? 'Loading...' : 'No roles configured.'}</td>
                </tr>
              )}
              {roles.map((role) => (
                <tr key={role.roleCode} className={selectedRoleCode === role.roleCode ? 'security-selected-row' : ''}>
                  <td>
                    <button type="button" className="table-link-button" onClick={() => applyRole(role, false)}>
                      {role.roleCode}
                    </button>
                  </td>
                  <td>{role.roleName}</td>
                  <td>{Number(role.userCount || 0)}</td>
                  <td>{role.active ? 'Active' : 'Inactive'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </CollapsibleSection>

        <CollapsibleSection className="security-editor card">
          <h3>{isNewRole ? 'New Role' : `Role: ${draft.roleCode || '-'}`}</h3>
          {systemRole && <p className="muted">System role (read-only)</p>}
          <form onSubmit={onSave}>
            <fieldset disabled={readOnly} className="cs-role-fields">
            <div className="row">
              <div className="col" style={{ maxWidth: 240 }}>
                <label htmlFor="security-role-code">Role Code</label>
                <input
                  id="security-role-code"
                  value={draft.roleCode}
                  onChange={(e) => setDraft((prev) => ({ ...prev, roleCode: e.target.value }))}
                  disabled={!isNewRole}
                  placeholder="e.g. policy_service"
                />
              </div>
              <div className="col">
                <label htmlFor="security-role-name">Role Name</label>
                <input
                  id="security-role-name"
                  value={draft.roleName}
                  onChange={(e) => setDraft((prev) => ({ ...prev, roleName: e.target.value }))}
                  placeholder="Display name"
                />
              </div>
              <div className="col" style={{ maxWidth: 180 }}>
                <label htmlFor="security-role-status">Status</label>
                <select
                  id="security-role-status"
                  value={draft.active ? 'active' : 'inactive'}
                  onChange={(e) => setDraft((prev) => ({ ...prev, active: e.target.value === 'active' }))}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <label htmlFor="security-role-description">Description</label>
            <input
              id="security-role-description"
              value={draft.description}
              onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Purpose of this role"
            />

            <div className="security-actions">
              <button type="submit" disabled={saving || !draft.roleCode || !draft.roleName}>
                {saving ? 'Saving...' : 'Save Role'}
              </button>
              {!isNewRole && (
                <button
                  type="button"
                  className="btn-danger"
                  onClick={onDelete}
                  disabled={saving || roles.find((x) => x.roleCode === draft.roleCode)?.isSystem}
                >
                  Delete Role
                </button>
              )}
            </div>
            </fieldset>
          </form>
        </CollapsibleSection>
      </div>

      <CollapsibleSection title="Role permissions" className="stack-card">
        <label>Search permissions<input type="search" value={permissionSearch} onChange={event => setPermissionSearch(event.target.value)} /></label>
        <div className="cs-matrix-scroll" tabIndex={0} role="region" aria-label="Role and permission matrix">
          <table className="table cs-matrix">
            <thead><tr><th scope="col">Permission</th>{roles.map(role => <th scope="col" key={role.roleCode}>
              <button type="button" className="table-link-button" onClick={() => applyRole(role, false)}>{role.roleName}</button>
            </th>)}{isNewRole && <th scope="col">{draft.roleName || 'New role'}</th>}</tr></thead>
            {Object.entries(groupedPermissions).sort(([a], [b]) => a.localeCompare(b)).map(([area, items]) => <tbody key={area}>
              <tr><th scope="rowgroup" colSpan={roles.length + 1 + Number(isNewRole)}>{area}</th></tr>
              {items.map(permission => <tr key={permission.permissionCode}>
                <th scope="row" title={permission.description}>{permissionName(permission)} <small className="muted">({permission.scope === 'api' ? 'API' : permission.scope})</small></th>
                {roles.map(role => {
                  const editing = !isNewRole && selectedRoleCode === role.roleCode
                  return <td key={role.roleCode}><input type="checkbox" aria-label={`${role.roleName}: ${permissionName(permission)} (${permission.scope})`}
                    checked={(editing ? draft.permissionCodes : role.permissionCodes).includes(permission.permissionCode)}
                    disabled={!editing || readOnly} onChange={() => togglePermission(permission.permissionCode)} /></td>
                })}
                {isNewRole && <td><input type="checkbox" aria-label={`${draft.roleName || 'New role'}: ${permissionName(permission)} (${permission.scope})`}
                  checked={draft.permissionCodes.includes(permission.permissionCode)} disabled={readOnly} onChange={() => togglePermission(permission.permissionCode)} /></td>}
              </tr>)}
            </tbody>)}
          </table>
          {!Object.keys(groupedPermissions).length && <p className="muted">{permissionsLoading ? 'Loading permissions...' : 'No permissions match your search.'}</p>}
        </div>
      </CollapsibleSection>

      <CollapsibleSection className="card stack-card">
        <div className="panel-header">
          <h3>Role -&gt; Permission Mapping</h3>
          <span className="muted">{relationships?.generatedAt ? `Refreshed ${new Date(relationships.generatedAt).toLocaleString()}` : ''}</span>
        </div>
        <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
        <table className="table table-sticky-header">
          <thead>
            <tr>
              <th>Role</th>
              <th>Status</th>
              <th>Users</th>
              <th>Menu</th>
              <th>Page</th>
              <th>API</th>
              <th>Total Permissions</th>
            </tr>
          </thead>
          <tbody>
            {!relationshipRoles.length && (
              <tr><td colSpan={7} className="muted">No role mappings available.</td></tr>
            )}
            {relationshipRoles.map((row) => (
              <tr key={row.roleCode}>
                <td>{row.roleCode} - {row.roleName}</td>
                <td>{row.active ? 'Active' : 'Inactive'}</td>
                <td>{row.userCount}</td>
                <td>{row.menuPermissionCount}</td>
                <td>{row.pagePermissionCount}</td>
                <td>{row.apiPermissionCount}</td>
                <td>{row.permissionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection className="card stack-card">
        <h3>User -&gt; Role Mapping</h3>
        <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
        <table className="table table-sticky-header">
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Roles</th>
              <th>Menu</th>
              <th>Page</th>
              <th>API</th>
              <th>Total Permissions</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {!relationshipUsers.length && (
              <tr><td colSpan={8} className="muted">No users available.</td></tr>
            )}
            {relationshipUsers.map((user) => {
              const draftRoles = sortCodes(userRoleDrafts[user.userId] || [])
              const dirty = !sameCodes(draftRoles, user.roleCodes || [])
              return (
                <tr key={user.userId}>
                  <td>{user.username}</td>
                  <td>{user.disabled ? 'Disabled' : 'Active'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {assignableRoles.map((role) => (
                        <label key={`${user.userId}-${role.roleCode}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            disabled={!canManage || savingUserId === user.userId}
                            checked={draftRoles.includes(role.roleCode)}
                            onChange={() => toggleUserRole(user.userId, role.roleCode)}
                          />
                          <span>{role.roleCode}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td>{user.menuPermissionCount}</td>
                  <td>{user.pagePermissionCount}</td>
                  <td>{user.apiPermissionCount}</td>
                  <td>{user.permissionCount}</td>
                  <td>
                    <button
                      className="btn-secondary"
                      type="button"
                      disabled={!canManage || !dirty || savingUserId === user.userId}
                      onClick={() => saveUserRoleMapping(user.userId)}
                    >
                      {savingUserId === user.userId ? 'Saving...' : 'Save Roles'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </CollapsibleSection>
    </div>
  )
}
