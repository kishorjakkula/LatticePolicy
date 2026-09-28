import { FormEvent, useState } from 'react'
import {
  useTreaties,
  useCreateTreatyMutation,
  useUpdateTreatyMutation,
  useFacultativeCertificates,
  useCreateFacultativeMutation,
} from '../../api/hooks'

type LayerRow = {
  layerId: string
  layerNumber: number
  layerType: string | null
  cededPercent: string
  retainedPercent: string
  retentionAmount: string | null
  limitAmount: string | null
  premiumRate: string | null
  participants: ParticipantRow[]
}

type ParticipantRow = {
  participantId?: string
  reinsurerName: string
  reinsurerReference?: string | null
  participationPercent: string
  brokerName?: string | null
  isLead: boolean
}

type TreatyEdit = {
  treatyId: string
  effectiveDate: string
  layers: LayerRow[]
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
  const [editing, setEditing] = useState<TreatyEdit | null>(null)

  const { data, isLoading, error } = useTreaties()
  const rows: TreatyRow[] = data?.items ?? []
  const createMutation = useCreateTreatyMutation()
  const updateMutation = useUpdateTreatyMutation()

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

  const beginEdit = (row: TreatyRow) => {
    setFormError(null)
    setEditing({
      treatyId: row.treaty_id,
      effectiveDate: row.effective_date.slice(0, 10),
      layers: row.layers.map(layer => ({
        ...layer,
        retentionAmount: layer.retentionAmount ?? '',
        limitAmount: layer.limitAmount ?? '',
        premiumRate: layer.premiumRate ?? '',
        participants: (layer.participants ?? []).map(participant => ({ ...participant })),
      })),
    })
  }

  const updateLayer = (index: number, patch: Partial<LayerRow>) => {
    setEditing(current => current ? {
      ...current,
      layers: current.layers.map((layer, layerIndex) => layerIndex === index ? { ...layer, ...patch } : layer),
    } : null)
  }

  const updateParticipant = (layerIndex: number, participantIndex: number, patch: Partial<ParticipantRow>) => {
    if (!editing) return
    const participants = editing.layers[layerIndex].participants.map((participant, index) =>
      index === participantIndex ? { ...participant, ...patch } : participant
    )
    updateLayer(layerIndex, { participants })
  }

  const saveEdit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editing) return
    setFormError(null)
    for (const layer of editing.layers) {
      const shares = layer.participants.map(participant => Number(participant.participationPercent))
      if (shares.some(share => !Number.isFinite(share) || share <= 0 || share > 100) || shares.reduce((sum, share) => sum + share, 0) > 100.001) {
        setFormError('Participant shares must each be greater than 0 and total no more than 100%')
        return
      }
    }
    try {
      await updateMutation.mutateAsync({
        id: editing.treatyId,
        patch: {
          effectiveDate: editing.effectiveDate,
          layers: editing.layers.map((layer, index) => ({
            layerNumber: layer.layerNumber || index + 1,
            layerType: layer.layerType,
            retentionAmount: layer.retentionAmount === '' ? null : Number(layer.retentionAmount),
            limitAmount: layer.limitAmount === '' ? null : Number(layer.limitAmount),
            cededPercent: Number(layer.cededPercent),
            retainedPercent: Number(layer.retainedPercent),
            premiumRate: layer.premiumRate === '' ? null : Number(layer.premiumRate),
            participants: layer.participants.map(participant => ({
              reinsurerName: participant.reinsurerName,
              reinsurerReference: participant.reinsurerReference || undefined,
              participationPercent: Number(participant.participationPercent),
              brokerName: participant.brokerName || undefined,
              isLead: participant.isLead,
            })),
          })),
        },
      })
      setEditing(null)
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || createMutation.isPending || updateMutation.isPending
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
          <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Effective</th><th>Expiration</th><th>Layers</th><th>Actions</th></tr></thead>
          <tbody>
            {!isLoading && rows.length === 0 && <tr><td colSpan={7} className="muted">No treaties configured</td></tr>}
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
                <td><button type="button" className="btn-secondary" onClick={() => beginEdit(row)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <form onSubmit={saveEdit} style={{ marginTop: 20 }} aria-label="Edit treaty terms">
          <h3>Edit Treaty Version</h3>
          <label>
            Version Effective
            <input type="date" value={editing.effectiveDate} onChange={e => setEditing({ ...editing, effectiveDate: e.target.value })} />
          </label>
          {editing.layers.map((layer, layerIndex) => (
            <fieldset key={layer.layerId || layerIndex} style={{ marginTop: 12 }}>
              <legend>Layer {layer.layerNumber}</legend>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <div className="col"><label>Retention<input aria-label={`Layer ${layer.layerNumber} retention`} type="number" value={layer.retentionAmount ?? ''} onChange={e => updateLayer(layerIndex, { retentionAmount: e.target.value })} /></label></div>
                <div className="col"><label>Limit<input aria-label={`Layer ${layer.layerNumber} limit`} type="number" value={layer.limitAmount ?? ''} onChange={e => updateLayer(layerIndex, { limitAmount: e.target.value })} /></label></div>
                <div className="col"><label>Ceded %<input aria-label={`Layer ${layer.layerNumber} ceded percent`} type="number" value={layer.cededPercent} onChange={e => updateLayer(layerIndex, { cededPercent: e.target.value })} /></label></div>
                <div className="col"><label>Retained %<input aria-label={`Layer ${layer.layerNumber} retained percent`} type="number" value={layer.retainedPercent} onChange={e => updateLayer(layerIndex, { retainedPercent: e.target.value })} /></label></div>
              </div>
              <h4>Market Participants</h4>
              {layer.participants.map((participant, participantIndex) => (
                <div className="row" key={participant.participantId || participantIndex} style={{ flexWrap: 'wrap', marginBottom: 8 }}>
                  <div className="col"><label>Reinsurer<input aria-label={`Layer ${layer.layerNumber} participant ${participantIndex + 1} reinsurer`} value={participant.reinsurerName} onChange={e => updateParticipant(layerIndex, participantIndex, { reinsurerName: e.target.value })} /></label></div>
                  <div className="col"><label>Share %<input aria-label={`Layer ${layer.layerNumber} participant ${participantIndex + 1} share`} type="number" value={participant.participationPercent} onChange={e => updateParticipant(layerIndex, participantIndex, { participationPercent: e.target.value })} /></label></div>
                  <label><input type="checkbox" checked={participant.isLead} onChange={e => updateParticipant(layerIndex, participantIndex, { isLead: e.target.checked })} /> Lead</label>
                  <button type="button" className="btn-secondary" onClick={() => updateLayer(layerIndex, { participants: layer.participants.filter((_, index) => index !== participantIndex) })}>Remove</button>
                </div>
              ))}
              <button type="button" className="btn-secondary" onClick={() => updateLayer(layerIndex, { participants: [...layer.participants, { reinsurerName: '', participationPercent: '', isLead: false }] })}>Add Participant</button>
            </fieldset>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button type="submit" disabled={loading || !editing.effectiveDate}>Save Version</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </form>
      )}
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
