import { z } from 'zod'
import { withTenantTx, toRawQuery } from '../db.js'
import { appendLlmAudit, llmActorRoles } from './llm-release.service.js'
import { BadRequestError } from '../errors/domain.errors.js'

/**
 * One view over the two AI governance audit logs:
 *
 * - submission intake (`submission_events`): what the AI read and drafted, and
 *   what people confirmed, corrected, approved or declined;
 * - model releases (`llm_release_audit`): what release automation registered,
 *   and what people tested, approved, renewed, revoked, granted or issued.
 *
 * Every entry is classified by who acted: the AI, release automation, a
 * person, or the system. Both logs are append-only and hash-chained per
 * carrier; `verifyAiAuditIntegrity` re-computes the chains.
 */
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

const filterInput = z
  .object({
    source: z.enum(['all', 'intake', 'releases']).default('all'),
    actor: z.enum(['all', 'ai', 'automation', 'person', 'system']).default('all'),
    actorKind: z.enum(['all', 'ai', 'automation', 'person', 'system']).optional(),
    user: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(240).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    search: z.string().trim().max(120).optional(),
    offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(25),
  })
  .refine((f) => !f.from || !f.to || Date.parse(f.from) <= Date.parse(f.to), 'From must not be after To')
  .refine((f) => !f.actorKind || f.actor === 'all' || f.actorKind === f.actor, 'Conflicting actor kinds')
export type AiAuditFilter = z.input<typeof filterInput>

// Intake actor_type ai/user/system and release actor_type automation/user/system
// map onto one vocabulary.
const UNION = `
  SELECT 'intake' AS source, e.event_id, e.chain_seq, e.created_at,
         CASE e.actor_type WHEN 'user' THEN 'person' ELSE e.actor_type END AS actor_kind,
         e.actor, '{}'::text[] AS actor_roles, e.action,
         s.submission_number AS subject, e.submission_id::text AS subject_id,
         e.detail, e.request_id, e.entry_hash, e.actor AS actor_id,
         e.detail->'processing'->>'model' AS model,
         NULLIF(e.detail->'processing', 'null'::jsonb) AS model_provenance
    FROM submission_events e JOIN submissions s ON s.tenant_id=e.tenant_id AND s.submission_id=e.submission_id
   WHERE e.tenant_id=$1
  UNION ALL
  SELECT 'releases', a.event_id, a.chain_seq, a.created_at,
         CASE a.actor_type WHEN 'user' THEN 'person' ELSE a.actor_type END,
         COALESCE(u.username, a.actor_id::text), a.actor_roles, a.action,
         COALESCE(r.version_label, su.username, CASE WHEN a.subject_user_id IS NOT NULL THEN a.subject_user_id::text END),
         COALESCE(a.release_id::text, a.subject_user_id::text),
         a.detail, a.request_id, a.entry_hash, a.actor_id::text,
         r.artifacts->>'model',
         CASE WHEN r.release_id IS NOT NULL THEN r.artifacts ||
           jsonb_build_object('releaseId', r.release_id, 'versionLabel', r.version_label) END
    FROM llm_release_audit a
    LEFT JOIN users u ON u.user_id=a.actor_id
    LEFT JOIN users su ON su.user_id=a.subject_user_id
    LEFT JOIN llm_releases r ON r.tenant_id=a.tenant_id AND r.release_id=a.release_id
   WHERE a.tenant_id=$1`

function parseFilter(filter: unknown) {
  const result = filterInput.safeParse(filter)
  if (!result.success) throw new BadRequestError('INVALID_AUDIT_FILTER', 'Invalid audit filter', result.error.flatten())
  return result.data
}

