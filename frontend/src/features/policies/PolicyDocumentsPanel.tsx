import { formatDisplayDateTime } from '../../shared/dateDisplay'
import { usePolicyDocuments } from '../../api/hooks'
import { api } from '../../api/client'
import { archivedOutputFormat, canOpenArchivedDocument } from '../../api/policies.api'
import { CollapsibleSection } from '../../components/CollapsibleSection'

interface PolicyDocumentsPanelProps {
  policyId: string
}

type PolicyDocument = {
  documentId: string
  type?: string
  displayName?: string
  transactionNumber?: string | null
  integrityStatus?: string
  generatedAt?: string
  status?: string
  available?: boolean
  contentType?: string
  byteSize?: number
  versionId?: string
  transactionId?: string
}

function integrityBadgeColor(status?: string): string {
  const normalized = String(status || '').trim().toUpperCase()
  if (normalized === 'VERIFIED') return 'green'
  if (normalized === 'FAILED') return 'red'
  return 'yellow' // UNVERIFIED, or any other/unknown status
}

async function handleOpen(policyId: string, doc: PolicyDocument) {
  if (!canOpenArchivedDocument(doc)) return
  const format = archivedOutputFormat(doc.contentType)
  const native = format === 'DOCX' || format === 'XLSX'
  // Reserve the tab during the click; opening only after a fetch can be blocked.
  const tab = native ? null : window.open('about:blank', '_blank')
  if (tab) tab.opener = null
  try {
    if (!native && !tab) throw new Error('Allow pop-ups to open policy documents.')
    const blob = await api.downloadPolicyDocument(policyId, doc.documentId,
      doc.versionId ? { versionId: doc.versionId, transactionId: doc.transactionId } : undefined)
    const url = URL.createObjectURL(blob)
    if (native) {
      const link = document.createElement('a')
      link.href = url
      link.download = `${doc.documentId}.${format.toLowerCase()}`
      link.click()
    } else if (tab) tab.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 30000)
  } catch (err) {
    tab?.close()
    window.alert(err instanceof Error ? err.message : 'Failed to open document')
  }
}

export function PolicyDocumentsPanel({ policyId }: PolicyDocumentsPanelProps) {
  const { data, isLoading, error } = usePolicyDocuments(policyId)
  // Internal staff viewing this page have page.policy.view, which the
  // GET /policies/:id/documents endpoint already uses to return every
  // generated document for the policy (not just customer-safe ones) — no
  // additional client-side filtering is needed here.
  const documents: PolicyDocument[] = Array.isArray(data?.documents) ? data.documents : []

  return (
    <CollapsibleSection className="card policy-section-card policy-documents-card" data-testid="policy-documents-panel">
      <div className="panel-header">
        <h3>Documents</h3>
      </div>

      {isLoading && <div className="muted">Loading documents...</div>}
      {!isLoading && error && (
        <p className="error">{error instanceof Error ? error.message : String(error)}</p>
      )}

      {!isLoading && !error && (
        <div className="ps-table-card">
          <table className="table">
            <thead>
              <tr>
                <th data-mobile-label="Document">Document</th>
                <th data-mobile-label="Type">Type</th>
                <th data-mobile-label="Transaction #">Transaction #</th>
                <th data-mobile-label="Generated">Generated</th>
                <th data-mobile-label="Integrity">Integrity</th>
                <th data-mobile-label="Action" />
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No documents have been generated for this policy yet.
                  </td>
                </tr>
              )}
              {documents.map((doc) => (
                <tr key={doc.documentId}>
                  <td>{doc.displayName || doc.type || 'Document'}</td>
                  <td>{doc.type || '-'}<div className="muted">{archivedOutputFormat(doc.contentType)}</div></td>
                  <td className="id-mono">{doc.transactionNumber || '-'}{doc.versionId && <div className="muted">Version {doc.versionId}</div>}</td>
                  <td>{formatDisplayDateTime(doc.generatedAt, { fallback: '-' })}</td>
                  <td>
                    <span className={`badge ${integrityBadgeColor(doc.integrityStatus)}`}>
                      {doc.integrityStatus || 'UNVERIFIED'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="table-link-button"
                      disabled={!canOpenArchivedDocument(doc)}
                      title={canOpenArchivedDocument(doc) ? doc.contentType : 'Archived output unavailable or not verified'}
                      onClick={() => {
                        void handleOpen(policyId, doc)
                      }}
                    >
                      {['DOCX', 'XLSX'].includes(archivedOutputFormat(doc.contentType)) ? 'Download' : 'Open'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsibleSection>
  )
}
