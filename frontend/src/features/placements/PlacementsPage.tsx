import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { usePlacements, useCreatePlacementMutation, useTransitionPlacementStatusMutation } from '../../api/hooks'

const STATUS_BADGE: Record<string, string> = {
  Submission: 'gray',
  Indication: 'yellow',
  Quoted: 'yellow',
  BindOrder: 'yellow',
  Bound: 'green',
  Issued: 'green',
  Declined: 'red',
  Withdrawn: 'gray',
}

const NEXT_STATUS: Record<string, string[]> = {
  Submission: ['Indication', 'Declined', 'Withdrawn'],
  Indication: ['Quoted', 'Declined', 'Withdrawn'],
  Quoted: ['BindOrder', 'Declined', 'Withdrawn'],
  BindOrder: ['Bound', 'Declined', 'Withdrawn'],
  Bound: ['Issued'],
  Issued: [],
  Declined: [],
  Withdrawn: [],
}

export function PlacementsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [pageSize] = useState(20)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [showCreate, setShowCreate] = useState(false)
  const [insuredName, setInsuredName] = useState('')
  const [productCode, setProductCode] = useState('')

  const canManage = hasPermission(user, 'placement.manage')
  const { data, isLoading, error } = usePlacements(page, pageSize, statusFilter || undefined)
  const items = data?.items ?? []
  const total = data?.total ?? 0

  const createMutation = useCreatePlacementMutation()
  const transitionMutation = useTransitionPlacementStatusMutation()

  const onCreate = async () => {
    if (!insuredName.trim()) return
    try {
      await createMutation.mutateAsync({ insuredName: insuredName.trim(), productCode: productCode.trim() || undefined })
      setInsuredName('')
      setProductCode('')
      setShowCreate(false)
    } catch (e: any) {
      alert(e.message || String(e))
    }
  }

  const onTransition = async (placementId: string, toStatus: string) => {
    const reason = toStatus === 'Declined' || toStatus === 'Withdrawn' ? window.prompt('Reason:') || '' : ''
    try {
      await transitionMutation.mutateAsync({ placementId, toStatus, reason: reason || undefined })
    } catch (e: any) {
      alert(e.message || String(e))
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="ps-page-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">Placements</span>
      </nav>
      <div className="ps-page-header">
        <div>
          <h1 className="ps-page-title">Large Commercial Placements</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            Multi-market subscription placements outside the standard single-carrier quote flow
          </p>
        </div>
        <div className="ps-page-header-actions">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            style={{ width: 'auto', height: 32, minHeight: 32, fontSize: 13 }}
          >
            <option value="">All</option>
            <option value="Submission">Submission</option>
            <option value="Indication">Indication</option>
            <option value="Quoted">Quoted</option>
            <option value="BindOrder">Bind Order</option>
            <option value="Bound">Bound</option>
            <option value="Issued">Issued</option>
          </select>
          {canManage && (
            <ActionButton variant="success" onClick={() => setShowCreate((v) => !v)}>+ New Placement</ActionButton>
          )}
        </div>
      </div>

      {showCreate && canManage && (
        <div className="ps-table-card" style={{ padding: 12, display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
          <input placeholder="Insured name" value={insuredName} onChange={(e) => setInsuredName(e.target.value)} style={{ flex: 1 }} />
          <input placeholder="Product code (optional)" value={productCode} onChange={(e) => setProductCode(e.target.value)} style={{ width: 200 }} />
          <ActionButton variant="success" size="sm" onClick={onCreate} disabled={!insuredName.trim() || createMutation.isPending}>
            Create
          </ActionButton>
        </div>
      )}

      {error && <p className="error">{String(error)}</p>}
      {isLoading ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <div className="ps-table-card">
            <table className="table">
              <thead>
                <tr><th>Insured</th><th>Product</th><th>Facility Ref</th><th>Effective</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: '24px' }}>No placements found</td></tr>
                )}
                {items.map((p: any) => (
                  <tr key={p.placementId}>
                    <td>{p.insuredName}</td>
                    <td>{p.productCode || '-'}</td>
                    <td className="muted">{p.facilityReference || '-'}</td>
                    <td>{formatDisplayDate(p.effectiveDate, { fallback: '-' })}</td>
                    <td><span className={`badge ${STATUS_BADGE[p.status] || 'gray'}`}>{p.status}</span></td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canManage && (NEXT_STATUS[p.status] || []).map((next) => (
                        <ActionButton key={next} variant="secondary" size="sm" onClick={() => onTransition(p.placementId, next)}>
                          {next}
                        </ActionButton>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ps-pagination-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="muted" style={{ fontSize: 13 }}>Total: {total}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <ActionButton variant="secondary" size="sm" onClick={() => { if (page > 1) setPage(page - 1) }} disabled={page <= 1}>← Prev</ActionButton>
              <span className="muted" style={{ fontSize: 13 }}>Page {page} / {totalPages}</span>
              <ActionButton variant="secondary" size="sm" onClick={() => { if (page < totalPages) setPage(page + 1) }} disabled={page >= totalPages}>Next →</ActionButton>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
