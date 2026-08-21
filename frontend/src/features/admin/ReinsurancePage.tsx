import { FormEvent, useState } from 'react'
import {
  useTreaties,
  useCreateTreatyMutation,
  useFacultativeCertificates,
  useCreateFacultativeMutation,
} from '../../api/hooks'

type LayerRow = {
  layerId: string
  layerNumber: number
  layerType: string | null
  cededPercent: string
  retainedPercent: string
}

type TreatyRow = {
  treaty_id: string
  treaty_name: string
  treaty_type: string
  status: string
  effective_date: string
  expiration_date: string
  broker_name: string | null
  layers: LayerRow[]
}

type FacultativeRow = {
  certificate_id: string
  policy_id: string
  certificate_number: string | null
  status: string
  effective_date: string
  expiration_date: string
  ceded_percent: string
  retained_percent: string
}

const TREATY_TYPES = ['QUOTA_SHARE', 'SURPLUS', 'EXCESS_OF_LOSS', 'FACULTATIVE_OBLIGATORY']

export function ReinsurancePage() {
  const [tab, setTab] = useState<'treaties' | 'facultative'>('treaties')

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Reinsurance</h2></div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={tab === 'treaties' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('treaties')}>
          Treaties
        </button>
        <button className={tab === 'facultative' ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab('facultative')}>
          Facultative Certificates
        </button>
      </div>
      {tab === 'treaties' ? <TreatiesSection /> : <FacultativeSection />}
    </div>
  )
}

function TreatiesSection() {
  const [formError, setFormError] = useState<string | null>(null)
  const [treatyName, setTreatyName] = useState('')
  const [treatyType, setTreatyType] = useState(TREATY_TYPES[0])
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [cededPercent, setCededPercent] = useState('')
  const [retainedPercent, setRetainedPercent] = useState('')

  const { data, isLoading, error } = useTreaties()
  const rows: TreatyRow[] = data?.items ?? []
  const createMutation = useCreateTreatyMutation()

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createMutation.mutateAsync({
        treatyName,
        treatyType,
        effectiveDate,
        expirationDate,
        layers: [{ layerNumber: 1, cededPercent: Number(cededPercent), retainedPercent: Number(retainedPercent), participants: [] }],
      })
      setTreatyName(''); setEffectiveDate(''); setExpirationDate(''); setCededPercent(''); setRetainedPercent('')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || createMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div>
      {errorMessage && <p className="error">{errorMessage}</p>}
      <form onSubmit={onCreate} className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="col"><label>Treaty Name<input value={treatyName} onChange={e => setTreatyName(e.target.value)} /></label></div>
        <div className="col">
          <label>
            Type
            <select value={treatyType} onChange={e => setTreatyType(e.target.value)}>
              {TREATY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="col"><label>Effective<input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label></div>
        <div className="col"><label>Expiration<input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} /></label></div>
        <div className="col"><label>Ceded %<input type="number" value={cededPercent} onChange={e => setCededPercent(e.target.value)} /></label></div>
        <div className="col"><label>Retained %<input type="number" value={retainedPercent} onChange={e => setRetainedPercent(e.target.value)} /></label></div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !treatyName || !effectiveDate || !expirationDate || !cededPercent || !retainedPercent}>
            Save
          </button>
        </div>
      </form>
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Effective</th><th>Expiration</th><th>Layers</th></tr></thead>
          <tbody>
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="muted">No treaties configured</td></tr>}
            {rows.map(row => (
              <tr key={row.treaty_id}>
                <td>{row.treaty_name}</td>
                <td>{row.treaty_type}</td>
                <td>{row.status}</td>
                <td>{row.effective_date}</td>
                <td>{row.expiration_date}</td>
                <td>
                  {row.layers.map(l => `L${l.layerNumber}: ${l.cededPercent}% ceded`).join(', ') || <span className="muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FacultativeSection() {
  const [formError, setFormError] = useState<string | null>(null)
  const [policyId, setPolicyId] = useState('')
  const [certificateNumber, setCertificateNumber] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expirationDate, setExpirationDate] = useState('')
  const [cededPercent, setCededPercent] = useState('')
  const [retainedPercent, setRetainedPercent] = useState('')

  const { data, isLoading, error } = useFacultativeCertificates()
  const rows: FacultativeRow[] = data?.items ?? []
  const createMutation = useCreateFacultativeMutation()

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createMutation.mutateAsync({
        policyId,
        certificateNumber: certificateNumber || undefined,
        effectiveDate,
        expirationDate,
        cededPercent: Number(cededPercent),
        retainedPercent: Number(retainedPercent),
        participants: [],
      })
      setPolicyId(''); setCertificateNumber(''); setEffectiveDate(''); setExpirationDate(''); setCededPercent(''); setRetainedPercent('')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || createMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div>
      {errorMessage && <p className="error">{errorMessage}</p>}
      <form onSubmit={onCreate} className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="col"><label>Policy ID<input value={policyId} onChange={e => setPolicyId(e.target.value)} placeholder="policy uuid" /></label></div>
        <div className="col"><label>Certificate #<input value={certificateNumber} onChange={e => setCertificateNumber(e.target.value)} /></label></div>
        <div className="col"><label>Effective<input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /></label></div>
        <div className="col"><label>Expiration<input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} /></label></div>
        <div className="col"><label>Ceded %<input type="number" value={cededPercent} onChange={e => setCededPercent(e.target.value)} /></label></div>
        <div className="col"><label>Retained %<input type="number" value={retainedPercent} onChange={e => setRetainedPercent(e.target.value)} /></label></div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !policyId || !effectiveDate || !expirationDate || !cededPercent || !retainedPercent}>
            Save
          </button>
        </div>
      </form>
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Certificate #</th><th>Policy</th><th>Status</th><th>Effective</th><th>Expiration</th><th>Ceded %</th></tr></thead>
          <tbody>
            {!isLoading && rows.length === 0 && <tr><td colSpan={6} className="muted">No facultative certificates</td></tr>}
            {rows.map(row => (
              <tr key={row.certificate_id}>
                <td>{row.certificate_number || <span className="muted">-</span>}</td>
                <td>{row.policy_id}</td>
                <td>{row.status}</td>
                <td>{row.effective_date}</td>
                <td>{row.expiration_date}</td>
                <td>{row.ceded_percent}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
