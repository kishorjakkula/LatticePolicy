import { request } from './request'

export const apiPlacements = {
  listPlacements: (page = 1, pageSize = 20, status?: string) =>
    request<any>(
      'GET',
      `/v1/placements?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}`
    ),
  getPlacement: (placementId: string) => request<any>('GET', `/v1/placements/${placementId}`),
  createPlacement: (payload: {
    insuredName: string
    productCode?: string
    effectiveDate?: string
    facilityReference?: string
  }) => request<any>('POST', '/v1/placements', payload),
  addParticipant: (
    placementId: string,
    payload: { marketName: string; role?: 'Lead' | 'Following'; subscriptionPercent: number; brokerIntermediary?: string }
  ) => request<any>('POST', `/v1/placements/${placementId}/participants`, payload),
  addSubjectivity: (placementId: string, payload: { description: string; dueDate?: string }) =>
    request<any>('POST', `/v1/placements/${placementId}/subjectivities`, payload),
  resolveSubjectivity: (placementId: string, subjectivityId: string, status: 'Satisfied' | 'Waived') =>
    request<any>('PATCH', `/v1/placements/${placementId}/subjectivities/${subjectivityId}`, { status }),
  transitionStatus: (placementId: string, toStatus: string, reason?: string) =>
    request<any>('PATCH', `/v1/placements/${placementId}/status`, { toStatus, reason }),
}
