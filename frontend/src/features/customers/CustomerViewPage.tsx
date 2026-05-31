import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { derivePolicyWorkflowStatus, policyStatusBadgeColor } from '../policies/statusModel'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'
import { useCustomer, useCustomerPolicies, useCustomerQuotes, useCustomerAiInsights } from '../../api/hooks'

type PolicySortField =
  | 'policyNumber'
  | 'productCode'
  | 'effectiveDate'
  | 'createdAt'
  | 'updatedAt'
  | 'updatedUser'
  | 'status'

function compareString(left: any, right: any): number {
  const a = String(left || '').trim().toUpperCase()
  const b = String(right || '').trim().toUpperCase()
  if (a === b) return 0
  return a > b ? 1 : -1
}

function compareDate(left: any, right: any): number {
  const a = Number.isFinite(Date.parse(String(left || ''))) ? Date.parse(String(left || '')) : 0
  const b = Number.isFinite(Date.parse(String(right || ''))) ? Date.parse(String(right || '')) : 0
  if (a === b) return 0
  return a > b ? 1 : -1
}

function formatDateTimeMmDdYyyyHm(value: any, fallback = ''): string {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return fallback
  const month = String(dt.getMonth() + 1).padStart(2, '0')
  const day = String(dt.getDate()).padStart(2, '0')
  const year = String(dt.getFullYear())
  const hours = String(dt.getHours()).padStart(2, '0')
  const minutes = String(dt.getMinutes()).padStart(2, '0')
  return `${month}-${day}-${year} ${hours}:${minutes}`
}

function customerStatusColor(status: string): string {
  const normalized = String(status || '').trim().toUpperCase()
  if (normalized === 'ACTIVE') return 'green'
  if (normalized === 'PENDING_APPROVAL') return 'yellow'
  if (normalized === 'MERGED') return 'blue'
  if (normalized === 'ARCHIVED' || normalized === 'INACTIVE') return 'red'
  return 'gray'
}

function customerDisplayName(customer: any): string {
  if (!customer) return '-'
  if (customer.displayName) return String(customer.displayName)
  const person = customer?.identity?.person || {}
  const company = customer?.identity?.company || {}
  const personName = [person.firstName, person.lastName].filter(Boolean).join(' ').trim()
  return personName || company.legalName || customer.customerKey || '-'
}

function preferredContact(customer: any, type: 'EMAIL' | 'PHONE'): string {
  const points = Array.isArray(customer?.contactPoints) ? customer.contactPoints : []
  const typed = points.filter((item: any) => String(item?.contactType || '').toUpperCase() === type)
  if (!typed.length) return '-'
  const preferred = typed.find((item: any) => item?.preferred === true)
  return String(preferred?.value || typed[0]?.value || '-')
}

function formatPct0(value: any): string {
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return `${Math.round(num * 100)}%`
}

function formatUsd(value: any): string {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '-'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount)
}

