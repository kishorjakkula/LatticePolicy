import { request, requestBlob } from './request'

export const listUnderwritingCompanies = (opts?: { productCode?: string; country?: string; state?: string }) => {
  const params = new URLSearchParams()
  if (opts?.productCode) params.set('productCode', opts.productCode)
  if (opts?.country) params.set('country', opts.country)
  if (opts?.state) params.set('state', opts.state)
  const query = params.toString()
  return request<{ items: any[] }>('GET', `/v1/underwriting-companies${query ? `?${query}` : ''}`)
}

export const listReferenceAgencies = (opts?: { q?: string; limit?: number }) => {
  const params = new URLSearchParams()
  if (opts?.q) params.set('q', opts.q)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const query = params.toString()
  return request<{ items: any[] }>('GET', `/v1/reference/agencies${query ? `?${query}` : ''}`)
}

export const listAgencyContacts = (agencyId: string) =>
  request<{ items: any[] }>('GET', `/v1/reference/agencies/${encodeURIComponent(agencyId)}/contacts`)

export const listUnderwriters = () => request<{ items: any[] }>('GET', '/v1/reference/underwriters')

export const listReferenceInsuranceCarriers = (opts?: { q?: string; limit?: number }) => {
  const params = new URLSearchParams()
  if (opts?.q) params.set('q', opts.q)
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  const query = params.toString()
  return request<{ items: any[] }>('GET', `/v1/reference/insurance-carriers${query ? `?${query}` : ''}`)
}

export const getProductConfig = (code: string) => request<any>('GET', `/v1/products/${code}/config`)

export const getProductForm = (code: string) => request<any>('GET', `/v1/products/${code}/form`)

export const previewForms = (payload: any) => request<any[]>('POST', '/v1/forms/preview', payload)

export const getFormDocument = (id: string) => requestBlob(`/v1/forms/${id}/document`)

export const getTenantPreferences = () => request<any>('GET', '/v1/tenant/preferences')

export const getAiSettings = () => request<any>('GET', '/v1/ai/settings')

export const getDashboardAiInsights = () => request<any>('GET', '/v1/ai/dashboard/insights')
