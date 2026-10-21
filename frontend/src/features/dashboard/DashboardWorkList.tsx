import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { apiSubmissions } from '../../api/submissions.api'
import { REVIEW_SUBMISSION_STATUS } from '../../components/useWorkCounts'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { productLabel } from '../../shared/displayLabels'
import { useAuth } from '../../auth/AuthContext'
import { loadPagedRows, type DashboardPolicy } from './dashboardModel'

export function DashboardWorkList({ kind, renewals, policiesAvailable }: {
  kind: 'submissions' | 'renewals'; renewals: DashboardPolicy[]; policiesAvailable: boolean
}) {
  const { user } = useAuth()
  const submissions = useQuery({
    queryKey: ['dashboard', 'review-list', user?.tenantId, user?.id],
    queryFn: () => loadPagedRows((page, size) => apiSubmissions.list(REVIEW_SUBMISSION_STATUS, page, size)),
    enabled: kind === 'submissions',
    staleTime: 60_000,
    retry: false,
  })
  const unavailable = kind === 'submissions' ? submissions.isError : !policiesAvailable
  return (
    <CollapsibleSection as="section" className="policy-section-card dashboard-section-card" aria-label="Filtered work" title={kind === 'submissions' ? 'Submissions ready for review' : 'Renewals due in the next 30 days'}>
      <Link to="/dashboard">Back to dashboard</Link>
      {unavailable ? <p role="alert">Work list unavailable. Refresh to retry.</p> : kind === 'submissions' ? (
        submissions.isPending ? <p role="status">Loading submissions...</p> : <ul className="dashboard-work-list">
          {submissions.data?.map((row) => <li key={row.submissionId}><Link to={`/submissions/${encodeURIComponent(row.submissionId)}`}>{row.insuredName || row.submissionNumber}</Link><span>{productLabel(row.productCode || '')}</span></li>)}
          {submissions.data?.length === 0 && <li>No submissions ready for review.</li>}
        </ul>
      ) : <ul className="dashboard-work-list">
        {renewals.map((row) => <li key={row.policyId}><Link to={`/policies/${encodeURIComponent(row.policyId)}`}>{row.policyNumber || row.policyId}</Link><span>{productLabel(row.productCode || '')} · Expires {formatDisplayDate(row.term?.expirationDate)}</span></li>)}
        {renewals.length === 0 && <li>No renewals due in the next 30 days.</li>}
      </ul>}
    </CollapsibleSection>
  )
}