function CustomerAiInsightsPanel({ insights }: { insights: any }) {
  const scores = insights?.scores || {}
  const summary = insights?.summary || {}
  const alerts = Array.isArray(insights?.alerts) ? insights.alerts : []
  const recommendations = Array.isArray(insights?.recommendations) ? insights.recommendations : []
  const productMix = Array.isArray(insights?.productMix) ? insights.productMix : []
  const suggestedProducts = Array.isArray(insights?.suggestedProducts) ? insights.suggestedProducts : []
  return (
    <>
      <div className="row">
        <div className="col">
          <label>Customer Health Score</label>
          <div>{Math.round(Number(insights?.customerHealthScore || 0))}</div>
        </div>
        <div className="col">
          <label>Retention Risk</label>
          <div>{formatPct0(scores.retentionRisk)}</div>
        </div>
        <div className="col">
          <label>Cross-sell Opportunity</label>
          <div>{formatPct0(scores.crossSellOpportunity)}</div>
        </div>
        <div className="col">
          <label>Service Complexity</label>
          <div>{formatPct0(scores.serviceComplexity)}</div>
        </div>
      </div>
      <div className="row row-spaced">
        <div className="col">
          <label>Estimated Annual Premium</label>
          <div>{formatUsd(summary.estimatedAnnualPremium)}</div>
        </div>
        <div className="col">
          <label>Active Policies</label>
          <div>{Number(summary.activePolicyCount || 0)}</div>
        </div>
        <div className="col">
          <label>Open Quotes</label>
          <div>{Number(summary.openQuoteCount || 0)}</div>
        </div>
        <div className="col">
          <label>Products</label>
          <div>{Number(summary.productCount || 0)}</div>
        </div>
      </div>
      {productMix.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Product Mix</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {productMix.map((item: any) => (
              <span key={String(item.productCode)} className="badge gray">
                {String(item.productCode || '-')} ({Number(item.count || 0)})
              </span>
            ))}
          </div>
        </div>
      )}
      {suggestedProducts.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Suggested Products</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            {suggestedProducts.map((item: any) => (
              <span key={String(item)} className="badge blue">{String(item)}</span>
            ))}
          </div>
        </div>
      )}
      {alerts.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Alerts</div>
          <ul className="dashboard-ai-list">
            {alerts.map((item: string, index: number) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}
      {recommendations.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="muted">Recommendations</div>
          <ul className="dashboard-ai-list">
            {recommendations.map((item: string, index: number) => <li key={index}>{item}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}

export function CustomerViewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [sortBy, setSortBy] = useState<PolicySortField>('effectiveDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const { data: customer, isLoading: customerLoading, error: customerError } = useCustomer(id ?? '')
  const { data: policiesData, isLoading: policiesLoading } = useCustomerPolicies(id ?? '', 500)
  const { data: quotesData, isLoading: quotesLoading } = useCustomerQuotes(id ?? '', 500)
  const { data: aiData, error: customerAiError } = useCustomerAiInsights(id ?? '')

  const loading = customerLoading || policiesLoading || quotesLoading
  const error = customerError ? String(customerError) : null
  const policies: any[] = Array.isArray(policiesData) ? policiesData : []
  const openQuotes: any[] = Array.isArray(quotesData) ? quotesData : []
  const customerAiInsights = aiData?.aiInsights ?? null

  const sortedPolicies = useMemo(() => {
    const rows = Array.isArray(policies) ? [...policies] : []
    const direction = sortDir === 'asc' ? 1 : -1
    rows.sort((left: any, right: any) => {
      let base = 0
      if (sortBy === 'policyNumber') base = compareString(left?.policyNumber, right?.policyNumber)
      else if (sortBy === 'productCode') base = compareString(left?.productCode, right?.productCode)
      else if (sortBy === 'effectiveDate') base = compareDate(left?.effectiveDate, right?.effectiveDate)
      else if (sortBy === 'createdAt') base = compareDate(left?.createdAt, right?.createdAt)
      else if (sortBy === 'updatedAt') base = compareDate(left?.updatedAt, right?.updatedAt)
      else if (sortBy === 'updatedUser') base = compareString(left?.updatedUser, right?.updatedUser)
      else if (sortBy === 'status') {
        const leftStatus = derivePolicyWorkflowStatus(left?.internalStatus || left?.status, {
          effectiveDate: left?.effectiveDate,
          expirationDate: left?.expirationDate
        })
        const rightStatus = derivePolicyWorkflowStatus(right?.internalStatus || right?.status, {
          effectiveDate: right?.effectiveDate,
          expirationDate: right?.expirationDate
        })
        base = compareString(leftStatus, rightStatus)
      }
      return base * direction
    })
    return rows
  }, [policies, sortBy, sortDir])

  const pagination = useClientPagination(sortedPolicies, 10)

  const onSort = (field: PolicySortField) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortBy(field)
    setSortDir(field === 'effectiveDate' || field === 'createdAt' || field === 'updatedAt' ? 'desc' : 'asc')
  }

  const sortLabel = (field: PolicySortField, label: string) => {
    if (sortBy !== field) return label
    return `${label} ${sortDir === 'asc' ? '↑' : '↓'}`
  }

  if (loading) {
    return (
      <div className="ps-page-shell">
        <h1 className="ps-page-title">Customer Details</h1>
        <p className="muted">Loading...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ps-page-shell">
        <h1 className="ps-page-title">Customer Details</h1>
        <p className="error">{error}</p>
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="ps-page-shell">
        <h1 className="ps-page-title">Customer Details</h1>
        <p className="muted">Customer not found.</p>
      </div>
    )
  }

  return (
    <div className="ps-page-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <Link to="/dashboard" className="ps-breadcrumb-link">Home</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <Link to="/search?mode=customers" className="ps-breadcrumb-link">Customers</Link>
        <span className="ps-breadcrumb-sep" aria-hidden="true">/</span>
        <span className="ps-breadcrumb-current">{customer.customerKey || customer.customerId}</span>
      </nav>
      <div className="ps-page-header">
        <div>
          <h1 className="ps-page-title">{customer.customerKey || customer.customerId}</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>{customerDisplayName(customer)}</p>
        </div>
        <div className="ps-page-header-actions">
          <span className={`badge ${customerStatusColor(customer.status)}`}>{customer.status || 'DRAFT'}</span>
          <ActionButton variant="secondary" onClick={() => navigate('/search?mode=customers')}>Back to Customers</ActionButton>
          <ActionButton variant="success" onClick={() => navigate(`/wizard?customerId=${encodeURIComponent(customer.customerId || '')}&customerKey=${encodeURIComponent(customer.customerKey || '')}`)}>New Quote</ActionButton>
        </div>
      </div>

      <div className="ps-content-card">
        <div className="ps-form-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          <div className="ps-form-field">
            <label className="ps-filter-label">Type</label>
            <div style={{ fontSize: 14, fontWeight: 600, paddingTop: 4 }}>{customer.entityType || '—'}</div>
          </div>
          <div className="ps-form-field">
            <label className="ps-filter-label">Policies</label>
            <div style={{ fontSize: 14, fontWeight: 600, paddingTop: 4 }}>{policies.length}</div>
          </div>
          <div className="ps-form-field">
            <label className="ps-filter-label">Open Quotes</label>
            <div style={{ fontSize: 14, fontWeight: 600, paddingTop: 4 }}>{openQuotes.length}</div>
          </div>
          <div className="ps-form-field">
            <label className="ps-filter-label">Email</label>
            <div style={{ fontSize: 14, paddingTop: 4 }}>{preferredContact(customer, 'EMAIL')}</div>
          </div>
          <div className="ps-form-field">
            <label className="ps-filter-label">Phone</label>
            <div style={{ fontSize: 14, paddingTop: 4 }}>{preferredContact(customer, 'PHONE')}</div>
          </div>
        </div>
      </div>

      {(customerAiInsights || customerAiError) && (
        <div className="ps-content-card">
          <h3 className="ps-content-card-title">AI / ML Insights</h3>
          {customerAiError && <div className="error">{String(customerAiError)}</div>}
          {customerAiInsights && <CustomerAiInsightsPanel insights={customerAiInsights} />}
        </div>
      )}

      <div className="ps-content-card">
        <h3 className="ps-content-card-title">Policies</h3>
        <div className="ps-table-card" style={{ marginTop: 0, borderRadius: 8 }}>
          <table className="table table-sticky-header">
            <thead>
              <tr>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('policyNumber')}>{sortLabel('policyNumber', 'Policy #')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('productCode')}>{sortLabel('productCode', 'Product')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('effectiveDate')}>{sortLabel('effectiveDate', 'Eff → Exp')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('createdAt')}>{sortLabel('createdAt', 'Created')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('updatedAt')}>{sortLabel('updatedAt', 'Updated')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('updatedUser')}>{sortLabel('updatedUser', 'User')}</button></th>
                <th><button type="button" className="table-sort-button" onClick={() => onSort('status')}>{sortLabel('status', 'Status')}</button></th>
              </tr>
            </thead>
            <tbody>
              {sortedPolicies.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 24 }}>No associated policies found.</td></tr>
              )}
              {pagination.rows.map((row: any) => {
                const displayStatus = derivePolicyWorkflowStatus(row.internalStatus || row.status, {
                  effectiveDate: row.effectiveDate,
                  expirationDate: row.expirationDate
                })
                return (
                  <tr key={row.policyId}>
                    <td>
                      <Link to={`/policies/${encodeURIComponent(row.policyId)}`}>
                        {row.policyNumber || row.policyId}
                      </Link>
                    </td>
                    <td>{row.productCode || '—'}</td>
                    <td>{`${formatDisplayDate(row.effectiveDate, { fallback: '—' })} → ${formatDisplayDate(row.expirationDate, { fallback: '—' })}`}</td>
                    <td>{formatDateTimeMmDdYyyyHm(row.createdAt, '—')}</td>
                    <td>{formatDateTimeMmDdYyyyHm(row.updatedAt, '—')}</td>
                    <td>{row.updatedUser || '—'}</td>
                    <td>
                      <span className={`badge ${policyStatusBadgeColor(displayStatus)}`}>{displayStatus}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {sortedPolicies.length > 0 && (
          <TablePagination
            page={pagination.page}
            pageSize={pagination.pageSize}
            totalItems={pagination.totalItems}
            onPageChange={pagination.setPage}
            onPageSizeChange={pagination.setPageSize}
          />
        )}
      </div>

      <div className="ps-content-card">
        <h3 className="ps-content-card-title">Open Quotes (Not Bound)</h3>
        <div className="ps-table-card" style={{ marginTop: 0, borderRadius: 8 }}>
          <table className="table table-sticky-header">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Product</th>
                <th>Effective Date</th>
                <th>Status</th>
                <th>Step</th>
                <th>Created</th>
                <th>Updated</th>
                <th>User</th>
              </tr>
            </thead>
            <tbody>
              {openQuotes.length === 0 && (
                <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>No open quotes found.</td></tr>
              )}
              {openQuotes.map((row: any) => (
                <tr key={row.quoteId}>
                  <td>
                    <Link to={`/wizard?quoteId=${encodeURIComponent(row.quoteId)}`}>
                      {row.quoteNumber || row.quoteId}
                    </Link>
                  </td>
                  <td>{row.productCode || '—'}</td>
                  <td>{formatDisplayDate(row.effectiveDate, { fallback: '—' })}</td>
                  <td>{row.status || 'Draft'}</td>
                  <td>{row.progressStep || '—'}</td>
                  <td>{formatDateTimeMmDdYyyyHm(row.createdAt, '—')}</td>
                  <td>{formatDateTimeMmDdYyyyHm(row.updatedAt, '—')}</td>
                  <td>{row.updatedUser || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Last Updated: {formatDisplayDateTime(customer.updatedAt, { includeTime: true, fallback: '—' })}</div>
      </div>
    </div>
  )
}
