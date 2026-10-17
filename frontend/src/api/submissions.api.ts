import { config } from '../config'
import { request, tenantId, authHeaders, API_PREFIX } from './request'

export type SubmissionStatus = 'RECEIVED' | 'READING' | 'READ_FAILED' | 'READY_FOR_REVIEW' | 'IN_REVIEW' | 'COMPLETED' | 'DECLINED'
export type FieldConfidence = 'high' | 'medium' | 'low' | 'missing' | 'conflict'

export type SubmissionEvidence = { documentId: string; line: number | null; page: number | null; quote: string; verified: boolean }

export type SubmissionField = {
  key: string
  section: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[]
  required: boolean
  aiValue: string | null
  confidence: FieldConfidence
  evidence: SubmissionEvidence[]
  alternatives: Array<SubmissionEvidence & { value: string }>
  reason: string | null
  value: string | null
  status: 'pending' | 'accepted'
  edited: boolean
  decidedBy: string | null
  decidedAt: string | null
}

export type SubmissionDocument = {
  documentId: string
  fileName: string
  contentType: string
  sizeBytes: number
  lines: string[]
  readableWithoutAi: boolean
}

export type SubmissionEvent = { actorType: 'ai' | 'user' | 'system'; actor: string | null; action: string; detail: Record<string, any>; createdAt: string }

export type SubmissionSummary = {
  submissionId: string
  submissionNumber: string
  status: SubmissionStatus
  channel: string
  subject: string | null
  brokerName: string | null
  brokerEmail: string | null
  insuredName: string | null
  productCode: string | null
  notes: string | null
  assignedTo: string | null
  aiRun: Record<string, any>
  customerChoice: { mode?: 'new' | 'existing'; customerId?: string; customerKey?: string; displayName?: string }
  readError: string | null
  approvedBy: string | null
  approvedAt: string | null
  declinedBy: string | null
  declineReason: string | null
  customerId: string | null
  quoteId: string | null
  quoteNumber: string | null
  receivedAt: string
  updatedAt: string
  fieldTotal?: number
  fieldConfirmed?: number
  fieldAttention?: number
  fieldConflicts?: number
  documentCount?: number
}

export type SubmissionDetail = SubmissionSummary & { documents: SubmissionDocument[]; fields: SubmissionField[]; events: SubmissionEvent[] }

export type SubmissionChecks = {
  clearance: {
    customerMatches: Array<{ customerId: string; customerKey: string; displayName: string; status: string; matchScore: number; reasons: string[] }>
    openSubmissions: Array<{ submissionId: string; submissionNumber: string; status: string; receivedAt: string }>
  }
  appetite: { decision: string; reasons: string[]; evaluated: boolean; note?: string }
  missingRequired: Array<{ key: string; label: string }>
  unconfirmed: number
  readyToApprove: boolean
}

export type IntakeSettings = {
  provider: 'builtin' | 'anthropic'
  model: string | null
  label: string
  configured: boolean
  problem: string | null
  readsPdfAndImages: boolean
  sendsDocumentsOffStack: boolean
  maxDocuments: number
  maxDocumentBytes: number
  products: Array<{ code: string; label: string; riskLabel: string }>
  attestation: string
}

export type NewSubmission = {
  channel?: string
  subject?: string
  brokerName?: string
  brokerEmail?: string
  notes?: string
  productCode?: string
  documents: Array<{ fileName: string; contentType?: string; dataBase64: string }>
}

export const apiSubmissions = {
  settings: () => request<IntakeSettings>('GET', '/v1/submissions/settings'),
  list: (status?: string, page = 1, pageSize = 25) =>
    request<{ items: SubmissionSummary[]; total: number; page: number; pageSize: number; statusCounts: Record<string, number> }>(
      'GET',
      `/v1/submissions?page=${page}&pageSize=${pageSize}${status ? `&status=${encodeURIComponent(status)}` : ''}`
    ),
  get: (id: string) => request<SubmissionDetail>('GET', `/v1/submissions/${id}`),
  checks: (id: string) => request<SubmissionChecks>('GET', `/v1/submissions/${id}/checks`),
  create: (payload: NewSubmission) => request<SubmissionDetail>('POST', '/v1/submissions', payload),
  read: (id: string, productCode?: string | null) => request<any>('POST', `/v1/submissions/${id}/read`, { productCode: productCode || null }),
  updateField: (id: string, key: string, body: { action: 'set' | 'accept' | 'undo'; value?: string | null }) =>
    request<SubmissionField>('PATCH', `/v1/submissions/${id}/fields/${encodeURIComponent(key)}`, body),
  acceptHighConfidence: (id: string) => request<{ accepted: number }>('POST', `/v1/submissions/${id}/accept-high-confidence`),
  setCustomer: (id: string, body: { mode: 'new' | 'existing'; customerId?: string }) => request<any>('PUT', `/v1/submissions/${id}/customer`, body),
  approve: (id: string) =>
    request<{ quoteId: string; quoteNumber: string; customerId: string; customerAction: string }>('POST', `/v1/submissions/${id}/approve`, { attestation: true }),
  decline: (id: string, reason: string) => request<any>('POST', `/v1/submissions/${id}/decline`, { reason }),
}

/** Opens an uploaded document in a new tab (the API needs auth headers, so a plain link will not do). */
export async function openSubmissionDocument(submissionId: string, documentId: string): Promise<void> {
  const url = `${config.apiBaseUrl}${API_PREFIX}/v1/submissions/${submissionId}/documents/${documentId}`
  const res = await fetch(url, { headers: { 'X-Tenant': tenantId(), 'X-Api-Version': config.apiVersion, ...authHeaders() } })
  if (!res.ok) throw new Error(`Could not open the document (${res.status})`)
  const blobUrl = URL.createObjectURL(await res.blob())
  window.open(blobUrl, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
}

/** The human-readable message from an API error thrown by request(). */
export function apiErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  const json = text.indexOf('{')
  if (json >= 0) {
    try {
      const body = JSON.parse(text.slice(json))
      return body?.details?.message || body?.message || text
    } catch {
      // fall through
    }
  }
  return text
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}
