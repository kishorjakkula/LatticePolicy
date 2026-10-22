import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import './admin-nav.css'

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

type AdminMenuItem = { path: string; label: string; permission: string }
type AdminMenuGroup = { id: string; label: string; items: AdminMenuItem[] }

// Grouped administration menu (WP-0004 REQ-5). Each item keeps the menu
// permission it had before grouping; the routes in App.tsx and the API still
// enforce access.
export const ADMIN_MENU_GROUPS: AdminMenuGroup[] = [
  {
    id: 'products',
    label: 'Products & rules',
    items: [
      { path: '/admin/forms', label: 'Forms', permission: 'menu.admin.forms.view' },
      { path: '/admin/validation-rules', label: 'Validation Rules', permission: 'menu.admin.validation_rules.view' },
      { path: '/admin/underwriting-rules', label: 'Underwriting Rules', permission: 'admin.underwriting_rules.read' },
      { path: '/admin/underwriting-authority', label: 'Underwriting Authority', permission: 'uw.authority.read' },
      { path: '/admin/compliance', label: 'Compliance', permission: 'menu.admin.compliance.view' },
    ],
  },
  {
    id: 'partners',
    label: 'Partners',
    items: [
      { path: '/admin/uw-company', label: 'Underwriting Companies', permission: 'menu.admin.uw_company.view' },
      { path: '/admin/onboarding', label: 'Agency Onboarding', permission: 'menu.admin.onboarding.view' },
      { path: '/admin/customers', label: 'Customers', permission: 'menu.admin.customers.view' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { path: '/admin/jobs', label: 'Jobs', permission: 'menu.admin.jobs.view' },
      { path: '/admin/import', label: 'Data Import', permission: 'menu.admin.import.view' },
      { path: '/admin/dashboard', label: 'Operations Dashboard', permission: 'menu.admin.dashboard.view' },
      { path: '/admin/bordereaux', label: 'Bordereaux', permission: 'menu.admin.bordereaux.view' },
      { path: '/admin/reinsurance', label: 'Reinsurance', permission: 'menu.admin.reinsurance.view' },
      { path: '/admin/exposure', label: 'Exposure', permission: 'menu.admin.exposure.view' },
    ],
  },
  {
    id: 'platform',
    label: 'Platform',
    items: [
      { path: '/admin/users', label: 'Users', permission: 'menu.admin.users.view' },
      { path: '/admin/security', label: 'Security', permission: 'menu.admin.security.view' },
      { path: '/admin/tenant', label: 'Tenant', permission: 'menu.admin.tenant.view' },
      { path: '/admin/notification-templates', label: 'Notifications', permission: 'menu.admin.notifications.view' },
      { path: '/admin/llm-releases', label: 'LLM Releases', permission: 'menu.admin.llm.view' },
      { path: '/admin/ai-audit', label: 'AI Audit', permission: 'menu.admin.ai_audit.view' },
    ],
  },
]

export function AdminShell() {
  const { user } = useAuth()
  const groups = ADMIN_MENU_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => hasPermission(user, item.permission)) }))
    .filter((group) => group.items.length > 0)
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
        <nav id="admin-sidebar-nav" className="ps-admin-nav" aria-label="Administration" hidden={collapsed}>
          <NavLink to="/admin" end className={adminMenuClass}>Overview</NavLink>
          {groups.map((group) => (
            <div key={group.id} className="ps-admin-nav-group">
              <h2 id={`admin-nav-${group.id}`} className="ps-admin-nav-group-title">{group.label}</h2>
              <ul className="ps-admin-nav-list" aria-labelledby={`admin-nav-${group.id}`}>
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink to={item.path} className={adminMenuClass}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <section className="admin-content">
        <Outlet />
      </section>
    </div>
  )
}
