import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import {
  useAddReferralCommentMutation,
  useAssignReferralMutation,
  useDecideReferralMutation,
  useUwReferrals,
} from '../../api/hooks'
import { productLabel, statusLabel } from '../../shared/displayLabels'

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
  const [selectedReferral, setSelectedReferral] = useState<any | null>(null)
  const [assignedTo, setAssignedTo] = useState('')
  const [commentText, setCommentText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const navigate = useNavigate()
  const canDecide = hasPermission(user, 'uw.referrals.decide')

  const { data, isLoading, error } = useUwReferrals(page, pageSize, statusFilter || undefined)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const decideMutation = useDecideReferralMutation()
  const assignMutation = useAssignReferralMutation()
  const commentMutation = useAddReferralCommentMutation()

  const openReferral = (referral: any) => {
    setSelectedReferral(referral)
    setAssignedTo(referral.assignedTo || '')
    setCommentText('')
    setActionError(null)
  }

  const onAssign = async (event: FormEvent) => {
    event.preventDefault()
    const nextAssignee = assignedTo.trim()
    if (!selectedReferral || !nextAssignee) return
    setActionError(null)
    try {
      const updated = await assignMutation.mutateAsync({
        referralId: selectedReferral.referralId,
        assignedTo: nextAssignee,
      })
      setSelectedReferral((current: any) => ({ ...current, ...updated }))
    } catch (e: any) {
      setActionError(e.message || String(e))
    }
  }

  const onAddComment = async (event: FormEvent) => {
    event.preventDefault()
    const text = commentText.trim()
    if (!selectedReferral || !text) return
    setActionError(null)
    try {
      const updated = await commentMutation.mutateAsync({
        referralId: selectedReferral.referralId,
        text,
      })
      setSelectedReferral((current: any) => ({ ...current, ...updated }))
      setCommentText('')
    } catch (e: any) {
      setActionError(e.message || String(e))
    }
  }

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
                <tr><th>Policy #</th><th>Product</th><th>Transaction</th><th>Effective Date</th><th>Reasons</th><th>Status</th><th>Assigned To</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {items.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No referrals found</td></tr>}
                {items.map((v: any) => (
                  <tr key={v.referralId}>
                    <td>{v.policyNumber || <span className="muted">Pre-bind (quote)</span>}</td>
                    <td>{productLabel(v.productCode)}</td>
                    <td>{statusLabel(v.transactionType)}</td>
                    <td>{formatDisplayDate(v.effectiveDate, { fallback: '-' })}</td>
                    <td className="muted" style={{ maxWidth: 260 }}>{(v.reasons || []).join('; ') || '-'}</td>
                    <td><span className={`badge ${STATUS_BADGE[v.status] || 'gray'}`}>{v.status}</span></td>
                    <td className="muted">{v.assignedTo || '-'}</td>
                    <td style={{ display:'flex', gap: 6 }}>
                      <ActionButton variant="secondary" size="sm" onClick={() => openReferral(v)}>Review</ActionButton>
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
          {selectedReferral && (
            <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="referral-review-title">
              <div className="modal-panel">
                <div className="modal-header">
                  <div>
                    <h2 id="referral-review-title">Referral review</h2>
                    <div className="muted" style={{ fontSize: 13 }}>
                      {selectedReferral.policyNumber || 'Pre-bind quote'} · {selectedReferral.productCode || 'Unknown product'}
                    </div>
                  </div>
                  <ActionButton variant="secondary" size="sm" onClick={() => setSelectedReferral(null)}>Close</ActionButton>
                </div>

                {actionError && <p className="error" role="alert">{actionError}</p>}

                <form onSubmit={onAssign} style={{ marginBottom: 20 }}>
                  <label htmlFor="referral-assignee">Assignee user UUID</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
                    <input
                      id="referral-assignee"
                      value={assignedTo}
                      onChange={(event) => setAssignedTo(event.target.value)}
                      placeholder="Enter a user UUID"
                      pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
                      title="Enter a valid user UUID"
                      disabled={!canDecide || assignMutation.isPending}
                    />
                    <ActionButton
                      type="submit"
                      size="sm"
                      disabled={!canDecide || !assignedTo.trim() || assignMutation.isPending}
                    >
                      {assignMutation.isPending ? 'Assigning…' : 'Assign'}
                    </ActionButton>
                  </div>
                </form>

                <section aria-labelledby="referral-comments-title">
                  <h3 id="referral-comments-title">Comments</h3>
                  {(selectedReferral.comments || []).length === 0 ? (
                    <p className="muted">No comments yet.</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                      {(selectedReferral.comments || []).map((comment: any, index: number) => (
                        <div key={`${comment.at || 'comment'}-${index}`} style={{ borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                          <div style={{ fontSize: 13 }}>{comment.text}</div>
                          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                            {comment.by || 'Unknown user'}{comment.at ? ` · ${formatDisplayDate(comment.at, { fallback: '' })}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <form onSubmit={onAddComment}>
                    <label htmlFor="referral-comment">Add comment</label>
                    <textarea
                      id="referral-comment"
                      rows={3}
                      value={commentText}
                      onChange={(event) => setCommentText(event.target.value)}
                      placeholder="Add underwriting context"
                      disabled={commentMutation.isPending}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <ActionButton type="submit" size="sm" disabled={!commentText.trim() || commentMutation.isPending}>
                        {commentMutation.isPending ? 'Adding…' : 'Add comment'}
                      </ActionButton>
                    </div>
                  </form>
                </section>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
