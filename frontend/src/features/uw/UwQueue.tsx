import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { useUwReferrals, useDecideReferralMutation } from '../../api/hooks'

const STATUS_BADGE: Record<string, string> = {
  Open: 'yellow',
  InfoRequested: 'yellow',
  Approved: 'green',
  Declined: 'red',
  Withdrawn: 'gray',
}

export function UwQueue() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<string>('Open')
  const navigate = useNavigate()
  const canDecide = hasPermission(user, 'uw.referrals.decide')

  const { data, isLoading, error } = useUwReferrals(page, pageSize, statusFilter || undefined)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const decideMutation = useDecideReferralMutation()

  const onDecide = async (v: any, decision: 'Approved' | 'Declined' | 'InfoRequested') => {
    const reason = window.prompt(
      decision === 'Approved' ? 'Approval reason (required):' : 'Decision note:'
    ) || ''
    if (decision === 'Approved' && !reason.trim()) return
    try {
      await decideMutation.mutateAsync({ referralId: v.referralId, decision, reason })
    } catch (e: any) {
      alert(e.message || String(e))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const canPrev = page > 1
  const canNext = page < totalPages

  return (
    <div className="ps-page-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">UW Referrals</span>
      </nav>
      <div className="ps-page-header">
        <div>
          <h1 className="ps-page-title">UW Referrals</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Items requiring underwriter approval</p>
        </div>
        <div className="ps-page-header-actions">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            style={{ width: 'auto', height: 32, minHeight: 32, fontSize: 13 }}
          >
            <option value="Open">Open</option>
            <option value="InfoRequested">Info Requested</option>
            <option value="Approved">Approved</option>
            <option value="Declined">Declined</option>
            <option value="">All</option>
          </select>
          <ActionButton variant="success" onClick={() => navigate('/wizard')}>+ New Quote</ActionButton>
        </div>
      </div>
      {error && <p className="error">{String(error)}</p>}
      {isLoading ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <div className="ps-table-card">
            <table className="table">
              <thead>
                <tr><th>Policy #</th><th>Product</th><th>Txn</th><th>Eff</th><th>Reasons</th><th>Status</th><th>Assigned</th><th></th></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No referrals found</td></tr>}
                {items.map((v: any) => (
                  <tr key={v.referralId}>
                    <td>{v.policyNumber || <span className="muted">Pre-bind (quote)</span>}</td>
                    <td>{v.productCode || '-'}</td>
                    <td>{v.transactionType}</td>
                    <td>{formatDisplayDate(v.effectiveDate, { fallback: '-' })}</td>
                    <td className="muted" style={{ maxWidth: 260 }}>{(v.reasons || []).join('; ') || '-'}</td>
                    <td><span className={`badge ${STATUS_BADGE[v.status] || 'gray'}`}>{v.status}</span></td>
                    <td className="muted">{v.assignedTo || '-'}</td>
                    <td style={{ display:'flex', gap: 6 }}>
                      {v.policyId && (
                        <ActionButton variant="secondary" size="sm" onClick={() => navigate(`/policies/${v.policyId}`)}>Open</ActionButton>
                      )}
                      {(v.status === 'Open' || v.status === 'InfoRequested') && (
                        <>
                          <ActionButton variant="success" size="sm" onClick={() => onDecide(v, 'Approved')} disabled={!canDecide}>Approve</ActionButton>
                          <ActionButton variant="secondary" size="sm" onClick={() => onDecide(v, 'Declined')} disabled={!canDecide}>Decline</ActionButton>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ps-pagination-footer" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div className="muted" style={{ fontSize: 13 }}>Total: {total}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ActionButton variant="secondary" size="sm" onClick={() => { if (canPrev) setPage(page-1) }} disabled={!canPrev}>← Prev</ActionButton>
              <span className="muted" style={{ fontSize: 13 }}>Page {page} / {totalPages}</span>
              <ActionButton variant="secondary" size="sm" onClick={() => { if (canNext) setPage(page+1) }} disabled={!canNext}>Next →</ActionButton>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }} style={{ width: 'auto', height: 32, minHeight: 32, fontSize: 13 }}>
                <option value={10}>10 / page</option>
                <option value={20}>20 / page</option>
                <option value={50}>50 / page</option>
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
