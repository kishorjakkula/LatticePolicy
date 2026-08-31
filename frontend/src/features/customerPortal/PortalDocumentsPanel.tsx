import { formatDisplayDate } from '../../shared/dateDisplay'
import { usePolicyDocuments } from '../../api/hooks'
import { api } from '../../api/client'

interface PortalDocumentsPanelProps {
  policyId: string
}

function openBlobInNewTab(blob: Blob) {
  const url = URL.createObjectURL(blob)
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

export function PortalDocumentsPanel({ policyId }: PortalDocumentsPanelProps) {
  const { data, isLoading, error } = usePolicyDocuments(policyId)
  // Backend already filters to customer-safe documents for portal callers
  // (customer.portal.read permission); no additional client-side filtering
  // is needed or should be relied upon for safety here.
  const documents = Array.isArray(data?.documents) ? data.documents : []

  return (
    <section
      className="policy-section-card stack-card customer-portal-section"
      style={{ marginTop: 12 }}
      data-testid="portal-documents-panel"
    >
      <div className="panel-header">
        <h3>Documents</h3>
      </div>

      {isLoading && <div className="muted">Loading documents...</div>}
      {!isLoading && error && <div className="error">{String(error)}</div>}

      {!isLoading && !error && (
        <div className="ps-table-card">
          <table className="table">
            <thead>
              <tr>
                <th data-mobile-label="Document">Document</th>
                <th data-mobile-label="Type">Type</th>
                <th data-mobile-label="Generated">Generated</th>
                <th data-mobile-label="Action" />
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No documents are available for this policy yet.
                  </td>
                </tr>
              )}
              {documents.map((doc: any) => (
                <tr key={doc.documentId}>
                  <td>{doc.displayName || doc.type || 'Document'}</td>
                  <td>{doc.type || '-'}</td>
                  <td>{formatDisplayDate(doc.generatedAt, { fallback: '-' })}</td>
                  <td>
                    <button
                      type="button"
                      className="table-link-button"
                      onClick={() => { void handleOpen(policyId, doc.documentId) }}
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
    </section>
  )
}
