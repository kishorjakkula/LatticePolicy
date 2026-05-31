import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ActionButton } from '../../components/ActionButton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, adminApi } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { derivePolicyWorkflowStatus } from '../policies/statusModel'
import { formatDisplayDateTime } from '../../shared/dateDisplay'
import { useDashboardAiInsights } from '../../api/hooks'

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

function SimpleTrendChart({ points }: { points: MonthPoint[] }) {
  const width = 740
  const height = 250
  const padTop = 18
  const padRight = 24
  const padBottom = 38
  const padLeft = 36
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

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio))

  return (
    <div className="dashboard-trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Policies and open quotes trend for the last 6 months">
        {gridValues.map((value) => {
          const y = toY(value)
          return (
            <g key={value}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={6} y={y + 4} fill="var(--muted)" fontSize="11">{value}</text>
            </g>
          )
        })}

        <polyline fill="none" stroke="var(--accent-strong)" strokeWidth="3" points={policyLine} />
        <polyline fill="none" stroke="var(--success)" strokeWidth="3" points={quoteLine} />

        {points.map((point, index) => (
          <g key={point.label}>
            <circle cx={toX(index)} cy={toY(point.policyCount)} r="3.5" fill="var(--accent-strong)" />
            <circle cx={toX(index)} cy={toY(point.quoteCount)} r="3.5" fill="var(--success)" />
            <text x={toX(index)} y={height - 12} fill="var(--muted)" textAnchor="middle" fontSize="11">
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
  const canSearchCustomers = hasPermission(user, 'admin.customers.read')
  const qc = useQueryClient()

  const { data: policiesData, isLoading: policiesLoading, error: policiesError, refetch: refetchPolicies } = useQuery({
    queryKey: ['dashboard', 'policies'],
    queryFn: () => loadPagedRows((page, pageSize) =>
      api.searchPolicies('', { page, pageSize, sortBy: 'effectiveDate', sortDir: 'desc' })
    ),
    staleTime: 60_000,
  })

  const { data: quotesData, isLoading: quotesLoading, error: quotesError, refetch: refetchQuotes } = useQuery({
    queryKey: ['dashboard', 'quotes'],
    queryFn: () => loadPagedRows((page, pageSize) =>
      api.searchQuotes('', { page, pageSize, sortBy: 'effectiveDate', sortDir: 'desc' })
    ),
    staleTime: 60_000,
  })

  const { data: customersData, isLoading: customersLoading, refetch: refetchCustomers } = useQuery({
    queryKey: ['dashboard', 'customers'],
    queryFn: () => canSearchCustomers ? adminApi.searchCustomers({ limit: 500 }) : Promise.resolve([]),
    staleTime: 60_000,
  })

  const { data: aiInsightsData, isLoading: aiLoading, refetch: refetchAi } = useDashboardAiInsights()

  const loading = policiesLoading || quotesLoading || customersLoading || aiLoading
  const error = policiesError ? String(policiesError) : (quotesError ? String(quotesError) : null)

  const policies: any[] = policiesData ?? []
  const quotes: any[] = quotesData ?? []
  const customers: any[] = Array.isArray(customersData) ? customersData : []
  const aiInsights: DashboardAiInsights | null = aiInsightsData?.aiInsights ?? null
  const lastRefreshedAt = ''

  const loadDashboard = () => {
    void refetchPolicies()
    void refetchQuotes()
    void refetchCustomers()
    void refetchAi()
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
            <ActionButton variant="success" onClick={() => navigate('/wizard')}>
              New Quote
            </ActionButton>
          </div>
        </div>
        <div className="dashboard-kpi-grid dashboard-summary-grid">
          <div className="dashboard-kpi-card">
            <label>Total Policies</label>
            <strong>{policies.length}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>In Force Policies</label>
            <strong>{statusCounts['In Force']}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>Open Quotes</label>
            <strong>{quotes.length}</strong>
          </div>
          <div className="dashboard-kpi-card">
            <label>Customers</label>
            <strong>{canSearchCustomers ? customers.length : '-'}</strong>
            {canSearchCustomers && <span className="muted">Active: {activeCustomers}</span>}
          </div>
        </div>
      </section>

      {error && <p className="error">{error}</p>}


      <div className="summary-grid dashboard-panels-grid">
        <section className="policy-section-card dashboard-section-card">
          <div className="policy-section-header">
            <h3>Policy Status Distribution</h3>
          </div>
          <div className="dashboard-bars">
            {POLICY_STATUS_ORDER.map((status) => {
              const count = toNumber(statusCounts[status])
              const width = Math.max(4, Math.round((count / statusMax) * 100))
              return (
                <div key={status} className="dashboard-bar-row">
                  <span className="dashboard-bar-label">{status}</span>
                  <div className="dashboard-bar-track">
                    <div className="dashboard-bar-fill" style={{ width: `${width}%` }} />
                  </div>
                  <span className="dashboard-bar-value">{count}</span>
                </div>
              )
            })}
          </div>
        </section>

        <section className="policy-section-card dashboard-section-card">
          <div className="policy-section-header">
            <h3>Product Mix</h3>
          </div>
          <div className="dashboard-bars">
            {productCounts.length === 0 && <p className="muted">No policy data available.</p>}
            {productCounts.map(([productCode, count]) => {
              const width = Math.max(4, Math.round((toNumber(count) / productMax) * 100))
              return (
                <div key={productCode} className="dashboard-bar-row">
                  <span className="dashboard-bar-label">{productCode}</span>
                  <div className="dashboard-bar-track">
                    <div className="dashboard-bar-fill dashboard-bar-fill-secondary" style={{ width: `${width}%` }} />
                  </div>
                  <span className="dashboard-bar-value">{count}</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {aiInsights && (
        <section className="policy-section-card dashboard-section-card">
          <div className="policy-section-header dashboard-section-header">
            <div>
              <h3>AI Insights and Predictions</h3>
              <p className="muted dashboard-section-subtitle">
                {aiInsights.enabled ? 'Enabled' : 'Baseline'} - {aiInsights.provider} - {aiInsights.modelVersion}
                {aiInsights.shadowMode ? ' - Shadow mode' : ''}
              </p>
            </div>
          </div>
          <div className="dashboard-ai-metrics">
            <div className="dashboard-ai-metric">
              <label>Portfolio Health</label>
              <strong>{Math.round(toNumber(aiInsights.portfolioHealthScore))}</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Conversion Rate</label>
              <strong>{Math.round(toNumber(aiInsights.conversionRate) * 100)}%</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Cancellation Rate</label>
              <strong>{Math.round(toNumber(aiInsights.cancellationRate) * 100)}%</strong>
            </div>
            <div className="dashboard-ai-metric">
              <label>Expiring in 30 Days</label>
              <strong>{toNumber(aiInsights.expiringNext30Days)}</strong>
            </div>
          </div>

          <table className="table">
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
                <td>{toNumber(aiInsights.predictions?.next30Days?.projectedQuotes)}</td>
                <td>{toNumber(aiInsights.predictions?.next30Days?.projectedPolicies)}</td>
                <td>{Math.round(toNumber(aiInsights.predictions?.next30Days?.projectedConversionRate) * 100)}%</td>
                <td>{Math.round(toNumber(aiInsights.predictions?.next30Days?.projectedCancellationRate) * 100)}%</td>
                <td>${toNumber(aiInsights.predictions?.next30Days?.projectedPremium).toLocaleString()}</td>
              </tr>
              <tr>
                <td>Next 90 Days</td>
                <td>{toNumber(aiInsights.predictions?.next90Days?.projectedQuotes)}</td>
                <td>{toNumber(aiInsights.predictions?.next90Days?.projectedPolicies)}</td>
                <td>{Math.round(toNumber(aiInsights.predictions?.next90Days?.projectedConversionRate) * 100)}%</td>
                <td>-</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>

          <table className="table">
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
              {(aiInsights.trend?.historical || []).map((row, index) => {
                const forecastRow = (aiInsights.trend?.forecast || [])[index]
                return (
                  <tr key={`trend-${row.monthKey}`}>
                    <td>{row.monthLabel}</td>
                    <td>{toNumber(row.quotes)}</td>
                    <td>{toNumber(row.policies)}</td>
                    <td>{toNumber(row.cancellations)}</td>
                    <td>{forecastRow ? toNumber(forecastRow.projectedQuotes) : '-'}</td>
                    <td>{forecastRow ? toNumber(forecastRow.projectedPolicies) : '-'}</td>
                    <td>{forecastRow ? toNumber(forecastRow.projectedCancellations) : '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

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
        </section>
      )}


      <section className="policy-section-card dashboard-section-card">
        <div className="policy-section-header">
          <h3>6-Month Trend</h3>
        </div>
        <SimpleTrendChart points={trendPoints} />
      </section>

      <p className="muted dashboard-refreshed">
        Last refreshed: {formatDisplayDateTime(lastRefreshedAt, { fallback: '-' })}
      </p>
    </div>
  )
}

async function loadPagedRows(
  fetchPage: (page: number, pageSize: number) => Promise<{ items?: any[]; total?: number }>
): Promise<any[]> {
  const pageSize = 100
  const maxPages = 25
  const all: any[] = []
  let page = 1
  let total = 0

  while (page <= maxPages) {
    const response = await fetchPage(page, pageSize)
    const items = Array.isArray(response?.items) ? response.items : []
    if (page === 1) {
      total = Number(response?.total || items.length)
    }
    all.push(...items)
    if (!items.length || all.length >= total) break
    page += 1
  }
  return all
}

export default DashboardPage
