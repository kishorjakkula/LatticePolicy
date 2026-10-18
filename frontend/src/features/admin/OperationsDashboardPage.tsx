import { useState } from 'react'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { Link } from 'react-router-dom'
import {
  useDashboardSummary,
  useDashboardOutbox,
  useDashboardNotifications,
  useOfacScreens,
  useUwReferrals,
  usePolicyIntegrityExceptions,
  useCoverageIntegrity,
  useUpdatePolicyIntegrityExceptionMutation,
  useRetryPolicyIntegrityExceptionMutation,
} from '../../api/hooks'
import { adminApi } from '../../api/admin.api'

type OutboxRow = {
  message_id: string
  source_table: string
  source_id: string
  topic: string
  status: string
  attempts: number
  max_attempts: number
  last_error: string | null
  next_attempt_at: string
  created_at: string
}

type NotificationRow = {
  notification_id: string
  policy_id: string | null
  transaction_id: string | null
  event_type: string
  channel: string
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}

const SEVERITY_COLORS: Record<'danger' | 'warning' | 'neutral', string> = {
  danger: '#c0392b',
  warning: '#b7791f',
  neutral: 'inherit',
}

function severityFor(status: string): 'danger' | 'warning' | 'neutral' {
  if (status === 'Failed' || status === 'DeadLettered' || status === 'BLOCKED' || status === 'Urgent' || status === 'Critical' || status === 'Error') return 'danger'
  if (status === 'Retry' || status === 'ESCALATED' || status === 'Suppressed' || status === 'High') return 'warning'
  return 'neutral'
}

function Severity({ status }: { status: string }) {
  const level = severityFor(status)
  return <span style={{ color: SEVERITY_COLORS[level], fontWeight: level === 'neutral' ? 400 : 600 }}>{status}</span>
}

export function OperationsDashboardPage() {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useDashboardSummary()

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Operations Dashboard</h2></div>
      </div>

      {summaryError && <p className="error">{String(summaryError)}</p>}
      {!summaryLoading && summary && (
        <div className="row" style={{ marginBottom: 20, gap: 12 }}>
          <SummaryCard label="Outbox Pending/Retry" value={(summary.outbox?.Pending || 0) + (summary.outbox?.Retry || 0)} />
          <SummaryCard label="Outbox Failed" value={summary.outbox?.Failed || 0} danger />
          <SummaryCard label="OFAC Pending Review" value={(summary.ofac?.PENDING || 0) + (summary.ofac?.ESCALATED || 0)} danger={!!summary.ofac?.ESCALATED} />
          <SummaryCard label="UW Referrals Open" value={summary.referrals?.Open || 0} />
          <SummaryCard label="Notifications Failed" value={summary.notifications?.Failed || 0} danger />
          <SummaryCard label="Notifications Suppressed" value={summary.notifications?.Suppressed || 0} />
          <SummaryCard label="Policy Integrity Open" value={(summary.integrity?.Open || 0) + (summary.integrity?.Acknowledged || 0)} danger={!!summary.integrity?.Open} />
        </div>
      )}

      <PolicyIntegrityPanel />
      <CoverageIntegrityPanel />
      <OutboxPanel />
      <NotificationsPanel />
      <OfacPanel />
      <ReferralsPanel />
    </div>
  )
}

