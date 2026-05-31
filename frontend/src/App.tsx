import { lazy, Suspense, useEffect } from 'react'
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom'
import { LoginPage } from './features/auth/LoginPage'
import { Spinner } from './components/Spinner'
import { useAuth } from './auth/AuthContext'
import { useTenantPreferences } from './api/hooks'
import { applyTenantDatePreferences, resetTenantDatePreferences } from './shared/dateDisplay'
import { hasPermission } from './auth/permissions'
import { config } from './config'
import { getInitials } from './utils/initials'
import { useGlobalSearch } from './hooks/useGlobalSearch'
import { useMobileNav } from './hooks/useMobileNav'
import { useMobileTableLabels } from './hooks/useMobileTableLabels'
import { RequireAuth, RequireAdmin, RequirePermission, AdminIndexRedirect, HomeRedirect } from './components/RouteGuards'
import latticePolicyLogo from './assets/lattice-policy-logo.svg'

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage').then(m => ({ default: m.DashboardPage })))
const PolicyViewPage = lazy(() => import('./features/policies/PolicyViewPage').then(m => ({ default: m.PolicyViewPage })))
const InsuredsPage = lazy(() => import('./features/insureds/InsuredsPage'))
const SearchPage = lazy(() => import('./features/search/SearchPage').then(m => ({ default: m.SearchPage })))
const QuoteWizard = lazy(() => import('./features/wizard/QuoteWizard').then(m => ({ default: m.QuoteWizard })))
const WizardWireframesPage = lazy(() => import('./features/wizard/WizardWireframesPage'))
const HeaderWireframesPage = lazy(() => import('./features/layout/HeaderWireframesPage'))
const UsersPage = lazy(() => import('./features/admin/UsersPage').then(m => ({ default: m.UsersPage })))
const TenantPage = lazy(() => import('./features/admin/TenantPage').then(m => ({ default: m.TenantPage })))
const UwQueue = lazy(() => import('./features/uw/UwQueue').then(m => ({ default: m.UwQueue })))
const RatingWorkbenchPage = lazy(() => import('./features/rating/RatingWorkbenchPage').then(m => ({ default: m.RatingWorkbenchPage })))
const AdministrationPage = lazy(() => import('./features/admin/AdministrationPage').then(m => ({ default: m.AdministrationPage })))
const AdminShell = lazy(() => import('./features/admin/AdminShell').then(m => ({ default: m.AdminShell })))
const FormsManagementPage = lazy(() => import('./features/admin/FormsManagementPage').then(m => ({ default: m.FormsManagementPage })))
const SecurityPage = lazy(() => import('./features/admin/SecurityPage').then(m => ({ default: m.SecurityPage })))
const CustomersPage = lazy(() => import('./features/admin/CustomersPage').then(m => ({ default: m.CustomersPage })))
const CustomerViewPage = lazy(() => import('./features/customers/CustomerViewPage').then(m => ({ default: m.CustomerViewPage })))
const AgencyOnboardingPage = lazy(() => import('./features/admin/AgencyOnboardingPage').then(m => ({ default: m.AgencyOnboardingPage })))
const CustomerPortalPage = lazy(() => import('./features/customerPortal/CustomerPortalPage').then(m => ({ default: m.CustomerPortalPage })))

