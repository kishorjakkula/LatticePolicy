import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { request, tenantId } from '../../api/request'
import { useCarrierBranding, type CarrierBranding } from '../../tenant/carrierBranding'
import { CollapsibleSection } from '../../components/CollapsibleSection'

export function CarrierBrandingSettings() {
  const { data, error: loadError } = useCarrierBranding()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<CarrierBranding | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  useEffect(() => { if (data) setDraft(data) }, [data])
  async function upload(file?: File) {
    setError(''); setSaved(false)
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 500000) { setError('Use a PNG, JPEG or WebP logo under 500 KB.'); return }
    setUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const image = new Image()
      image.onload = () => {
        if (image.naturalWidth > 4096 || image.naturalHeight > 4096) setError('Logo dimensions must not exceed 4096 pixels.')
        else setDraft(prev => prev ? { ...prev, logoDataUrl: String(reader.result) } : prev)
        setUploading(false)
      }
      image.onerror = () => { setError('Unable to decode the logo. Use a valid raster image.'); setUploading(false) }
      image.src = String(reader.result)
    }
    reader.onerror = () => { setError('Unable to read the logo.'); setUploading(false) }
    reader.readAsDataURL(file)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setSaved(false)
    try {
      const result = await request<CarrierBranding>('PATCH', '/v1/admin/branding', draft)
      queryClient.setQueryData(['carrier-branding', tenantId()], result)
      setSaved(true)
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save branding') }
    finally { setBusy(false) }
  }
  return <CollapsibleSection title="Carrier branding" className="ps-content-card">
    <p>Branding appears on login, screen headers, and newly generated documents. Issued documents retain their original branding.</p>
    {(error || loadError) && <p role="alert">{error || 'Unable to load branding.'}</p>}
    {saved && <p role="status">Carrier branding saved.</p>}
    {draft && <form onSubmit={save}>
      <label htmlFor="carrier-brand-name">Carrier display name</label>
      <input id="carrier-brand-name" required maxLength={100} value={draft.name} onChange={e => { setSaved(false); setDraft({ ...draft, name: e.target.value }) }} />
      <label htmlFor="carrier-brand-color">Brand color</label>
      <input id="carrier-brand-color" type="color" value={draft.primaryColor} onChange={e => { setSaved(false); setDraft({ ...draft, primaryColor: e.target.value }) }} />
      <label htmlFor="carrier-brand-logo">Carrier logo (PNG, JPEG or WebP; up to 500 KB)</label>
      <input id="carrier-brand-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => upload(e.target.files?.[0])} />
      {draft.logoDataUrl && <><img src={draft.logoDataUrl} alt="Carrier logo preview" style={{ maxWidth: 220, maxHeight: 80, objectFit: 'contain', display: 'block' }} /><button type="button" onClick={() => { setSaved(false); setDraft({ ...draft, logoDataUrl: null }) }}>Remove logo</button></>}
      <label htmlFor="carrier-brand-footer">Document footer</label>
      <textarea id="carrier-brand-footer" maxLength={500} value={draft.documentFooter} onChange={e => { setSaved(false); setDraft({ ...draft, documentFooter: e.target.value }) }} />
      <button type="submit" disabled={busy || uploading}>{busy ? 'Saving branding…' : 'Save carrier branding'}</button>
    </form>}
  </CollapsibleSection>
}
