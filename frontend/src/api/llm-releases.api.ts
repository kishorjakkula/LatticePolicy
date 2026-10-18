import { request } from './request'

type SignedReceipt = {
  payload: { approvedAt: string; expiresAt?: string; approvedBy: string; environment: string }
  signature: string
}
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
    reportSha256?: string
  }
  validation_authorization?: SignedReceipt | null
  production_authorization?: SignedReceipt | null
  created_by?: string
  approved_by?: string | null
  validated_by?: string | null
  revoked_by?: string | null
  revoked_at?: string | null
  revocation_reason?: string | null
  approver_active?: boolean | null
  has_evaluation_report?: boolean
  has_validation_report?: boolean
  production_quality?: {
    submissions: number
    drafted: number
    corrected: number
    correctionRate: number | null
  } | null
  created_at: string
  notifications: Array<{
    email: string
    status: string
    attempts: number
    error?: string
  }>
}
export type LlmReleasePolicy = {
  minSampleCount: number
  minFieldAccuracy: number
  minEvidenceAccuracy: number
  authorizationDays: number
  roleCooldownHours: number
}
export type AutomationCredential = {
  credentialId: string
  userId: string
  username: string
  label: string
  allowedCidrs: string[]
  createdAt: string
  expiresAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  token?: string
}
export const llmReleasesApi = {
  list: (release?: string | null) =>
    request<{
      items: LlmRelease[]
      canReview: boolean
      canManageCredentials: boolean
      currentUserId: string
      policy: LlmReleasePolicy
      platformPolicy: LlmReleasePolicy
      contactEmail: string
      emailEnabled: boolean
    }>(
      'GET',
      `/v1/admin/llm/releases${release ? `?release=${encodeURIComponent(release)}` : ''}`,
    ),
  contact: (email: string) => request('PUT', '/v1/admin/llm/contact', { email }),
  transition: (id: string, action: string, body: unknown = {}) =>
    request<LlmRelease>('POST', `/v1/admin/llm/releases/${id}/${action}`, body),
  savePolicy: (policy: LlmReleasePolicy) =>
    request<LlmReleasePolicy>('PUT', '/v1/admin/llm/policy', policy),
  revocations: () =>
    request<{ schemaVersion: 1; releaseIds: string[]; payload: unknown; signature: string }>(
      'GET',
      '/v1/admin/llm/revocations',
    ),
  credentials: () =>
    request<{ items: AutomationCredential[]; automationUsers: Array<{ userId: string; username: string }> }>(
      'GET',
      '/v1/admin/llm/credentials',
    ),
  issueCredential: (body: { userId: string; label: string; expiresInDays: number; allowedCidrs: string[] }) =>
    request<AutomationCredential>('POST', '/v1/admin/llm/credentials', body),
  revokeCredential: (id: string) =>
    request<AutomationCredential>('POST', `/v1/admin/llm/credentials/${id}/revoke`, {}),
}

/**
 * SHA-256 of a report in the canonical form the API and the learning service
 * use (object keys sorted with localeCompare, then JSON).
 */
export async function reportDigest(report: unknown): Promise<string> {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      )
    return value
  }
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(report)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
