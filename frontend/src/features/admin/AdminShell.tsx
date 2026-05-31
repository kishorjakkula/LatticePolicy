import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'

function adminMenuClass({ isActive }: { isActive: boolean }) {
  return `ps-admin-nav-link${isActive ? ' ps-admin-nav-link--active' : ''}`
}

export function AdminShell() {
  const { user } = useAuth()
  return (
    <div className="admin-layout">
      <aside className="ps-admin-sidebar">
        <div className="ps-admin-sidebar-title">Administration</div>
        <nav className="ps-admin-nav">
          {hasPermission(user, 'menu.admin.forms.view') && (
            <NavLink to="/admin/forms" className={adminMenuClass}>Forms</NavLink>
          )}
          {hasPermission(user, 'menu.admin.uw_company.view') && (
            <NavLink to="/admin/uw-company" className={adminMenuClass}>UW Company</NavLink>
          )}
          {hasPermission(user, 'menu.admin.users.view') && (
            <NavLink to="/admin/users" className={adminMenuClass}>Users</NavLink>
          )}
          {hasPermission(user, 'menu.admin.tenant.view') && (
            <NavLink to="/admin/tenant" className={adminMenuClass}>Tenant</NavLink>
          )}
          {hasPermission(user, 'menu.admin.security.view') && (
            <NavLink to="/admin/security" className={adminMenuClass}>Security</NavLink>
          )}
          {hasPermission(user, 'menu.admin.customers.view') && (
            <NavLink to="/admin/customers" className={adminMenuClass}>Customers</NavLink>
          )}
          {hasPermission(user, 'menu.admin.onboarding.view') && (
            <NavLink to="/admin/onboarding" className={adminMenuClass}>Agency Onboarding</NavLink>
          )}
        </nav>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  )
}
