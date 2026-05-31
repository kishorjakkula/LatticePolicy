import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from '../AuthContext'

const mockUser = { id: '1', username: 'testuser', tenantId: 'sample-carrier', roles: ['agent'] }

function TestConsumer() {
  const { token, user, login, logout } = useAuth()
  return (
    <div>
      <span data-testid="token">{token ?? 'null'}</span>
      <span data-testid="user">{user?.username ?? 'null'}</span>
      <button onClick={() => login('test-token', mockUser)}>Login</button>
      <button onClick={logout}>Logout</button>
    </div>
  )
}

describe('AuthContext', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('starts with no token when localStorage is empty', () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    expect(screen.getByTestId('token').textContent).toBe('null')
    expect(screen.getByTestId('user').textContent).toBe('null')
  })

  it('login sets token and user', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await user.click(screen.getByText('Login'))
    expect(screen.getByTestId('token').textContent).toBe('test-token')
    expect(screen.getByTestId('user').textContent).toBe('testuser')
  })

  it('logout clears token and user', async () => {
    const user = userEvent.setup()
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    await user.click(screen.getByText('Login'))
    await user.click(screen.getByText('Logout'))
    expect(screen.getByTestId('token').textContent).toBe('null')
    expect(screen.getByTestId('user').textContent).toBe('null')
  })

  it('clears auth on auth:unauthorized event', async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>)
    act(() => {
      localStorage.setItem('authToken', 'test-token')
      localStorage.setItem('authUser', JSON.stringify(mockUser))
    })
    act(() => {
      window.dispatchEvent(new CustomEvent('auth:unauthorized'))
    })
    expect(screen.getByTestId('token').textContent).toBe('null')
  })

  it('useAuth works without AuthProvider since Zustand is global', () => {
    // Zustand stores are module-level singletons; no provider required
    render(<TestConsumer />)
    expect(screen.getByTestId('token').textContent).toBe('null')
  })
})
