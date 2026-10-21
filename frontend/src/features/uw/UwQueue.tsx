import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { Pagination } from '../../components/Pagination'
import { useToast } from '../../components/Toast'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { useAssignReferralMutation, useUnderwriters, useUwReferrals } from '../../api/hooks'
import type { UwReferral, UwReferralSort } from '../../api/uw.api'
import { productLabel } from '../../shared/displayLabels'
import {
  REFERRAL_STATUS_BADGE,
  assigneeLabel,
  insuredDisplay,
  isDecidable,
  premiumLabel,
  reasonLabel,
  referralAge,
  referralErrorMessage,
  referralStatusLabel,
} from './referralDisplay'
import './uw.css'

const STATUS_OPTIONS = [
  { value: 'Open', label: 'Open' },
  { value: 'InfoRequested', label: 'Info requested' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Declined', label: 'Declined' },
  { value: '', label: 'All' },
]

/** Mirrors the server default: an Open queue is worked oldest first. */
function defaultSortFor(status: string): UwReferralSort {
  return status === 'Open' ? 'oldest' : 'newest'
}

/**
 * Underwriting referral queue (WP-0004 REQ-1, REQ-17): a triage list only.
 * Decisions are made from the referral detail view, which shows the reasons
 * first and asks for a reason; rows offer "Open" and "Assign to me".
 */
export function UwQueue() {
  const { user } = useAuth()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<string>('Open')
  const [sort, setSort] = useState<UwReferralSort>('oldest')
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const canDecide = hasPermission(user, 'uw.referrals.decide')
  const currentUserId = user?.id ? String(user.id) : null

  const { data, isLoading, error } = useUwReferrals(page, pageSize, statusFilter || undefined, sort)
  const items: UwReferral[] = data?.items ?? []
  const total = Number(data?.total ?? 0)
  const assignMutation = useAssignReferralMutation()
  const underwriters = useUnderwriters()
  const underwriterNames = useMemo(() => {
    const names = new Map<string, string>()
    for (const item of (underwriters.data as any)?.items ?? []) {
      if (item?.userId) names.set(String(item.userId), String(item.displayName || item.username || ''))
    }
    return names
  }, [underwriters.data])

  const onStatusChange = (status: string) => {
    setStatusFilter(status)
    setSort(defaultSortFor(status))
    setPage(1)
  }

  const assignToMe = async (referral: UwReferral) => {
    if (!currentUserId) return
    setAssigningId(referral.referralId)
    try {
      await assignMutation.mutateAsync({ referralId: referral.referralId, assignedTo: currentUserId })
      toast.success('Referral assigned to you', insuredDisplay(referral))
    } catch (e) {
      toast.error('Could not assign the referral', referralErrorMessage(e))
    } finally {
      setAssigningId(null)
    }
  }

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
          <p className="muted uw-subtitle">Quotes and transactions waiting for an underwriting decision</p>
        </div>
        <div className="ps-page-header-actions uw-queue-filters">
          <label className="uw-inline-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => onStatusChange(e.target.value)}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="uw-inline-field">
            <span>Sort</span>
            <select value={sort} onChange={(e) => { setSort(e.target.value as UwReferralSort); setPage(1) }}>
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
        </div>
      </div>
      {error && <p className="error" role="alert">{referralErrorMessage(error)}</p>}
      {isLoading ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <CollapsibleSection title="Referral list" className="ps-table-card">
            <div className="uw-table-scroll">
              <table className="table uw-referral-table">
                <thead>
                  <tr>
                    <th scope="col" aria-sort={sort === 'oldest' ? 'descending' : 'ascending'}>Age</th>
                    <th scope="col">Insured</th>
                    <th scope="col">Product</th>
                    <th scope="col" className="uw-num">Premium</th>
                    <th scope="col">Reasons</th>
                    <th scope="col">Status</th>
                    <th scope="col">Assigned</th>
                    <th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted uw-empty">
                        {statusFilter === 'Open' ? 'No open referrals. Referred quotes appear here.' : 'No referrals found'}
                      </td>
                    </tr>
                  )}
                  {items.map((referral) => {
                    const reasons = (referral.reasons || []).map(reasonLabel)
                    const insured = insuredDisplay(referral)
                    const mine = !!currentUserId && referral.assignedTo === currentUserId
                    return (
                      <tr key={referral.referralId} data-referral-id={referral.referralId}>
                        <td title={referral.createdAt || undefined}>{referralAge(referral.createdAt)}</td>
                        <td className="uw-truncate" title={insured}>{insured}</td>
                        <td>{productLabel(referral.productCode)}</td>
                        <td className="uw-num">{premiumLabel(referral.premium)}</td>
                        <td className="muted uw-reasons">{reasons.join('; ') || '-'}</td>
                        <td>
                          <span className={`badge ${REFERRAL_STATUS_BADGE[referral.status] || 'gray'}`}>
                            {referralStatusLabel(referral.status)}
                          </span>
                        </td>
                        <td>
                          <div className="uw-assignee">
                            <span className={referral.assignedTo ? undefined : 'muted'}>
                              {assigneeLabel(referral.assignedTo, currentUserId, underwriterNames)}
                            </span>
                            {canDecide && currentUserId && !mine && isDecidable(referral) && (
                              <ActionButton
                                variant="ghost"
                                size="sm"
                                onClick={() => void assignToMe(referral)}
                                disabled={assigningId === referral.referralId}
                              >
                                {assigningId === referral.referralId ? 'Assigning…' : 'Assign to me'}
                              </ActionButton>
                            )}
                          </div>
                        </td>
                        <td>
                          <Link
                            to={`/uw/queue/${encodeURIComponent(referral.referralId)}`}
                            className="action-btn action-btn--secondary action-btn--sm"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CollapsibleSection>
          <Pagination
            page={page}
            pageSize={pageSize}
            totalItems={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
            pageSizeOptions={[10, 20, 50]}
            showRange
          />
        </>
      )}
    </div>
  )
}
