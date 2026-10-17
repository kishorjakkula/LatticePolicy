import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { closeDb, getDb, initDb, toRawQuery, withTenantTx } from '../db.js'
import { BuiltinExtractor, PrivateDocumentExtractor } from '../lib/intake/extractors.js'
import { qualificationTargetFields } from '../lib/intake/target-fields.js'
import { insertDraftQuote } from '../services/quote.service.js'
import { submissionRoutes } from '../routes/submissions.routes.js'
import * as scheduler from '../services/submission-intake-scheduler.js'
import {
  acceptHighConfidence,
  approveSubmission,
  createSubmission,
  declineSubmission,
  getSubmission,
  getSubmissionChecks,
  runExtraction,
  setCustomerChoice,
  startReading,
  startManualReview,
  updateSubmissionField,
  type ExtractionScheduler,
} from '../services/submission-intake.service.js'

const TENANT_ID = 'sample-carrier'
const OTHER_TENANT = 'intake-other-carrier'

const EMAIL = [
  'From: Dana Whitfield <dana@brightway.example>',
  'Subject: New submission - Northline Logistics LLC, commercial auto',
  '',
  'Please quote commercial auto for Northline Logistics, a small fleet.',
].join('\n')

const ACORD = [
  'ACORD 125 COMMERCIAL INSURANCE APPLICATION',
  'Applicant: Northline Logistics LLC',
  'FEIN: 84-2219031',
  'Mailing address: 1180 Commerce Pkwy',
  'City: Columbus',
  'ZIP code: 43215',
  'Proposed eff. date: 12/01/2026      State: OH',
  'Primary Garaging ZIP: 43215',
  'Vehicle Count: 2',
  'Driver Count: 4',
].join('\n')

const SCHEDULE = ['ACORD 127 BUSINESS AUTO SECTION', 'Primary Garaging ZIP: 43219'].join('\n')

function b64(text: string) {
  return Buffer.from(text, 'utf8').toString('base64')
}

function intakeApi() {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.tenant = { tenantId: req.header('X-Tenant') || TENANT_ID } as any
    if (req.header('X-Permissions')) req.user = { username: 'agent1', roles: [], permissions: req.header('X-Permissions')!.split(',') } as any
    next()
  })
  app.use('/api/v1', submissionRoutes)
  app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode || 500).json({ code: err.code }))
  return app
}

/** Captures the scheduled read instead of running it, so the test runs it explicitly. */
function capture() {
  const jobs: Parameters<ExtractionScheduler>[0][] = []
  const schedule: ExtractionScheduler = async (job) => { jobs.push(job) }
  return { jobs, schedule }
}

async function uploadAndRead(insuredSuffix = '') {
  const submission = await createSubmission(TENANT_ID, 'agent1', {
    channel: 'email',
    subject: 'Northline Logistics',
    documents: [
      { fileName: 'broker.eml', dataBase64: b64(EMAIL) },
      { fileName: 'acord125.txt', dataBase64: b64(ACORD.replace('Northline Logistics LLC', `Northline Logistics LLC${insuredSuffix}`)) },
      { fileName: 'acord127.txt', dataBase64: b64(SCHEDULE) },
    ],
  })
  const { jobs, schedule } = capture()
  await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule })
  expect(jobs).toHaveLength(1)
  expect(await runExtraction(jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'drafted' })
  return getSubmission(TENANT_ID, submission.submissionId)
}

/** Confirms every value the way a reviewer would: accept high confidence, then resolve the rest. */
async function confirmEverything(submissionId: string) {
  await acceptHighConfidence(TENANT_ID, submissionId, 'uw1')
  const current = await getSubmission(TENANT_ID, submissionId)
  for (const field of current.fields.filter((item) => item.status !== 'accepted')) {
    let value = field.value || undefined
    if (field.confidence === 'conflict') value = field.alternatives[0].value
    if (!value && field.required) {
      value = field.type === 'select' ? field.options[0] : field.type === 'number' ? '3' : field.type === 'date' ? '2026-12-01' : /state/i.test(field.key) ? 'OH' : 'Entered by reviewer'
    }
    await updateSubmissionField(TENANT_ID, submissionId, field.key, 'uw1', { action: 'accept', value })
  }
}