export default function App() {
  const { token, user, logout } = useAuth()
  const location = useLocation()
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)
  const isLoginRoute = location.pathname === '/login'
  const isAdminUser = Array.isArray(user?.roles) && user.roles.includes('admin')
  const canUseGlobalSearch = hasPermission(user, 'page.search.view')
  const canSearchCustomers = hasPermission(user, 'admin.customers.read')
  const apiDocsUrl = `${config.apiBaseUrl || ''}/api-docs${token ? `?token=${encodeURIComponent(token)}` : ''}`

  const { mobileNavOpen, setMobileNavOpen } = useMobileNav()
  const {
    globalSearchQuery, setGlobalSearchQuery,
    setGlobalFocused,
    cancelPendingGlobalAutoSearch,
    onGlobalSearchSubmit
  } = useGlobalSearch({ token, isLoginRoute, canUseGlobalSearch, canSearchCustomers })

  useMobileTableLabels(token, location.pathname)

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: '📊', permission: 'menu.search.view' },
    { path: '/search', label: 'Search', icon: '🔍', permission: 'menu.search.view' },
    { path: '/rating', label: 'Rating', icon: '⚙️', permission: 'menu.rating.view' },
    { path: '/portal', label: 'Portal', icon: '🌐', permission: 'menu.portal.view' },
    { path: '/admin', label: 'Administration', icon: '🛠️', permission: 'menu.admin.view' }
  ].filter((item) => hasPermission(user, item.permission))

  const { data: tenantPrefs } = useTenantPreferences(!!token)
  useEffect(() => {
    if (!token) {
      resetTenantDatePreferences()
      return
    }
    if (tenantPrefs) {
      applyTenantDatePreferences(tenantPrefs)
    }
  }, [token, tenantPrefs])

  const routeContent = (
    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}><Spinner /></div>}>
      <Routes>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/dashboard" element={<RequireAuth><RequirePermission permission="page.search.view"><DashboardPage /></RequirePermission></RequireAuth>} />
            <Route path="/rating" element={<RequireAuth><RequirePermission permission="page.rating.view"><RatingWorkbenchPage /></RequirePermission></RequireAuth>} />
            <Route path="/portal" element={<RequireAuth><RequirePermission permission="page.portal.view"><CustomerPortalPage /></RequirePermission></RequireAuth>} />
            <Route path="/search" element={<RequireAuth><RequirePermission permission="page.search.view"><SearchPage /></RequirePermission></RequireAuth>} />
            <Route path="/wizard" element={<RequireAuth><RequirePermission permission="page.wizard.view"><QuoteWizard /></RequirePermission></RequireAuth>} />
            <Route path="/wizard-wireframes" element={<RequireAuth><RequirePermission permission="page.wizard.view"><WizardWireframesPage /></RequirePermission></RequireAuth>} />
            <Route path="/header-wireframes" element={<RequireAuth><HeaderWireframesPage /></RequireAuth>} />
            <Route path="/insureds" element={<RequireAuth><InsuredsPage /></RequireAuth>} />
            <Route path="/policies/:id" element={<RequireAuth><RequirePermission permission="page.policy.view"><PolicyViewPage /></RequirePermission></RequireAuth>} />
            <Route path="/customers/:id" element={<RequireAuth><RequirePermission permission="admin.customers.read"><CustomerViewPage /></RequirePermission></RequireAuth>} />
            <Route path="/uw/queue" element={<RequireAuth><RequirePermission permission="page.uw_queue.view"><UwQueue /></RequirePermission></RequireAuth>} />
            <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminShell /></RequireAdmin></RequireAuth>}>
              <Route index element={<AdminIndexRedirect />} />
              <Route path="forms" element={<RequirePermission permission="page.admin.forms.view"><FormsManagementPage /></RequirePermission>} />
              <Route path="uw-company" element={<RequirePermission permission="page.admin.uw_company.view"><AdministrationPage /></RequirePermission>} />
              <Route path="users" element={<RequirePermission permission="page.admin.users.view"><UsersPage /></RequirePermission>} />
              <Route path="tenant" element={<RequirePermission permission="page.admin.tenant.view"><TenantPage /></RequirePermission>} />
              <Route path="security" element={<RequirePermission permission="page.admin.security.view"><SecurityPage /></RequirePermission>} />
              <Route path="customers/*" element={<RequirePermission permission="page.admin.customers.view"><CustomersPage /></RequirePermission>} />
              <Route path="onboarding/*" element={<RequirePermission permission="page.admin.onboarding.view"><AgencyOnboardingPage /></RequirePermission>} />
            </Route>
            <Route path="/admin/underwriting-companies" element={<Navigate to="/admin/uw-company" replace />} />
      </Routes>
    </Suspense>
  )

  if (isLoginRoute) {
    return (
      <div className="app-shell app-shell-login">
        <main className="main-login">
          <div className="container">
            {routeContent}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell app-shell-topnav">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="topbar-brand">
            <img src={latticePolicyLogo} alt="LatticePolicy" className="topbar-logo" />
          </div>

          {/* Mobile hamburger toggle */}
          <button
            type="button"
            className="topnav-toggle"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileNavOpen}
            aria-controls="topnav-main"
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M4 4l10 10M14 4L4 14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M3 5h12M3 9h12M3 13h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
          </button>

          {/* Primary nav links */}
          <nav id="topnav-main" className={`topnav ${mobileNavOpen ? 'is-open' : ''}`}>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  navClass({ isActive: isActive || (item.path === '/admin' && location.pathname.startsWith('/admin')) })
                }
              >
                <span className="topnav-icon" aria-hidden="true">{item.icon}</span>
                <span className="topnav-label">{item.label}</span>
              </NavLink>
            ))}
            {!config.useMock && isAdminUser && (
              <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer">
                <span className="topnav-icon" aria-hidden="true">📖</span>
                <span className="topnav-label">API Docs</span>
              </a>
            )}
          </nav>

          {/* Quick lookup */}
          {canUseGlobalSearch && (
            <form className="topbar-search-wrap" onSubmit={onGlobalSearchSubmit} role="search" aria-label="Quick lookup">
              <svg className="topbar-search-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                className="topbar-search-input"
                aria-label="Quick lookup: policy, quote, or customer"
                placeholder="Quick lookup…"
                value={globalSearchQuery}
                onChange={(e) => setGlobalSearchQuery(e.target.value)}
                onFocus={() => setGlobalFocused(true)}
                onBlur={() => {
                  setGlobalFocused(false)
                  cancelPendingGlobalAutoSearch()
                }}
              />
            </form>
          )}

          {/* User profile pill */}
          <div className="topbar-user-pill">
            <span className="topbar-avatar" aria-hidden="true">
              {getInitials(user?.username || 'U')}
            </span>
            <div className="topbar-user-info">
              <span className="topbar-user-name">{user?.username || 'User'}</span>
              {Array.isArray(user?.roles) && user.roles[0] && (
                <span className="topbar-user-role">{user.roles[0]}</span>
              )}
            </div>
            <button type="button" className="topbar-signout" onClick={() => logout()} aria-label="Sign out" title="Sign out">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M6 14H3a1 1 0 01-1-1V3a1 1 0 011-1h3M10 11l3-3-3-3M13 8H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <main className="app-main">
          {routeContent}
        </main>
      </div>
    </div>
  )
}
