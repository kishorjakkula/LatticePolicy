import { request, fileToBase64 } from './request'

export const listRatingModels = () => request<any[]>('GET', '/v1/rating/models')

export const importRatingWorkbook = async (file: File, opts?: { modelCode?: string; productCode?: string; stateCode?: string; programName?: string }) => {
  const dataBase64 = await fileToBase64(file)
  return request<any>('POST', '/v1/rating/models/import', {
    fileName: file.name,
    mimeType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    dataBase64,
    ...(opts || {})
  })
}

export const getRatingModelVersion = (modelId: string, versionId: string) =>
  request<any>('GET', `/v1/rating/models/${encodeURIComponent(modelId)}/versions/${encodeURIComponent(versionId)}`)

export const publishRatingModelVersion = (modelId: string, versionId: string) =>
  request<any>('POST', `/v1/rating/models/${encodeURIComponent(modelId)}/versions/${encodeURIComponent(versionId)}/publish`, {})

export const getPublishedRatingModel = (opts: { productCode?: string; stateCode?: string; modelCode?: string; versionLabel?: string }) => {
  const params = new URLSearchParams()
  if (opts.productCode) params.set('productCode', opts.productCode)
  if (opts.stateCode) params.set('stateCode', opts.stateCode)
  if (opts.modelCode) params.set('modelCode', opts.modelCode)
  if (opts.versionLabel) params.set('versionLabel', opts.versionLabel)
  return request<any>('GET', `/v1/rating/published?${params.toString()}`)
}
