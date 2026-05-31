import { api, adminApi } from '../api/client'

export type SmartSearchMode = 'policies' | 'quotes' | 'customers'

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

export function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '')
}

export function scoreTextMatch(
  query: string,
  candidate: unknown,
  weights?: { exact?: number; startsWith?: number; contains?: number }
): number {
  const q = normalizeSearchText(query)
  const c = normalizeSearchText(candidate)
  if (!q || !c) return 0
  const exact = weights?.exact ?? 100
  const startsWith = weights?.startsWith ?? 70
  const contains = weights?.contains ?? 35
  if (c === q) return exact
  if (c.startsWith(q)) return startsWith
  if (c.includes(q)) return contains
  return 0
}

export function scorePolicyResult(item: any, query: string): number {
  const customer = item?.customer || {}
  let score = 0
  score = Math.max(score, scoreTextMatch(query, item?.policyNumber, { exact: 240, startsWith: 180, contains: 120 }))
  score = Math.max(score, scoreTextMatch(query, item?.policyId, { exact: 220, startsWith: 160, contains: 100 }))
  score = Math.max(score, scoreTextMatch(query, item?.productCode, { exact: 80, startsWith: 60, contains: 40 }))
  score = Math.max(score, scoreTextMatch(query, customer?.customerKey, { exact: 90, startsWith: 70, contains: 45 }))
  score = Math.max(score, scoreTextMatch(query, customer?.name, { exact: 85, startsWith: 65, contains: 45 }))
  return score
}

export function scoreQuoteResult(item: any, query: string): number {
  let score = 0
  score = Math.max(score, scoreTextMatch(query, item?.quoteNumber, { exact: 240, startsWith: 180, contains: 120 }))
  score = Math.max(score, scoreTextMatch(query, item?.quoteId, { exact: 220, startsWith: 160, contains: 100 }))
  score = Math.max(score, scoreTextMatch(query, item?.productCode, { exact: 80, startsWith: 60, contains: 40 }))
  return score
}

export function scoreCustomerResult(item: any, query: string): number {
  let score = 0
  score = Math.max(score, scoreTextMatch(query, item?.customerKey, { exact: 240, startsWith: 180, contains: 120 }))
  score = Math.max(score, scoreTextMatch(query, item?.customerId, { exact: 220, startsWith: 160, contains: 100 }))
  score = Math.max(score, scoreTextMatch(query, item?.name, { exact: 170, startsWith: 125, contains: 80 }))
  score = Math.max(score, scoreTextMatch(query, item?.email || item?.primaryEmail, { exact: 200, startsWith: 140, contains: 100 }))
  const qDigits = normalizeDigits(query)
  if (qDigits.length >= 7) {
    const itemDigits = normalizeDigits(item?.phone || item?.primaryPhone)
    if (itemDigits) {
      if (itemDigits === qDigits) score = Math.max(score, 180)
      else if (itemDigits.includes(qDigits) || qDigits.includes(itemDigits)) score = Math.max(score, 90)
    }
  }
  return score
}

export function fallbackSearchModeHint(query: string, canSearchCustomers: boolean): SmartSearchMode {
  const q = String(query || '').trim()
  if (!q) return 'policies'
  const upper = q.toUpperCase()
  if (canSearchCustomers && (q.includes('@') || /^CUST[-_]/i.test(q))) return 'customers'
  if (/^Q[A-Z0-9-]{2,}$/i.test(upper)) return 'quotes'
  if (/^(PC|CA|HO|CY|PL)[-_]/i.test(upper)) return 'policies'
  if (canSearchCustomers && /\s/.test(q)) return 'customers'
  return 'policies'
}

export async function inferSmartSearchMode(
  query: string,
  opts: { canSearchCustomers: boolean }
): Promise<SmartSearchMode> {
  const trimmed = String(query || '').trim()
  if (!trimmed) return 'policies'

  const immediateHint = fallbackSearchModeHint(trimmed, opts.canSearchCustomers)
  const hasStrongExplicitHint =
    trimmed.includes('@') ||
    /^CUST[-_]/i.test(trimmed) ||
    /^Q[A-Z0-9-]{2,}$/i.test(trimmed) ||
    /^(PC|CA|HO|CY|PL)[-_]/i.test(trimmed)
  if (hasStrongExplicitHint) return immediateHint

  const [policyResp, quoteResp, customerResp] = await Promise.all([
    api.searchPolicies(trimmed, { page: 1, pageSize: 5, sortBy: 'updatedAt', sortDir: 'desc' }).catch(() => ({ items: [] })),
    api.searchQuotes(trimmed, { page: 1, pageSize: 5, sortBy: 'effectiveDate', sortDir: 'desc' }).catch(() => ({ items: [] })),
    opts.canSearchCustomers
      ? adminApi.searchCustomers({ q: trimmed, limit: 5 }).catch(() => [])
      : Promise.resolve([])
  ])

  const policyItems = Array.isArray((policyResp as any)?.items) ? (policyResp as any).items : []
  const quoteItems = Array.isArray((quoteResp as any)?.items) ? (quoteResp as any).items : []
  const customerItems = Array.isArray(customerResp) ? customerResp : []

  const scores: Array<{ mode: SmartSearchMode; score: number; count: number }> = [
    {
      mode: 'policies',
      score: policyItems.reduce((max: number, item: any) => Math.max(max, scorePolicyResult(item, trimmed)), 0),
      count: policyItems.length
    },
    {
      mode: 'quotes',
      score: quoteItems.reduce((max: number, item: any) => Math.max(max, scoreQuoteResult(item, trimmed)), 0),
      count: quoteItems.length
    }
  ]

  if (opts.canSearchCustomers) {
    scores.push({
      mode: 'customers',
      score: customerItems.reduce((max: number, item: any) => Math.max(max, scoreCustomerResult(item, trimmed)), 0),
      count: customerItems.length
    })
  }

  scores.sort((a, b) => b.score - a.score || b.count - a.count)
  const winner = scores[0]
  if (!winner) return immediateHint
  if (winner.score > 0) return winner.mode
  if (winner.count > 0) return winner.mode
  return immediateHint
}
