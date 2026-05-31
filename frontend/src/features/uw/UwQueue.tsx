import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { useUwReferrals, useApproveReferralMutation, useDeclineReferralMutation } from '../../api/hooks'

export function UwQueue() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const navigate = useNavigate()
  const canDecide = hasPermission(user, 'uw.referrals.decide')

  const { data, isLoading, error } = useUwReferrals(page, pageSize)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const approveMutation = useApproveReferralMutation()
  const declineMutation = useDeclineReferralMutation()

  const onApprove = async (v: any) => {
    const reason = window.prompt('Override reason (required):') || ''
    if (!reason.trim()) return
    try { await approveMutation.mutateAsync({ versionId: v.versionId, reason }) } catch (e: any) { alert(e.message || String(e)) }
  }
  const onDecline = async (v: any) => {
    const reason = window.prompt('Decline note (optional):') || ''
    try { await declineMutation.mutateAsync({ versionId: v.versionId, reason }) } catch (e: any) { alert(e.message || String(e)) }
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
                <tr><th>Policy #</th><th>Product</th><th>Version</th><th>Eff</th><th>Processed</th><th>Txn</th><th>Submitted By</th><th>UW</th><th></th></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No referrals pending</td></tr>}
                {items.map((v: any) => (
                  <tr key={v.versionId}>
                    <td>{v.policyNumber}</td>
                    <td>{v.productCode}</td>
                    <td className="muted">{v.versionId.slice(0,8)}</td>
                    <td>{formatDisplayDate(v.effectiveDate, { fallback: '-' })}</td>
                    <td>{formatDisplayDate(v.processedDate, { fallback: '-' })}</td>
                    <td>{v.transactionType}</td>
                    <td>{v.submittedBy || '-'}</td>
                    <td><span className="badge yellow">Refer</span></td>
                    <td style={{ display:'flex', gap: 6 }}>
                      <ActionButton variant="secondary" size="sm" onClick={() => navigate(`/policies/${v.policyId}`)}>Open</ActionButton>
                      <ActionButton variant="success" size="sm" onClick={() => onApprove(v)} disabled={!canDecide}>Approve</ActionButton>
                      <ActionButton variant="secondary" size="sm" onClick={() => onDecline(v)} disabled={!canDecide}>Decline</ActionButton>
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
