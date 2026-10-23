import { useState } from 'react'
import { AddressFields } from './AddressFields'
import { Checkbox } from './Checkbox'
import { contactAddresses, formatPostalAddress, postalAddress, type ContactAddress } from '../shared/postalAddress'

export function ContactAddresses({ value, onChange, disabled = false, scope = '' }: { value: ContactAddress[]; onChange: (value: ContactAddress[]) => void; disabled?: boolean; scope?: string }) {
  const [selected, setSelected] = useState(0)
  const index = Math.min(selected, Math.max(0, value.length - 1))
  const address = value[index]
  const change = (patch: Partial<ContactAddress>) => onChange(value.map((a, i) => i === index ? { ...a, ...patch, validationStatus: 'unvalidated' } : a))
  const primary = (at: number) => onChange(value.map((a, i) => ({ ...a, primary: i === at })))
  return <div className="contact-addresses">
    <div className="postal-toolbar"><h4>Addresses</h4>{!disabled && <button type="button" className="btn-secondary" onClick={() => { setSelected(value.length); onChange([...value, { ...postalAddress(), addressId: crypto.randomUUID(), addressType: 'mailing', primary: !value.length }]) }}>Add Address</button>}</div>
    <div className="postal-table" role="region" aria-label="Contact addresses" tabIndex={0}><table className="table table-no-sticky-head">
      <thead><tr><th>Type</th><th>Address</th><th>Primary</th><th>Actions</th></tr></thead><tbody>
        {!value.length && <tr><td colSpan={4} className="muted">No addresses.</td></tr>}
        {value.map((a, i) => <tr key={a.addressId || i}>
          <td>{a.addressType || 'mailing'}</td><td>{formatPostalAddress(a) || '-'}</td><td>{a.primary ? 'Yes' : 'No'}</td><td><div className="table-actions">
            <button type="button" className="table-link-button" onClick={() => setSelected(i)} aria-label={`View address ${i + 1}`}>{disabled ? 'View' : 'Edit'}</button>
            {!disabled && <>{!a.primary && <button type="button" className="table-link-button" onClick={() => primary(i)} aria-label={`Set address ${i + 1} primary`}>Set primary</button>}<button type="button" className="table-link-button" onClick={() => { onChange(contactAddresses(value.filter((_, n) => n !== i))); setSelected(0) }} aria-label={`Remove address ${i + 1}`}>Remove</button></>}
          </div></td></tr>)}
      </tbody></table></div>
    {address && <div className="postal-selected" key={address.addressId || index}>
      <div className="postal-toolbar"><label>Address type<select value={address.addressType || 'mailing'} disabled={disabled} onChange={e => change({ addressType: e.target.value })}>
        {['mailing', 'home', 'business', 'other', ...(!['mailing', 'home', 'business', 'other'].includes(address.addressType || 'mailing') ? [address.addressType!] : [])].map(type => <option key={type} value={type}>{type}</option>)}
      </select></label><Checkbox checked={address.primary} disabled={disabled || address.primary} onChange={() => primary(index)} label="Primary address" /></div>
      <AddressFields identity={`${scope}:${address.addressId || index}`} value={postalAddress(address)} disabled={disabled} onChange={change} />
      <div className="postal-fields"><label>Effective From<input type="date" value={address.effectiveFrom || ''} disabled={disabled} onChange={e => change({ effectiveFrom: e.target.value })} /></label><label>Effective To<input type="date" value={address.effectiveTo || ''} disabled={disabled} onChange={e => change({ effectiveTo: e.target.value })} /></label></div>
    </div>}
  </div>
}

export function ContactCommunication({ email, phone, disabled, onChange }: { email: string; phone: string; disabled?: boolean; onChange: (patch: { email?: string; phone?: string }) => void }) {
  return <div className="postal-fields"><label>Email<input type="email" autoComplete="email" value={email} disabled={disabled} onChange={e => onChange({ email: e.target.value })} /></label><label>Mobile number<input type="tel" autoComplete="tel" value={phone} disabled={disabled} onChange={e => onChange({ phone: e.target.value })} /></label></div>
}
