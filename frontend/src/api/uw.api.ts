import { request } from './request'

export type UwReferralSort = 'oldest' | 'newest'
export type UwReferralDecision = 'Approved' | 'Declined' | 'InfoRequested'

export interface UwProposalSnapshot {
  schemaVersion: 1
  tenantId: string
  quoteId: string | null
  policyId: string | null
  transactionType: string
  effectiveDate: string | null
  reasons: string[]
  baseVersion: unknown
  payload: Record<string, unknown>
  premium: unknown
  underwriting: unknown
  authority: unknown
}

export interface UwReferral {
  referralId: string
  quoteId?: string | null
  policyId?: string | null
  policyNumber?: string | null
  productCode?: string | null
  insuredName?: string | null
  effectiveDate?: string | null
  transactionType?: string | null
  status: string
  reasons: string[]
  assignedTo?: string | null
  comments?: Array<{ by?: string | null; text: string; at?: string; decision?: string }>
  decision?: string | null
  decidedBy?: string | null
  decidedAt?: string | null
  decisionReason?: string | null
  /** Latest policy version premium, or the rated quote total; null when not rated. */
  premium?: { amount: number; currency: string } | null
  /** Immutable server evidence; null on legacy referrals, never inferred from current context. */
  proposalHash: string | null
  proposalSnapshot: UwProposalSnapshot | null
  createdAt?: string
}

export interface UwReferralList {
  items: UwReferral[]
  total: number
  page: number
  pageSize: number
  sort?: UwReferralSort
}

export const apiUw = {
  listAuthorityGrants: () => request<{ items: any[] }>('GET', '/v1/uw/authority-grants'),
  createAuthorityGrant: (payload: {
    subjectType: 'USER' | 'ROLE' | 'PRODUCER'
    subjectId: string
    productCode?: string | null
    stateCode?: string | null
    transactionTypes: string[]
    maxPremium?: number | null
    maxLimit?: number | null
    mayOverride?: boolean
    effectiveDate: string
    expirationDate?: string | null
  }) => request<any>('POST', '/v1/uw/authority-grants', payload),
  updateAuthorityGrant: (grantId: string, patch: { active?: boolean; expirationDate?: string | null }) =>
    request<any>('PATCH', `/v1/uw/authority-grants/${grantId}`, patch),
  /**
   * sort defaults on the server: oldest first for Open, newest first otherwise.
   * Resolves to a UwReferralList; typed loosely so existing count callers and
   * their test doubles keep compiling.
   */
  listReferrals: (page = 1, pageSize = 20, status?: string, sort?: UwReferralSort) =>
    request<any>(
      'GET',
      `/v1/uw/referrals?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}${sort ? `&sort=${sort}` : ''}`
    ),
  getReferral: (referralId: string) => request<UwReferral>('GET', `/v1/uw/referrals/${encodeURIComponent(referralId)}`),
  assignReferral: (referralId: string, assignedTo: string) =>
    request<any>('PATCH', `/v1/uw/referrals/${referralId}/assign`, { assignedTo }),
  addReferralComment: (referralId: string, text: string) =>
    request<any>('POST', `/v1/uw/referrals/${referralId}/comments`, { text }),
  /** Approved and Declined need a non-blank reason (server returns 400 REASON_REQUIRED). */
  decideReferral: (referralId: string, decision: UwReferralDecision, reason?: string) =>
    request<UwReferral>('PATCH', `/v1/uw/referrals/${encodeURIComponent(referralId)}/decide`, { decision, reason }),
}
