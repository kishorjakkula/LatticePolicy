import { useQuery } from '@tanstack/react-query'
import { api, apiDetails } from '../../api/client'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'

export interface AuditVersionRow {
  versionId: string
  transactionId?: string | null
  transactionNumber?: string | null
  transactionType?: string
  effectiveDate?: string
  policyEffectiveDate?: string
  updatedDate?: string
  updatedUser?: string
  uwDecision?: string | null
  uwOverride?: boolean
  overrideReason?: string | null
  uwSubmittedBy?: string | null
  premium?: {
    total?: { amount: number; currency: string } | null
    fees?: { amount: number; currency: string } | null
    taxes?: { amount: number; currency: string } | null
    calcTrace?: any
  } | null
}

export interface AuditTimelineTransaction {
  transactionId?: string
  status?: string
  jurisdiction?: string
  requestedChanges?: any[]
  metadata?: Record<string, any> | null
  createdAt?: string
  createdBy?: string
  rating?: { total?: { amount: number; currency: string } | null; calcTrace?: any } | null
  forms?: Array<{ policyFormId: string; code?: string | null; name?: string | null; edition?: string | null }>
  documents?: Array<{ documentId: string; type?: string; hash?: string | null; metadata?: any; createdAt?: string }>
  notes?: Array<{ noteId: string; noteType?: string | null; noteText?: string | null; addedBy?: string | null; createdAt?: string }>
}

export interface AuditLedgerEvent {
  eventId: string
  event: string
  fromState?: string | null
  toState?: string | null
  occurredAt?: string
  actor?: string
  payload?: any
}

interface TransactionAuditPanelProps {
  policyId: string
  version: AuditVersionRow
  timelineTransaction: AuditTimelineTransaction | null
  ledgerEvents: AuditLedgerEvent[]
}

function formatCurrency(value?: { amount: number; currency: string } | null): string {
  if (!value || !Number.isFinite(Number(value.amount))) return '-'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: value.currency || 'USD' }).format(Number(value.amount))
  } catch {
    return String(value.amount)
  }
}

