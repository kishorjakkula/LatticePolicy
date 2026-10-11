import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { config } from '../config'
import { tenantId } from '../api/request'

export type CarrierBranding = { name: string; primaryColor: string; logoDataUrl: string | null; documentFooter: string }
export function fallbackBranding(id: string): CarrierBranding {
  return { name: id, primaryColor: '#1f3a8a', logoDataUrl: null, documentFooter: "Coverage is governed by the policy's terms and conditions." }
}
export async function fetchCarrierBranding(id = tenantId()): Promise<CarrierBranding> {
  if (!config.apiBaseUrl || config.useMock) return fallbackBranding(id)
  const response = await fetch(`${config.apiBaseUrl}/brand`, { headers: { 'X-Tenant': id } })
  if (!response.ok) throw new Error('Unable to load carrier branding')
  return response.json()
}
export function useCarrierBranding(id = tenantId()) {
  return useQuery({ queryKey: ['carrier-branding', id], queryFn: () => fetchCarrierBranding(id), staleTime: 60000, retry: false })
}
export function CarrierBrand({ id = tenantId(), className }: { id?: string; className?: string }) {
  const { data } = useCarrierBranding(id)
  const brand = data || fallbackBranding(id)
  useEffect(() => {
    document.title = `${brand.name} | Policy Administration`
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (icon) {
      icon.href = brand.logoDataUrl || '/favicon.svg'
      icon.type = brand.logoDataUrl ? brand.logoDataUrl.slice(5, brand.logoDataUrl.indexOf(';')) : 'image/svg+xml'
    }
    const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (theme) theme.content = brand.primaryColor
    const root = document.documentElement.style
    root.setProperty('--accent', brand.primaryColor)
    root.setProperty('--accent-strong', brand.primaryColor)
    root.setProperty('--accent-soft', `color-mix(in srgb, ${brand.primaryColor} 12%, white)`)
  }, [brand.name, brand.primaryColor])
  return brand.logoDataUrl ? <img src={brand.logoDataUrl} alt={brand.name} className={className} /> : <strong className={className}>{brand.name}</strong>
}
