// Shared TypeScript types for LatticePolicy
// Consumed by both frontend and server packages

// ─── Auth ───────────────────────────────────────────────────────────────────

export type User = {
  id: string
  username: string
  tenantId: string
  roles: string[]
  permissions?: string[]
  customerId?: string | null
  customerKey?: string | null
  customerName?: string | null
}

// ─── Tenant ──────────────────────────────────────────────────────────────────

export type TenantPreferences = {
  dateFormat?: string
  currency?: string
  timezone?: string
  dateFormatsByCountry?: Record<string, string>
  policyNumberFormatsByProduct?: Record<string, string>
  mfaRequired?: boolean
  aiMlConfig?: Record<string, unknown>
}

// ─── Policy ──────────────────────────────────────────────────────────────────

export type PolicyStatus =
  | 'Draft'
  | 'Quoted'
  | 'Bound'
  | 'Active'
  | 'Cancelled'
  | 'Expired'
  | 'NonRenewed'
  | 'PendingCancellation'

export type TransactionType =
  | 'Issue'
  | 'Endorse'
  | 'Cancel'
  | 'Reinstate'
  | 'Rewrite'
  | 'Renew'
  | 'NonRenewal'

export type Policy = {
  policyId: string
  policyNumber: string
  tenantId: string
  productCode: string
  status: PolicyStatus
  effectiveDate: string
  expirationDate: string
  currency: string
  totalPremium?: number | null
  customer?: {
    customerId?: string | null
    name?: string | null
    customerKey?: string | null
  } | null
  createdAt: string
  updatedAt: string
}

export type PolicyVersion = {
  versionId: string
  policyId: string
  tenantId: string
  transactionType: TransactionType
  effectiveDate: string
  status: string
  totalPremium?: number | null
  underwritingDecision?: string | null
  createdAt: string
}

// ─── Quote ───────────────────────────────────────────────────────────────────

export type QuoteStatus = 'Draft' | 'Submitted' | 'Quoted' | 'Bound' | 'Expired' | 'Declined'

export type Quote = {
  quoteId: string
  quoteNumber: string
  tenantId: string
  productCode: string
  status: QuoteStatus
  effectiveDate?: string | null
  expirationDate?: string | null
  totalPremium?: number | null
  createdAt: string
  updatedAt: string
}

// ─── Customer ─────────────────────────────────────────────────────────────────

export type CustomerStatus = 'Draft' | 'PendingApproval' | 'Active' | 'Inactive' | 'Merged'

export type Customer = {
  customerId: string
  customerKey: string
  tenantId: string
  name: string
  entityType?: string | null
  status: CustomerStatus
  email?: string | null
  phone?: string | null
  address?: unknown | null
  createdAt: string
  updatedAt: string
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export type PaginatedResult<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type SortDir = 'asc' | 'desc'

// ─── Additional Interests ─────────────────────────────────────────────────────

export type InterestType =
  | 'Additional Insured'
  | 'Loss Payee'
  | 'Mortgagee'
  | 'Lienholder'
  | 'Certificate Holder'

export type AdditionalInterest = {
  interestId: string
  policyId: string
  tenantId: string
  interestType: InterestType
  name: string
  address?: unknown | null
  loanNumber?: string | null
  rank?: number | null
  createdAt: string
  updatedAt: string
}

// ─── Rating ───────────────────────────────────────────────────────────────────

export type RatingModel = {
  modelId: string
  tenantId: string
  modelCode: string
  productCode?: string | null
  stateCode?: string | null
  programName?: string | null
  createdAt: string
}

// ─── API Responses ────────────────────────────────────────────────────────────

export type ApiError = {
  code: string
  message: string
  details?: unknown
}

export type HealthStatus = {
  status: 'ok' | 'degraded'
  db: boolean
  cache: boolean
  ts: string
}

// Zod schemas (runtime validation + react-hook-form integration)
export * from './schemas/common.schema.js'
export * from './schemas/quote.schema.js'
export * from './schemas/policy.schema.js'
