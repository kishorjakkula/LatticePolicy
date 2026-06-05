import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import {
  AdminIndexRedirect,
  HomeRedirect,
  RequireAdmin,
  RequireAuth,
  RequirePermission,
  resolveHomePath,
} from '../RouteGuards'
import { useAuthStore, type AuthUser } from '../../store/auth.store'

function setAuth(user: AuthUser | null, token = 'test-token') {
  useAuthStore.setState({ token: user ? token : null, user })
}

function renderWithRoutes(initialPath: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/search" element={<div>Search Page</div>} />
        <Route path="/rating" element={<div>Rating Page</div>} />
        <Route path="/portal" element={<div>Portal Page</div>} />
        <Route path="/admin/forms" element={<div>Forms Admin Page</div>} />
        <Route path="/admin/users" element={<div>Users Admin Page</div>} />
        <Route path={initialPath} element={element} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RouteGuards', () => {
  it('resolves the expected home path by role priority', () => {
    expect(resolveHomePath({ roles: ['agent'] })).toBe('/search')
    expect(resolveHomePath({ roles: ['actuary'] })).toBe('/rating')
    expect(resolveHomePath({ roles: ['customer'] })).toBe('/portal')
    expect(resolveHomePath({ roles: [] })).toBe('/login')
  })

  it('redirects unauthenticated users to login', () => {
    setAuth(null)
    renderWithRoutes('/private', <RequireAuth><div>Private Page</div></RequireAuth>)
    expect(screen.getByText('Login Page')).toBeInTheDocument()
  })

  it('renders authenticated content', () => {
    setAuth({ id: 'u1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'] })
    renderWithRoutes('/private', <RequireAuth><div>Private Page</div></RequireAuth>)
    expect(screen.getByText('Private Page')).toBeInTheDocument()
  })

  it('redirects non-admin users away from admin-only content', () => {
    setAuth({ id: 'u1', username: 'agent1', tenantId: 'sample-carrier', roles: ['agent'] })
    renderWithRoutes('/admin-only', <RequireAdmin><div>Admin Only</div></RequireAdmin>)
    expect(screen.getByText('Search Page')).toBeInTheDocument()
  })

  it('allows users with the required permission through', () => {
    setAuth({ id: 'u1', username: 'actuary1', tenantId: 'sample-carrier', roles: ['actuary'] })
    renderWithRoutes(
      '/rating-protected',
      <RequirePermission permission="page.rating.view"><div>Rating Protected</div></RequirePermission>,
    )
    expect(screen.getByText('Rating Protected')).toBeInTheDocument()
  })

  it('redirects users without a required permission to their home path', () => {
    setAuth({ id: 'u1', username: 'customer1', tenantId: 'sample-carrier', roles: ['customer'] })
    renderWithRoutes(
      '/admin-protected',
      <RequirePermission permission="page.admin.users.view"><div>Users Protected</div></RequirePermission>,
    )
    expect(screen.getByText('Portal Page')).toBeInTheDocument()
  })

  it('redirects admin index to the first available admin area', () => {
    setAuth({ id: 'u1', username: 'forms-admin', tenantId: 'sample-carrier', roles: ['forms_admin'] })
    renderWithRoutes('/admin', <AdminIndexRedirect />)
    expect(screen.getByText('Forms Admin Page')).toBeInTheDocument()
  })

  it('redirects home based on authenticated user role', () => {
    setAuth({ id: 'u1', username: 'customer1', tenantId: 'sample-carrier', roles: ['customer'] })
    renderWithRoutes('/', <HomeRedirect />)
    expect(screen.getByText('Portal Page')).toBeInTheDocument()
  })
})
