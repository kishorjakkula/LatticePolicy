import { request } from './request'

export const apiUw = {
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
