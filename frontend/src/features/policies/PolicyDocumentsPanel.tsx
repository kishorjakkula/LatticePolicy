import { formatDisplayDateTime } from '../../shared/dateDisplay'
import { usePolicyDocuments } from '../../api/hooks'
import { api } from '../../api/client'

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
}

function integrityBadgeColor(status?: string): string {
  const normalized = String(status || '').trim().toUpperCase()
  if (normalized === 'VERIFIED') return 'green'
  if (normalized === 'FAILED') return 'red'
  return 'yellow' // UNVERIFIED, or any other/unknown status
}

function openBlobInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob)
  // The blob retains the Content-Type the server sent (e.g. application/pdf
  // or text/html), so the browser renders it appropriately in the new tab —
  // no need to branch on content type here.
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

async function handleOpen(policyId: string, documentId: string) {
  try {
    const blob = await api.downloadPolicyDocument(policyId, documentId)
    openBlobInNewTab(blob)
  } catch (err) {
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
    <div className="card policy-section-card policy-documents-card" data-testid="policy-documents-panel">
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
                  <td>{doc.type || '-'}</td>
                  <td className="id-mono">{doc.transactionNumber || '-'}</td>
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
                      onClick={() => {
                        void handleOpen(policyId, doc.documentId)
                      }}
                    >
                      Open
                    </button>
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
