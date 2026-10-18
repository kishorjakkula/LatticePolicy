import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { aiAuditApi, type ActorKind, type AiAuditEntry, type AiAuditFilter } from '../../api/ai-audit.api'
import { tenantId } from '../../api/request'
import { RadioGroup } from '../../components/RadioGroup'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import './ai-audit.css'

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
    const model = d.processing?.model ? ` · model ${d.processing.model}` : ''
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

export function AiAuditPage() {
  const [filter, setFilter] = useState<AiAuditFilter>({ source: 'all', actor: 'all' })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AiAuditEntry | null>(null)
  const [error, setError] = useState('')
  const trail = useQuery({
    queryKey: ['ai-audit', tenantId(), filter],
    queryFn: () => aiAuditApi.list(filter),
  })
  const integrity = useQuery({
    queryKey: ['ai-audit-integrity', tenantId()],
    queryFn: () => aiAuditApi.integrity(),
  })
  const chains = integrity.data ? [integrity.data.intake, integrity.data.releases] : []
  const intact = chains.length > 0 && chains.every((chain) => chain.intact)

  return (
    <div className="ps-admin-page ai-audit">
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
                .exportCsv({ ...filter, search: search || undefined })
                .then((csv) => downloadText(csv, `ai-audit-${new Date().toISOString().slice(0, 10)}.csv`))
                .catch((cause) => setError(cause instanceof Error ? cause.message : 'Export failed'))
            }
          >
            Export CSV
          </button>
        </div>
      </div>
      <p className="ai-audit__lede">
        Every action on AI-drafted submissions and private model releases, separated by who acted. The AI and release
        automation can only draft and register; confirming, approving, and authorizing are always a person&apos;s
        action, and the database refuses anything else. Entries cannot be changed or deleted.
      </p>
      {(error || trail.error) && <p role="alert">{error || String(trail.error)}</p>}

      <div className={`ai-audit__integrity ${integrity.data ? (intact ? 'is-intact' : 'is-broken') : ''}`} role="status">
        {integrity.isPending && 'Checking the audit chain…'}
        {integrity.error && 'Integrity check unavailable.'}
        {integrity.data &&
          (intact
            ? `Audit chain intact · ${integrity.data.intake.entries + integrity.data.releases.entries} entries verified ${new Date(integrity.data.checkedAt).toLocaleString()}`
            : `Audit chain broken${integrity.data.intake.intact ? '' : ` · submission intake at entry ${integrity.data.intake.firstBrokenEntry}`}${integrity.data.releases.intact ? '' : ` · model releases at entry ${integrity.data.releases.firstBrokenEntry}`}. Escalate to security.`)}
      </div>

      <div className="ai-audit__cards">
        {(Object.keys(ACTORS) as ActorKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className={`ai-audit__card ai-audit__card--${kind}${filter.actor === kind ? ' is-selected' : ''}`}
            aria-pressed={filter.actor === kind}
            onClick={() => setFilter({ ...filter, actor: filter.actor === kind ? 'all' : kind })}
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
            setFilter({ ...filter, search: search.trim() || undefined })
          }}
        >
          <div>
            <span className="ai-audit__filter-label" id="ai-audit-source">Area</span>
            <RadioGroup
              name="ai-audit-source"
              labelledBy="ai-audit-source"
              value={filter.source}
              onChange={(source) => setFilter({ ...filter, source })}
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
              value={filter.actor}
              onChange={(actor) => setFilter({ ...filter, actor })}
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
                setFilter({ ...filter, from: event.target.value ? new Date(`${event.target.value}T00:00:00`).toISOString() : undefined })
              }
            />
          </label>
          <label>
            To
            <input
              type="date"
              aria-label="To"
              onChange={(event) =>
                setFilter({ ...filter, to: event.target.value ? new Date(`${event.target.value}T23:59:59.999`).toISOString() : undefined })
              }
            />
          </label>
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
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
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
                      <button type="button" className="ai-audit__detail-link" onClick={() => setSelected(entry)}>
                        {detailSummary(entry) || 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {selected && (
        <CollapsibleSection title="Entry Details" className="card" style={{ marginTop: 16 }}>
          <dl className="ai-audit__entry">
            <dt>Who acted</dt>
            <dd>
              {ACTORS[selected.actorKind].label} · {selected.actor || 'LatticePolicy'}
              {selected.actorRoles.length ? ` (roles at the time: ${selected.actorRoles.join(', ')})` : ''}
            </dd>
            <dt>Action</dt>
            <dd>{actionLabel(selected.action)}</dd>
            <dt>When</dt>
            <dd>{new Date(selected.createdAt).toISOString()}</dd>
            <dt>Request</dt>
            <dd>{selected.requestId || '—'}</dd>
            <dt>Entry hash</dt>
            <dd className="ai-audit__hash">{selected.entryHash}</dd>
            <dt>Recorded detail</dt>
            <dd>
              <pre>{JSON.stringify(selected.detail, null, 2)}</pre>
            </dd>
          </dl>
          <button type="button" className="btn-secondary" onClick={() => setSelected(null)}>
            Close
          </button>
        </CollapsibleSection>
      )}
    </div>
  )
}
