import { FormEvent, useState } from 'react'
import { useBordereauxBatches, useBordereauxRows, useGenerateBordereauxMutation } from '../../api/hooks'

const BORDEREAU_TYPES = ['RISK', 'PREMIUM', 'TRANSACTION', 'CANCELLATION', 'CORRECTION', 'CLAIMS_REFERENCE_HANDOFF']

type BatchRow = {
  batch_id: string
  bordereau_type: string
  status: string
  period_start: string
  period_end: string
  product_code: string | null
  row_count: number
  valid_row_count: number
  invalid_row_count: number
  version: number
  corrects_batch_id: string | null
  generated_at: string
}

export function BordereauxPage() {
  const [formError, setFormError] = useState<string | null>(null)
  const [bordereauType, setBordereauType] = useState(BORDEREAU_TYPES[0])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [productCode, setProductCode] = useState('')
  const [correctsBatchId, setCorrectsBatchId] = useState('')
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null)

  const { data, isLoading, error } = useBordereauxBatches()
  const rows: BatchRow[] = data?.items ?? []
  const generateMutation = useGenerateBordereauxMutation()

  const onGenerate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await generateMutation.mutateAsync({
        bordereauType,
        periodStart,
        periodEnd,
        productCode: productCode || undefined,
        correctsBatchId: correctsBatchId || undefined,
      })
      setPeriodStart(''); setPeriodEnd(''); setProductCode(''); setCorrectsBatchId('')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || generateMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Bordereaux</h2></div>
      </div>
      {errorMessage && <p className="error">{errorMessage}</p>}
      <form onSubmit={onGenerate} className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="col">
          <label>
            Type
            <select value={bordereauType} onChange={e => setBordereauType(e.target.value)}>
              {BORDEREAU_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <div className="col"><label>Period Start<input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} /></label></div>
        <div className="col"><label>Period End<input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} /></label></div>
        <div className="col"><label>Product Code<input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="optional" /></label></div>
        <div className="col"><label>Corrects Batch ID<input value={correctsBatchId} onChange={e => setCorrectsBatchId(e.target.value)} placeholder="optional" /></label></div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !periodStart || !periodEnd}>
            Generate
          </button>
        </div>
      </form>
      <div className="ps-table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Type</th><th>Status</th><th>Period</th><th>Product</th><th>Rows</th><th>Valid</th><th>Invalid</th><th>Generated</th><th></th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && <tr><td colSpan={9} className="muted">No bordereaux batches generated yet</td></tr>}
            {rows.map(row => (
              <BatchRowView
                key={row.batch_id}
                row={row}
                expanded={expandedBatchId === row.batch_id}
                onToggle={() => setExpandedBatchId(expandedBatchId === row.batch_id ? null : row.batch_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BatchRowView({ row, expanded, onToggle }: { row: BatchRow; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td>{row.bordereau_type}</td>
        <td>{row.status}</td>
        <td>{row.period_start} &ndash; {row.period_end}</td>
        <td>{row.product_code || <span className="muted">All</span>}</td>
        <td>{row.row_count}</td>
        <td>{row.valid_row_count}</td>
        <td>{row.invalid_row_count > 0 ? <span className="error">{row.invalid_row_count}</span> : 0}</td>
        <td>{new Date(row.generated_at).toLocaleString()}</td>
        <td><button className="btn-secondary" onClick={onToggle}>{expanded ? 'Hide rows' : 'View rows'}</button></td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9}>
            <BatchRowsTable batchId={row.batch_id} />
          </td>
        </tr>
      )}
    </>
  )
}

function BatchRowsTable({ batchId }: { batchId: string }) {
  const { data, isLoading } = useBordereauxRows(batchId)
  const items = data?.items ?? []
  if (isLoading) return <p className="muted">Loading rows...</p>
  if (items.length === 0) return <p className="muted">No rows in this batch</p>
  return (
    <table className="table">
      <thead><tr><th>#</th><th>Policy</th><th>Valid</th><th>Errors</th><th>Data</th></tr></thead>
      <tbody>
        {items.map((r: any) => (
          <tr key={r.rowNumber}>
            <td>{r.rowNumber}</td>
            <td>{r.policyNumber || <span className="muted">-</span>}</td>
            <td>{r.isValid ? 'Yes' : 'No'}</td>
            <td>{r.validationErrors?.length ? r.validationErrors.join('; ') : <span className="muted">-</span>}</td>
            <td><code style={{ fontSize: 12 }}>{JSON.stringify(r.data)}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
