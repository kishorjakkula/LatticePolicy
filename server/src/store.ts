export type QuoteAuditEntry<T = string | number> = {
  value: T
  updatedAt: string
  updatedBy: string
}

// Simple in-memory stores for MVP
export type Quote = {
  id: string
  tenantId: string
  payload: any
  premium: any
  aiInsights?: any
  uw?: { decision: 'Eligible'|'Refer'|'Decline'; reasons: string[] }
  quoteNumber?: string
  status?: 'Draft' | 'Rated' | 'Converted'
  progressStep?: number
  updatedAt?: string
  updatedBy?: string
  createdAt?: string
  stepHistory?: QuoteAuditEntry[]
  statusHistory?: QuoteAuditEntry[]
  convertedPolicyId?: string
}

export type Policy = {
  policyId: string
  policyNumber: string
  tenantId: string
  productCode: string
  status: 'Bound' | 'Issued' | 'Cancelled'
  term: { effectiveDate: string; expirationDate: string }
  versions: PolicyVersion[]
  payload: any
  lastFullTermPremium: number
  cancelledAt?: string
}

const quotes = new Map<string, Quote>()
const policies = new Map<string, Policy>()

export const store = {
  addQuote(q: Quote) { quotes.set(q.id, q) },
  updateQuote(id: string, patch: Partial<Quote>) {
    const curr = quotes.get(id)
    if (!curr) return
    quotes.set(id, { ...curr, ...patch })
  },
  getQuote(id: string) { return quotes.get(id) },
  addPolicy(p: Policy) { policies.set(p.policyId, p) },
  getPolicy(id: string) { return policies.get(id) },
  searchPolicies(tenantId: string, query: string) {
    const q = (query || '').toLowerCase()
    return Array.from(policies.values()).filter(p => p.tenantId === tenantId && (
      p.policyId.toLowerCase().includes(q) || p.policyNumber.toLowerCase().includes(q)
    ))
  },
  searchQuotes(tenantId: string, query: string) {
    const q = (query || '').toLowerCase()
    return Array.from(quotes.values()).filter(x => x.tenantId === tenantId && (
      x.id.toLowerCase().includes(q) || (x.quoteNumber || '').toLowerCase().includes(q)
    ))
  }
}

export type PolicyVersion = {
  versionId: string
  effectiveDate: string
  processedDate: string
  transactionType: 'Issue' | 'Endorse' | 'Cancel' | 'Reinstate' | 'Rewrite' | 'Renew'
  transactionNumber?: string
  premium: {
    byCoverage: any[]
    fees: { amount: number; currency: string }
    taxes: { amount: number; currency: string }
    total: { amount: number; currency: string }
  }
  uwDecision?: { decision: string; reasons?: string[] } | null
  uwOverride?: boolean
  overrideReason?: string | null
  submittedBy?: string | null
  meta?: any
}
