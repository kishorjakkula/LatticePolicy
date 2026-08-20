import { FormEvent, useState } from 'react'
import {
  useImportBatches,
  useImportRows,
  useStageImportBatchMutation,
  useValidateImportBatchMutation,
  useCommitImportBatchMutation,
  useRetryImportRowMutation,
} from '../../api/hooks'

type ImportBatchRow = {
  batchId: string
  entityType: string
  sourceSystem: string
  status: string
  rowCount: number
  validCount: number
  invalidCount: number
  committedCount: number
  failedCount: number
  createdAt: string
}

type ImportRowRow = {
  rowId: string
  rowNumber: number
  externalId: string | null
  status: string
  validationErrors: string[]
  committedEntityId: string | null
  errorMessage: string | null
}

const SAMPLE_PAYLOAD = `[
  {
    "payload": {
      "entityType": "INDIVIDUAL",
      "identity": { "person": { "firstName": "Jane", "lastName": "Doe", "dob": "1985-05-15" } },
      "contactPoints": [{ "contactType": "EMAIL", "value": "jane.doe@example.com" }],
      "externalIdentifiers": [{ "sourceSystem": "LEGACY_AMS", "externalId": "CUST-0001" }]
    }
  }
]`

export function DataImportPage() {
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const [sourceSystem, setSourceSystem] = useState('')
  const [rowsJson, setRowsJson] = useState(SAMPLE_PAYLOAD)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: batches, isLoading: batchesLoading } = useImportBatches()
  const { data: rows } = useImportRows(selectedBatchId)
  const stageMutation = useStageImportBatchMutation()
  const validateMutation = useValidateImportBatchMutation()
  const commitMutation = useCommitImportBatchMutation()
  const retryMutation = useRetryImportRowMutation()

  const batchRows: ImportBatchRow[] = batches ?? []
  const rowList: ImportRowRow[] = rows ?? []

  const onStage = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    let parsedRows: any[]
    try {
      parsedRows = JSON.parse(rowsJson)
      if (!Array.isArray(parsedRows)) throw new Error('rows must be a JSON array')
    } catch (err: any) {
      setFormError(`Invalid rows JSON: ${err.message || err}`)
      return
    }
    try {
      const batch = await stageMutation.mutateAsync({
        entityType: 'customer',
        sourceSystem,
        rows: parsedRows,
      })
      setSelectedBatchId(batch.batchId)
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onValidate = async (batchId: string) => {
    setFormError(null)
    try {
      await validateMutation.mutateAsync(batchId)
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onCommit = async (batchId: string) => {
    setFormError(null)
    try {
      await commitMutation.mutateAsync(batchId)
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onRetry = async (batchId: string, rowId: string) => {
    setFormError(null)
    try {
      await retryMutation.mutateAsync({ batchId, rowId })
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading =
    batchesLoading || stageMutation.isPending || validateMutation.isPending || commitMutation.isPending || retryMutation.isPending
  const errorMessage = formError

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Data Import</h2></div>
      </div>
      <p className="muted">
        Stage a batch of legacy records, validate before commit, and review/retry failed rows. Only the
        <code> customer</code> entity type has a commit handler in this slice; other entity types can be
        staged and validated for review, but committing them is a documented follow-up.
      </p>
      {errorMessage && <p className="error">{errorMessage}</p>}

      <form onSubmit={onStage} className="row" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="col">
          <label>Source System</label>
          <input value={sourceSystem} onChange={e => setSourceSystem(e.target.value)} placeholder="LEGACY_AMS" />
        </div>
        <div className="col" style={{ flex: 2 }}>
          <label>Rows (JSON array)</label>
          <textarea
            value={rowsJson}
            onChange={e => setRowsJson(e.target.value)}
            rows={8}
            style={{ width: '100%', fontFamily: 'monospace' }}
          />
        </div>
        <div className="col" style={{ alignSelf: 'end' }}>
          <button type="submit" disabled={loading || !sourceSystem}>Stage Batch</button>
        </div>
      </form>

      <div className="ps-table-card" style={{ marginBottom: 16 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Entity</th><th>Source</th><th>Status</th><th>Rows</th><th>Valid</th><th>Invalid</th>
              <th>Committed</th><th>Failed</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batchRows.length === 0 && <tr><td colSpan={9} className="muted">No import batches</td></tr>}
            {batchRows.map(batch => (
              <tr key={batch.batchId} style={{ background: selectedBatchId === batch.batchId ? 'var(--surface-hover, #f5f5f5)' : undefined }}>
                <td>{batch.entityType}</td>
                <td>{batch.sourceSystem}</td>
                <td>{batch.status}</td>
                <td>{batch.rowCount}</td>
                <td>{batch.validCount}</td>
                <td>{batch.invalidCount}</td>
                <td>{batch.committedCount}</td>
                <td>{batch.failedCount}</td>
                <td style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={() => setSelectedBatchId(batch.batchId)}>Review</button>
                  <button className="btn-secondary" disabled={loading} onClick={() => onValidate(batch.batchId)}>Validate</button>
                  <button
                    className="btn-primary"
                    disabled={loading || !['Validated', 'PartiallyCommitted'].includes(batch.status)}
                    onClick={() => onCommit(batch.batchId)}
                  >
                    Commit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedBatchId && (
        <div className="ps-table-card">
          <h3>Rows for batch {selectedBatchId}</h3>
          <table className="table">
            <thead><tr><th>#</th><th>External ID</th><th>Status</th><th>Errors</th><th>Committed Entity</th><th>Actions</th></tr></thead>
            <tbody>
              {rowList.length === 0 && <tr><td colSpan={6} className="muted">No rows</td></tr>}
              {rowList.map(row => (
                <tr key={row.rowId}>
                  <td>{row.rowNumber}</td>
                  <td>{row.externalId || <span className="muted">-</span>}</td>
                  <td>{row.status}</td>
                  <td>
                    {row.validationErrors?.length ? row.validationErrors.join('; ') : row.errorMessage || <span className="muted">-</span>}
                  </td>
                  <td>{row.committedEntityId || <span className="muted">-</span>}</td>
                  <td>
                    {row.status === 'Failed' && (
                      <button className="btn-secondary" disabled={loading} onClick={() => onRetry(selectedBatchId, row.rowId)}>
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
