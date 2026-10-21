import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { createApp } from '../app.js'
import { issueToken } from '../auth.js'
import { ensureTenantRbacDefaults } from '../rbac.js'
import { exportAiAuditCsv, listAiAudit, verifyAiAuditIntegrity } from '../services/ai-audit.service.js'

const tenant = `wp4-audit-${randomUUID()}`
const other = `wp4-audit-other-${randomUUID()}`
const actor = randomUUID()
const deniedActor = randomUUID()
const releaseId = randomUUID()
const submission = randomUUID()
const processing = { model: 'private-v2', profileId: 'submission', profileVersion: '2.0', releaseId }
const artifacts = { ...processing, model: 'release-model-v3', modelSha256: 'b'.repeat(64), profileSha256: 'a'.repeat(64) }
const q = (tenantId: string, sql: string, params: unknown[] = []) => withTenantTx(tenantId, (db) => toRawQuery(db)(sql, params))

describe('WP-0004 REQ-19 AI audit (real PostgreSQL)', () => {
  beforeAll(async () => {
    // Never let an inherited demo/pilot URL turn this into a live-data test.
    if (process.env.LATTICE_DISPOSABLE_TEST_DATABASE !== 'true') throw new Error('Disposable test database required')
    const url = new URL(process.env.DATABASE_URL || '')
    if (!url.pathname.includes('integration')) throw new Error('Integration database name required')
    await initDb()
    for (const id of [tenant, other]) {
      await getDb()!.query('INSERT INTO tenants(tenant_id,name) VALUES($1,$1)', [id])
      await ensureTenantRbacDefaults(id)
    }
    for (const [id, role] of [[actor, 'admin'], [deniedActor, 'agent']]) {
      await getDb()!.query('INSERT INTO users(user_id,tenant_id,username,password_hash) VALUES($1,$2,$3,$4)', [id, tenant, `audit-${id}`, 'no-login'])
      await getDb()!.query('INSERT INTO user_roles(user_id,role_code) VALUES($1,$2)', [id, role])
    }
    await q(tenant, `INSERT INTO llm_releases(release_id,tenant_id,version_label,status,artifacts,artifact_digest,evaluation,created_by)
      VALUES($1,$2,'synthetic-v3','READY_FOR_VALIDATION',$3::jsonb,$4,'{}',$5)`, [releaseId, tenant, JSON.stringify(artifacts), 'c'.repeat(64), actor])
    await q(tenant, `INSERT INTO llm_release_audit(tenant_id,release_id,actor_id,actor_type,action,detail)
      VALUES($1,$2,$3,'automation','CANDIDATE_READY','{"evaluationReportVerified":true}')`, [tenant, releaseId, actor])
    for (const id of [tenant, other]) {
      const sid = id === tenant ? submission : randomUUID()
      await q(id, 'INSERT INTO submissions(submission_id,tenant_id,submission_number) VALUES($1,$2,$3)', [sid, id, `SUB-${sid}`])
      await q(id, `INSERT INTO submission_events(tenant_id,submission_id,actor_type,actor,action,detail)
        SELECT $1,$2,'ai','private-reader','drafted',jsonb_build_object('processing',$3::jsonb,'ordinal',n)
        FROM generate_series(1,$4::int) n`, [id, sid, JSON.stringify(processing), id === tenant ? 500 : 3])
    }
    await q(tenant, `INSERT INTO submission_events(tenant_id,submission_id,actor_type,actor,action,detail)
      VALUES($1,$2,'user',$3,'approved','{"values":4}')`, [tenant, submission, `audit-${actor}`])
  })
  afterAll(async () => { await closeDb() })

  it('pages 500 synthetic entries in stable, disjoint sets of 25 and counts beyond the end', async () => {
    const filter = { source: 'intake', actorKind: 'ai' }
    const first = await listAiAudit(tenant, filter)
    const second = await listAiAudit(tenant, { ...filter, offset: 25 })
    expect(first.items).toHaveLength(25)
    expect(second.items).toHaveLength(25)
    expect(first.total).toBe(500)
    expect(second.total).toBe(500)
    expect(new Set([...first.items, ...second.items].map((e) => e.eventId)).size).toBe(50)
    expect(first.items.map((e) => e.chainSeq)).toEqual([...first.items.map((e) => e.chainSeq)].sort((a, b) => b - a))
    expect(await listAiAudit(tenant, { ...filter, offset: 1000 })).toMatchObject({ items: [], total: 500 })
  })
  it('keeps legacy actor=kind, exact model/user filters, and accurate release provenance', async () => {
    expect((await listAiAudit(tenant, { actor: 'ai' })).total).toBe(500)
    const ai = await listAiAudit(tenant, { model: 'private-v2', user: 'private-reader', actorKind: 'ai', search: 'drafted' })
    expect(ai.total).toBe(500)
    expect(ai.items[0]).toMatchObject({ model: 'private-v2', modelProvenance: processing })
    const release = await listAiAudit(tenant, { model: 'release-model-v3', user: actor })
    expect(release.total).toBe(1)
    expect(release.items[0]).toMatchObject({ source: 'releases', model: 'release-model-v3', modelProvenance: { model: 'release-model-v3', versionLabel: 'synthetic-v3', modelSha256: 'b'.repeat(64) }, detail: { evaluationReportVerified: true } })
    expect((await listAiAudit(tenant, { user: `audit-${actor}`, actorKind: 'person' })).total).toBe(1)
    expect((await listAiAudit(tenant, { model: 'private' })).total).toBe(0)
    expect((await listAiAudit(tenant, { user: 'reader' })).total).toBe(0)
    expect((await listAiAudit(tenant, { source: 'releases', model: 'private-v2' })).total).toBe(0)
    const person = (await listAiAudit(tenant, { actor: 'person' })).items[0]
    expect(person.model).toBeNull()
    expect(person.modelProvenance).toBeNull()
  })
  it('filters inclusive date bounds using recorded timestamps, not rewritten audit rows', async () => {
    const page = await listAiAudit(tenant, { actor: 'ai', limit: 500 })
    const boundary = page.items[200].createdAt
    // PostgreSQL timestamps include microseconds; JS dates are milliseconds.
    const end = new Date(Date.parse(boundary) + 1).toISOString()
    const result = await listAiAudit(tenant, { actor: 'ai', from: boundary, to: end, limit: 500 })
    const expected = await q(tenant, `SELECT count(*)::int AS total FROM submission_events WHERE tenant_id=$1 AND actor_type='ai' AND created_at >= $2 AND created_at <= $3`, [tenant, boundary, end])
    expect(result.total).toBe(expected.rows[0].total)
    expect(result.total).toBeGreaterThan(0)
    expect((await listAiAudit(tenant, { from: '2000-01-01T00:00:00Z', to: '2001-01-01T00:00:00Z' })).total).toBe(0)
    expect((await listAiAudit(tenant, { from: '2099-01-01T00:00:00Z' })).total).toBe(0)
  })
  it('isolates items, totals, provenance and summary counts across tenants with RLS enabled', async () => {
    expect(process.env.TENANT_RLS_ENFORCED).toBe('true')
    const result = await listAiAudit(other, { model: 'private-v2' })
    expect(result.total).toBe(3)
    expect(result.counts).toEqual({ ai: 3, automation: 0, person: 0, system: 0 })
    expect(result.items.every((e) => e.subjectId !== submission)).toBe(true)
    expect((await listAiAudit(other, { user: actor })).total).toBe(0)
    expect((await listAiAudit(other, { model: 'release-model-v3' })).total).toBe(0)
    expect((await listAiAudit(other, { search: 'synthetic-v3' })).total).toBe(0)
  })
  it('exports the full filtered set despite paging inputs, audits the export and leaves both chains intact', async () => {
    const before = await listAiAudit(tenant, { actor: 'ai', limit: 1 })
    const csv = await exportAiAuditCsv(tenant, actor, { model: 'private-v2', offset: 499, limit: 1 })
    expect(csv.trim().split('\n')).toHaveLength(501)
    const after = await listAiAudit(tenant, { actor: 'ai', limit: 1 })
    expect(after.items).toEqual(before.items)
    const exported = await listAiAudit(tenant, { search: 'AUDIT_EXPORTED' })
    expect(exported.items[0]).toMatchObject({ actorKind: 'person', detail: { rows: 500, filter: { model: 'private-v2' } } })
    const chains = await verifyAiAuditIntegrity(tenant)
    expect(chains.intake.intact).toBe(true)
    expect(chains.releases.intact).toBe(true)
    await expect(q(tenant, 'UPDATE submission_events SET action=action WHERE tenant_id=$1', [tenant])).rejects.toThrow(/AUDIT_APPEND_ONLY/)
    await expect(q(tenant, 'DELETE FROM llm_release_audit WHERE tenant_id=$1', [tenant])).rejects.toThrow(/AUDIT_APPEND_ONLY/)
  })
  it('validates API filters and keeps backend permission enforcement', async () => {
    const app = createApp()
    const token = (id: string, role: string) => issueToken({ id, username: `audit-${id}`, tenantId: tenant, roles: [role], permissions: [] })
    const get = (suffix: string, id = actor, role = 'admin') => request(app).get(`/api/v1/admin/ai-audit${suffix}`).set('Authorization', `Bearer ${token(id, role)}`).set('X-Tenant', tenant)
    await get('?offset=0&limit=25&actor=ai').expect(200).then((r) => expect(r.body).toMatchObject({ total: 500 }))
    for (const invalid of ['offset=-1', 'offset=1.5', 'limit=501', 'limit=0', 'from=bad', 'from=2026-10-21T00:00:00Z&to=2026-10-20T00:00:00Z', 'actor=person&actorKind=ai', 'actorKind=invalid', 'model=one&model=two', 'user=']) {
      await get(`?${invalid}`).expect(400).then((r) => expect(r.body.code).toBe('INVALID_AUDIT_FILTER'))
    }
    await get('', deniedActor, 'agent').expect(403)
    await get('/integrity', deniedActor, 'agent').expect(403)
    await get('/export', deniedActor, 'agent').expect(403)
  })
})
