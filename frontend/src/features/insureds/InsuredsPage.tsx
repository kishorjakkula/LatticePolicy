import { useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../../api/client'
import { ActionButton } from '../../components/ActionButton'
import { useCreateCustomerMutation } from '../../api/hooks'

function NameFields({ prefix, setPrefix, firstName, setFirstName, lastName, setLastName, displayName, setDisplayName }: any) {
  return (
    <div className="insured-name-fields">
      <label>
        Prefix
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} />
      </label>
      <label>
        First name
        <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
      </label>
      <label>
        Last name
        <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
    </div>
  )
}

function AddressFields({ address, setAddress }: any) {
  return (
    <div className="insured-address-fields">
      <label>
        Street
        <input value={address.street || ''} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
      </label>
      <label>
        City
        <input value={address.city || ''} onChange={(e) => setAddress({ ...address, city: e.target.value })} />
      </label>
      <label>
        State
        <input value={address.state || ''} onChange={(e) => setAddress({ ...address, state: e.target.value })} />
      </label>
      <label>
        ZIP
        <input value={address.zip || ''} onChange={(e) => setAddress({ ...address, zip: e.target.value })} />
      </label>
    </div>
  )
}

export function InsuredsPage() {
  // Primary
  const [pPrefix, setPPrefix] = useState('')
  const [pFirst, setPFirst] = useState('')
  const [pLast, setPLast] = useState('')
  const [pDisplay, setPDisplay] = useState('')
  const [pAddress, setPAddress] = useState<any>({})

  // Secondary
  const [sPrefix, setSPrefix] = useState('')
  const [sFirst, setSFirst] = useState('')
  const [sLast, setSLast] = useState('')
  const [sDisplay, setSDisplay] = useState('')
  const [sAddress, setSAddress] = useState<any>({})

  // Additional named insureds
  const [additional, setAdditional] = useState<any[]>([])

  // Contacts search
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  const createCustomerMutation = useCreateCustomerMutation()

  async function searchContacts() {
    setLoading(true)
    try {
      const items = await adminApi.searchCustomers({ q, limit: 20 })
      setResults(items || [])
    } catch (err) {
      console.error('search failed', err)
    } finally {
      setLoading(false)
    }
  }

  async function addContactFromResult(item: any) {
    setAdditional((s) => [...s, item])
  }

  async function createCustomerAndAdd(payload: any) {
    try {
      const created = await createCustomerMutation.mutateAsync(payload)
      setAdditional((s) => [...s, created])
    } catch (err) {
      console.error('create failed', err)
    }
  }

  function removeAdditional(index: number) {
    setAdditional((s) => s.filter((_, i) => i !== index))
  }

  return (
    <div className="ps-page-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">Insureds</span>
      </nav>
      <div className="ps-page-header">
        <h1 className="ps-page-title">Insureds</h1>
      </div>

      <section>
        <h3 className="ps-content-card-title">Primary Named Insured</h3>
        <div className="ps-form-grid">
          <NameFields prefix={pPrefix} setPrefix={setPPrefix} firstName={pFirst} setFirstName={setPFirst} lastName={pLast} setLastName={setPLast} displayName={pDisplay} setDisplayName={setPDisplay} />
        </div>
        <AddressFields address={pAddress} setAddress={setPAddress} />
      </section>

      <section>
        <h3 className="ps-content-card-title">Secondary Named Insured</h3>
        <div className="ps-form-grid">
          <NameFields prefix={sPrefix} setPrefix={setSPrefix} firstName={sFirst} setFirstName={setSFirst} lastName={sLast} setLastName={setSLast} displayName={sDisplay} setDisplayName={setSDisplay} />
        </div>
        <AddressFields address={sAddress} setAddress={setSAddress} />
      </section>

      <section>
        <h3 className="ps-content-card-title">Additional Named Insureds</h3>
        <div className="ps-filter-grid" style={{ gridTemplateColumns: '1fr auto', marginBottom: 12 }}>
          <div className="ps-filter-col">
            <label className="ps-filter-label">Search Contacts</label>
            <input className="ps-filter-input" placeholder="Name, phone, or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="ps-filter-actions">
            <button type="button" className="ps-filter-btn-search" onClick={searchContacts} disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </div>
        </div>
        <div className="search-results">
          {results.map((r) => (
            <div key={r.id || r.customerKey} className="search-result">
              <span>{r.displayName || r.name || r.firstName + ' ' + r.lastName}</span>
              <ActionButton variant="secondary" size="sm" onClick={() => addContactFromResult(r)}>Add</ActionButton>
            </div>
          ))}
          {results.length === 0 && <div className="muted" style={{ fontSize: 13, padding: '4px 0' }}>No results</div>}
        </div>

        {additional.length > 0 && (
          <div className="ps-table-card" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th>Name</th><th>Contact</th><th /></tr>
              </thead>
              <tbody>
                {additional.map((a, i) => (
                  <tr key={a.id || i}>
                    <td>{a.displayName || a.name || `${a.firstName || ''} ${a.lastName || ''}`}</td>
                    <td>{a.email || a.phone || '—'}</td>
                    <td><ActionButton variant="secondary" size="sm" onClick={() => removeAdditional(i)}>Remove</ActionButton></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ps-content-card" style={{ marginTop: 16 }}>
          <h4 className="ps-content-card-title">Add New Contact</h4>
          <CreateCustomerForm onCreate={createCustomerAndAdd} />
        </div>
      </section>
    </div>
  )
}

function CreateCustomerForm({ onCreate }: { onCreate: (p: any) => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [street, setStreet] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zip, setZip] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e?: any) {
    if (e && e.preventDefault) e.preventDefault()
    setSaving(true)
    try {
      const payload = {
        entityType: 'INDIVIDUAL',
        firstName,
        lastName,
        email,
        phone,
        addresses: [{ street, city, state, zip, country: 'US', primary: true }]
      }
      await onCreate(payload)
      // clear
      setFirstName(''); setLastName(''); setEmail(''); setPhone(''); setStreet(''); setCity(''); setState(''); setZip('')
    } catch (err) {
      console.error(err)
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={submit} className="create-customer-form">
      <label>First name<input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
      <label>Last name<input value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Phone<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      <label>Street<input value={street} onChange={(e) => setStreet(e.target.value)} /></label>
      <label>City<input value={city} onChange={(e) => setCity(e.target.value)} /></label>
      <label>State<input value={state} onChange={(e) => setState(e.target.value)} /></label>
      <label>ZIP<input value={zip} onChange={(e) => setZip(e.target.value)} /></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create & Add'}</button>
    </form>
  )
}

export default InsuredsPage
