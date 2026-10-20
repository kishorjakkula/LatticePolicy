import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.js'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { createUser } from '../users.js'
import { previewForm } from '../services/forms.service.js'
import { persistPolicyDocumentPacket, selectPolicyForms, type PolicyDocumentContext } from '../services/document-generation.service.js'
import { disposableFormAttachmentDatabase, startFormAttachmentPostgres } from './fixtures/form-attachment-postgres.js'

// WP-0003: real HTTP/auth, migrations, SQL, RLS and shared expressions; no DB/service mocks.
// Run with: npm run test:integration --workspace=server -- src/__tests__/form-attachment-rules.integration.test.ts
// Standalone requires Docker and ignores DATABASE_URL. The root runner can explicitly
// opt into its local lattice_policy_integration DB with LATTICE_DISPOSABLE_TEST_DATABASE=true.
// That path needs no Docker CLI/socket here; teardown deletes only our random tenants.
const tenantA = `attachment-a-${randomUUID().slice(0, 8)}`
const tenantB = `attachment-b-${randomUUID().slice(0, 8)}`
const editorUsername = `attachment-editor-${tenantA}`
const product = 'personal-auto'
const effectiveDate = '2026-07-01'
const app = createApp()
let postgres: Awaited<ReturnType<typeof startFormAttachmentPostgres>> | undefined
let initialized = false
let editor = '', reader = '', agent = '', otherEditor = '', approver = ''

