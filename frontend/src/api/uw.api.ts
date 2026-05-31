import { request } from './request'

export const apiUw = {
  listReferrals: (page = 1, pageSize = 20) => request<any>('GET', `/v1/uw/referrals?page=${page}&pageSize=${pageSize}`),
  approveReferral: (versionId: string, reason: string) => request<any>('PATCH', `/v1/uw/referrals/${versionId}/approve`, { reason }),
  declineReferral: (versionId: string, reason: string) => request<any>('PATCH', `/v1/uw/referrals/${versionId}/decline`, { reason })
}