function humanizePath(path: string): string {
  return path
    .replace(/^\//, '')
    .replace(/\//g, ' → ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function formatDiffValue(value: any): string {
  if (value === null || value === undefined || value === '') return '(empty)'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function TransactionAuditPanel({ policyId, version, timelineTransaction, ledgerEvents }: TransactionAuditPanelProps) {
  const detailsQuery = useQuery({
    queryKey: ['policy-version-details', policyId, version.versionId],
    queryFn: () => apiDetails.getVersionDetails(policyId, version.versionId),
    enabled: !!policyId && !!version.versionId,
  })

  const diffs: Array<{ path: string; old: any; new: any }> = Array.isArray(detailsQuery.data?.diffs) ? detailsQuery.data.diffs : []
  const forms = timelineTransaction?.forms || []
  const documents = timelineTransaction?.documents || []
  const notes = timelineTransaction?.notes || []
  const reasonNote = notes.find((note) => note.noteType === 'reason' || note.noteType === 'Reason') || notes[0]
  const outOfSequence =
    timelineTransaction?.metadata?.outOfSequence ||
    timelineTransaction?.metadata?.isOutOfSequence ||
    timelineTransaction?.metadata?.rebased ||
    null

  async function handleDownload(documentId: string) {
    try {
      const blob = await api.downloadPolicyDocument(policyId, documentId)
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      // Surface via alert since this panel has no local toast/error state of its own.
      window.alert(err instanceof Error ? err.message : 'Failed to open document')
    }
  }

  return (
    <div className="card stack-card policy-audit-panel" data-testid="transaction-audit-panel">
      <div className="row row-spaced">
        <div className="col">
          <label>Actor</label>
          <div>{version.updatedUser || timelineTransaction?.createdBy || 'system'}</div>
        </div>
        <div className="col">
          <label>Processed (System) Date</label>
          <div>{formatDisplayDateTime(version.updatedDate, { fallback: '-' })}</div>
        </div>
        <div className="col">
          <label>Valid / Effective Date</label>
          <div>{formatDisplayDate(version.policyEffectiveDate || version.effectiveDate, { fallback: '-' })}</div>
        </div>
        <div className="col">
          <label>Status</label>
          <div>{timelineTransaction?.status || '-'}</div>
        </div>
      </div>

      {outOfSequence ? (
        <p className="muted" data-testid="out-of-sequence-flag">
          Out-of-sequence / rebased transaction: {typeof outOfSequence === 'string' ? outOfSequence : 'yes'}
        </p>
      ) : null}

      {reasonNote?.noteText ? (
        <p className="muted">Reason: {reasonNote.noteText}</p>
      ) : null}

      <details className="policy-collapsible" open>
        <summary className="policy-collapsible-summary">Field Changes</summary>
        <div className="policy-collapsible-body">
          {detailsQuery.isLoading ? (
            <p className="muted">Loading changes...</p>
          ) : diffs.length === 0 ? (
            <p className="muted">No field-level changes recorded for this transaction.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Old Value</th>
                  <th>New Value</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((diff) => (
                  <tr key={diff.path}>
                    <td>{humanizePath(diff.path)}</td>
                    <td>{formatDiffValue(diff.old)}</td>
                    <td>{formatDiffValue(diff.new)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      <details className="policy-collapsible">
        <summary className="policy-collapsible-summary">Rating &amp; Underwriting</summary>
        <div className="policy-collapsible-body">
          <div className="row row-spaced">
            <div className="col">
              <label>Premium Total</label>
              <div>{formatCurrency(version.premium?.total)}</div>
            </div>
            <div className="col">
              <label>Fees</label>
              <div>{formatCurrency(version.premium?.fees)}</div>
            </div>
            <div className="col">
              <label>Taxes</label>
              <div>{formatCurrency(version.premium?.taxes)}</div>
            </div>
            <div className="col">
              <label>UW Decision</label>
              <div>
                {version.uwDecision || 'N/A'}
                {version.uwOverride ? ' (Override)' : ''}
              </div>
            </div>
          </div>
          {version.overrideReason ? <p className="muted">Override reason: {version.overrideReason}</p> : null}
          {version.uwSubmittedBy ? <p className="muted">Submitted by: {version.uwSubmittedBy}</p> : null}
          {version.premium?.calcTrace ? (
            <details className="policy-collapsible">
              <summary className="policy-collapsible-summary">Rating calc trace</summary>
              <pre className="policy-collapsible-body">{JSON.stringify(version.premium.calcTrace, null, 2)}</pre>
            </details>
          ) : null}
        </div>
      </details>

      <details className="policy-collapsible">
        <summary className="policy-collapsible-summary">Forms &amp; Documents</summary>
        <div className="policy-collapsible-body">
          {forms.length === 0 && documents.length === 0 ? (
            <p className="muted">No forms or documents generated for this transaction.</p>
          ) : (
            <>
              {forms.length > 0 ? (
                <ul>
                  {forms.map((form) => (
                    <li key={form.policyFormId}>
                      {form.code || form.name || form.policyFormId}
                      {form.edition ? ` (${form.edition})` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {documents.length > 0 ? (
                <ul>
                  {documents.map((doc) => (
                    <li key={doc.documentId}>
                      {doc.type || 'Document'}
                      {doc.metadata?.customerSafe ? ' — customer-safe' : ' — internal'}
                      {' '}
                      <button type="button" className="table-link-button" onClick={() => handleDownload(doc.documentId)}>
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </details>

      <details className="policy-collapsible">
        <summary className="policy-collapsible-summary">Ledger Events</summary>
        <div className="policy-collapsible-body">
          {ledgerEvents.length === 0 ? (
            <p className="muted">No ledger events recorded for this transaction.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Occurred</th>
                  <th>Actor</th>
                </tr>
              </thead>
              <tbody>
                {ledgerEvents.map((event) => (
                  <tr key={event.eventId}>
                    <td>{event.event}</td>
                    <td>{event.fromState || '-'}</td>
                    <td>{event.toState || '-'}</td>
                    <td>{formatDisplayDateTime(event.occurredAt, { fallback: '-' })}</td>
                    <td>{event.actor || 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </div>
  )
}
