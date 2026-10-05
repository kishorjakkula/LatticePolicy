import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage'

const login = vi.fn()
const navigate = vi.fn()

vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ login }) }))
vi.mock('../../config', () => ({ config: { apiBaseUrl: 'https://api.example.com', useMock: false } }))
vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>()
  return { ...original, useNavigate: () => navigate }
})

describe('LoginPage SSO', () => {
  beforeEach(() => {
    login.mockReset()
    navigate.mockReset()
    localStorage.clear()
  })

  it('opens a tenant-scoped popup flow', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    render(<MemoryRouter><LoginPage /></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with SSO' }))

    expect(open).toHaveBeenCalledWith(
      'https://api.example.com/auth/sso/sample-carrier/login?flow=popup',
      'lattice-sso',
      'popup,width=520,height=720',
    )
    open.mockRestore()
  })

  it('accepts credentials only from the configured API origin', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://untrusted.example.com',
      data: { type: 'lattice:sso', token: 'bad', user: { tenantId: 'other' } },
    }))
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://api.example.com',
      data: { type: 'lattice:sso', token: 'good', user: { id: 'u1', tenantId: 'sample-carrier' } },
    }))

    await waitFor(() => expect(login).toHaveBeenCalledTimes(1))
    expect(login).toHaveBeenCalledWith('good', expect.objectContaining({ id: 'u1' }))
    expect(navigate).toHaveBeenCalledWith('/')
  })

  it('shows a safe provider error returned by the popup', async () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://api.example.com',
      data: { type: 'lattice:sso:error', message: 'Single sign-on could not be completed' },
    }))
    expect(await screen.findByText('Single sign-on could not be completed')).toBeInTheDocument()
    expect(login).not.toHaveBeenCalled()
  })
})
