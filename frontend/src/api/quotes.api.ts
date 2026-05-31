import { config } from '../config'
import { request, tenantId, authHeaders, handleUnauthorized, API_PREFIX } from './request'

export const createQuote = (payload: any) => request<any>('POST', '/v1/quotes', payload)

export const bindQuote = (id: string, payload?: any) => request<any>('POST', `/v1/quotes/${id}/bind`, payload)

export const copyQuote = (id: string) => request<any>('POST', `/v1/quotes/${id}/copy`)

export const createQuoteDraft = (payload: any, opts?: { status?: string; progressStep?: number }) =>
  request<any>('POST', '/v1/quotes/draft', { payload, ...opts })

export const updateQuoteDraft = (id: string, payload: any, opts?: { status?: string; progressStep?: number }) =>
  request<any>('PATCH', `/v1/quotes/${id}/draft`, { payload, ...opts })

export const searchQuotes = (q: string, opts?: { product?: string; status?: string; effectiveFrom?: string; effectiveTo?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: 'asc'|'desc' }) => {
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
  return request<any>('GET', `/v1/quotes?${params.toString()}`)
}

export const getQuote = (id: string) => request<any>('GET', `/v1/quotes/${id}`)

export const inferQuoteAiInsights = (payload: { payload: any; premium?: any; underwriting?: any }) =>
  request<any>('POST', '/v1/ai/quotes/insights', payload)

export const exportQuotesCsv = async (params: Record<string,string|number|undefined>) => {
  const usp = new URLSearchParams()
  Object.entries(params).forEach(([k,v]) => { if (v!=null && v!=='') usp.set(k, String(v)) })
  const url = `${config.apiBaseUrl}${API_PREFIX}/v1/quotes/export?${usp.toString()}`
  const res = await fetch(url, { headers: { 'X-Tenant': tenantId(), 'X-Api-Version': config.apiVersion, ...authHeaders() } })
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized()
    throw new Error(`Export failed ${res.status}`)
  }
  return await res.blob()
}
