export type DashboardPolicy = {
  policyId: string
  policyNumber?: string
  productCode?: string
  status?: string
  internalStatus?: string
  term?: { effectiveDate?: string; expirationDate?: string }
}

export function barWidth(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(maximum) || maximum <= 0) return 0
  return Math.min(100, (value / maximum) * 100)
}

export function renewalsDue(rows: DashboardPolicy[], now = new Date()): DashboardPolicy[] {
  const calendarDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const today = calendarDate(now)
  const end = new Date(now)
  end.setDate(end.getDate() + 30)
  const through = calendarDate(end)
  return rows.filter((row) => {
    const status = (row.internalStatus || row.status || '').toLowerCase()
    const expiry = row.term?.expirationDate?.slice(0, 10) || ''
    return ['issued', 'in force', 'inforced'].includes(status)
      && /^\d{4}-\d{2}-\d{2}$/.test(expiry) && expiry >= today && expiry <= through
  }).sort((a, b) => (a.term?.expirationDate || '').localeCompare(b.term?.expirationDate || ''))
}

type ActualMonth = { monthKey: string; quotes: number; policies: number; cancellations: number }
type ForecastMonth = { monthKey: string; projectedQuotes: number; projectedPolicies: number; projectedCancellations: number }
export type TrendMonth = { monthKey: string; label: string; actual?: ActualMonth; forecast?: ForecastMonth }

export function buildAiTrend(
  trend: { historical?: ActualMonth[]; forecast?: ForecastMonth[] } | undefined,
  now = new Date(),
): TrendMonth[] {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const months = new Map<string, TrendMonth>()
  const valid = (key: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(key)
  const point = (key: string): TrendMonth => ({
    monthKey: key,
    label: new Date(Number(key.slice(0, 4)), Number(key.slice(5)) - 1, 1)
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  })
  for (const actual of trend?.historical || []) {
    if (valid(actual.monthKey) && actual.monthKey <= current) months.set(actual.monthKey, { ...point(actual.monthKey), actual })
  }
  for (const forecast of trend?.forecast || []) {
    if (valid(forecast.monthKey) && forecast.monthKey > current) months.set(forecast.monthKey, { ...point(forecast.monthKey), forecast })
  }
  return [...months.values()].sort((a, b) => a.monthKey.localeCompare(b.monthKey))
}

/** Never present a capped or malformed list as a complete portfolio/count. */
export async function loadPagedRows<T>(fetchPage: (page: number, pageSize: number) => Promise<{ items?: T[]; total?: number }>): Promise<T[]> {
  const rows: T[] = []
  let expectedTotal: number | undefined
  for (let page = 1; page <= 250; page++) {
    const response = await fetchPage(page, 100)
    const total = response?.total
    if (!Array.isArray(response?.items) || !Number.isInteger(total) || total! < 0) throw new Error('Incomplete list response')
    if (expectedTotal !== undefined && expectedTotal !== total) throw new Error('List changed while loading; refresh to retry')
    expectedTotal = total
    rows.push(...response.items)
    if (rows.length === total) return rows
    if (!response.items.length || rows.length > total!) throw new Error('List changed while loading; refresh to retry')
  }
  throw new Error('Portfolio is too large to load completely; counts unavailable')
}
