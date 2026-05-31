import React, { useEffect } from 'react'
import { getBrand } from './brand'
import { useTenantStore } from '../store/tenant.store'

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const tenantId = useTenantStore((s) => s.tenantId)

  // Apply brand accent colour whenever the active tenant changes
  useEffect(() => {
    const brand = getBrand(tenantId)
    document.documentElement.style.setProperty('--accent', brand.accent)
  }, [tenantId])

  return <>{children}</>
}

export function useTenant() {
  const { tenantId, setTenantId } = useTenantStore()
  return { tenantId, setTenantId }
}
