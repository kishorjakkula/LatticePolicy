import { request } from './request'

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
  listReferrals: (page = 1, pageSize = 20, status?: string) =>
    request<any>(
      'GET',
      `/v1/uw/referrals?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}`
    ),
  getReferral: (referralId: string) => request<any>('GET', `/v1/uw/referrals/${referralId}`),
  assignReferral: (referralId: string, assignedTo: string) =>
    request<any>('PATCH', `/v1/uw/referrals/${referralId}/assign`, { assignedTo }),
  addReferralComment: (referralId: string, text: string) =>
    request<any>('POST', `/v1/uw/referrals/${referralId}/comments`, { text }),
  decideReferral: (referralId: string, decision: 'Approved' | 'Declined' | 'InfoRequested', reason?: string) =>
    request<any>('PATCH', `/v1/uw/referrals/${referralId}/decide`, { decision, reason }),
}