function api(method: 'get' | 'post' | 'patch' | 'delete', path: string, token = editor, tenantId = tenantA) {
  return request(app)[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`).set('X-Tenant', tenantId)
}

async function user(tenantId: string, username: string, roles: string[]) {
  username = `${username}-${tenantId}`
  await createUser({ tenantId, username, roles, password: 'local-integration-only-password' })
  const response = await request(app).post('/auth/login')
    .send({ tenantId, username, password: 'local-integration-only-password' }).expect(200)
  expect(response.body.token).toEqual(expect.any(String))
  return response.body.token as string
}

async function form(options: { tenantId?: string; workflow?: string; active?: boolean; metadata?: object } = {}) {
  const tenantId = options.tenantId ?? tenantA
  const id = randomUUID()
  await getDb()!.query(
    `INSERT INTO forms_admin_forms
      (form_id,tenant_id,carrier_code,authority,form_number,form_title,edition_date,form_type,
       line_of_business,workflow_status,active,require_approved_jurisdiction,metadata)
     VALUES ($1,$2,'TEST','Carrier',$3,'Synthetic attachment form','2026-01-01','Endorsement',
       $4,$5,$6,true,$7::jsonb)`,
    [id, tenantId, `ATT-${id}`, product, options.workflow ?? 'Draft', options.active ?? false,
      JSON.stringify(options.metadata ?? { fixture: 'preserve-me' })],
  )
  await getDb()!.query(
    `INSERT INTO forms_admin_jurisdictions (tenant_id,form_id,state_code,regulatory_status,effective_date)
     VALUES ($1,$2,'CA','Approved','2026-01-01')`, [tenantId, id],
  )
  await getDb()!.query(
    `INSERT INTO forms_admin_applicability (tenant_id,form_id,line_of_business,product_code,transaction_types)
     VALUES ($1,$2,$3,$3,ARRAY['Bind','Issue'])`, [tenantId, id, product],
  )
  return id
}

async function rule(formId: string, overrides: Record<string, unknown> = {}) {
  const response = await api('post', `/admin/forms/${formId}/triggers`).send({
    triggerType: 'Expression', conditionExpression: 'payload.customFields.score >= 10', priority: 20,
    ...overrides,
  }).expect(201)
  expect(response.body.triggerId).toEqual(expect.any(String))
  return response.body
}

async function publish(formId: string) {
  await getDb()!.query("UPDATE forms_admin_forms SET workflow_status='Approved', active=true WHERE form_id=$1", [formId])
}

async function state(formId: string) {
  const pool = getDb()!
  const forms = await pool.query('SELECT * FROM forms_admin_forms WHERE form_id=$1', [formId])
  const triggers = await pool.query('SELECT * FROM forms_admin_triggers WHERE form_id=$1 ORDER BY trigger_id', [formId])
  const audit = await pool.query('SELECT * FROM forms_admin_audit_events WHERE form_id=$1 ORDER BY changed_at,audit_id', [formId])
  return { form: forms.rows[0], triggers: triggers.rows, audit: audit.rows }
}

async function waitingFormLock(projection: '*' | 'form_id', blockingPid: number) {
  let waitingPid = 0
  await expect.poll(async () => {
    const waiting = await getDb()!.query(
      `SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE $1 AND $2::int = ANY(pg_blocking_pids(pid))`,
      [`SELECT ${projection} FROM forms_admin_forms%FOR UPDATE`, blockingPid],
    )
    waitingPid = waiting.rows[0]?.pid ?? 0
    return waitingPid
  }, { timeout: 5000, interval: 25 }).toBeGreaterThan(0)
  return waitingPid
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    productCode: product, state: 'CA', effectiveDate,
    customFields: { score: 10, segment: 'preferred', suppress: false },
    risks: [{ annualMiles: 8000, customFields: { fleetClass: 'local' } }],
    coverages: [{ code: 'BI', selected: true, limit: 100000 }, { code: 'PD', selected: false, limit: 50000 }],
    ...overrides,
  }
}

async function selection(payload: Record<string, unknown>, tenantId = tenantA, extra: Partial<PolicyDocumentContext> = {}) {
  return withTenantTx(tenantId, db => selectPolicyForms(toRawQuery(db), {
    tenantId, policyId: randomUUID(), transactionId: randomUUID(), transactionType: 'NB',
    productCode: product, state: 'CA', effectiveDate, inputSnapshot: payload, ...extra,
  }))
}

async function assertParity(formId: string, payload: Record<string, unknown>, attaches: boolean) {
  const preview = await withTenantTx(tenantA, db => previewForm(db, tenantA, {
    ...payload, lineOfBusiness: product, transactionType: 'Bind',
  }))
  const selected = await selection(payload)
  expect(preview.some(item => item.formId === formId), 'preview decision').toBe(attaches)
  expect(selected.some(item => item.metadata.sourceFormId === formId), 'packet selection decision').toBe(attaches)
}

describe('form attachment configuration on disposable PostgreSQL', () => {
  beforeAll(async () => {
    postgres = await startFormAttachmentPostgres()
    vi.stubEnv('DATABASE_URL', postgres.url)
    vi.stubEnv('CARRIER_TENANT_ID', '')
    vi.stubEnv('TENANT_RLS_ENFORCED', '1')
    vi.stubEnv('CACHE_ENABLED', 'false')
    await initDb()
    initialized = true
    for (const tenantId of [tenantA, tenantB]) {
      await getDb()!.query(
        `INSERT INTO tenants (tenant_id,name,default_locale,default_currency,mfa_required)
         VALUES ($1,'Synthetic attachment carrier','en-US','USD',false)`, [tenantId],
      )
    }
    editor = await user(tenantA, 'attachment-editor', ['forms_admin'])
    reader = await user(tenantA, 'attachment-reader', ['read_only'])
    agent = await user(tenantA, 'attachment-agent', ['agent'])
    otherEditor = await user(tenantB, 'attachment-other-editor', ['forms_admin'])
    approver = await user(tenantA, 'attachment-approver', ['compliance_admin'])
  }, 180_000)

  afterAll(async () => {
    try {
      if (initialized) {
        const client = await getDb()!.connect()
        try {
          await client.query('BEGIN')
          // Migration 064 allows cascade cleanup only via transaction-local offboarding.
          // Never disable deletion triggers or purge any other suite's tenant data.
          await client.query("SELECT set_config('app.audit_purge', 'tenant-offboarding', true)")
          await client.query('DELETE FROM tenants WHERE tenant_id = ANY($1::text[])', [[tenantA, tenantB]])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally { client.release() }
      }
    } finally {
      try { await closeDb() } finally {
        try { await postgres?.stop() } finally { vi.unstubAllEnvs() }
      }
    }
  }, 30_000)

  it('creates, reads, patches and deactivates rules with opt-in metadata and attributable audit snapshots', async () => {
    const id = await form()
    const created = await rule(id, { reason: 'Synthetic threshold authoring' })
    expect(created).toMatchObject({ triggerType: 'Expression', priority: 20, active: true })
    const afterCreate = await state(id)
    expect(afterCreate.form.metadata).toEqual({ fixture: 'preserve-me', attachmentRulesVersion: 1 })
    expect(afterCreate.triggers).toHaveLength(1)
    expect(afterCreate.triggers[0]).toMatchObject({ tenant_id: tenantA, created_by: editorUsername, updated_by: editorUsername })
    expect(afterCreate.audit).toHaveLength(1)
    expect(afterCreate.audit[0]).toMatchObject({
      entity_type: 'AttachmentRule', entity_id: created.triggerId, event_type: 'ATTACHMENT_RULE_CREATED',
      before_snapshot: null, after_snapshot: created, changed_by: editorUsername, reason: 'Synthetic threshold authoring',
    })
    expect(afterCreate.audit[0].correlation_id).toEqual(expect.any(String))

    const patched = await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`)
      .send({ conditionExpression: 'payload.customFields.score >= 25', priority: 5, active: false }).expect(200)
    expect(patched.body).toMatchObject({ triggerId: created.triggerId, triggerType: 'Expression', priority: 5, active: false })
    const afterPatch = await state(id)
    expect(afterPatch.triggers[0]).toMatchObject({ condition_expression: 'payload.customFields.score >= 25', priority: 5, active: false })
    expect(afterPatch.audit).toHaveLength(2)
    expect(afterPatch.audit[1]).toMatchObject({
      event_type: 'ATTACHMENT_RULE_UPDATED', before_snapshot: created, after_snapshot: patched.body, changed_by: editorUsername,
    })
    const listed = await api('get', `/admin/forms/${id}/triggers`).expect(200)
    expect(listed.body).toEqual([patched.body])
    await api('delete', `/admin/forms/${id}/triggers/${created.triggerId}`).expect(204)
    expect((await state(id)).triggers).toEqual([])
  })

  it('denies unauthenticated, read-only and agent writes without changing any persisted state', async () => {
    const id = await form()
    const created = await rule(id)
    const before = await state(id)
    await request(app).post(`/api/v1/admin/forms/${id}/triggers`).set('X-Tenant', tenantA)
      .send({ triggerType: 'Always' }).expect(401)
    for (const token of [reader, agent]) {
      await api('post', `/admin/forms/${id}/triggers`, token).send({ triggerType: 'Always' }).expect(403)
      await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`, token).send({ active: false }).expect(403)
      await api('delete', `/admin/forms/${id}/triggers/${created.triggerId}`, token).expect(403)
    }
    expect(await state(id)).toEqual(before)
  })

  it.each([
    ['Draft', true], ['Reviewed', false], ['Reviewed', true], ['Approved', false], ['Approved', true],
  ] as const)('locks POST and PATCH on workflow %s / active %s', async (workflow, active) => {
    const id = await form()
    const created = await rule(id)
    // An unlocked Approved edition must also be immutable: do not only test edit_lock=true.
    await getDb()!.query('UPDATE forms_admin_forms SET workflow_status=$2,active=$3,edit_lock=false WHERE form_id=$1', [id, workflow, active])
    const before = await state(id)
    const post = await api('post', `/admin/forms/${id}/triggers`).send({ triggerType: 'Always' }).expect(409)
    const patch = await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`).send({ active: false }).expect(409)
    expect(post.body.code).toBe('LOCKED')
    expect(patch.body.code).toBe('LOCKED')
    expect(await state(id)).toEqual(before)
  })

  it.each([
    { conditionExpression: 'payload.customFields.score >=' },
    { conditionExpression: 'process.env.DATABASE_URL' },
    { conditionExpression: 'payload.constructor.prototype' },
    { conditionExpression: 'payload.applicant.password == "x"' },
    { conditionExpression: 'payload.customFields.score = 5' },
    { suppressExpression: 'payload.customFields.suppress &&' },
    { triggerType: 'Not a trigger' },
    { active: 'false' },
    { priority: -1 },
    { priority: 1.5 },
  ])('rejects unsafe or malformed authoring atomically: %j', async invalid => {
    const id = await form()
    const before = await state(id)
    const response = await api('post', `/admin/forms/${id}/triggers`).send({
      triggerType: 'Expression', conditionExpression: 'payload.customFields.score >= 10', ...invalid,
    }).expect(400)
    expect(response.body.code).toBe('INVALID_INPUT')
    expect(await state(id)).toEqual(before)
    const created = await rule(id)
    const configured = await state(id)
    await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`).send(invalid).expect(400)
    expect(await state(id)).toEqual(configured)
  })

  it.each(['abc', '20', '', 0.5, true, false])('rejects non-integer-number priority %j before normalization on POST and PATCH', async priority => {
    const id = await form()
    const before = await state(id)
    const post = await api('post', `/admin/forms/${id}/triggers`)
      .send({ triggerType: 'Always', priority }).expect(400)
    expect(post.body.code).toBe('INVALID_INPUT')
    expect(await state(id)).toEqual(before)
    const created = await rule(id)
    const configured = await state(id)
    const patch = await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`)
      .send({ priority }).expect(400)
    expect(patch.body.code).toBe('INVALID_INPUT')
    expect(await state(id)).toEqual(configured)
  })

  it.each(['conditionExpression', 'suppressExpression'].flatMap(field =>
    [false, 42, {}, []].map(value => ({ field, value })),
  ))('rejects non-string expression input %j without silently clearing it', async ({ field, value }) => {
    const id = await form()
    const before = await state(id)
    // Always permits absent expressions, so only the type guard prevents coercion to empty text.
    const post = await api('post', `/admin/forms/${id}/triggers`)
      .send({ triggerType: 'Always', [field]: value }).expect(400)
    expect(post.body.code).toBe('INVALID_INPUT')
    expect(await state(id)).toEqual(before)
    const created = await rule(id, { triggerType: 'Always', suppressExpression: 'payload.customFields.suppress == true' })
    const configured = await state(id)
    const patch = await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`)
      .send({ [field]: value }).expect(400)
    expect(patch.body.code).toBe('INVALID_INPUT')
    expect(await state(id)).toEqual(configured)
  })

  it('scopes guessed form and trigger IDs to tenant and form, including reads and preview', async () => {
    const id = await form()
    const created = await rule(id)
    const other = await form({ tenantId: tenantB })
    const before = await state(id)
    await api('post', `/admin/forms/${id}/triggers`, otherEditor, tenantB).send({ triggerType: 'Always' }).expect(404)
    await api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`, otherEditor, tenantB).send({ active: false }).expect(404)
    await api('patch', `/admin/forms/${other}/triggers/${created.triggerId}`, otherEditor, tenantB).send({ active: false }).expect(404)
    await api('delete', `/admin/forms/${id}/triggers/${created.triggerId}`, otherEditor, tenantB).expect(404)
    const listed = await api('get', `/admin/forms/${id}/triggers`, otherEditor, tenantB).expect(200)
    expect(listed.body).toEqual([])
    await api('post', `/admin/forms/${id}/triggers`, editor, tenantB).send({ triggerType: 'Always' }).expect(403)
    const preview = await api('post', '/admin/forms/preview', otherEditor, tenantB)
      .send({ ...input(), formId: id, includeDraft: true }).expect(200)
    expect(preview.body).toEqual([])
    expect(await state(id)).toEqual(before)
    await publish(id)
    expect((await selection(input(), tenantB)).some(item => item.metadata.sourceFormId === id)).toBe(false)
  })

  it.each(['post', 'patch'] as const)('%s waits on the form row lock and rechecks workflow after a concurrent approval commits', async method => {
    const id = await form()
    const created = await rule(id)
    const before = await state(id)
    const client = await getDb()!.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT form_id FROM forms_admin_forms WHERE form_id=$1 FOR UPDATE', [id])
      pending = api(method, `/admin/forms/${id}/triggers${method === 'patch' ? `/${created.triggerId}` : ''}`)
        .send(method === 'patch' ? { active: false } : { triggerType: 'Always' }).then(response => response)
      // Observe a real PostgreSQL lock wait, not a timing-only assertion.
      await expect.poll(async () => {
        const blocked = await getDb()!.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock'
              AND query LIKE '%forms_admin_forms%FOR UPDATE%'`,
        )
        return blocked.rows[0].n
      }, { timeout: 5000, interval: 25 }).toBeGreaterThan(0)
      await client.query("UPDATE forms_admin_forms SET workflow_status='Approved',active=true WHERE form_id=$1", [id])
      await client.query('COMMIT')
      const response = await pending
      expect(response.status).toBe(409)
      expect(response.body.code).toBe('LOCKED')
      const after = await state(id)
      expect(after.triggers).toEqual(before.triggers)
      expect(after.audit).toEqual(before.audit)
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pending
    }
  })

  it.each([true, false])('serializes concurrent rule PATCH and submit with rule-first=%s', async ruleFirst => {
    const id = await form()
    const created = await rule(id)
    const expression = 'payload.customFields.score >= 42'
    const client = await getDb()!.connect()
    let writing: Promise<request.Response> | undefined
    let submitting: Promise<request.Response> | undefined
    const write = () => api('patch', `/admin/forms/${id}/triggers/${created.triggerId}`)
      .send({ conditionExpression: expression }).then(response => response)
    const submit = () => api('post', `/admin/forms/${id}/submit`)
      .send({ reason: 'Synthetic concurrent submission' }).then(response => response)
    try {
      await client.query('BEGIN')
      await client.query('SELECT form_id FROM forms_admin_forms WHERE form_id=$1 FOR UPDATE', [id])
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number
      if (ruleFirst) writing = write()
      else submitting = submit()
      const firstPid = await waitingFormLock(ruleFirst ? '*' : 'form_id', blocker)
      if (ruleFirst) submitting = submit()
      else writing = write()
      // PostgreSQL reports soft blockers too: the second HTTP transaction must queue
      // behind the first, establishing the execution order without arbitrary sleeps.
      await waitingFormLock(ruleFirst ? 'form_id' : '*', firstPid)
      await client.query('COMMIT')

      const writeResponse = await writing!
      const submitResponse = await submitting!
      expect(writeResponse.status).toBe(ruleFirst ? 200 : 409)
      if (!ruleFirst) expect(writeResponse.body.code).toBe('LOCKED')
      expect(submitResponse.status).toBe(200)
      const final = await state(id)
      const finalExpression = ruleFirst ? expression : created.conditionExpression
      expect(final.form).toMatchObject({ workflow_status: 'Reviewed', active: false })
      expect(final.triggers).toHaveLength(1)
      expect(final.triggers[0].condition_expression).toBe(finalExpression)
      expect(final.audit.map(row => row.event_type)).toEqual(ruleFirst
        ? ['ATTACHMENT_RULE_CREATED', 'ATTACHMENT_RULE_UPDATED', 'FORM_SUBMITTED']
        : ['ATTACHMENT_RULE_CREATED', 'FORM_SUBMITTED'])
      const submittedAudit = final.audit[final.audit.length - 1]
      const expectedRule = { triggerId: created.triggerId, conditionExpression: finalExpression }
      expect(submittedAudit.before_snapshot.triggers).toEqual([expect.objectContaining(expectedRule)])
      expect(submittedAudit.after_snapshot.triggers).toEqual([expect.objectContaining(expectedRule)])
      const versions = await getDb()!.query(
        'SELECT workflow_status,snapshot FROM forms_admin_versions WHERE tenant_id=$1 AND form_id=$2', [tenantA, id],
      )
      expect(versions.rows).toEqual([expect.objectContaining({
        workflow_status: 'Reviewed', snapshot: expect.objectContaining({ triggers: [expect.objectContaining(expectedRule)] }),
      })])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await Promise.allSettled([writing, submitting].filter(promise => promise !== undefined))
    }
  })

  it.each(['approve', 'activate'] as const)('%s locks the form before reading workflow state', async action => {
    const id = await form()
    await rule(id)
    await getDb()!.query('UPDATE forms_admin_forms SET workflow_status=$2 WHERE form_id=$1', [id, action === 'approve' ? 'Reviewed' : 'Approved'])
    const before = await state(id)
    const client = await getDb()!.connect()
    let pending: Promise<request.Response> | undefined
    try {
      await client.query('BEGIN')
      await client.query('SELECT form_id FROM forms_admin_forms WHERE form_id=$1 FOR UPDATE', [id])
      const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid as number
      pending = api('post', `/admin/forms/${id}/${action}`, approver)
        .send({ reason: 'Synthetic workflow lock regression' }).then(response => response)
      await waitingFormLock('form_id', blocker)
      await client.query("UPDATE forms_admin_forms SET workflow_status='Draft' WHERE form_id=$1", [id])
      await client.query('COMMIT')
      const response = await pending
      expect(response.status).toBe(409)
      expect(response.body.code).toBe('INVALID_STATE')
      const after = await state(id)
      expect(after.form).toMatchObject({ workflow_status: 'Draft', active: false })
      expect(after.triggers).toEqual(before.triggers)
      expect(after.audit).toEqual(before.audit)
      const versions = await getDb()!.query('SELECT * FROM forms_admin_versions WHERE form_id=$1', [id])
      expect(versions.rows).toEqual([])
    } finally {
      await client.query('ROLLBACK')
      client.release()
      await pending
    }
  })

  it('rolls back the rule and opt-in metadata when the audit insert fails', async () => {
    const id = await form()
    const before = await state(id)
    // This fault injection stays inside our throwaway DB and uses a generated UUID only.
    await getDb()!.query(`ALTER TABLE forms_admin_audit_events ADD CONSTRAINT attachment_test_audit_failure
      CHECK (form_id <> '${id}'::uuid)`)
    try {
      const response = await api('post', `/admin/forms/${id}/triggers`).send({ triggerType: 'Always' }).expect(500)
      expect(response.body.code).toBe('DB_ERROR')
      expect(await state(id)).toEqual(before)
    } finally {
      await getDb()!.query('ALTER TABLE forms_admin_audit_events DROP CONSTRAINT attachment_test_audit_failure')
    }
  })

  it('keeps unflagged legacy rules inert and refuses silent activation by authoring another row', async () => {
    const id = await form()
    await getDb()!.query(
      `INSERT INTO forms_admin_triggers (tenant_id,form_id,trigger_type,condition_expression,suppress_expression)
       VALUES ($1,$2,'Expression','legacy.javascript()','true')`, [tenantA, id],
    )
    const before = await state(id)
    const rejected = await api('post', `/admin/forms/${id}/triggers`).send({ triggerType: 'Always' }).expect(409)
    expect(rejected.body.code).toBe('LEGACY_RULES_DISABLED')
    expect(await state(id)).toEqual(before)
    await publish(id)
    await assertParity(id, input(), true)
    const selected = (await selection(input())).find(item => item.metadata.sourceFormId === id)!
    expect(selected.metadata.attachmentRuleIds).toEqual([])
    expect(selected.metadata.attachmentRules).toEqual([])
  })

  it('applies the jurisdiction gate and Bind/Issue scope in real generation SQL', async () => {
    const isSelected = async (id: string, extra: Partial<PolicyDocumentContext> = {}) =>
      (await selection(input(), tenantA, extra)).some(item => item.metadata.sourceFormId === id)

    // Requires approval, approved only in NY: never attaches to a CA transaction.
    const nyOnly = await form({ metadata: {} })
    await getDb()!.query("UPDATE forms_admin_jurisdictions SET state_code='NY' WHERE form_id=$1", [nyOnly])
    await publish(nyOnly)
    expect(await isSelected(nyOnly)).toBe(false)

    // CA approval that expired before the effective date.
    const expired = await form({ metadata: {} })
    await getDb()!.query("UPDATE forms_admin_jurisdictions SET effective_date='2020-01-01', sunset_date='2021-01-01' WHERE form_id=$1", [expired])
    await publish(expired)
    expect(await isSelected(expired)).toBe(false)

    // Filed counts as usable (file-and-use).
    const filed = await form({ metadata: {} })
    await getDb()!.query("UPDATE forms_admin_jurisdictions SET regulatory_status='Filed' WHERE form_id=$1", [filed])
    await publish(filed)
    expect(await isSelected(filed)).toBe(true)

    // Bind-only and Issue-only scopes attach only at their own stage.
    const bindOnly = await form({ metadata: {} })
    await getDb()!.query("UPDATE forms_admin_applicability SET transaction_types=ARRAY['Bind'] WHERE form_id=$1", [bindOnly])
    await publish(bindOnly)
    const issueOnly = await form({ metadata: {} })
    await getDb()!.query("UPDATE forms_admin_applicability SET transaction_types=ARRAY['Issue'] WHERE form_id=$1", [issueOnly])
    await publish(issueOnly)
    expect(await isSelected(bindOnly, { transactionType: 'NB' })).toBe(true)
    expect(await isSelected(bindOnly, { transactionType: 'Issue' })).toBe(false)
    expect(await isSelected(issueOnly, { transactionType: 'NB' })).toBe(false)
    expect(await isSelected(issueOnly, { transactionType: 'Issue' })).toBe(true)
  })

  it('keeps the rules flag server-owned on general form edits', async () => {
    const legacy = await form()
    await getDb()!.query(
      `INSERT INTO forms_admin_triggers (tenant_id,form_id,trigger_type,condition_expression)
       VALUES ($1,$2,'Expression','legacy.javascript()')`, [tenantA, legacy],
    )
    await api('patch', `/admin/forms/${legacy}`).send({ metadata: { fixture: 'edited', attachmentRulesVersion: 1 } }).expect(200)
    expect((await state(legacy)).form.metadata).toEqual({ fixture: 'edited' })

    const optedIn = await form()
    await rule(optedIn)
    await api('patch', `/admin/forms/${optedIn}`).send({ metadata: { fixture: 'edited' } }).expect(200)
    expect((await state(optedIn)).form.metadata).toEqual({ fixture: 'edited', attachmentRulesVersion: 1 })
    // The UI saves details without metadata; that must not wipe it.
    await api('patch', `/admin/forms/${optedIn}`).send({ formTitle: 'Renamed synthetic form' }).expect(200)
    expect((await state(optedIn)).form.metadata).toEqual({ fixture: 'edited', attachmentRulesVersion: 1 })
    const rejected = await api('patch', `/admin/forms/${optedIn}`).send({ metadata: ['not', 'an', 'object'] }).expect(400)
    expect(rejected.body.code).toBe('INVALID_INPUT')

    // Resending the stored metadata in another key order is not a change, so a locked edition accepts it.
    await getDb()!.query("UPDATE forms_admin_forms SET workflow_status='Approved', active=true, edit_lock=true WHERE form_id=$1", [optedIn])
    await api('patch', `/admin/forms/${optedIn}`).send({ metadata: { attachmentRulesVersion: 1, fixture: 'edited' } }).expect(200)
  })

  it('strips the rules flag from a newly created form', async () => {
    const created = await api('post', '/admin/forms').send({
      carrierCode: 'SYN', authority: 'Carrier', formNumber: `FLAG-${randomUUID().slice(0, 8)}`, formTitle: 'Flag create',
      editionDate: '2026-01-01', formType: 'Endorsement', lineOfBusiness: product, metadata: { fixture: 'create', attachmentRulesVersion: 1 },
    }).expect(201)
    expect((await state(created.body.form.formId)).form.metadata).toEqual({ fixture: 'create' })
  })

  it('rejects an unknown preview transaction type instead of previewing new business', async () => {
    const response = await api('post', '/admin/forms/preview').send({ ...input(), lineOfBusiness: product, transactionType: 'Audit' }).expect(400)
    expect(response.body.code).toBe('INVALID_INPUT')
    for (const transactionType of ['NB', 'new_business', 'QuoteBind']) {
      await api('post', '/admin/forms/preview').send({ ...input(), lineOfBusiness: product, transactionType }).expect(200)
    }
  })

  it('rejects array metadata on create', async () => {
    const response = await api('post', '/admin/forms').send({
      carrierCode: 'SYN', authority: 'Carrier', formNumber: `ARR-${randomUUID().slice(0, 8)}`, formTitle: 'Array metadata',
      editionDate: '2026-01-01', formType: 'Endorsement', lineOfBusiness: product, metadata: ['x'],
    }).expect(400)
    expect(response.body.code).toBe('INVALID_INPUT')
  })

  it('matches carrier custom fields, numeric boundaries and nested risk data identically in preview and selection', async () => {
    const id = await form()
    await rule(id, { conditionExpression: 'payload.customFields.score >= 10 && quote.customFields.segment == "preferred" && risks.0.annualMiles < 10000' })
    await publish(id)
    await assertParity(id, input(), true)
    await assertParity(id, input({ customFields: { score: 9, segment: 'preferred' } }), false)
    await assertParity(id, input({ customFields: { score: 10, segment: 'standard' } }), false)
    await assertParity(id, input({ risks: [{ annualMiles: 10000 }] }), false)
  })

  it.each(['empty', 'inactive'] as const)('does not attach an opted-in edition whose rules are %s', async kind => {
    const id = await form({ metadata: { attachmentRulesVersion: 1 } })
    if (kind === 'inactive') await rule(id, { triggerType: 'Always', active: false })
    await publish(id)
    await assertParity(id, input(), false)
  })

  it.each([false, true])('clones only opted-in rules, keeping the new edition inactive (opt-in=%s)', async optedIn => {
    const id = await form()
    if (optedIn) {
      await rule(id)
      await rule(id, { triggerType: 'Always', active: false })
    } else {
      await getDb()!.query(`INSERT INTO forms_admin_triggers (tenant_id,form_id,trigger_type,condition_expression)
        VALUES ($1,$2,'Expression','legacy.javascript()')`, [tenantA, id])
    }
    await publish(id)
    const before = await state(id)
    const response = await api('post', `/admin/forms/${id}/clone`)
      .send({ editionDate: '2026-02-01', changeReason: 'Synthetic new edition' }).expect(201)
    const cloned = await state(response.body.form.formId)
    expect(cloned.form).toMatchObject({ previous_form_id: id, active: false, workflow_status: 'Draft' })
    expect(cloned.form.metadata).toEqual(before.form.metadata)
    expect(cloned.triggers).toHaveLength(optedIn ? 2 : 0)
    if (optedIn) {
      const definitions = (rows: any[]) => rows.map(row => ({
        type: row.trigger_type, condition: row.condition_expression, suppress: row.suppress_expression,
        active: row.active, priority: row.priority,
      })).sort((a, b) => a.type.localeCompare(b.type))
      expect(definitions(cloned.triggers)).toEqual(definitions(before.triggers))
      for (const row of cloned.triggers) {
        expect(before.triggers.some(source => source.trigger_id === row.trigger_id)).toBe(false)
        expect(row).toMatchObject({ tenant_id: tenantA, form_id: cloned.form.form_id })
      }
    }
    expect(await state(id)).toEqual(before)
    expect((await selection(input())).some(item => item.metadata.sourceFormId === cloned.form.form_id)).toBe(false)
  })

  it('matches selected coverages and limits, honors suppression over Always, and ignores inactive rules', async () => {
    const id = await form()
    await rule(id, { triggerType: 'Coverage Selected', conditionExpression: 'BI', suppressExpression: 'payload.customFields.suppress == true' })
    await rule(id, { conditionExpression: 'coverages.PD.selected == true && coverages.PD.limit >= 50000' })
    await rule(id, { triggerType: 'Always', active: false })
    await publish(id)
    await assertParity(id, input(), true)
    await assertParity(id, input({ coverages: [{ code: 'BI', selected: false }] }), false)
    await assertParity(id, input({ coverages: [{ code: 'PD', selected: true, limit: 50000 }] }), true)
    await assertParity(id, input({ coverages: [{ code: 'PD', selected: true, limit: 49999 }] }), false)
    await assertParity(id, input({ customFields: { suppress: true } }), false)
    const alwaysId = await form()
    await rule(alwaysId, { triggerType: 'Always' })
    await rule(alwaysId, { conditionExpression: 'false', suppressExpression: 'payload.customFields.suppress == true' })
    await publish(alwaysId)
    await assertParity(alwaysId, input({ customFields: { suppress: true } }), false)
  })

  it('pins matching rule IDs, rule definitions and source edition independently of later edits', async () => {
    const id = await form()
    const matched = await rule(id)
    const unmatched = await rule(id, { conditionExpression: 'payload.customFields.score > 1000', priority: 30 })
    await publish(id)
    const selected = (await selection(input())).find(item => item.metadata.sourceFormId === id)!
    expect(selected).toMatchObject({ source: 'forms_admin', metadata: {
      source: 'forms_admin', sourceFormId: id, attachmentRulesVersion: 1, attachmentRuleIds: [matched.triggerId],
    } })
    expect(selected.metadata.attachmentRules).toEqual([
      { triggerId: matched.triggerId, triggerType: 'Expression', conditionExpression: matched.conditionExpression, suppressExpression: null, priority: expect.any(Number), active: true },
      { triggerId: unmatched.triggerId, triggerType: 'Expression', conditionExpression: unmatched.conditionExpression, suppressExpression: null, priority: expect.any(Number), active: true },
    ])
    const context: PolicyDocumentContext = {
      tenantId: tenantA, policyId: randomUUID(), transactionId: randomUUID(), transactionType: 'NB',
      productCode: product, state: 'CA', effectiveDate,
    }
    await withTenantTx(tenantA, async db => {
      const q = toRawQuery(db)
      await q(`INSERT INTO policies (policy_id,tenant_id,product_code,term_effective_date,term_expiration_date)
        VALUES ($1,$2,$3,'2026-07-01','2027-07-01')`, [context.policyId, tenantA, product])
      await q(`INSERT INTO policy_transactions (transaction_id,tenant_id,policy_id,type,status)
        VALUES ($1,$2,$3,'NB','Bound')`, [context.transactionId, tenantA, context.policyId])
      await persistPolicyDocumentPacket(db, context, { forms: [selected], documents: [] })
    })
    const stored = await getDb()!.query('SELECT * FROM policy_forms WHERE policy_form_id=$1', [selected.policyFormId])
    expect(stored.rows).toHaveLength(1)
    expect(stored.rows[0]).toMatchObject({
      tenant_id: tenantA, policy_id: context.policyId, transaction_id: context.transactionId,
      metadata: selected.metadata, data: { metadata: selected.metadata },
      snapshot_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const pinned = structuredClone(selected)
    await getDb()!.query('UPDATE forms_admin_triggers SET condition_expression=$2 WHERE trigger_id=$1', [matched.triggerId, 'false'])
    expect(selected).toEqual(pinned)
    expect((await selection(input())).some(item => item.metadata.sourceFormId === id)).toBe(false)
    const persisted = await getDb()!.query('SELECT * FROM policy_forms WHERE policy_form_id=$1', [selected.policyFormId])
    expect(persisted.rows).toEqual(stored.rows)
    const otherTenant = await withTenantTx(tenantB, db => toRawQuery(db)(
      'SELECT * FROM policy_forms WHERE policy_form_id=$1', [selected.policyFormId],
    ))
    expect(otherTenant.rows).toEqual([])
  })

  it('evaluates transaction, policy and Money-shaped premium context in both selection and admin preview', async () => {
    const id = await form()
    await rule(id, { conditionExpression: 'transaction.stage == "Bind" && policy.status == "Bound" && premium.total >= 1200.5 && risk.customFields.fleetClass == "local"' })
    await publish(id)
    const payload = input()
    const context = { transaction: { type: 'NB', stage: 'Bind' }, policy: { status: 'Bound' }, premium: { total: { amount: 1200.5, currency: 'USD' } } }
    const preview = await api('post', '/admin/forms/preview').send({
      ...payload, ...context, formId: id, transactionType: 'Bind', lineOfBusiness: product,
    }).expect(200)
    expect(preview.body.map((item: any) => item.formId)).toEqual([id])
    expect((await selection(payload, tenantA, context)).some(item => item.metadata.sourceFormId === id)).toBe(true)
    expect((await selection(payload, tenantA, { ...context, premium: { total: { amount: 1200.49 } } }))
      .some(item => item.metadata.sourceFormId === id)).toBe(false)
    expect((await selection(payload, tenantA, { ...context, policy: { status: 'Quote' } }))
      .some(item => item.metadata.sourceFormId === id)).toBe(false)
  })

  it('fails closed on corrupt opted-in expressions rather than attaching a partial packet', async () => {
    const id = await form()
    const created = await rule(id)
    await publish(id)
    await getDb()!.query('UPDATE forms_admin_triggers SET condition_expression=$2 WHERE trigger_id=$1', [created.triggerId, 'process.env.SECRET'])
    try {
      await expect(selection(input())).rejects.toMatchObject({ code: 'FORM_ATTACHMENT_RULE_INVALID' })
      await expect(withTenantTx(tenantA, db => previewForm(db, tenantA, {
        ...input(), transactionType: 'Bind', lineOfBusiness: product,
      }, { formId: id }))).rejects.toMatchObject({ code: 'FORM_ATTACHMENT_RULE_INVALID' })
    } finally {
      await getDb()!.query('UPDATE forms_admin_forms SET active=false WHERE form_id=$1', [id])
    }
  })

  it('supports explicit draft admin preview but never exposes draft forms through public overrides', async () => {
    const id = await form()
    await rule(id)
    const body = { ...input(), lineOfBusiness: product, transactionType: 'Bind', formId: id, includeDraft: true }
    const admin = await api('post', '/admin/forms/preview').send(body).expect(200)
    expect(admin.body.map((item: any) => item.formId)).toEqual([id])
    const failed = await api('post', '/admin/forms/preview').send({ ...body, customFields: { score: 9 } }).expect(200)
    expect(failed.body).toEqual([])
    await api('post', '/admin/forms/preview').send({ ...body, formId: undefined }).expect(400)
    const publicPreview = await api('post', '/forms/preview', agent).send(body).expect(200)
    expect(publicPreview.body.some((item: any) => item.formId === id)).toBe(false)
    expect((await selection(input())).some(item => item.metadata.sourceFormId === id)).toBe(false)
  })

  it('returns only field metadata to authorized readers, independent of customer/application values', async () => {
    const path = `/admin/forms/attachment-fields?productCode=${product}`
    await api('get', path, agent).expect(403)
    const first = await api('get', path).expect(200)
    expect(first.body.contextRoots).toEqual(expect.arrayContaining(['payload', 'quote', 'risk', 'coverages', 'transaction', 'policy', 'premium']))
    expect(first.body.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ expressionPath: 'payload.customFields' }),
      expect.objectContaining({ expressionPath: 'premium.total' }),
      expect.objectContaining({ expressionPath: 'coverages.BI.selected' }),
    ]))
    for (const field of first.body.fields) {
      expect(Object.keys(field).every(key => ['path', 'expressionPath', 'label', 'type', 'group', 'values'].includes(key))).toBe(true)
      expect(field.expressionPath).not.toMatch(/password|secret|token|__proto__|constructor/i)
    }
    const second = await api('get', path, otherEditor, tenantB).expect(200)
    expect(second.body).toEqual(first.body)
  })

  it('lists tenant-scoped compact applicability summaries without full metadata or version history', async () => {
    const id = await form({ metadata: { privateFixtureMarker: 'not-for-form-list' } })
    await rule(id)
    const foreignId = await form({ tenantId: tenantB })
    await getDb()!.query(
      `INSERT INTO forms_admin_applicability (tenant_id,form_id,line_of_business,product_code,transaction_types,active)
       VALUES ($1,$2,'homeowners','homeowners',ARRAY['Issue','Renewal'],true),
              ($1,$2,'personal-auto','personal-auto',ARRAY['Bind','Issue'],true),
              ($1,$2,'cyber','cyber',ARRAY['Cancellation'],false)`, [tenantA, id],
    )
    await getDb()!.query(
      `INSERT INTO forms_admin_jurisdictions (tenant_id,form_id,state_code,regulatory_status,effective_date)
       VALUES ($1,$2,'NY','Approved','2026-01-01'), ($1,$2,'CA','Approved','2026-02-01')`, [tenantA, id],
    )
    await getDb()!.query(
      `INSERT INTO forms_admin_output (tenant_id,form_id,template_source)
       VALUES ($1,$2,'Uploaded DOCX'), ($3,$4,'Static PDF')`, [tenantA, id, tenantB, foreignId],
    )
    // Populate a real version so omission of history is not vacuously true.
    await api('post', `/admin/forms/${id}/submit`).send({ reason: 'Synthetic summary test' }).expect(200)
    const versions = await getDb()!.query('SELECT version_id FROM forms_admin_versions WHERE form_id=$1', [id])
    expect(versions.rows).toHaveLength(1)

    const listed = await api('get', '/admin/forms').expect(200)
    const summary = listed.body.find((item: any) => item.formId === id)
    expect(summary).toMatchObject({
      formId: id, workflowStatus: 'Reviewed', active: false,
      productCodes: ['homeowners', 'personal-auto'], stateCodes: ['CA', 'NY'],
      transactionTypes: ['Bind', 'Issue', 'Renewal'], templateSource: 'Uploaded DOCX',
      jurisdictionCount: 3, applicabilityCount: 4, triggerCount: 1,
    })
    for (const key of ['metadata', 'versions', 'triggers', 'jurisdictions', 'applicability', 'output', 'audit', 'templateAsset']) {
      expect(summary).not.toHaveProperty(key)
    }
    expect(JSON.stringify(summary)).not.toContain('not-for-form-list')
    expect(listed.body.some((item: any) => item.formId === foreignId)).toBe(false)
    const foreign = await api('get', '/admin/forms', otherEditor, tenantB).expect(200)
    expect(foreign.body.some((item: any) => item.formId === id)).toBe(false)
    expect(foreign.body.find((item: any) => item.formId === foreignId)).toMatchObject({
      productCodes: ['personal-auto'], stateCodes: ['CA'], transactionTypes: ['Bind', 'Issue'], templateSource: 'Static PDF',
    })
    // Explicitly scoped rows expose no generator fallbacks.
    expect(summary).toMatchObject({ hasApplicability: true, requireApprovedJurisdiction: true })
  })

  it('lists the scope fallbacks the generator applies to forms without explicit product or state scope', async () => {
    // No applicability rows and no jurisdictions: matches by line of business, every state when approval is optional.
    const noRows = await form()
    await getDb()!.query('DELETE FROM forms_admin_applicability WHERE form_id=$1', [noRows])
    await getDb()!.query('DELETE FROM forms_admin_jurisdictions WHERE form_id=$1', [noRows])
    await getDb()!.query('UPDATE forms_admin_forms SET require_approved_jurisdiction=false WHERE form_id=$1', [noRows])
    // Only inactive rows count as no applicability, as in selectPolicyForms' has_app join.
    const inactiveOnly = await form()
    await getDb()!.query('UPDATE forms_admin_applicability SET active=false WHERE form_id=$1', [inactiveOnly])
    // Blank-product rows (seeds/imports can carry blanks) never attach in generation, so they add no product code; plus an ALL jurisdiction.
    const blankProduct = await form()
    await getDb()!.query(
      `INSERT INTO forms_admin_applicability (tenant_id,form_id,line_of_business,product_code,transaction_types,active)
       VALUES ($1,$2,'homeowners','',ARRAY['Issue'],true), ($1,$2,' ','',ARRAY['Issue'],true)`, [tenantA, blankProduct],
    )
    await getDb()!.query(
      `INSERT INTO forms_admin_jurisdictions (tenant_id,form_id,state_code,regulatory_status,effective_date)
       VALUES ($1,$2,'ALL','Approved','2026-01-01')`, [tenantA, blankProduct],
    )
    // Another tenant's form must not leak into tenant A's projection.
    const foreignId = await form({ tenantId: tenantB })
    await getDb()!.query(
      `INSERT INTO forms_admin_applicability (tenant_id,form_id,line_of_business,product_code,transaction_types,active)
       VALUES ($1,$2,'','',ARRAY['Issue'],true)`, [tenantB, foreignId],
    )

    const listed = await api('get', '/admin/forms').expect(200)
    const byId = (id: string) => listed.body.find((item: any) => item.formId === id)
    expect(byId(noRows)).toMatchObject({
      lineOfBusiness: product, hasApplicability: false,
      productCodes: [], stateCodes: [], jurisdictionCount: 0, requireApprovedJurisdiction: false,
    })
    expect(byId(inactiveOnly)).toMatchObject({ hasApplicability: false, productCodes: [], requireApprovedJurisdiction: true })
    expect(byId(blankProduct)).toMatchObject({
      hasApplicability: true, productCodes: [product], stateCodes: ['ALL', 'CA'],
    })
    const foreign = await api('get', '/admin/forms', otherEditor, tenantB).expect(200)
    expect(foreign.body.find((item: any) => item.formId === foreignId)).toMatchObject({ hasApplicability: true })
    expect(listed.body.some((item: any) => item.formId === foreignId)).toBe(false)
  })
})

describe('disposable root-runner database opt-in guard', () => {
  it.each([undefined, 'false', 'TRUE', '1'])('ignores inherited DATABASE_URL without exact opt-in %j', optIn => {
    expect(disposableFormAttachmentDatabase({
      LATTICE_DISPOSABLE_TEST_DATABASE: optIn, DATABASE_URL: 'postgres://localhost/demo',
    })).toBeUndefined()
  })

  it.each(['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'])('accepts the exact disposable DB on %s', host => {
    const url = `postgresql://test:test@${host}:5432/lattice_policy_integration`
    expect(disposableFormAttachmentDatabase({ LATTICE_DISPOSABLE_TEST_DATABASE: 'true', DATABASE_URL: url })).toBe(url)
  })

  it.each([
    undefined, 'not a URL', 'postgres://localhost/demo', 'postgres://localhost/pilot',
    'postgres://localhost/lattice_policy_integration_extra', 'postgres://localhost/lattice_policy_integration/',
    'postgres://remote.example/lattice_policy_integration', 'postgres://localhost.evil.example/lattice_policy_integration',
    'https://localhost/lattice_policy_integration', 'postgres://localhost/lattice_policy_integration?host=remote.example',
    'postgres://localhost/lattice_policy_integration#fragment',
  ])('rejects unsafe opt-in URL %j before making any connection', url => {
    expect(() => disposableFormAttachmentDatabase({ LATTICE_DISPOSABLE_TEST_DATABASE: 'true', DATABASE_URL: url })).toThrow(/integration database/)
  })
})
