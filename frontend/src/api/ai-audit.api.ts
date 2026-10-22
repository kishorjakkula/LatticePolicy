import { request } from './request'

export type ActorKind = 'ai' | 'automation' | 'person' | 'system'
export type AiAuditEntry = {
  source: 'intake' | 'releases'
  eventId: string
  chainSeq: number
  createdAt: string
  actorKind: ActorKind
  actor: string | null
  actorRoles: string[]
  action: string
  subject: string | null
  subjectId: string | null
  detail: Record<string, unknown>
  requestId: string | null
  entryHash: string
  model: string | null
  modelProvenance: Record<string, unknown> | null
}
export type AiAuditFilter = {
  source?: 'all' | 'intake' | 'releases'
  actor?: 'all' | ActorKind
  actorKind?: 'all' | ActorKind
  user?: string
  model?: string
  offset?: number
  limit?: number
  from?: string
  to?: string
  search?: string
}
type ChainStatus = { intact: boolean; firstBrokenEntry: number | null; entries: number }

function query(filter: AiAuditFilter) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) if (value !== undefined && value !== '' && value !== 'all') params.set(key, String(value))
  const text = params.toString()
  return text ? `?${text}` : ''
}
export const aiAuditApi = {
  list: (filter: AiAuditFilter) =>
    request<{ items: AiAuditEntry[]; counts: Record<ActorKind, number>; total: number }>('GET', `/v1/admin/ai-audit${query(filter)}`),
  integrity: () =>
    request<{ checkedAt: string; intake: ChainStatus; releases: ChainStatus }>('GET', '/v1/admin/ai-audit/integrity'),
  exportCsv: (filter: AiAuditFilter) => request<string>('GET', `/v1/admin/ai-audit/export${query(filter)}`),
}
