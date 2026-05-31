import { request } from './request'

export const getCustomerPortalSummary = () => request<any>('GET', '/v1/customer-portal/summary')

export const getCustomerPortalPolicy = (policyId: string) => request<any>('GET', `/v1/customer-portal/policies/${encodeURIComponent(policyId)}`)
