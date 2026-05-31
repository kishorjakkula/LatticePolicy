import { useTenant } from './TenantContext'

const tenants = [
  { id: 'sample-carrier', name: 'Sample Carrier' }
]

export function TenantSelector() {
  const { tenantId, setTenantId } = useTenant()
  return (
    <div>
      <label className="muted" htmlFor="tenantSel">Tenant</label>
      <select id="tenantSel" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
        {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  )
}

