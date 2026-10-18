import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'

function adminMenuClass({ isActive }: { isActive: boolean }) {
  return `ps-admin-nav-link${isActive ? ' ps-admin-nav-link--active' : ''}`
}

const SIDEBAR_COLLAPSED_KEY = 'adminSidebarCollapsed'

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function AdminShell() {
  const { user } = useAuth()
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed)
  const toggleSidebar = () => {
    setCollapsed((value) => {
      const next = !value
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // Storage unavailable: the choice just lasts for this page visit.
      }
      return next
    })
  }
  const toggleLabel = collapsed ? 'Expand administration menu' : 'Collapse administration menu'
  return (
    <div className="admin-layout">
      <aside className={`ps-admin-sidebar${collapsed ? ' ps-admin-sidebar--collapsed' : ''}`}>
        <div className="ps-admin-sidebar-head">
          {!collapsed && <div className="ps-admin-sidebar-title">Administration</div>}
          <button
            type="button"
            className="ps-admin-sidebar-toggle"
            aria-expanded={!collapsed}
            aria-controls="admin-sidebar-nav"
            aria-label={toggleLabel}
            title={toggleLabel}
            onClick={toggleSidebar}
          >
            {collapsed ? '\u00BB' : '\u00AB'}
          </button>
        </div>
        <nav id="admin-sidebar-nav" className="ps-admin-nav" hidden={collapsed}>
          {hasPermission(user, 'menu.admin.forms.view') && (
            <NavLink to="/admin/forms" className={adminMenuClass}>Forms</NavLink>
          )}
          {hasPermission(user, 'menu.admin.uw_company.view') && (
            <NavLink to="/admin/uw-company" className={adminMenuClass}>Underwriting Companies</NavLink>
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
          {hasPermission(user, 'menu.admin.notifications.view') && (
            <NavLink to="/admin/notification-templates" className={adminMenuClass}>Notifications</NavLink>
          )}
          {hasPermission(user, 'menu.admin.llm.view') && <NavLink to="/admin/llm-releases" className={adminMenuClass}>LLM Releases</NavLink>}
          {hasPermission(user, 'menu.admin.ai_audit.view') && <NavLink to="/admin/ai-audit" className={adminMenuClass}>AI Audit</NavLink>}
          {hasPermission(user, 'menu.admin.validation_rules.view') && <NavLink to="/admin/validation-rules" className={adminMenuClass}>Validation Rules</NavLink>}
          {hasPermission(user, 'menu.admin.compliance.view') && (
            <NavLink to="/admin/compliance" className={adminMenuClass}>Compliance</NavLink>
          )}
          {hasPermission(user, 'menu.admin.import.view') && (
            <NavLink to="/admin/import" className={adminMenuClass}>Data Import</NavLink>
          )}
          {hasPermission(user, 'menu.admin.dashboard.view') && (
            <NavLink to="/admin/dashboard" className={adminMenuClass}>Operations Dashboard</NavLink>
          )}
          {hasPermission(user, 'menu.admin.exposure.view') && (
            <NavLink to="/admin/exposure" className={adminMenuClass}>Exposure</NavLink>
          )}
          {hasPermission(user, 'menu.admin.reinsurance.view') && (
            <NavLink to="/admin/reinsurance" className={adminMenuClass}>Reinsurance</NavLink>
          )}
          {hasPermission(user, 'menu.admin.bordereaux.view') && (
            <NavLink to="/admin/bordereaux" className={adminMenuClass}>Bordereaux</NavLink>
          )}
          {hasPermission(user, 'menu.admin.jobs.view') && (
            <NavLink to="/admin/jobs" className={adminMenuClass}>Jobs</NavLink>
          )}
          {hasPermission(user, 'uw.authority.read') && (
            <NavLink to="/admin/underwriting-authority" className={adminMenuClass}>Underwriting Authority</NavLink>
          )}
          {hasPermission(user, 'admin.underwriting_rules.read') && (
            <NavLink to="/admin/underwriting-rules" className={adminMenuClass}>Underwriting Rules</NavLink>
          )}
        </nav>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  )
}
