import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, adminApi, apiUw } from '../../api/client'
import { apiSubmissions } from '../../api/submissions.api'
import { tenantId } from '../../api/request'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { derivePolicyWorkflowStatus } from '../policies/statusModel'
import { formatDisplayDateTime } from '../../shared/dateDisplay'
import { useDashboardAiInsights } from '../../api/hooks'
import { aiModelSummary, productLabel } from '../../shared/displayLabels'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { useWorkCounts, OPEN_REFERRAL_STATUS, REVIEW_SUBMISSION_STATUS } from '../../components/useWorkCounts'
import { barWidth, buildAiTrend, loadPagedRows, renewalsDue } from './dashboardModel'
import { DashboardWorkList } from './DashboardWorkList'
import './dashboard.css'

type PolicyStatus =
  | 'Draft'
  | 'Rated'
  | 'Bind'
  | 'Issued'
  | 'In Force'
  | 'Expired'
  | 'Cancelled'

type MonthPoint = {
  label: string
  policyCount: number
  quoteCount: number
}

type DashboardAiInsights = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersion: string
  generatedAt: string
  portfolioHealthScore: number
  conversionRate: number
  cancellationRate: number
  expiringNext30Days: number
  openQuotes: number
  recommendations: string[]
  alerts: string[]
  predictions: {
    next30Days: {
      projectedQuotes: number
      projectedPolicies: number
      projectedConversionRate: number
      projectedCancellationRate: number
      projectedPremium: number
    }
    next90Days: {
      projectedQuotes: number
      projectedPolicies: number
      projectedConversionRate: number
    }
  }
  trend: {
    historical: Array<{
      monthKey: string
      monthLabel: string
      quotes: number
      policies: number
      cancellations: number
    }>
    forecast: Array<{
      monthKey: string
      monthLabel: string
      projectedQuotes: number
      projectedPolicies: number
      projectedCancellations: number
    }>
  }
}

const POLICY_STATUS_ORDER: PolicyStatus[] = [
  'Draft',
  'Rated',
  'Bind',
  'Issued',
  'In Force',
  'Expired',
  'Cancelled'
]

