import type { ReactElement } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { hasPermission } from '../auth/permissions'

export function resolveHomePath(user: any): string {
  if (hasPermission(user, 'page.search.view')) return '/search'
  if (hasPermission(user, 'page.rating.view')) return '/rating'
  if (hasPermission(user, 'page.portal.view')) return '/portal'
  if (hasPermission(user, 'page.wizard.view')) return '/wizard'
  if (hasPermission(user, 'page.policy.view')) return '/search'
  if (hasPermission(user, 'page.uw_queue.view')) return '/uw/queue'
  if (hasPermission(user, 'page.admin.forms.view')) return '/admin/forms'
  if (hasPermission(user, 'page.admin.uw_company.view')) return '/admin/uw-company'
  if (hasPermission(user, 'page.admin.users.view')) return '/admin/users'
  if (hasPermission(user, 'page.admin.tenant.view')) return '/admin/tenant'
  if (hasPermission(user, 'page.admin.security.view')) return '/admin/security'
  if (hasPermission(user, 'page.admin.customers.view')) return '/admin/customers'
  if (hasPermission(user, 'page.admin.onboarding.view')) return '/admin/onboarding'
  return '/login'
}

export function RequireAuth({ children }: { children: ReactElement }) {
  const { token } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return children
}

export function RequireAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth()
  if (!hasPermission(user, 'menu.admin.view')) return <Navigate to="/search" replace />
  return children
}

export function RequirePermission({ children, permission }: { children: ReactElement; permission: string }) {
  const { user } = useAuth()
  const ok = hasPermission(user, permission)
  if (!ok) return <Navigate to={resolveHomePath(user)} replace />
  return children
}

export function AdminIndexRedirect() {
  const { user } = useAuth()
  if (hasPermission(user, 'page.admin.forms.view')) return <Navigate to="/admin/forms" replace />
  if (hasPermission(user, 'page.admin.uw_company.view')) return <Navigate to="/admin/uw-company" replace />
  if (hasPermission(user, 'page.admin.users.view')) return <Navigate to="/admin/users" replace />
  if (hasPermission(user, 'page.admin.tenant.view')) return <Navigate to="/admin/tenant" replace />
  if (hasPermission(user, 'page.admin.security.view')) return <Navigate to="/admin/security" replace />
  if (hasPermission(user, 'page.admin.customers.view')) return <Navigate to="/admin/customers" replace />
  if (hasPermission(user, 'page.admin.onboarding.view')) return <Navigate to="/admin/onboarding" replace />
  return <Navigate to={resolveHomePath(user)} replace />
}

export function HomeRedirect() {
  const { token, user } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  return <Navigate to={resolveHomePath(user)} replace />
}
