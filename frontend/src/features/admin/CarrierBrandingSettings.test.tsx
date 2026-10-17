import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CarrierBrandingSettings } from './CarrierBrandingSettings'
import { CarrierBrand } from '../../tenant/carrierBranding'
import { request } from '../../api/request'
vi.mock('../../api/request', () => ({ request: vi.fn(), tenantId: () => 'acme-pilot' }))
vi.mock('../../config', () => ({ config: { apiBaseUrl: '', useMock: true } }))
const original = { name: 'Acme Mutual Pilot', primaryColor: '#155e75', logoDataUrl: null, documentFooter: 'Carrier terms apply.' }
function renderSettings() {
  const client = new QueryClient()
  client.setQueryData(['carrier-branding', 'acme-pilot'], original)
  return render(<QueryClientProvider client={client}><CarrierBrand /><CarrierBrandingSettings /></QueryClientProvider>)
}
describe('carrier branding administration', () => {
  beforeEach(() => { vi.mocked(request).mockReset() })
  it('saves carrier identity and updates the screen header', async () => {
    vi.mocked(request).mockResolvedValue({ ...original, name: 'New Carrier' })
    renderSettings()
    fireEvent.change(await screen.findByLabelText('Carrier display name'), { target: { value: 'New Carrier' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save carrier branding' }))
    await screen.findByText('Carrier branding saved.')
    expect(request).toHaveBeenCalledWith('PATCH', '/v1/admin/branding', { ...original, name: 'New Carrier' })
    expect(document.title).toBe('New Carrier | Policy Administration')
    expect(screen.getByText('New Carrier', { selector: 'strong' })).toBeVisible()
  })
  it('rejects an unsupported image and shows save errors on the screen', async () => {
    renderSettings()
    const upload = await screen.findByLabelText(/Carrier logo \(/)
    fireEvent.change(upload, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a PNG, JPEG or WebP')
    vi.mocked(request).mockRejectedValue(new Error('Access denied'))
    fireEvent.click(screen.getByRole('button', { name: 'Save carrier branding' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Access denied'))
  })
})
