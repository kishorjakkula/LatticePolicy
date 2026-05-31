import React, { useEffect } from 'react'
import { config } from '../config'
import { useAuthStore } from '../store/auth.store'

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const token = useAuthStore((s) => s.token)
  const logout = useAuthStore((s) => s.logout)

  // Invalidate persisted mock tokens when running in non-mock mode
  useEffect(() => {
    if (!config.useMock && token === 'mock-token') {
      logout()
    }
  }, [token, logout])

  // Listen for unauthorized events emitted by the API layer
  useEffect(() => {
    const handleUnauthorized = () => logout()
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [logout])

  return <>{children}</>
}

export function useAuth() {
  const { token, user, login, logout } = useAuthStore()
  return { token, user, login, logout }
}
