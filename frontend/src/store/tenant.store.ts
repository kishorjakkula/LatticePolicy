import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { config } from '../config'

type TenantState = {
  tenantId: string
  setTenantId: (id: string) => void
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: config.carrierTenantId || 'sample-carrier',
      setTenantId: (tenantId) => set({ tenantId }),
    }),
    {
      name: 'tenant-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
)
