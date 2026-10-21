import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiAuditApi, type ActorKind, type AiAuditEntry, type AiAuditFilter } from '../../api/ai-audit.api'
import { tenantId } from '../../api/request'
import { RadioGroup } from '../../components/RadioGroup'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { Pagination } from '../../components/Pagination'
import { formatDisplayDateTime } from '../../shared/dateDisplay'
import './ai-audit.css'
import './ai-audit-phase3.css'

const ACTORS: Record<ActorKind, { label: string; description: string }> = {
  ai: { label: 'AI', description: 'Read documents and drafted values' },
  automation: { label: 'Automation', description: 'Release pipeline registered candidates' },
  person: { label: 'Person', description: 'Confirmed, approved, declined, granted' },
  system: { label: 'System', description: 'Records created after a person approved' },
}
const ACTION_LABELS: Record<string, string> = {
  drafted: 'Drafted values from documents',
  reading_failed: 'Could not read documents',
  reading_requested: 'Asked the AI to read documents',
  received: 'Uploaded a submission',
  value_confirmed: 'Confirmed a drafted value',
  value_edited: 'Corrected a drafted value',
  value_unconfirmed: 'Took back a confirmation',
  high_confidence_confirmed: 'Confirmed all high-confidence values',
  manual_review_started: 'Started manual review',
  customer_choice: 'Chose the customer',
  approved: 'Approved the submission',
  declined: 'Declined the submission',
  quote_created: 'Created the draft quote',
  customer_created: 'Created the customer',
  customer_linked: 'Linked the existing customer',
  CANDIDATE_READY: 'Registered an evaluated model candidate',
  'start-validation': 'Authorized a lower-environment test',
  'record-validation': 'Recorded the lower-environment test',
  'authorize-production': 'Authorized production',
  'renew-authorization': 'Renewed an authorization',
  reject: 'Rejected a release',
  revoke: 'Revoked a release',
  ROLE_GRANTED: 'Granted a governance role',
  ROLE_REVOKED: 'Removed a governance role',
  GOVERNANCE_ACCOUNT_DISABLED: 'Disabled a governance account',
  CREDENTIAL_ISSUED: 'Issued an automation credential',
  CREDENTIAL_REVOKED: 'Revoked an automation credential',
  POLICY_CHANGED: 'Changed release gates',
  REVOCATION_LIST_ISSUED: 'Issued the signed revocation list',
  AUDIT_EXPORTED: 'Exported the audit trail',
}
const actionLabel = (action: string) => ACTION_LABELS[action] || action.replace(/[_-]/g, ' ').toLowerCase()

function detailSummary(entry: AiAuditEntry) {
  const d = entry.detail as Record<string, any>
  if (entry.action === 'drafted') {
    const modelName = entry.model ?? d.processing?.model
    const model = modelName ? ` · model ${modelName}` : ''
    const release = d.processing?.releaseId ? ` · release ${String(d.processing.releaseId).slice(0, 8)}` : ''
    return `${d.drafted ?? 0} of ${d.fields ?? 0} fields drafted, ${d.needsAttention ?? 0} need attention${model}${release}`
  }
  if (entry.action === 'value_edited' || entry.action === 'value_confirmed') return d.field ? `Field ${d.field}` : ''
  if (entry.action === 'approved') return `${d.values ?? 0} values, ${d.changedFromAi ?? 0} changed from the AI draft`
  if (d.role) return `Role ${d.role}`
  if (d.reason) return String(d.reason)
  if (d.status) return `Status ${String(d.status).toLowerCase().replace(/_/g, ' ')}`
  return ''
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function AuditDetailPanel({ children, onClose, returnFocus }: { children: ReactNode; onClose: () => void; returnFocus: HTMLElement | null }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const trigger = returnFocus
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); return }
      if (event.key !== 'Tab') return
      const buttons = panel.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
      if (!buttons?.length) return
      // The read-only panel has one focusable control, its Close button.
      event.preventDefault()
      buttons[0].focus()
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      trigger?.focus()
    }
  }, [])
  return (
    <div className="ai-audit__detail-overlay">
      <div ref={panel} tabIndex={-1} className="ai-audit__detail-panel" role="dialog" aria-modal="true" aria-labelledby="ai-audit-entry-title">
        <header><h3 id="ai-audit-entry-title">Entry Details</h3><button type="button" className="btn-secondary" onClick={onClose}>Close</button></header>
        {children}
      </div>
    </div>
  )
}