function PolicyIntegrityPanel() {
  const { data, isLoading, error } = usePolicyIntegrityExceptions()
  const update = useUpdatePolicyIntegrityExceptionMutation()
  const retry = useRetryPolicyIntegrityExceptionMutation()
  const rows = data?.items ?? []

  const exportCsv = async () => {
    const blob = await adminApi.exportPolicyIntegrityExceptions()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'policy-integrity-exceptions.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <PanelShell title="Policy Integrity Exceptions" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="No unresolved policy integrity exceptions.">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="button secondary" type="button" onClick={() => void exportCsv()}>Export CSV</button>
      </div>
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Policy</th><th>Exception</th><th>Severity</th><th>Status</th><th>Detected</th><th>Actions</th></tr></thead>
          <tbody>{rows.map((row: any) => (
            <tr key={row.exception_id}>
              <td><Link to={`/policies/${row.policy_id}`}>{row.policy_number || row.policy_id.slice(0, 8)}</Link></td>
              <td><strong>{String(row.exception_class).replace(/_/g, ' ')}</strong><div className="muted">{row.summary}</div></td>
              <td><Severity status={row.severity} /></td>
              <td><Severity status={row.status} /></td>
              <td>{new Date(row.last_detected_at).toLocaleString()}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="button secondary" type="button" disabled={retry.isPending} onClick={() => retry.mutate(row.exception_id)}>Retry</button>
                  {row.status === 'Open' && <button className="button secondary" type="button" disabled={update.isPending} onClick={() => update.mutate({ id: row.exception_id, status: 'Acknowledged' })}>Acknowledge</button>}
                  <button className="button secondary" type="button" disabled={update.isPending} onClick={() => update.mutate({ id: row.exception_id, status: 'Resolved', note: 'Resolved by operator' })}>Resolve</button>
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </PanelShell>
  )
}

/** Records whose coverages are not offered by their product (WP-0002). Report only. */
export function CoverageIntegrityPanel() {
  const { data, isLoading, error } = useCoverageIntegrity()
  const rows = data?.items || []
  return (
    <PanelShell title="Coverage Integrity" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="All quotes and policies carry only coverages their product offers.">
      <p className="muted">Records whose coverages are not offered by their product. Report only; nothing is changed.</p>
      {data?.truncated && <p className="muted">Showing the 500 most recent of {data.total}.</p>}
      <div className="ps-table-card" style={{ overflowX: 'auto' }}>
        <table className="table table-no-sticky-head">
          <thead><tr><th>Record</th><th>Number</th><th>Product</th><th>Status</th><th>Unexpected coverages</th><th>Date</th></tr></thead>
          <tbody>{rows.map((row) => (
            <tr key={`${row.kind}-${row.id}`}>
              <td>{row.kind === 'policy' ? 'Policy' : 'Quote'}</td>
              <td>
                <Link to={row.kind === 'policy' ? `/policies/${row.id}` : `/wizard?quoteId=${row.id}`}>{row.number || row.id.slice(0, 8)}</Link>
              </td>
              <td>{row.productCode}</td>
              <td>{row.status || '—'}</td>
              <td>{row.note ? <span className="muted">{row.note}</span> : row.unexpectedCodes.join(', ')}</td>
              <td>{row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </PanelShell>
  )
}

function SummaryCard({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="ps-table-card" style={{ padding: 12, minWidth: 160 }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: danger && value > 0 ? 'var(--color-danger, #c0392b)' : undefined }}>
        {value}
      </div>
    </div>
  )
}

function PanelShell({ title, isLoading, error, empty, emptyMessage, children }: {
  title: string
  isLoading: boolean
  error: unknown
  empty: boolean
  emptyMessage: string
  children: React.ReactNode
}) {
  return (
    <CollapsibleSection as="section" style={{ marginBottom: 24 }}>
      <h3>{title}</h3>
      {error ? (
        <p className="error">{String(error)}</p>
      ) : isLoading ? (
        <p className="muted">Loading…</p>
      ) : empty ? (
        <p className="muted">{emptyMessage}</p>
      ) : (
        children
      )}
    </CollapsibleSection>
  )
}

function OutboxPanel() {
  const { data, isLoading, error } = useDashboardOutbox()
  const rows: OutboxRow[] = data?.items ?? []

  return (
    <PanelShell title="Outbox Delivery Failures" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="No pending or failed outbox messages.">
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Topic</th><th>Source</th><th>Status</th><th>Attempts</th><th>Next Attempt</th><th>Last Error</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.message_id}>
                <td>{row.topic}</td>
                <td>{row.source_table}:{row.source_id.slice(0, 8)}</td>
                <td><Severity status={row.status} /></td>
                <td>{row.attempts}/{row.max_attempts}</td>
                <td>{new Date(row.next_attempt_at).toLocaleString()}</td>
                <td>{row.last_error || <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}

function NotificationsPanel() {
  const { data, isLoading, error } = useDashboardNotifications()
  const rows: NotificationRow[] = data?.items ?? []

  return (
    <PanelShell title="Notification Failures" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="No failed or suppressed notifications.">
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Event</th><th>Channel</th><th>Status</th><th>Policy</th><th>Attempts</th><th>Last Error</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.notification_id}>
                <td>{row.event_type}</td>
                <td>{row.channel}</td>
                <td><Severity status={row.status} /></td>
                <td>{row.policy_id ? <Link to={`/policies/${row.policy_id}`}>Open</Link> : <span className="muted">-</span>}</td>
                <td>{row.attempts}</td>
                <td>{row.last_error || <span className="muted">-</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PanelShell>
  )
}

function OfacPanel() {
  const { data, isLoading, error } = useOfacScreens()
  const rows = data?.items ?? []

  return (
    <PanelShell title="OFAC Review Queue" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="No pending OFAC reviews.">
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Party</th><th>Result</th><th>Disposition</th><th>Policy</th><th>Screened</th></tr></thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.screen_id}>
                <td>{row.party_name}</td>
                <td>{row.result}</td>
                <td><Severity status={row.disposition} /></td>
                <td>{row.policy_id ? <Link to={`/policies/${row.policy_id}`}>Open</Link> : <span className="muted">-</span>}</td>
                <td>{new Date(row.screen_date).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Manage dispositions from the Compliance admin page.</p>
    </PanelShell>
  )
}

function ReferralsPanel() {
  const [page] = useState(1)
  const { data, isLoading, error } = useUwReferrals(page, 20, 'Open')
  const rows = data?.items ?? []

  return (
    <PanelShell title="Open Underwriting Referrals" isLoading={isLoading} error={error} empty={rows.length === 0} emptyMessage="No open underwriting referrals.">
      <div className="ps-table-card">
        <table className="table">
          <thead><tr><th>Policy</th><th>Type</th><th>Priority</th><th>Reasons</th><th>Assigned</th></tr></thead>
          <tbody>
            {rows.map((row: any) => (
              <tr key={row.referral_id}>
                <td>{row.policy_id ? <Link to={`/policies/${row.policy_id}`}>{row.policyNumber || 'Open'}</Link> : <span className="muted">-</span>}</td>
                <td>{row.transaction_type}</td>
                <td><Severity status={row.priority} /></td>
                <td>{(row.reasons || []).join(', ') || <span className="muted">-</span>}</td>
                <td>{row.assigned_to || <span className="muted">Unassigned</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>Assign and decide referrals from the UW Queue page.</p>
    </PanelShell>
  )
}
