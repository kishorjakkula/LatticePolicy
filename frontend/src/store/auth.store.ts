import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type AuthUser = {
  id: string
  username: string
  tenantId: string
  roles: string[]
  permissions?: string[]
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
}

type AuthState = {
  token: string | null
  user: AuthUser | null
  login: (token: string, user: AuthUser) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      login: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, user: state.user }),
    }
  )
)
