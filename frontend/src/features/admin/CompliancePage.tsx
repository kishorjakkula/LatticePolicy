import { FormEvent, useState } from 'react'
import {
  useEligibility,
  useCreateEligibilityMutation,
  useUpdateEligibilityMutation,
  useOfacScreens,
  useDispositionOfacScreenMutation,
} from '../../api/hooks'

type EligibilityRow = {
  eligibility_id: string
  product_code: string
  state_code: string
  status: string
  admitted: boolean
  surplus_lines: boolean
  min_premium: string | null
  max_tiv: string | null
  max_limit: string | null
  notes: string | null
}

type OfacScreenRow = {
  screen_id: string
  party_name: string
  policy_id: string | null
  quote_id: string | null
  screen_date: string
  result: string
  disposition: string
  disposition_reason: string | null
  match_details: any[] | null
}

const ELIGIBILITY_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED', 'FILING_PENDING']

export function CompliancePage() {
  const [tab, setTab] = useState<'eligibility' | 'ofac'>('eligibility')

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Compliance</h2></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={tab === 'eligibility' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('eligibility')}>
          State/Product Eligibility
        </button>
        <button className={tab === 'ofac' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('ofac')}>
          OFAC Review Queue
        </button>
      </div>
      {tab === 'eligibility' ? <EligibilitySection /> : <OfacSection />}
    </div>
  )
}

function EligibilitySection() {
  const [formError, setFormError] = useState<string | null>(null)
  const [productCode, setProductCode] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [notes, setNotes] = useState('')

  const { data, isLoading, error } = useEligibility()
  const rows: EligibilityRow[] = data?.items ?? []
  const createMutation = useCreateEligibilityMutation()
  const updateMutation = useUpdateEligibilityMutation()

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createMutation.mutateAsync({ productCode, stateCode, status, notes })
      setProductCode(''); setStateCode(''); setNotes(''); setStatus('ACTIVE')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onStatusChange = async (row: EligibilityRow, nextStatus: string) => {
    setFormError(null)
    try {
      await updateMutation.mutateAsync({ id: row.eligibility_id, patch: { status: nextStatus } })
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || createMutation.isPending || updateMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div>
      {errorMessage && <p className="error">{errorMessage}</p>}
      <form onSubmit={onCreate} className="row" style={{ marginBottom: 12 }}>
        <div className="col"><label>Product Code</label><input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="personal-auto" /></div>
        <div className="col"><label>State</label><input value={stateCode} onChange={e => setStateCode(e.target.value.toUpperCase())} maxLength={2} placeholder="CA" /></div>
        <div className="col">
          <label>Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            {ELIGIBILITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="col"><label>Notes</label><input value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !productCode || stateCode.length !== 2}>Save</button>
        </div>
      </form>
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Product</th><th>State</th><th>Status</th><th>Admitted</th><th>Notes</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No eligibility records</td></tr>}
            {rows.map(row => (
              <tr key={row.eligibility_id}>
                <td>{row.product_code}</td>
                <td>{row.state_code}</td>
                <td>{row.status}</td>
                <td>{row.admitted ? 'Yes' : 'No'}</td>
                <td>{row.notes || <span className="muted">-</span>}</td>
                <td>
                  <select value={row.status} onChange={e => onStatusChange(row, e.target.value)}>
                    {ELIGIBILITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function OfacSection() {
  const [formError, setFormError] = useState<string | null>(null)
  const { data, isLoading, error } = useOfacScreens()
  const rows: OfacScreenRow[] = data?.items ?? []
  const dispositionMutation = useDispositionOfacScreenMutation()

  const onDisposition = async (row: OfacScreenRow, disposition: 'CLEARED' | 'ESCALATED' | 'BLOCKED') => {
    setFormError(null)
    const reason = prompt(`Reason to mark this screen as ${disposition}:`)
    if (!reason) return
    try {
      await dispositionMutation.mutateAsync({ screenId: row.screen_id, disposition, reason })
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div>
      {errorMessage && <p className="error">{errorMessage}</p>}
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Party</th><th>Result</th><th>Screened</th><th>Matches</th><th>Disposition</th><th>Actions</th></tr></thead>
          <tbody>
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="muted">No pending OFAC reviews</td></tr>}
            {rows.map(row => (
              <tr key={row.screen_id}>
                <td>{row.party_name}</td>
                <td>{row.result}</td>
                <td>{new Date(row.screen_date).toLocaleString()}</td>
                <td>{row.match_details?.length ?? 0}</td>
                <td>{row.disposition}{row.disposition_reason ? ` — ${row.disposition_reason}` : ''}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => onDisposition(row, 'CLEARED')}>Clear</button>
                  <button className="btn-secondary" onClick={() => onDisposition(row, 'ESCALATED')}>Escalate</button>
                  <button className="btn-secondary" onClick={() => onDisposition(row, 'BLOCKED')}>Block</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
