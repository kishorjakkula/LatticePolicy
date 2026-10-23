import { useEffect, useId, useRef, useState } from 'react'
import type { PostalAddress } from '@lattice-policy/types'
import { request, tenantId } from '../api/request'
import { useAuthStore } from '../store/auth.store'
import { US_STATES, CANADA_PROVINCES } from '../shared/usStates'
import { formatPostalAddress, postalAddress } from '../shared/postalAddress'
import { Checkbox } from './Checkbox'
import { RadioGroup } from './RadioGroup'
import './address-fields.css'

export function AddressFields({ value, onChange, disabled = false, identity = '' }: {
  value: PostalAddress; onChange: (address: PostalAddress) => void; disabled?: boolean; identity?: string
}) {
  const id = useId()
  const user = useAuthStore(state => state.user)
  const principal = JSON.stringify([tenantId(), user?.id || user?.username])
  const section = id.replace(/:/g, '')
  const [enabled, setEnabled] = useState(false)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [choice, setChoice] = useState('')
  const generation = useRef(0)
  const pending = useRef(false)
  const key = JSON.stringify(value)
  const invalidate = () => { generation.current++; pending.current = false; setBusy(false); setResult(null); setConsent(false); setChoice('') }
  useEffect(() => { invalidate(); return () => { generation.current++ } }, [key, identity, disabled, principal])
  useEffect(() => {
    let alive = true
    setEnabled(false)
    if (!disabled) void request<{ enabled: boolean }>('GET', '/v1/addresses/capabilities').then(r => { if (alive) setEnabled(r.enabled) }).catch(() => {})
    return () => { alive = false }
  }, [disabled, identity, principal])
  const update = (field: keyof PostalAddress, text: string) => { invalidate(); onChange({ ...value, [field]: text }) }
  const regions = value.country === 'US' ? [...US_STATES, ...[
    ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'], ['VI', 'US Virgin Islands'],
    ['AA', 'Armed Forces Americas'], ['AE', 'Armed Forces Europe'], ['AP', 'Armed Forces Pacific'],
  ].map(([code, name]) => ({ code, name }))].filter((a, i, all) => all.findIndex(b => b.code === a.code) === i) : value.country === 'CA' ? CANADA_PROVINCES : []
  async function check() {
    if (!enabled || !consent || disabled || pending.current) return
    pending.current = true
    const token = ++generation.current
    setBusy(true); setResult(null); setChoice('')
    try {
      const response = await request<any>('POST', '/v1/addresses/check', { address: postalAddress(value) })
      if (token !== generation.current) return
      setResult(response)
      if (response.candidates?.length === 1) setChoice('0')
    } catch { if (token === generation.current) setResult({ outcome: 'unavailable', candidates: [] }) }
    finally { if (token === generation.current) { pending.current = false; setBusy(false) } }
  }
  const messages: Record<string, string> = {
    matched: 'Address range matched. Postal delivery and apartment/unit were not verified.',
    ambiguous: 'Several address ranges matched. Choose a suggestion to review.',
    unmatched: 'No address match found. You can keep the address you entered.',
    unsupported: 'This address type cannot be checked with this service.',
    unavailable: 'Address check unavailable. Your entries have been kept.', disabled: 'External address checking is disabled.',
  }
  return <div className="postal-editor">
    <div className="postal-fields">
      <label className="postal-wide" htmlFor={`${id}-country`}>Country<select id={`${id}-country`} autoComplete={`section-${section} country`} value={value.country} disabled={disabled} onChange={e => update('country', e.target.value)}>
        <option value="US">United States</option><option value="CA">Canada</option>{!['US', 'CA'].includes(value.country) && <option value={value.country}>{value.country || 'Select country'}</option>}
      </select></label>
      {(['line1', 'line2', 'line3'] as const).map(field => (field !== 'line3' || value.line3) && <label className="postal-wide" key={field} htmlFor={`${id}-${field}`}>
        {field === 'line1' ? 'Address line 1' : field === 'line2' ? 'Apartment, suite or unit' : 'Address line 3'}
        <input id={`${id}-${field}`} maxLength={field === 'line1' ? 200 : 100} value={value[field] || ''} disabled={disabled} autoComplete={`section-${section} address-${field}`} onChange={e => update(field, e.target.value)} />
      </label>)}
      <label htmlFor={`${id}-city`}>City<input id={`${id}-city`} maxLength={100} value={value.city} disabled={disabled} autoComplete={`section-${section} address-level2`} onChange={e => update('city', e.target.value)} /></label>
      <label htmlFor={`${id}-state`}>{value.country === 'US' ? 'State' : 'State / Province'}{regions.length ? <select id={`${id}-state`} value={value.state} disabled={disabled} onChange={e => update('state', e.target.value)}>
        <option value="">Select</option>{value.state && !regions.some(r => r.code === value.state) && <option value={value.state}>{value.state}</option>}{regions.map(r => <option value={r.code} key={r.code}>{r.name}</option>)}
      </select> : <input id={`${id}-state`} value={value.state} disabled={disabled} onChange={e => update('state', e.target.value)} />}</label>
      <label htmlFor={`${id}-zip`}>{value.country === 'US' ? 'ZIP Code' : 'Postal Code'}<input id={`${id}-zip`} type="text" maxLength={20} value={value.postalCode} disabled={disabled} autoComplete={`section-${section} postal-code`} onChange={e => update('postalCode', e.target.value)} /></label>
      <label className="postal-wide" htmlFor={`${id}-county`}>County<input id={`${id}-county`} maxLength={100} value={value.county || ''} disabled={disabled} onChange={e => update('county', e.target.value)} /></label>
    </div>
    {enabled && !disabled && <div className="postal-check">
      <Checkbox checked={consent} onChange={setConsent} label="I agree to send this street, city, state and ZIP to the US Census Bureau for address matching." />
      <button type="button" className="btn-secondary" onClick={() => void check()} disabled={busy || !consent || !value.line1 || !value.city || !value.state || !value.postalCode}>{busy ? 'Checking address...' : 'Check Address'}</button>
    </div>}
    <div role="status" aria-live="polite">{result && messages[result.outcome]}</div>
    {!!result?.candidates?.length && <div className="postal-comparison">
      <div><strong>Entered address</strong><p>{formatPostalAddress(value)}</p></div>
      <div><strong>Suggested address</strong>{result.candidates.length > 1 && <RadioGroup name={`${id}-candidate`} ariaLabel="Address suggestions" value={choice} onChange={setChoice} options={result.candidates.map((c: any, i: number) => ({ value: String(i), label: formatPostalAddress(c.address) }))} />}
        {choice !== '' && <p>{formatPostalAddress(result.candidates[Number(choice)].address)}</p>}
        <button type="button" className="btn-secondary" onClick={invalidate}>Keep entered address</button>{' '}
        <button type="button" disabled={choice === '' || disabled} onClick={() => { const next = result.candidates[Number(choice)].address; invalidate(); onChange({ ...value, ...next }) }}>Use suggested address</button>
      </div>
    </div>}
  </div>
}
