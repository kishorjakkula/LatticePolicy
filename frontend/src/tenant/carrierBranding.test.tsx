import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CarrierBrand, type CarrierBranding } from './carrierBranding'
import latticePolicyLogo from '../assets/lattice-policy-logo.svg'

vi.mock('../api/request', () => ({ tenantId: () => 'synthetic-carrier' }))
vi.mock('../config', () => ({ config: { apiBaseUrl: '', useMock: true } }))
const branding: CarrierBranding = { name: 'Synthetic Carrier', primaryColor: '#155e75', logoDataUrl: null, documentFooter: 'Synthetic terms.' }
const raster = 'data:image/png;base64,synthetic'
beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><meta name="theme-color" content="#000000">'
})
afterEach(() => { document.head.innerHTML = ''; document.documentElement.removeAttribute('style') })
function setup(value = branding) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(['carrier-branding', 'synthetic-carrier'], value)
  render(<QueryClientProvider client={client}><CarrierBrand className="topbar-logo" /></QueryClientProvider>)
  return client
}

it('restores the local platform logo and keeps the carrier name when no carrier logo exists', () => {
  setup()
  expect(screen.getByRole('img', { name: 'LatticePolicy' })).toHaveAttribute('src', latticePolicyLogo)
  expect(screen.getByText('Synthetic Carrier', { selector: 'strong' })).toBeVisible()
  expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  expect(document.title).toBe('Synthetic Carrier | Policy Administration')
})

it('keeps a supplied carrier logo primary without adding framework branding', () => {
  setup({ ...branding, logoDataUrl: raster })
  expect(screen.getByRole('img', { name: 'Synthetic Carrier' })).toHaveAttribute('src', raster)
  expect(screen.queryByRole('img', { name: 'LatticePolicy' })).not.toBeInTheDocument()
  expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', raster)
})

it('refreshes the browser icon on logo-only updates and restores the default when cleared', async () => {
  const client = setup()
  await act(async () => { client.setQueryData(['carrier-branding', 'synthetic-carrier'], { ...branding, logoDataUrl: raster }) })
  await waitFor(() => expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', raster))
  await act(async () => { client.setQueryData(['carrier-branding', 'synthetic-carrier'], branding) })
  await waitFor(() => expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg'))
  expect(screen.getByRole('img', { name: 'LatticePolicy' })).toBeVisible()
})