function monthKey(value: any): string {
  const datePrefix = /^(\d{4}-(?:0[1-9]|1[0-2]))-\d{2}(?:T|$)/.exec(String(value || ''))
  if (datePrefix) return datePrefix[1]
  const parsed = new Date(String(value || ''))
  if (Number.isNaN(parsed.getTime())) return ''
  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

function buildRecentMonths(count: number): Array<{ key: string; label: string }> {
  const total = Math.max(1, count)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - (total - 1), 1)
  const months: Array<{ key: string; label: string }> = []
  for (let i = 0; i < total; i++) {
    const current = new Date(start.getFullYear(), start.getMonth() + i, 1)
    const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`
    const label = current.toLocaleString('en-US', { month: 'short' })
    months.push({ key, label })
  }
  return months
}

function toNumber(value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function modelValue(value: unknown, style: 'count' | 'percent' | 'premium' = 'count'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-'
  if (style === 'percent') return `${Math.round(value * 100)}%`
  if (style === 'premium') return `$${value.toLocaleString()}`
  return String(Math.round(value))
}

function SimpleTrendChart({ points }: { points: MonthPoint[] }) {
  const width = 360
  const height = 250
  const padTop = 18
  const padRight = 24
  const padBottom = 38
  const padLeft = 52
  const plotWidth = width - padLeft - padRight
  const plotHeight = height - padTop - padBottom

  const maxValue = Math.max(
    1,
    ...points.map((point) => Math.max(point.policyCount, point.quoteCount))
  )

  const toX = (index: number) => {
    if (points.length <= 1) return padLeft + plotWidth / 2
    return padLeft + (index * plotWidth) / (points.length - 1)
  }
  const toY = (value: number) => padTop + plotHeight - (value / maxValue) * plotHeight

  const policyLine = points
    .map((point, index) => `${toX(index)},${toY(point.policyCount)}`)
    .join(' ')
  const quoteLine = points
    .map((point, index) => `${toX(index)},${toY(point.quoteCount)}`)
    .join(' ')

  const gridValues = [...new Set([0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio)))]

  return (
    <div className="dashboard-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Policies and open quotes trend for the last 6 months">
        {gridValues.map((value) => {
          const y = toY(value)
          return (
            <g key={value}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={padLeft - 8} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize="13">{value}</text>
            </g>
          )
        })}

        <polyline fill="none" stroke="var(--accent-strong)" strokeWidth="3" points={policyLine} />
        <polyline fill="none" stroke="var(--success)" strokeWidth="3" points={quoteLine} />

        {points.map((point, index) => (
          <g key={point.label}>
            <circle cx={toX(index)} cy={toY(point.policyCount)} r="3.5" fill="var(--accent-strong)" />
            <circle cx={toX(index)} cy={toY(point.quoteCount)} r="3.5" fill="var(--success)" />
            <text x={toX(index)} y={height - 12} fill="var(--muted)" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fontSize="13">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="dashboard-legend">
        <span className="dashboard-legend-item">
          <span className="dashboard-dot dashboard-dot-policy" />
          Policies
        </span>
        <span className="dashboard-legend-item">
          <span className="dashboard-dot dashboard-dot-quote" />
          Open Quotes
        </span>
      </div>
    </div>
  )
}

export function DashboardPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  const canReadPortfolio = hasPermission(user, 'page.search.view')
  const canReadReferrals = ['page.uw_queue.view', 'uw.referrals.read'].every((code) => hasPermission(user, code))
  const canReadSubmissions = ['page.submissions.view', 'submissions.read'].every((code) => hasPermission(user, code))
  const canReadPolicies = canReadPortfolio && hasPermission(user, 'page.policy.view')
  const counts = useWorkCounts({ referrals: canReadReferrals, submissions: canReadSubmissions })
  const scope = [user?.tenantId || tenantId(), user?.id || user?.username || null]
  const referralCountKey = ['uw-referrals', ...scope, 'count', OPEN_REFERRAL_STATUS]
  const submissionCountKey = ['submissions', ...scope, 'count', REVIEW_SUBMISSION_STATUS]
  // Observe the shared hook's cache for honest loading/error/time states without another request.
  const referralsQuery = useQuery({ queryKey: referralCountKey, queryFn: () => apiUw.listReferrals(1, 1, OPEN_REFERRAL_STATUS), enabled: false })
  const submissionsQuery = useQuery({ queryKey: submissionCountKey, queryFn: () => apiSubmissions.list(REVIEW_SUBMISSION_STATUS, 1, 1), enabled: false })
  const canSearchCustomers = hasPermission(user, 'admin.customers.read')
  const qc = useQueryClient()

  const policiesQuery = useQuery({
    queryKey: ['dashboard', user?.tenantId, user?.id, 'policies'],
    queryFn: () => loadPagedRows((page, pageSize) =>
      api.searchPolicies('', { page, pageSize, sortBy: 'effectiveDate', sortDir: 'desc' })
    ),
    staleTime: 60_000,
    enabled: canReadPortfolio,
    retry: false,
  })
  const { data: policiesData, error: policiesError, refetch: refetchPolicies } = policiesQuery

  const quotesQuery = useQuery({
    queryKey: ['dashboard', user?.tenantId, user?.id, 'quotes'],
    queryFn: () => loadPagedRows((page, pageSize) =>
      api.searchQuotes('', { page, pageSize, sortBy: 'effectiveDate', sortDir: 'desc' })
    ),
    staleTime: 60_000,
    enabled: canReadPortfolio,
    retry: false,
  })
  const { data: quotesData, error: quotesError, refetch: refetchQuotes } = quotesQuery

  const customersQuery = useQuery({
    queryKey: ['dashboard', user?.tenantId, user?.id, 'customers'],
    queryFn: () => adminApi.searchCustomers({ limit: 500 }),
    staleTime: 60_000,
    enabled: canSearchCustomers,
    retry: false,
  })
  const { data: customersData, refetch: refetchCustomers } = customersQuery

  const aiQuery = useDashboardAiInsights()
  const { data: aiInsightsData, refetch: refetchAi } = aiQuery

  const queries = [policiesQuery, quotesQuery, aiQuery, ...(canSearchCustomers ? [customersQuery] : []), ...(canReadReferrals ? [referralsQuery] : []), ...(canReadSubmissions ? [submissionsQuery] : [])]
  const loading = queries.some((query) => query.isFetching)
  const error = queries.some((query) => query.isError)
  const stale = queries.some((query) => query.dataUpdatedAt > 0 && now - query.dataUpdatedAt >= 60_000)

  const policies: any[] = policiesData ?? []
  const quotes: any[] = quotesData ?? []
  const customers: any[] = Array.isArray(customersData) ? customersData : []
  const aiInsights: DashboardAiInsights | null = !aiQuery.isError && aiInsightsData?.aiInsights?.enabled ? aiInsightsData.aiInsights : null
  const lastRefreshedAt = queries.every((query) => query.dataUpdatedAt > 0)
    ? new Date(Math.min(...queries.map((query) => query.dataUpdatedAt))).toISOString() : ''
  const due = renewalsDue(policies, new Date(now))
  const aiTrend = buildAiTrend(aiInsights?.trend, new Date(now))
  const workKind = searchParams.get('work')

  const loadDashboard = () => {
    void refetchPolicies()
    void refetchQuotes()
    if (canSearchCustomers) void refetchCustomers()
    void refetchAi()
    if (canReadReferrals) void qc.refetchQueries({ queryKey: referralCountKey, exact: true })
    if (canReadSubmissions) void qc.refetchQueries({ queryKey: submissionCountKey, exact: true })
    void qc.invalidateQueries({ queryKey: ['dashboard', 'review-list'] })
  }

  const statusCounts = useMemo(() => {
    const counts: Record<PolicyStatus, number> = {
      Draft: 0,
      Rated: 0,
      Bind: 0,
      Issued: 0,
      'In Force': 0,
      Expired: 0,
      Cancelled: 0
    }
    for (const row of policies) {
      const status = derivePolicyWorkflowStatus(row.internalStatus || row.status, row.term)
      counts[status] = (counts[status] || 0) + 1
    }
    return counts
  }, [policies])

  const productCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const row of policies) {
      const key = String(row.productCode || 'unknown').trim() || 'unknown'
      counts[key] = (counts[key] || 0) + 1
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [policies])

  const trendPoints = useMemo<MonthPoint[]>(() => {
    const months = buildRecentMonths(6)
    const policyBuckets: Record<string, number> = {}
    const quoteBuckets: Record<string, number> = {}
    for (const row of policies) {
      const key = monthKey(row?.term?.effectiveDate || row?.createdAt || row?.updatedAt)
      if (!key) continue
      policyBuckets[key] = (policyBuckets[key] || 0) + 1
    }
    for (const row of quotes) {
      const key = monthKey(row?.effectiveDate || row?.updatedAt)
      if (!key) continue
      quoteBuckets[key] = (quoteBuckets[key] || 0) + 1
    }
    return months.map((month) => ({
      label: month.label,
      policyCount: policyBuckets[month.key] || 0,
      quoteCount: quoteBuckets[month.key] || 0
    }))
  }, [policies, quotes])

  const statusMax = useMemo(
    () => Math.max(1, ...POLICY_STATUS_ORDER.map((status) => toNumber(statusCounts[status]))),
    [statusCounts]
  )
  const productMax = useMemo(
    () => Math.max(1, ...productCounts.map((entry) => toNumber(entry[1]))),
    [productCounts]
  )

  const activeCustomers = useMemo(
    () => customers.filter((item) => String(item?.status || '').toUpperCase() === 'ACTIVE').length,
    [customers]
  )

  return (
    <div className="ps-page-shell policy-search-shell dashboard-page-shell">
      <nav className="ps-breadcrumbs" aria-label="Breadcrumb">
        <span className="ps-breadcrumb-current">Home</span>
      </nav>
      <section className="card page-shell policy-hero policy-search-hero dashboard-hero">
        <div className="ps-page-header policy-page-header">
          <div className="policy-hero-main">
            <div className="policy-hero-kicker">Portfolio Overview</div>
            <h1 className="ps-page-title">Dashboard</h1>
            <p className="policy-search-subtitle">Portfolio and pipeline statistics.</p>
          </div>
          <div className="ps-page-header-actions">
            <ActionButton variant="secondary" size="sm" onClick={() => navigate('/search')}>
              Search
            </ActionButton>
            <ActionButton variant="secondary" size="sm" onClick={() => void loadDashboard()} loading={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </ActionButton>
            {hasPermission(user, 'page.wizard.view') && <ActionButton variant="primary" onClick={() => navigate('/wizard')}>
              New Quote
            </ActionButton>}
          </div>
        </div>
      </section>

      <CollapsibleSection as="section" className="dashboard-my-work" title="My work" aria-label="My work">
        <div className="dashboard-kpi-grid dashboard-work-grid">
          {canReadPortfolio && <Link className="dashboard-kpi-card" to="/search?mode=quotes">
            <span>Open quotes</span>{' '}
            <strong>{quotesError ? 'Unavailable' : quotesData ? quotes.length : 'Loading...'}</strong>
          </Link>}
          {canReadReferrals && <Link className="dashboard-kpi-card" to="/uw/queue?status=Open">
            <span>Open referrals</span>{' '}
            <strong>{referralsQuery.isError ? 'Unavailable' : counts.referrals ?? (referralsQuery.isPending ? 'Loading...' : 'Unavailable')}</strong>
          </Link>}
          {canReadSubmissions && <Link className="dashboard-kpi-card" to="/dashboard?work=submissions">
            <span>Submissions to review</span>{' '}
            <strong>{submissionsQuery.isError ? 'Unavailable' : counts.submissions ?? (submissionsQuery.isPending ? 'Loading...' : 'Unavailable')}</strong>{' '}
            <span>Ready for review</span>
          </Link>}
          {canReadPolicies && <Link className="dashboard-kpi-card" to="/dashboard?work=renewals">
            <span>Renewals due</span>{' '}
            <strong>{policiesError ? 'Unavailable' : policiesData ? due.length : 'Loading...'}</strong>{' '}
            <span>Next 30 days</span>
          </Link>}
        </div>
      </CollapsibleSection>

      {error && <p className="error" role="alert">Some dashboard data could not be refreshed. Failed counts are unavailable; any retained portfolio data is stale. Use Refresh to retry.</p>}
      {loading && <p role="status">Refreshing dashboard data...</p>}
      {stale && !loading && <p role="status">Some dashboard data is older than one minute. Refresh for current figures.</p>}
      {workKind === 'submissions' && canReadSubmissions && <DashboardWorkList kind="submissions" renewals={[]} policiesAvailable={false} />}
      {workKind === 'renewals' && canReadPolicies && <DashboardWorkList kind="renewals" renewals={due} policiesAvailable={!!policiesData && !policiesError} />}

      <CollapsibleSection as="section" className="dashboard-portfolio" title="Portfolio" defaultOpen={!window.matchMedia('(max-width: 600px)').matches}>
        <div className="dashboard-kpi-grid dashboard-summary-grid">
          <div className="dashboard-kpi-card">
            <label>Total Policies</label>
            <strong>{policiesData ? policies.length : 'Unavailable'}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>In Force Policies</label>
            <strong>{policiesData ? statusCounts['In Force'] : 'Unavailable'}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>Open Quotes</label>
            <strong>{quotesData ? quotes.length : 'Unavailable'}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>Customers</label>
            <strong>{canSearchCustomers && customersData ? `${customers.length}${customers.length >= 500 ? '+' : ''}` : 'Unavailable'}</strong>
            {canSearchCustomers && customersData && <span className="muted">Active in loaded customers: {activeCustomers}</span>}
          </div>
        </div>


      <div className="summary-grid dashboard-panels-grid">
        <CollapsibleSection as="section" className="policy-section-card dashboard-section-card">
          <div className="policy-section-header">
            <h3>Policy Status Distribution</h3>
          </div>
          <div className="dashboard-bars">
            {POLICY_STATUS_ORDER.map((status) => {
              const count = toNumber(statusCounts[status])
              const width = barWidth(count, statusMax)
              return (
                <div key={status} className="dashboard-bar-row" aria-label={`${status}: ${policiesData ? count : 'unavailable'}`}>
                  <span className="dashboard-bar-label">{status}</span>
                  <div className="dashboard-bar-track">
                    <div className="dashboard-bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="dashboard-bar-value">{policiesData ? count : '-'}</span>
                </div>
              )
            })}
          </div>
        </CollapsibleSection>

        <CollapsibleSection as="section" className="policy-section-card dashboard-section-card">
          <div className="policy-section-header">
            <h3>Product Mix</h3>
          </div>
          <div className="dashboard-bars">
            {productCounts.length === 0 && <p className="muted">No policy data available.</p>}
            {productCounts.map(([productCode, count]) => {
              const width = barWidth(count, productMax)
              return (
                <div key={productCode} className="dashboard-bar-row">
                  <span className="dashboard-bar-label">{productLabel(productCode)}</span>
                  <div className="dashboard-bar-track">
                    <div className="dashboard-bar-fill dashboard-bar-fill-secondary" style={{ width: `${width}%` }} />
                  </div>
                  <span className="dashboard-bar-value">{count}</span>
                </div>
              )
            })}
          </div>
        </CollapsibleSection>
      </div>

      {aiQuery.isError && <p role="alert">AI insights unavailable. Refresh to retry.</p>}
      {!aiQuery.isPending && !aiQuery.isError && !aiInsights && <p className="muted">AI insights are not enabled or available.</p>}
      {aiInsights && (
        <CollapsibleSection as="section" className="policy-section-card dashboard-section-card">
          <div className="policy-section-header dashboard-section-header">
            <div>
              <h3>AI Insights and Predictions</h3>
              <p className="muted dashboard-section-subtitle">
                {aiModelSummary(aiInsights)}
                {aiInsights.generatedAt && <> · Generated {formatDisplayDateTime(aiInsights.generatedAt, { includeTime: true })}</>}
              </p>
            </div>
          </div>
          <div className="dashboard-ai-metrics">
            <div className="dashboard-ai-metric">
              <label>Portfolio Health</label>
              <strong>{modelValue(aiInsights.portfolioHealthScore)}</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Conversion Rate</label>
              <strong>{modelValue(aiInsights.conversionRate, 'percent')}</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Cancellation Rate</label>
              <strong>{modelValue(aiInsights.cancellationRate, 'percent')}</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Expiring in 30 Days</label>
              <strong>{modelValue(aiInsights.expiringNext30Days)}</strong>
            </div>
          </div>

          <div className="dashboard-table-scroll" role="region" aria-label="Model predictions" tabIndex={0}>
          <table className="dashboard-data-table">
            <thead>
              <tr>
                <th>Prediction Horizon</th>
                <th>Projected Quotes</th>
                <th>Projected Policies</th>
                <th>Projected Conversion</th>
                <th>Projected Cancellation</th>
                <th>Projected Premium</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Next 30 Days</td>
                <td>{modelValue(aiInsights.predictions?.next30Days?.projectedQuotes)}</td>
                <td>{modelValue(aiInsights.predictions?.next30Days?.projectedPolicies)}</td>
                <td>{modelValue(aiInsights.predictions?.next30Days?.projectedConversionRate, 'percent')}</td>
                <td>{modelValue(aiInsights.predictions?.next30Days?.projectedCancellationRate, 'percent')}</td>
                <td>{modelValue(aiInsights.predictions?.next30Days?.projectedPremium, 'premium')}</td>
              </tr>
              <tr>
                <td>Next 90 Days</td>
                <td>{modelValue(aiInsights.predictions?.next90Days?.projectedQuotes)}</td>
                <td>{modelValue(aiInsights.predictions?.next90Days?.projectedPolicies)}</td>
                <td>{modelValue(aiInsights.predictions?.next90Days?.projectedConversionRate, 'percent')}</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
          </div>

          <div className="dashboard-table-scroll" role="region" aria-label="Actual and future forecast by month" tabIndex={0}>
          <table className="dashboard-data-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Quotes (Actual)</th>
                <th>Policies (Actual)</th>
                <th>Cancellations (Actual)</th>
                <th>Quotes (Forecast)</th>
                <th>Policies (Forecast)</th>
                <th>Cancellations (Forecast)</th>
              </tr>
            </thead>
            <tbody>
              {aiTrend.map((row) => {
                return (
                  <tr key={`trend-${row.monthKey}`}>
                    <th scope="row">{row.label}</th>
                    <td>{row.actual?.quotes ?? '-'}</td>
                    <td>{row.actual?.policies ?? '-'}</td>
                    <td>{row.actual?.cancellations ?? '-'}</td>
                    <td>{row.forecast?.projectedQuotes ?? '-'}</td>
                    <td>{row.forecast?.projectedPolicies ?? '-'}</td>
                    <td>{row.forecast?.projectedCancellations ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>

          <div className="dashboard-ai-text-grid">
            <div>
              <h4>Alerts</h4>
              {Array.isArray(aiInsights.alerts) && aiInsights.alerts.length > 0 ? (
                <ul className="dashboard-ai-list">
                  {aiInsights.alerts.map((item, index) => (
                    <li key={`alert-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No current alerts.</p>
              )}
            </div>
            <div>
              <h4>Recommendations</h4>
              {Array.isArray(aiInsights.recommendations) && aiInsights.recommendations.length > 0 ? (
                <ul className="dashboard-ai-list">
                  {aiInsights.recommendations.map((item, index) => (
                    <li key={`recommendation-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No recommendations generated.</p>
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}


      <CollapsibleSection as="section" className="policy-section-card dashboard-section-card">
        <div className="policy-section-header">
          <h3>6-Month Trend</h3>
        </div>
        <SimpleTrendChart points={trendPoints} />
      </CollapsibleSection>
      </CollapsibleSection>

      <p className="muted dashboard-refreshed">
        Last refreshed: {formatDisplayDateTime(lastRefreshedAt, { fallback: 'Not yet fully loaded', includeTime: true })}
        {error && ' (refresh incomplete)'}
      </p>
    </div>
  )
}

export default DashboardPage
