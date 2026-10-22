import { FormEvent, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  useEligibility,
  useCreateEligibilityMutation,
  useOfacScreens,
  useDispositionOfacScreenMutation,
} from '../../api/hooks'
import { productLabel, statusLabel } from '../../shared/displayLabels'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { ReasonDialog, useReasonDialog } from '../../components/Dialog'
import { request } from '../../api/request'
import { hasPermission } from '../../auth/permissions'
import { useAuthStore } from '../../store/auth.store'
import './compliance-security.css'

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
const eligibilityStatusLabel = (status: string) => ({ ACTIVE: 'Active', SUSPENDED: 'Suspended', CLOSED: 'Closed', FILING_PENDING: 'Filing pending' }[status] || statusLabel(status))

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
  const user = useAuthStore(state => state.user)
  const canManage = hasPermission(user, 'admin.compliance.manage')
  const qc = useQueryClient()
  const [productFilter, setProductFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [exceptionsOnly, setExceptionsOnly] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [bulkStatus, setBulkStatus] = useState('SUSPENDED')
  const [batch, setBatch] = useState<{ ids: string[]; status: string } | null>(null)
  const bulkBusy = useRef(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [productCode, setProductCode] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [status, setStatus] = useState('ACTIVE')
  const [notes, setNotes] = useState('')

  const { data, isLoading, error } = useEligibility()
  const rows: EligibilityRow[] = data?.items ?? []
  const createMutation = useCreateEligibilityMutation()
  const bulkMutation = useMutation({
    mutationFn: (payload: { ids: string[]; status: string; reason: string }) =>
      request<{ updated: number }>('POST', '/v1/admin/compliance/eligibility/bulk', payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['compliance', 'eligibility'] }) },
  })
  const visibleRows = rows.filter(row => (!productFilter || row.product_code === productFilter)
    && (!stateFilter || row.state_code === stateFilter) && (!exceptionsOnly || row.status !== 'ACTIVE'))
  const products = Array.from(new Set(rows.map(row => row.product_code))).sort()
  const states = Array.from(new Set(visibleRows.map(row => row.state_code))).sort()
  const visibleProducts = products.filter(product => !productFilter || product === productFilter)
  const selectedRows = visibleRows.filter(row => selected.includes(row.eligibility_id))
  const changeFilter = (change: () => void) => { change(); setSelected([]) }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (!canManage) return
    if (rows.some(row => row.product_code === productCode.trim() && row.state_code === stateCode)) {
      setFormError('This product and state already exist. Select the record to change its status with a reason.')
      return
    }
    try {
      await createMutation.mutateAsync({ productCode, stateCode, status, notes })
      setProductCode(''); setStateCode(''); setNotes(''); setStatus('ACTIVE')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const saveBatch = async (reason: string) => {
    if (!batch || bulkBusy.current) return
    bulkBusy.current = true
    try {
      await bulkMutation.mutateAsync({ ...batch, reason })
      setBatch(null)
      setSelected([])
    } finally { bulkBusy.current = false }
  }

  const loading = isLoading || createMutation.isPending || bulkMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div>
      {batch && <ReasonDialog title={`Change ${batch.ids.length} eligibility records`}
        description={`Set status to ${eligibilityStatusLabel(batch.status)}.`} confirmLabel="Change status"
        onConfirm={saveBatch} onCancel={() => { if (!bulkBusy.current) setBatch(null) }} />}
      {errorMessage && <p className="error">{errorMessage}</p>}
      {canManage && <form onSubmit={onCreate} className="row" style={{ marginBottom: 12 }}>
        <div className="col"><label htmlFor="eligibility-product">Product Code</label><input id="eligibility-product" value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="personal-auto" /></div>
        <div className="col"><label htmlFor="eligibility-state">State</label><input id="eligibility-state" value={stateCode} onChange={e => setStateCode(e.target.value.toUpperCase())} maxLength={2} placeholder="CA" /></div>
        <div className="col">
          <label htmlFor="eligibility-status">Status</label>
          <select id="eligibility-status" value={status} onChange={e => setStatus(e.target.value)}>
            {ELIGIBILITY_STATUSES.map(s => <option key={s} value={s}>{eligibilityStatusLabel(s)}</option>)}
          </select>
        </div>
        <div className="col"><label htmlFor="eligibility-notes">Notes</label><input id="eligibility-notes" value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !productCode || stateCode.length !== 2}>Save</button>
        </div>
      </form>}
      <div className="cs-filters">
        <label>Product<select value={productFilter} onChange={e => changeFilter(() => setProductFilter(e.target.value))}>
          <option value="">All products</option>{products.map(product => <option key={product} value={product}>{productLabel(product)}</option>)}
        </select></label>
        <label>State<select value={stateFilter} onChange={e => changeFilter(() => setStateFilter(e.target.value))}>
          <option value="">All states</option>{Array.from(new Set(rows.map(row => row.state_code))).sort().map(state => <option key={state}>{state}</option>)}
        </select></label>
        <label className="cs-check"><input type="checkbox" checked={exceptionsOnly} onChange={e => changeFilter(() => setExceptionsOnly(e.target.checked))} />Exceptions only</label>
      </div>
      {canManage && <div className="cs-filters">
        <label className="cs-check"><input type="checkbox" aria-label="Select all visible eligibility records"
          disabled={loading || !visibleRows.length || visibleRows.length > 500}
          checked={visibleRows.length > 0 && selectedRows.length === visibleRows.length}
          onChange={e => setSelected(e.target.checked ? visibleRows.map(row => row.eligibility_id) : [])} />Select all</label>
        <span role="status">{selectedRows.length} selected</span>
        <label>New status<select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} disabled={loading}>
          {ELIGIBILITY_STATUSES.map(s => <option key={s} value={s}>{eligibilityStatusLabel(s)}</option>)}
        </select></label>
        <button type="button" disabled={loading || !selectedRows.length} onClick={() => setBatch({ ids: selectedRows.map(row => row.eligibility_id), status: bulkStatus })}>Change status</button>
      </div>}
      <CollapsibleSection title="Product Filings" className="ps-table-card">
        <div className="cs-matrix-scroll" tabIndex={0} role="region" aria-label="Product and state eligibility">
        <table className="table cs-matrix">
          <thead><tr><th scope="col">State</th>{visibleProducts.map(product => <th key={product} scope="col">{productLabel(product)}</th>)}</tr></thead>
          <tbody>
            {!states.length && <tr><td colSpan={visibleProducts.length + 1} className="muted">{isLoading ? 'Loading eligibility records...' : exceptionsOnly && rows.some(row => !productFilter || row.product_code === productFilter) && !stateFilter ? `Every state is active${productFilter ? ` for ${productLabel(productFilter)}` : ''}.` : 'No eligibility records'}</td></tr>}
            {states.map(state => <tr key={state}><th scope="row">{state}</th>{visibleProducts.map(product => {
              const row = visibleRows.find(item => item.state_code === state && item.product_code === product)
              return <td key={product}>{row ? <label className="cs-check" title={row.notes || undefined}>
                {canManage && <input type="checkbox" aria-label={`Select ${productLabel(product)} ${state}`}
                  checked={selected.includes(row.eligibility_id)} disabled={loading || (!selected.includes(row.eligibility_id) && selected.length >= 500)}
                  onChange={e => setSelected(previous => e.target.checked ? [...previous, row.eligibility_id] : previous.filter(id => id !== row.eligibility_id))} />}
                <span>{eligibilityStatusLabel(row.status)}</span>
              </label> : <span className="muted">{exceptionsOnly && rows.some(item => item.state_code === state && item.product_code === product) ? 'No exception' : 'Not configured'}</span>}</td>
            })}</tr>)}
          </tbody>
        </table>
        </div>
      </CollapsibleSection>
    </div>
  )
}

const DISPOSITION_VERBS = { CLEARED: 'Clear', ESCALATED: 'Escalate', BLOCKED: 'Block' } as const

function OfacSection() {
  const [formError, setFormError] = useState<string | null>(null)
  const { data, isLoading, error } = useOfacScreens()
  const rows: OfacScreenRow[] = data?.items ?? []
  const dispositionMutation = useDispositionOfacScreenMutation()
  const { dialog: reasonDialog, askReason } = useReasonDialog()

  const onDisposition = async (row: OfacScreenRow, disposition: 'CLEARED' | 'ESCALATED' | 'BLOCKED') => {
    setFormError(null)
    const verb = DISPOSITION_VERBS[disposition]
    const reason = await askReason({
      title: `${verb} OFAC screen for ${row.party_name}`,
      confirmLabel: verb,
      danger: disposition === 'BLOCKED',
      help: 'Recorded with the screening disposition.',
    })
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
      {reasonDialog}
      {errorMessage && <p className="error">{errorMessage}</p>}
      <CollapsibleSection title="OFAC Screenings" className="ps-table-card">
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
      </CollapsibleSection>
    </div>
  )
}
