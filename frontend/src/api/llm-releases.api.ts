import { request } from './request'

export type LlmRelease = {
  release_id: string
  version_label: string
  status: string
  artifact_digest: string
  artifacts: {
    model: string
    modelSha256: string
    profileId: string
    profileVersion: string
    profileSha256: string
  }
  evaluation: {
    sampleCount: number
    fieldAccuracy: number
    evidenceAccuracy: number
  }
  validation?: {
    environment?: string
    runId?: string
    passed?: boolean
    notes?: string
    reason?: string
  }
  validation_authorization?: unknown
  production_authorization?: unknown
  approved_by?: string
  validated_by?: string
  created_at: string
  notifications: Array<{
    email: string
    status: string
    attempts: number
    error?: string
  }>
}
export const llmReleasesApi = {
  list: (release?: string | null) =>
    request<{
      items: LlmRelease[]
      canReview: boolean
      contactEmail: string
      emailEnabled: boolean
    }>(
      'GET',
      `/admin/llm/releases${release ? `?release=${encodeURIComponent(release)}` : ''}`,
    ),
  contact: (email: string) => request('PUT', '/admin/llm/contact', { email }),
  transition: (id: string, action: string, body: unknown = {}) =>
    request<LlmRelease>('POST', `/admin/llm/releases/${id}/${action}`, body),
}