async function count(sql: string, params: any[]) {
  return withTenantTx(TENANT_ID, async (db) => Number((await toRawQuery(db)(sql, params)).rows[0].count))
}

describe('submission intake', () => {
  beforeAll(async () => {
    await initDb()
    const db = getDb()!
    for (const [id, name] of [[TENANT_ID, 'Sample Carrier'], [OTHER_TENANT, 'Other Carrier']]) {
      await db.query(
        `INSERT INTO tenants (tenant_id, name, default_locale, default_currency) VALUES ($1,$2,'en-US','USD')
         ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`,
        [id, name]
      )
    }
    // Two companies write commercial auto in Ohio (the reviewer must choose); one writes cyber (used automatically).
    for (const [company, product] of [['Acme Mutual Casualty', 'commercial-auto'], ['Acme Specialty', 'commercial-auto'], ['Acme Specialty', 'cyber']]) {
      await db.query(
        `INSERT INTO underwriting_companies (tenant_id, name, product_code, country_code, state_code, active) VALUES ($1,$2,$3,'US','OH',true)
         ON CONFLICT DO NOTHING`,
        [TENANT_ID, company, product]
      )
    }
  })

  afterAll(async () => {
    await closeDb()
  })

  it('records private processing provenance without creating business records or bypassing review', async () => {
    vi.stubEnv('INTAKE_AI_PROVIDER', 'private')
    vi.stubEnv('DOCUMENT_PROCESSOR_URL', 'http://document-processor:8080')
    vi.stubEnv('DOCUMENT_PROCESSOR_TOKEN', 'test-only-private-token-1234567890123456')
    try {
      const customersBefore = await count('SELECT COUNT(*) AS count FROM customers WHERE tenant_id=$1', [TENANT_ID])
      const quotesBefore = await count('SELECT COUNT(*) AS count FROM quotes WHERE tenant_id=$1', [TENANT_ID])
      const uploaded = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'synthetic.txt', dataBase64: b64('Applicant: Private Synthetic Company LLC') }] })
      const { jobs, schedule } = capture()
      await startReading(TENANT_ID, uploaded.submissionId, 'agent1', { schedule })
      const original = await getSubmission(TENANT_ID, uploaded.submissionId)
      const documentId = original.documents[0].documentId
      const extractor = new PrivateDocumentExtractor('http://document-processor:8080', 'test-only-private-token-1234567890123456', 'submission', async () => ({
        schemaVersion: 1, model: 'offline-model-test-v1', profile: { id: 'submission', version: '1.0.0' },
        documents: [{ id: documentId, pages: [] }],
        result: { variant: 'commercial-auto', variantConfidence: 90, variantReason: 'Synthetic example', summary: 'Synthetic test',
          values: [{ key: 'insuredName', value: 'Private Synthetic Company LLC', confidence: 90, documentId, line: 1, quote: 'Applicant: Private Synthetic Company LLC', reason: 'Stated' }], conflicts: [] },
      }))
      expect(await runExtraction(jobs[0], extractor)).toEqual({ outcome: 'drafted' })
      const drafted = await getSubmission(TENANT_ID, uploaded.submissionId)
      expect(drafted.aiRun).toMatchObject({ provider: 'private', processing: { model: 'offline-model-test-v1', profileId: 'submission', profileVersion: '1.0.0' } })
      expect(drafted.fields.find(field => field.key === 'insuredName')).toMatchObject({ value: 'Private Synthetic Company LLC', status: 'pending' })
      expect(await count('SELECT COUNT(*) AS count FROM customers WHERE tenant_id=$1', [TENANT_ID])).toBe(customersBefore)
      expect(await count('SELECT COUNT(*) AS count FROM quotes WHERE tenant_id=$1', [TENANT_ID])).toBe(quotesBefore)
      await expect(approveSubmission(TENANT_ID, uploaded.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'UNCONFIRMED_VALUES' })
    } finally { vi.unstubAllEnvs() }
  })

  it('drafts proposals only, and creates the customer and quote only after every value is confirmed and approved', async () => {
    const submission = await uploadAndRead()
    expect(submission.status).toBe('READY_FOR_REVIEW')
    expect(submission.productCode).toBe('commercial-auto')
    expect(submission.aiRun).toMatchObject({ provider: 'builtin', counts: expect.any(Object) })
    expect(submission.documents.map((document) => document.fileName)).toEqual(['acord125.txt', 'acord127.txt', 'broker.eml'].sort())

    const byKey = new Map(submission.fields.map((field) => [field.key, field]))
    expect(byKey.get('fein')).toMatchObject({ aiValue: '84-2219031', value: '84-2219031', confidence: 'high', confidenceScore: 90, status: 'pending' })
    expect(byKey.get('risk.garagingZip')!.confidenceScore).toBeNull()
    expect(submission.aiRun.counts.averageScore).toBeGreaterThan(0)
    expect(byKey.get('risk.garagingZip')).toMatchObject({ confidence: 'conflict', aiValue: null })
    expect(byKey.get('risk.garagingZip')!.alternatives.map((option: any) => option.value).sort()).toEqual(['43215', '43219'])

    // Reading creates nothing outside the submission.
    expect(await count(`SELECT COUNT(*) FROM quotes WHERE tenant_id = $1 AND payload->'intake'->>'submissionId' = $2`, [TENANT_ID, submission.submissionId])).toBe(0)

    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'UNCONFIRMED_VALUES' })
    await expect(updateSubmissionField(TENANT_ID, submission.submissionId, 'effectiveDate', 'uw1', { action: 'set', value: 'next tuesday' })).rejects.toMatchObject({ code: 'INVALID_VALUE' })
    await expect(updateSubmissionField(TENANT_ID, submission.submissionId, 'risk.garagingZip', 'uw1', { action: 'accept' })).rejects.toMatchObject({ code: 'VALUE_REQUIRED' })

    // Editing a value keeps the AI proposal and marks it changed.
    const edited = await updateSubmissionField(TENANT_ID, submission.submissionId, 'insuredName', 'uw1', { action: 'accept', value: 'Northline Logistics, LLC' })
    expect(edited).toMatchObject({ aiValue: 'Northline Logistics LLC', value: 'Northline Logistics, LLC', edited: true, status: 'accepted', decidedBy: 'uw1' })

    const accepted = await acceptHighConfidence(TENANT_ID, submission.submissionId, 'uw1')
    expect(accepted.accepted).toBeGreaterThan(0)
    await confirmEverything(submission.submissionId)

    const checks = await getSubmissionChecks(TENANT_ID, submission.submissionId)
    expect(checks.readyToApprove).toBe(true)
    expect(checks.appetite.evaluated).toBe(true)

    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', {})).rejects.toMatchObject({ code: 'ATTESTATION_REQUIRED' })
    expect(checks.underwritingCompanies.map((company) => company.name)).toEqual(['Acme Mutual Casualty', 'Acme Specialty'])
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'UNDERWRITING_COMPANY_REQUIRED' })
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true, underwritingCompanyId: '00000000-0000-4000-8000-000000000000' })).rejects.toMatchObject({ code: 'UNKNOWN_UNDERWRITING_COMPANY' })
    const company = checks.underwritingCompanies[0]
    const approved = await approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true, underwritingCompanyId: company.companyId })
    expect(approved).toMatchObject({ status: 'COMPLETED', customerAction: 'customer_created', quoteNumber: expect.any(String) })

    const quote = await withTenantTx(TENANT_ID, async (db) => (await toRawQuery(db)(`SELECT * FROM quotes WHERE tenant_id = $1 AND quote_id = $2`, [TENANT_ID, approved.quoteId])).rows[0])
    expect(quote).toMatchObject({ product_code: 'commercial-auto', state: 'OH', status: 'Draft', progress_step: 4 })
    expect(quote.payload.intake).toMatchObject({ submissionId: submission.submissionId, approvedBy: 'uw1' })
    expect(quote.payload.insureds.primary).toMatchObject({ displayName: 'Northline Logistics, LLC', customerId: approved.customerId })
    expect(quote.payload.risks[0]).toMatchObject({ garagingZip: '43215', vehicleCount: 2, driverCount: 4 })
    expect(quote.payload).toMatchObject({ underwritingCompanyId: company.companyId, underwritingCompanyName: 'Acme Mutual Casualty' })
    // Qualification questions are drafted and approved like any other value.
    expect(quote.payload.qualificationAnswers).toMatchObject({ noHazmatHauling: 'yes', fleetMaintained: 'yes' })
    expect(quote.payload.uwAnswers).toMatchObject({ noHazmatHauling: 'yes' })
    // The risk carries the product's structural defaults (its type) but only approved values for reviewed fields.
    expect(quote.payload.risks[0].type).toBeTruthy()
    expect(quote.payload.risks[0].vehicleCount).toBe(2)

    const done = await getSubmission(TENANT_ID, submission.submissionId)
    expect(done).toMatchObject({ status: 'COMPLETED', quoteId: approved.quoteId, customerId: approved.customerId, approvedBy: 'uw1' })
    expect(done.events.map((event) => event.action)).toEqual(expect.arrayContaining(['received', 'reading_requested', 'drafted', 'value_confirmed', 'approved', 'customer_created', 'quote_created']))
    expect(done.events.find((event) => event.action === 'drafted')).toMatchObject({ actorType: 'ai' })
    expect(done.events.find((event) => event.action === 'approved')!.detail.changedFromAi).toContain('insuredName')

    // A completed submission is closed.
    await expect(updateSubmissionField(TENANT_ID, submission.submissionId, 'fein', 'uw1', { action: 'undo' })).rejects.toMatchObject({ code: 'NOT_IN_REVIEW' })
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'NOT_IN_REVIEW' })
  })

  it('replaces product questions and clears confirmations when the reviewer switches products', async () => {
    const submission = await uploadAndRead()
    await confirmEverything(submission.submissionId)
    const original = await getSubmission(TENANT_ID, submission.submissionId)
    const common = original.fields.find(field => field.key === 'insuredName')!
    expect(original.fields.find(field => field.key === 'qual.fleetMaintained')?.status).toBe('accepted')

    await updateSubmissionField(TENANT_ID, submission.submissionId, 'productCode', 'uw1', { action: 'accept', value: 'cyber' })
    const switched = await getSubmission(TENANT_ID, submission.submissionId)
    const questions = switched.fields.filter(field => field.key.startsWith('qual.'))
    expect(questions.map(field => field.key).sort()).toEqual(qualificationTargetFields('cyber').map(field => field.key).sort())
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every(field => field.status === 'pending' && field.value === null && field.decidedBy === null)).toBe(true)
    expect(switched.fields.some(field => field.key === 'qual.fleetMaintained')).toBe(false)
    expect(switched.fields.some(field => field.key === 'risk.vehicleCount')).toBe(false)
    expect(switched.fields.find(field => field.key === 'insuredName')).toEqual(common)
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'UNCONFIRMED_VALUES' })

    // Switching back must not revive previously accepted answers either.
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'qual.mfaRequiredForRemoteAccess', 'uw1', { action: 'accept', value: 'yes' })
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'productCode', 'uw1', { action: 'accept', value: 'commercial-auto' })
    const restored = await getSubmission(TENANT_ID, submission.submissionId)
    expect(restored.fields.find(field => field.key === 'qual.fleetMaintained')).toMatchObject({ status: 'pending', value: null, decidedBy: null })
    expect(restored.fields.some(field => field.key === 'qual.mfaRequiredForRemoteAccess')).toBe(false)
  })

  it('applies branding and intake migrations together', async () => {
    const rows = await getDb()!.query("SELECT name FROM schema_migrations WHERE tenant_id='system' AND version IN (60,61,62) ORDER BY version")
    expect(rows.rows.map(row => row.name)).toEqual(['060_tenant_branding.sql', '061_submission_intake.sql', '062_submission_confidence_score.sql'])
    const columns = await getDb()!.query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND ((table_name='tenants' AND column_name='branding') OR (table_name='submission_fields' AND column_name='confidence_score'))")
    expect(columns.rows).toHaveLength(2)
  })

  it('finds the existing customer, refuses a silent duplicate, and links when the reviewer chooses it', async () => {
    const submission = await uploadAndRead()
    await confirmEverything(submission.submissionId)
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'insuredName', 'uw1', { action: 'accept', value: 'Northline Logistics, LLC' })

    const checks = await getSubmissionChecks(TENANT_ID, submission.submissionId)
    expect(checks.clearance.customerMatches.length).toBeGreaterThan(0)
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true, underwritingCompanyId: checks.underwritingCompanies[0].companyId })).rejects.toMatchObject({ code: 'POTENTIAL_DUPLICATE' })
    // The failed approval created nothing.
    expect(await count(`SELECT COUNT(*) FROM quotes WHERE tenant_id = $1 AND payload->'intake'->>'submissionId' = $2`, [TENANT_ID, submission.submissionId])).toBe(0)
    expect((await getSubmission(TENANT_ID, submission.submissionId)).status).toBe('IN_REVIEW')

    const existing = checks.clearance.customerMatches[0]
    await setCustomerChoice(TENANT_ID, submission.submissionId, 'uw1', { mode: 'existing', customerId: existing.customerId })
    const approved = await approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true, underwritingCompanyId: checks.underwritingCompanies[0].companyId })
    expect(approved).toMatchObject({ customerAction: 'customer_linked', customerId: existing.customerId })
  })

  it('discards a superseded read, keeps tenants apart, and lets a reviewer decline', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'acord125.txt', dataBase64: b64(ACORD) }] })
    const first = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: first.schedule })
    await expect(startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: first.schedule })).rejects.toMatchObject({ code: 'ALREADY_READING' })
    // Force a newer read by expiring the first one, then run the stale job.
    await withTenantTx(TENANT_ID, (db) => toRawQuery(db)(`UPDATE submissions SET ai_run = jsonb_set(ai_run, '{startedAt}', '"2000-01-01T00:00:00Z"') WHERE submission_id = $1`, [submission.submissionId]))
    const second = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: second.schedule, productHint: 'commercial-auto' })
    expect(await runExtraction(first.jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'superseded' })
    expect(await runExtraction(second.jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'drafted' })

    await expect(getSubmission(OTHER_TENANT, submission.submissionId)).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' })
    await expect(updateSubmissionField(OTHER_TENANT, submission.submissionId, 'fein', 'x', { action: 'accept' })).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' })

    await expect(declineSubmission(TENANT_ID, submission.submissionId, 'uw1', {})).rejects.toMatchObject({ code: 'REASON_REQUIRED' })
    expect(await declineSubmission(TENANT_ID, submission.submissionId, 'uw1', { reason: 'Outside appetite' })).toMatchObject({ status: 'DECLINED' })
  })

  it('warns before approval when the values cannot make a valid new customer', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'app.txt', dataBase64: b64('Applicant: Lonely Holdings LLC\nState: OH\nProposed eff. date: 12/01/2026') }] })
    const { jobs, schedule } = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule, productHint: 'cyber' })
    await runExtraction(jobs[0], new BuiltinExtractor())
    await confirmEverything(submission.submissionId)
    const checks = await getSubmissionChecks(TENANT_ID, submission.submissionId)
    expect(checks.clearance.newCustomerProblems.join(' ')).toMatch(/contact method or address/)
    expect(checks.readyToApprove).toBe(false)
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'CUSTOMER_INVALID' })
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'email', 'uw1', { action: 'accept', value: 'ops@lonely.example' })
    // The carrier's customer rules also need a FEIN (or incorporation state) for a company.
    expect((await getSubmissionChecks(TENANT_ID, submission.submissionId)).clearance.newCustomerProblems.join(' ')).toMatch(/FEIN/)
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'fein', 'uw1', { action: 'accept', value: '12-3456789' })
    const after = await getSubmissionChecks(TENANT_ID, submission.submissionId)
    expect({ ready: after.readyToApprove, problems: after.clearance.newCustomerProblems, missing: after.missingRequired, unconfirmed: after.unconfirmed }).toEqual({ ready: true, problems: [], missing: [], unconfirmed: 0 })
  })

  it('records a failed read when nothing can be read without an AI model', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'scan.pdf', dataBase64: b64('%PDF-1.4 scanned') }] })
    const { jobs, schedule } = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule })
    expect(await runExtraction(jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'failed' })
    const failed = await getSubmission(TENANT_ID, submission.submissionId)
    expect(failed.status).toBe('READ_FAILED')
    expect(failed.readError).toMatch(/cannot read these documents/)
  })

  it('rejects unsupported and oversized uploads', async () => {
    await expect(createSubmission(TENANT_ID, 'agent1', { documents: [] })).rejects.toMatchObject({ code: 'NO_DOCUMENTS' })
    await expect(createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'tool.exe', dataBase64: b64('MZ') }] })).rejects.toMatchObject({ code: 'UNSUPPORTED_DOCUMENT' })
    await expect(createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'a.txt', dataBase64: '***' }] })).rejects.toMatchObject({ code: 'INVALID_DOCUMENT' })
  })

  it('rolls back customer creation and approval when all quote number retries collide', async () => {
    const submission = await uploadAndRead(' Retry Exhaustion')
    await confirmEverything(submission.submissionId)
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'fein', 'uw1', { action: 'accept', value: '55-9876543' })
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'addressLine1', 'uw1', { action: 'accept', value: '982 Retry Lane' })
    const checks = await getSubmissionChecks(TENANT_ID, submission.submissionId)
    expect(checks.clearance.customerMatches).toEqual([])
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.123456789)
    try {
      await withTenantTx(TENANT_ID, db => insertDraftQuote(toRawQuery(db), TENANT_ID, { payload: { productCode: 'cyber' } }, 'uw1'))
      const customers = await count('SELECT COUNT(*) FROM customers WHERE tenant_id = $1', [TENANT_ID])
      await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', {
        attestation: true, underwritingCompanyId: checks.underwritingCompanies[0].companyId,
      })).rejects.toMatchObject({ code: '23505' })
      expect(await count('SELECT COUNT(*) FROM customers WHERE tenant_id = $1', [TENANT_ID])).toBe(customers)
      expect(await count("SELECT COUNT(*) FROM quotes WHERE tenant_id = $1 AND payload->'intake'->>'submissionId' = $2", [TENANT_ID, submission.submissionId])).toBe(0)
      const current = await getSubmission(TENANT_ID, submission.submissionId)
      expect(current).toMatchObject({ status: 'IN_REVIEW', quoteId: null, customerId: null, approvedAt: null })
      expect(current.events.some(event => ['approved', 'customer_created', 'quote_created'].includes(event.action))).toBe(false)
    } finally { random.mockRestore() }
  })

  it('retries a quote collision successfully and leaves the caller transaction usable', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.234567891)
    try {
      const first = await withTenantTx(TENANT_ID, db => insertDraftQuote(toRawQuery(db), TENANT_ID, { payload: { productCode: 'cyber' } }, 'uw1'))
      random.mockReturnValueOnce(0.234567891).mockReturnValue(0.345678912)
      await withTenantTx(TENANT_ID, async db => {
        const q = toRawQuery(db)
        const second = await insertDraftQuote(q, TENANT_ID, { payload: { productCode: 'cyber' } }, 'uw1')
        expect(second.quoteNumber).not.toBe(first.quoteNumber)
        expect((await q('SELECT quote_id FROM quotes WHERE tenant_id = $1 AND quote_id = $2', [TENANT_ID, second.quoteId])).rows).toHaveLength(1)
      })
    } finally { random.mockRestore() }
  })

  it('returns the durable upload on queue failure and gates manual recovery by permission and tenant', async () => {
    const schedule = vi.spyOn(scheduler, 'scheduleExtraction').mockRejectedValue(new Error('queue offline'))
    const app = intakeApi()
    try {
      const uploaded = await request(app).post('/api/v1/submissions').set('X-Permissions', 'submissions.manage')
        .send({ documents: [{ fileName: 'app.txt', dataBase64: b64(ACORD) }] }).expect(201)
      expect(uploaded.body).toMatchObject({ submissionId: expect.any(String), status: 'READ_FAILED' })
      const path = `/api/v1/submissions/${uploaded.body.submissionId}/manual-review`
      await request(app).post(path).expect(401)
      await request(app).post(path).set('X-Permissions', 'submissions.read').expect(403)
      await request(app).post(path).set('X-Permissions', 'submissions.manage').set('X-Tenant', OTHER_TENANT).expect(404)
      await request(app).post(path).set('X-Permissions', 'submissions.manage').expect(200)
      expect((await getSubmission(TENANT_ID, uploaded.body.submissionId)).status).toBe('IN_REVIEW')
    } finally { schedule.mockRestore() }
  })

  it('persists scheduling failure, rejects late jobs, and allows immediate retry', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'app.txt', dataBase64: b64(ACORD) }] })
    const late = capture()
    const result = await startReading(TENANT_ID, submission.submissionId, 'agent1', {
      productHint: 'commercial-auto', schedule: async job => { await late.schedule(job); throw new Error('private queue credentials') },
    })
    expect(result).toMatchObject({ submissionId: submission.submissionId, status: 'READ_FAILED' })
    const failed = await getSubmission(TENANT_ID, submission.submissionId)
    expect(failed.readError).toMatch(/could not be queued/)
    expect(JSON.stringify(failed)).not.toContain('private queue credentials')
    expect(failed.aiRun.finishedAt).toBeTruthy()
    expect(failed.events.some(event => event.action === 'reading_schedule_failed')).toBe(true)
    expect(await runExtraction(late.jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'superseded' })
    const retry = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: retry.schedule })
    expect(await runExtraction(retry.jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'drafted' })
  })

  it('does not overwrite a newer read when an earlier scheduling call fails late', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'app.txt', dataBase64: b64(ACORD) }] })
    const newer = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: async () => {
      await withTenantTx(TENANT_ID, db => toRawQuery(db)(`UPDATE submissions SET ai_run = jsonb_set(ai_run, '{startedAt}', '"2000-01-01T00:00:00Z"') WHERE submission_id = $1`, [submission.submissionId]))
      await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: newer.schedule })
      throw new Error('late queue failure')
    } })
    const current = await getSubmission(TENANT_ID, submission.submissionId)
    expect(current).toMatchObject({ status: 'READING', readError: null, aiRun: { runToken: newer.jobs[0].runToken } })
    expect(await runExtraction(newer.jobs[0], new BuiltinExtractor())).toEqual({ outcome: 'drafted' })
  })

  it('recovers a first failed read manually with blank pending fields and no AI or business writes', async () => {
    const submission = await createSubmission(TENANT_ID, 'agent1', { documents: [{ fileName: 'scan.pdf', dataBase64: b64('%PDF-1.4 scanned') }] })
    const first = capture()
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: first.schedule, productHint: 'cyber' })
    await runExtraction(first.jobs[0], new BuiltinExtractor())
    await expect(startManualReview(OTHER_TENANT, submission.submissionId, 'uw1')).rejects.toMatchObject({ code: 'SUBMISSION_NOT_FOUND' })
    await startManualReview(TENANT_ID, submission.submissionId, 'uw1')
    const manual = await getSubmission(TENANT_ID, submission.submissionId)
    expect(manual.status).toBe('IN_REVIEW')
    expect(manual.fields.length).toBeGreaterThan(0)
    expect(manual.fields.every(field => field.value === null && field.aiValue === null && field.status === 'pending' && field.confidence === 'missing' && field.confidenceScore === null && !field.evidence.length)).toBe(true)
    expect(manual.events.some(event => event.action === 'manual_review_started' && event.actor === 'uw1')).toBe(true)
    await expect(approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })).rejects.toMatchObject({ code: 'UNCONFIRMED_VALUES' })
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'productCode', 'uw1', { action: 'accept', value: 'cyber' })
    await confirmEverything(submission.submissionId)
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'fein', 'uw1', { action: 'accept', value: '55-1234567' })
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'email', 'uw1', { action: 'accept', value: 'manual@synthetic.example' })
    const approved = await approveSubmission(TENANT_ID, submission.submissionId, 'uw1', { attestation: true })
    expect(approved.status).toBe('COMPLETED')
    await expect(startManualReview(TENANT_ID, submission.submissionId, 'uw1')).rejects.toMatchObject({ code: 'NOT_READ_FAILED' })
  })

  it('preserves reviewed values when a reread cannot be queued and manual review resumes', async () => {
    const submission = await uploadAndRead(' Preserve')
    await updateSubmissionField(TENANT_ID, submission.submissionId, 'insuredName', 'uw1', { action: 'accept', value: 'Reviewer Preserved LLC' })
    const before = await getSubmission(TENANT_ID, submission.submissionId)
    await startReading(TENANT_ID, submission.submissionId, 'agent1', { schedule: async () => { throw new Error('queue offline') } })
    await startManualReview(TENANT_ID, submission.submissionId, 'uw1')
    expect((await getSubmission(TENANT_ID, submission.submissionId)).fields).toEqual(before.fields)
  })
})
