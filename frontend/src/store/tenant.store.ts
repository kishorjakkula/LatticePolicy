import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

type TenantState = {
  tenantId: string
  setTenantId: (id: string) => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: 'sample-carrier',
      setTenantId: (tenantId) => set({ tenantId }),
    }),
    {
      name: 'tenant-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