export function AiAuditPage() {
  const [filter, setFilter] = useState<AiAuditFilter>({ source: 'all', actorKind: 'all' })
  const [offset, setOffset] = useState(0)
  const changeFilter = (next: AiAuditFilter) => { setOffset(0); setFilter(next) }
  const [search, setSearch] = useState('')
  const [model, setModel] = useState('')
  const [user, setUser] = useState('')
  const [selected, setSelected] = useState<AiAuditEntry | null>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const [error, setError] = useState('')
  const trail = useQuery({
    queryKey: ['ai-audit', tenantId(), { ...filter, offset, limit: 25 }],
    queryFn: () => aiAuditApi.list({ ...filter, offset, limit: 25 }),
  })
  const integrity = useQuery({
    queryKey: ['ai-audit-integrity', tenantId()],
    queryFn: () => aiAuditApi.integrity(),
  })
  const chains = integrity.data ? [integrity.data.intake, integrity.data.releases] : []
  const intact = chains.length > 0 && chains.every((chain) => chain.intact)
  useEffect(() => {
    if (trail.data && offset > 0 && offset >= trail.data.total) {
      setOffset(Math.max(0, Math.ceil(trail.data.total / 25) - 1) * 25)
    }
  }, [trail.data, offset])

  return (
    <div className="ps-admin-page ai-audit">
      <div inert={!!selected}>
      <div className="ps-page-header">
        <h2 className="ps-page-title">AI Audit Trail</h2>
        <div className="ai-audit__actions">
          <button type="button" className="btn-secondary" onClick={() => void integrity.refetch()}>
            Verify Integrity
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              void aiAuditApi
                .exportCsv(filter)
                .then((csv) => downloadText(csv, `ai-audit-${new Date().toISOString().slice(0, 10)}.csv`))
                .catch((cause) => setError(cause instanceof Error ? cause.message : 'Export failed'))
            }
          >
            Export CSV
          </button>
        </div>
      </div>
      {(error || trail.error) && <p role="alert">{error || String(trail.error)}</p>}
      {trail.error && <button type="button" className="btn-secondary" onClick={() => void trail.refetch()}>Retry</button>}

      <div className={`ai-audit__integrity ${integrity.data ? (intact ? 'is-intact' : 'is-broken') : ''}`} role="status">
        {integrity.isPending && 'Checking the audit chain…'}
        {integrity.error && 'Integrity check unavailable.'}
        {integrity.data &&
          (intact
            ? `Audit chain intact · ${integrity.data.intake.entries + integrity.data.releases.entries} entries verified ${formatDisplayDateTime(integrity.data.checkedAt, { includeTime: true })}`
            : `Audit chain broken${integrity.data.intake.intact ? '' : ` · submission intake at entry ${integrity.data.intake.firstBrokenEntry}`}${integrity.data.releases.intact ? '' : ` · model releases at entry ${integrity.data.releases.firstBrokenEntry}`}. Escalate to security.`)}
      </div>

      <div className="ai-audit__cards">
        {(Object.keys(ACTORS) as ActorKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`ai-audit__card ai-audit__card--${kind}${filter.actorKind === kind ? ' is-selected' : ''}`}
            aria-pressed={filter.actorKind === kind}
            onClick={() => changeFilter({ ...filter, actorKind: filter.actorKind === kind ? 'all' : kind })}
          >
            <span className="ai-audit__card-count">{trail.data?.counts[kind] ?? '—'}</span>
            <span className="ai-audit__card-label">{ACTORS[kind].label}</span>
            <span className="ai-audit__card-description">{ACTORS[kind].description}</span>
          </button>
        ))}
      </div>

      <CollapsibleSection title="Filters" className="card">
        <form
          className="ai-audit__filters"
          onSubmit={(event) => {
            event.preventDefault()
            changeFilter({ ...filter, search: search.trim() || undefined, model: model.trim() || undefined, user: user.trim() || undefined })
          }}
        >
          <div>
            <span className="ai-audit__filter-label" id="ai-audit-source">Area</span>
            <RadioGroup
              name="ai-audit-source"
              labelledBy="ai-audit-source"
              value={filter.source}
              onChange={(source) => changeFilter({ ...filter, source })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'intake', label: 'Submission intake' },
                { value: 'releases', label: 'Model releases' },
              ] as const}
            />
          </div>
          <div>
            <span className="ai-audit__filter-label" id="ai-audit-actor">Who acted</span>
            <RadioGroup
              name="ai-audit-actor"
              labelledBy="ai-audit-actor"
              value={filter.actorKind}
              onChange={(actorKind) => changeFilter({ ...filter, actorKind })}
              options={[
                { value: 'all', label: 'Everyone' },
                { value: 'ai', label: 'AI' },
                { value: 'automation', label: 'Automation' },
                { value: 'person', label: 'Person' },
                { value: 'system', label: 'System' },
              ] as const}
            />
          </div>
          <label>
            From
            <input
              type="date"
              aria-label="From"
              onChange={(event) =>
                changeFilter({ ...filter, from: event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : undefined })
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              aria-label="To"
              onChange={(event) =>
                changeFilter({ ...filter, to: event.target.value ? new Date(`${event.target.value}T23:59:59.999`).toISOString() : undefined })
              }
            />
          </label>
          <label>Model<input aria-label="Model" maxLength={240} value={model} onChange={(event) => setModel(event.target.value)} /></label>
          <label>User<input aria-label="User" maxLength={120} value={user} onChange={(event) => setUser(event.target.value)} /></label>
          <label>
            Search
            <input
              aria-label="Search"
              placeholder="Action, submission, release, person"
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <button type="submit" className="btn-secondary">
            Apply
          </button>
        </form>
      </CollapsibleSection>

      <CollapsibleSection title="Activity" className="card" style={{ marginTop: 16 }}>
        {trail.isPending && <p role="status">Loading audit trail…</p>}
        {trail.data && !trail.data.items.length && <p>No activity matches these filters.</p>}
        {!!trail.data?.items.length && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-no-sticky-head ai-audit__table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who acted</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {trail.data.items.map((entry) => (
                  <tr
                    key={`${entry.source}-${entry.eventId}`}
                    className={selected?.eventId === entry.eventId ? 'is-selected' : ''}
                  >
                    <td>{formatDisplayDateTime(entry.createdAt, { includeTime: true })}</td>
                    <td>
                      <span className={`ai-audit__badge ai-audit__badge--${entry.actorKind}`}>{ACTORS[entry.actorKind].label}</span>{' '}
                      <span className="ai-audit__actor">{entry.actor || 'LatticePolicy'}</span>
                    </td>
                    <td>{actionLabel(entry.action)}</td>
                    <td>
                      <span className="ai-audit__source">{entry.source === 'intake' ? 'Submission' : 'Model release'}</span>{' '}
                      {entry.subject || '—'}
                    </td>
                    <td>
                      <button type="button" className="ai-audit__detail-link" onClick={(event) => { detailTrigger.current = event.currentTarget; setSelected(entry) }}>
                        {detailSummary(entry) || 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {trail.data && <Pagination page={offset / 25 + 1} pageSize={25} totalItems={trail.data.total} onPageChange={(page) => setOffset((page - 1) * 25)} />}
      </CollapsibleSection>
      </div>

      {selected && (
        <AuditDetailPanel onClose={() => setSelected(null)} returnFocus={detailTrigger.current}>
          <dl className="ai-audit__entry">
            <dt>Who acted</dt>
            <dd>
              {ACTORS[selected.actorKind].label} · {selected.actor || 'LatticePolicy'}
              {selected.actorRoles.length ? ` (roles at the time: ${selected.actorRoles.join(', ')})` : ''}
            </dd>
            <dt>Action</dt>
            <dd>{actionLabel(selected.action)}</dd>
            <dt>When</dt>
            <dd>{formatDisplayDateTime(selected.createdAt, { includeTime: true })}</dd>
            <dt>Record</dt><dd>{selected.subject || 'Not recorded'}</dd>
            <dt>Model</dt><dd>{selected.model || 'Not recorded'}</dd>
            <dt>Model provenance</dt><dd><pre>{selected.modelProvenance ? JSON.stringify(selected.modelProvenance, null, 2) : 'Not recorded'}</pre></dd>
            <dt>Source</dt><dd>{selected.source}</dd>
            <dt>Event ID</dt><dd>{selected.eventId}</dd>
            <dt>Chain sequence</dt><dd>{selected.chainSeq}</dd>
            <dt>Request</dt>
            <dd>{selected.requestId || '—'}</dd>
            <dt>Entry hash</dt>
            <dd className="ai-audit__hash">{selected.entryHash}</dd>
            <dt>Recorded detail</dt>
            <dd>
              <pre>{JSON.stringify(selected.detail, null, 2)}</pre>
            </dd>
          </dl>
        </AuditDetailPanel>
      )}
    </div>
  )
}