async function query(q: any, tenantId: string, filter: ReturnType<typeof parseFilter>, limit: number, offset = 0): Promise<{ items: AiAuditEntry[]; total: number }> {
  const params: unknown[] = [tenantId]
  const where: string[] = []
  const add = (sql: string, value: unknown) => {
    params.push(value)
    where.push(sql.replace('?', `$${params.length}`))
  }
  if (filter.source !== 'all') add('source = ?', filter.source)
  const kind = filter.actorKind ?? filter.actor
  if (kind !== 'all') add('actor_kind = ?', kind)
  if (filter.model) add('model = ?', filter.model)
  if (filter.user) {
    params.push(filter.user)
    where.push(`(actor = $${params.length} OR actor_id = $${params.length})`)
  }
  if (filter.from) add('created_at >= ?::timestamptz', filter.from)
  if (filter.to) add('created_at <= ?::timestamptz', filter.to)
  if (filter.search) {
    params.push(`%${filter.search.replace(/[%_\\]/g, '\\$&')}%`)
    const p = `$${params.length}`
    where.push(`(action ILIKE ${p} OR coalesce(subject,'') ILIKE ${p} OR coalesce(actor,'') ILIKE ${p})`)
  }
  params.push(limit, offset)
  const result = await q(
    `WITH filtered AS (
       SELECT * FROM (${UNION}) t ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ), page AS (
       SELECT * FROM filtered ORDER BY created_at DESC, chain_seq DESC, source, event_id
       LIMIT $${params.length - 1} OFFSET $${params.length}
     )
     SELECT COALESCE((SELECT json_agg(page ORDER BY created_at DESC, chain_seq DESC, source, event_id) FROM page), '[]'::json) AS items,
            (SELECT count(*)::int FROM filtered) AS total`,
    params,
  )
  const items = result.rows[0].items.map(
    (row: any): AiAuditEntry => ({
      source: row.source,
      eventId: row.event_id,
      chainSeq: Number(row.chain_seq),
      createdAt: new Date(row.created_at).toISOString(),
      actorKind: row.actor_kind,
      actor: row.actor,
      actorRoles: row.actor_roles || [],
      action: row.action,
      subject: row.subject,
      subjectId: row.subject_id,
      detail: row.detail || {},
      requestId: row.request_id,
      entryHash: row.entry_hash,
      model: row.model ?? null,
      modelProvenance: row.model_provenance ?? null,
    }),
  )
  return { items, total: result.rows[0].total }
}

export async function listAiAudit(tenantId: string, filter: unknown) {
  const parsed = parseFilter(filter)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const { items, total } = await query(q, tenantId, parsed, parsed.limit, parsed.offset)
    const totals = await q(
      `SELECT actor_kind, count(*)::int AS count FROM (${UNION}) t
        WHERE ($2::timestamptz IS NULL OR created_at >= $2) AND ($3::timestamptz IS NULL OR created_at <= $3)
        GROUP BY actor_kind`,
      [tenantId, parsed.from || null, parsed.to || null],
    )
    const counts: Record<ActorKind, number> = { ai: 0, automation: 0, person: 0, system: 0 }
    for (const row of totals.rows) counts[row.actor_kind as ActorKind] = row.count
    // Keep summary-card counts date-scoped as before; total uses every list filter.
    return { items, counts, total }
  })
}

export async function verifyAiAuditIntegrity(tenantId: string) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const check = async (table: 'submission_events' | 'llm_release_audit') => {
      const result = await q(
        `SELECT audit_chain_first_break($1, $2) AS first_break, (SELECT count(*)::int FROM ${table} WHERE tenant_id=$2) AS entries`,
        [table, tenantId],
      )
      const firstBreak = result.rows[0].first_break
      return { intact: firstBreak === null, firstBrokenEntry: firstBreak === null ? null : Number(firstBreak), entries: result.rows[0].entries }
    }
    return { checkedAt: new Date().toISOString(), intake: await check('submission_events'), releases: await check('llm_release_audit') }
  })
}

const csvCell = (value: unknown) => {
  let text = value === null || value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)
  // Spreadsheet formula injection: neutralize cells that start with a formula character.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** CSV export of the filtered trail (max 10,000 rows); the export itself is audited. */
export async function exportAiAuditCsv(tenantId: string, actor: string, filter: unknown, requestId?: string) {
  const parsed = parseFilter({ ...(filter as object), limit: undefined, offset: undefined })
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const { items } = await query(q, tenantId, parsed, 10000)
    const header = ['created_at', 'source', 'actor_kind', 'actor', 'actor_roles', 'action', 'subject', 'detail', 'request_id', 'entry_hash']
    const lines = [header.join(',')]
    for (const item of items)
      lines.push(
        [item.createdAt, item.source, item.actorKind, item.actor, item.actorRoles.join(' '), item.action, item.subject, item.detail, item.requestId, item.entryHash]
          .map(csvCell)
          .join(','),
      )
    await appendLlmAudit(q, tenantId, {
      releaseId: null,
      actorId: actor,
      actorType: 'user',
      actorRoles: await llmActorRoles(q, tenantId, actor).catch(() => []),
      action: 'AUDIT_EXPORTED',
      detail: { rows: items.length, filter: { source: parsed.source, actor: parsed.actor, actorKind: parsed.actorKind || null, user: parsed.user || null, model: parsed.model || null, from: parsed.from || null, to: parsed.to || null, search: parsed.search || null } },
      requestId,
    })
    return `${lines.join('\n')}\n`
  })
}
