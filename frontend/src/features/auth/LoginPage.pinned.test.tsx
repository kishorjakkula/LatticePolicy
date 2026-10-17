import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ login: vi.fn() }) }))
vi.mock('../../config', () => ({
  config: { apiBaseUrl: 'https://api.example.com', useMock: false, showDemoCredentials: false, carrierTenantId: 'acme-mutual' }
}))

describe('LoginPage on a single-carrier stack', () => {
  beforeEach(() => {
    localStorage.clear()
    // A stale tenant from an earlier session must not override the stack's carrier.
    localStorage.setItem('tenantId', 'sample-carrier')
  })

  it('does not ask for an organization', () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>)

    expect(screen.queryByLabelText('Organization Slug')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email / Username')).toBeInTheDocument()
  })

  it('starts SSO for the configured carrier', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><LoginPage /></MemoryRouter></QueryClientProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' }))

    expect(open).toHaveBeenCalledWith(
      'https://api.example.com/auth/sso/acme-mutual/login?flow=popup',
      'lattice-sso',
      'popup,width=520,height=720',
    )
    open.mockRestore()
  })
})
