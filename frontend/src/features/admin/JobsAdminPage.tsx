import { useState } from 'react'
import { useJobDefinitions, useJobRuns, useJobRun, useRetryJobRunMutation } from '../../api/hooks'

type JobDefinitionRow = {
  job_code: string
  description: string | null
  enabled: boolean
  default_schedule: string | null
  default_max_attempts: number
  default_timeout_seconds: number
  created_at: string
  updated_at: string
}

type JobRunRow = {
  run_id: string
  job_code: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  next_attempt_at: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
}

const RUN_STATUSES = ['Queued', 'Running', 'Succeeded', 'Retry', 'DeadLettered', 'Cancelled']

const SEVERITY_COLORS: Record<'danger' | 'warning' | 'success' | 'neutral', string> = {
  danger: '#c0392b',
  warning: '#b7791f',
  success: '#2e7d32',
  neutral: 'inherit',
}

function severityFor(status: string): 'danger' | 'warning' | 'success' | 'neutral' {
  if (status === 'DeadLettered' || status === 'Cancelled') return 'danger'
  if (status === 'Retry') return 'warning'
  if (status === 'Succeeded') return 'success'
  return 'neutral'
}

function Severity({ status }: { status: string }) {
  const level = severityFor(status)
  return <span style={{ color: SEVERITY_COLORS[level], fontWeight: level === 'neutral' ? 400 : 600 }}>{status}</span>
}

export function JobsAdminPage() {
  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Job Queue</h2></div>
      </div>
      <DefinitionsPanel />
      <RunsPanel />
    </div>
  )
}

function DefinitionsPanel() {
  const { data, isLoading, error } = useJobDefinitions()
  const rows: JobDefinitionRow[] = data?.items ?? []

  return (
    <section style={{ marginBottom: 24 }}>
      <h3>Job Definitions</h3>
      {error ? (
        <p className="error">{String(error)}</p>
      ) : isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No job definitions registered.</p>
      ) : (
        <div className="ps-table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Job Code</th><th>Description</th><th>Enabled</th><th>Schedule</th><th>Max Attempts</th><th>Timeout (s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.job_code}>
                  <td>{row.job_code}</td>
                  <td>{row.description || <span className="muted">-</span>}</td>
                  <td>{row.enabled ? 'Yes' : 'No'}</td>
                  <td>{row.default_schedule || <span className="muted">-</span>}</td>
                  <td>{row.default_max_attempts}</td>
                  <td>{row.default_timeout_seconds}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function RunsPanel() {
  const [jobCode, setJobCode] = useState('')
  const [status, setStatus] = useState('')
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)

  const { data: defsData } = useJobDefinitions()
  const jobCodes: string[] = (defsData?.items ?? []).map((d: JobDefinitionRow) => d.job_code)

  const { data, isLoading, error } = useJobRuns({
    jobCode: jobCode || undefined,
    status: status || undefined,
    limit: 100,
  })
  const rows: JobRunRow[] = data?.items ?? []
  const retryMutation = useRetryJobRunMutation()

  const onRetry = async (row: JobRunRow) => {
    setRetryError(null)
    try {
      await retryMutation.mutateAsync(row.run_id)
    } catch (err: any) {
      setRetryError(err.message || String(err))
    }
  }

  return (
    <section>
      <h3>Run History</h3>
      <div className="row" style={{ marginBottom: 12, gap: 12 }}>
        <div className="col">
          <label>Job Code</label>
          <select value={jobCode} onChange={(e) => setJobCode(e.target.value)}>
            <option value="">All</option>
            {jobCodes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </div>
        <div className="col">
          <label>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {RUN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {retryError && <p className="error">{retryError}</p>}
      {error ? (
        <p className="error">{String(error)}</p>
      ) : isLoading ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted">No job runs match the current filters.</p>
      ) : (
        <div className="ps-table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Job Code</th><th>Status</th><th>Attempts</th><th>Last Error</th><th>Created</th><th>Finished</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.run_id}>
                  <td>{row.job_code}</td>
                  <td><Severity status={row.status} /></td>
                  <td>{row.attempts}/{row.max_attempts}</td>
                  <td>{row.last_error || <span className="muted">-</span>}</td>
                  <td>{new Date(row.created_at).toLocaleString()}</td>
                  <td>{row.finished_at ? new Date(row.finished_at).toLocaleString() : <span className="muted">-</span>}</td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" onClick={() => setSelectedRunId(row.run_id)}>View</button>
                    {row.status === 'DeadLettered' && (
                      <button className="btn-secondary" disabled={retryMutation.isPending} onClick={() => onRetry(row)}>
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

      {selectedRunId && <RunDetail runId={selectedRunId} onClose={() => setSelectedRunId(null)} />}
    </section>
  )
}

function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data, isLoading, error } = useJobRun(runId)

  return (
    <div className="ps-table-card" style={{ marginTop: 16, padding: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h4 style={{ margin: 0 }}>Run Detail — {runId}</h4>
        <button className="btn-secondary" onClick={onClose}>Close</button>
      </div>
      {error ? (
        <p className="error">{String(error)}</p>
      ) : isLoading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {data?.run?.last_error && (
            <p className="error" style={{ marginTop: 12 }}>{data.run.last_error}</p>
          )}
          <table className="table" style={{ marginTop: 12 }}>
            <thead><tr><th>Event</th><th>Message</th><th>Time</th></tr></thead>
            <tbody>
              {(data?.events ?? []).length === 0 && <tr><td colSpan={3} className="muted">No events recorded</td></tr>}
              {(data?.events ?? []).map((event: any) => (
                <tr key={event.event_id}>
                  <td>{event.event_type}</td>
                  <td>{event.message || <span className="muted">-</span>}</td>
                  <td>{new Date(event.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
