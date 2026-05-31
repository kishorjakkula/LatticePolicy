import { config } from '../config'
import { request, tenantId, authHeaders, handleUnauthorized, API_PREFIX } from './request'

export const issuePolicy = (id: string) => request<any>('POST', `/v1/policies/${id}/issue`)

export const getPolicy = (id: string) => request<any>('GET', `/v1/policies/${id}`)

export const getPolicyVersions = (id: string) => request<any[]>('GET', `/v1/policies/${id}/versions`)

export const getFullPolicy = (id: string) => request<any>('GET', `/v1/policies/${id}/full`)

export const getPolicyTimeline = (id: string) => request<any>('GET', `/v1/policies/${id}/timeline`)

export const searchPolicies = (q: string, opts?: { product?: string; status?: string; effectiveFrom?: string; effectiveTo?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: 'asc'|'desc' }) => {
  const params = new URLSearchParams()
  if (q != null) params.set('q', q)
  if (opts?.product) params.set('product', opts.product)
  if (opts?.status) params.set('status', opts.status)
  if (opts?.effectiveFrom) params.set('effectiveFrom', opts.effectiveFrom)
  if (opts?.effectiveTo) params.set('effectiveTo', opts.effectiveTo)
  if (opts?.page) params.set('page', String(opts.page))
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  if (opts?.sortBy) params.set('sortBy', opts.sortBy)
  if (opts?.sortDir) params.set('sortDir', opts.sortDir)
  return request<any>('GET', `/v1/policies?${params.toString()}`)
}

export const exportPoliciesCsv = async (params: Record<string,string|number|undefined>) => {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k,v]) => { if (v!=null && v!=='') usp.set(k, String(v)) })
  const url = `${config.apiBaseUrl}${API_PREFIX}/v1/policies/export?${usp.toString()}`
  const res = await fetch(url, { headers: { 'X-Tenant': tenantId(), 'X-Api-Version': config.apiVersion, ...authHeaders() } })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    throw new Error(`Export failed ${res.status}`)
  }
  return await res.blob()
}

export const getPolicyAiInsights = (policyId: string) => request<any>('GET', `/v1/ai/policies/${encodeURIComponent(policyId)}/insights`)

export const reserveEndorsementNumber = (id: string) => request<{ transactionNumber: string }>('POST', `/v1/policies/${id}/endorse/reserve-number`)

export const reserveTransactionNumber = (id: string, mode: 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew') =>
  request<{ transactionNumber: string }>('POST', `/v1/policies/${id}/transactions/reserve-number`, { mode })

export const endorsePolicy = (id: string, payload: { effectiveDate: string; changes?: any[]; payload?: any; overrideReason?: string; reason?: string; notes?: string; transactionNumber?: string }) => request<any>('POST', `/v1/policies/${id}/endorse`, payload)

export const endorsePreview = (id: string, payload: { effectiveDate: string; changes?: any[]; payload?: any; overrideReason?: string }) => request<any>('POST', `/v1/policies/${id}/endorse/preview`, payload)

export const cancelPolicy = (id: string, payload: { effectiveDate: string; payload?: any; reason?: string; cancellationReasonCode?: string; transactionNumber?: string }) => request<any>('POST', `/v1/policies/${id}/cancel`, payload)

export const reinstatePolicy = (id: string, payload: { effectiveDate: string; payload?: any; transactionNumber?: string }) => request<any>('POST', `/v1/policies/${id}/reinstate`, payload)

export const rewritePolicy = (id: string, payload: { effectiveDate?: string; payload?: any; overrideReason?: string; transactionNumber?: string }) => request<any>('POST', `/v1/policies/${id}/rewrite`, payload)

export const renewPolicy = (id: string, payload?: { effectiveDate?: string; payload?: any; overrideReason?: string; transactionNumber?: string }) => request<any>('POST', `/v1/policies/${id}/renew`, payload)

export const nonRenewPolicy = (id: string, payload: { noticeDate?: string; reasonCode?: string; reason?: string }) =>
  request<any>('POST', `/v1/policies/${id}/non-renew`, payload)

export const getAdditionalInterests = (policyId: string) =>
  request<{ items: any[]; total: number }>('GET', `/v1/policies/${encodeURIComponent(policyId)}/interests`)

export const createAdditionalInterest = (policyId: string, data: any) =>
  request<any>('POST', `/v1/policies/${encodeURIComponent(policyId)}/interests`, data)

export const updateAdditionalInterest = (policyId: string, aiId: string, data: any) =>
  request<any>('PATCH', `/v1/policies/${encodeURIComponent(policyId)}/interests/${encodeURIComponent(aiId)}`, data)

export const deleteAdditionalInterest = (policyId: string, aiId: string) =>
  request<any>('DELETE', `/v1/policies/${encodeURIComponent(policyId)}/interests/${encodeURIComponent(aiId)}`)

export const getCancellationReasonCodes = () =>
  request<{ items: any[] }>('GET', '/v1/reference/cancellation-reason-codes')

export const apiDetails = {
  getVersionDetails: (policyId: string, versionId: string) => request<any>('GET', `/v1/policies/${policyId}/versions/${versionId}/details`),
  getVersionRatingWorksheet: (policyId: string, versionId: string) =>
    request<any>('GET', `/v1/policies/${policyId}/versions/${versionId}/rating-worksheet`)
}

export const apiPreview = {
  renew: (id: string) => request<any>('POST', `/v1/policies/${id}/renew/preview`)
}
