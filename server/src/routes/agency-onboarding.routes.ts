import type { Request } from 'express'
import { Router } from 'express'
import XLSX from 'xlsx'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { hasPermission } from '../auth.js'
import {
  encryptSensitiveValue,
  hashSensitiveValue,
  normalizeSensitiveValue
} from '../customerCrypto.js'
import { today } from '../lib/date.utils.js'
import { csvEscape, sanitizeText } from '../lib/utils.js'

type QueryFn = (text: string, params?: any[]) => Promise<any>

type OnboardingMode = 'UPLOAD' | 'SERVICE_HIT' | 'MANUAL'
type EntityType = 'AGENCY' | 'PRODUCER' | 'LICENSE' | 'APPOINTMENT' | 'COMMISSION'
type RootEntityType = 'AGENCY' | 'PRODUCER'
type IdempotencyStrategy = 'EXTERNAL_ID_WINS' | 'KEY_WINS' | 'ALWAYS_CREATE'
type ConflictBehavior = 'SKIP' | 'OVERWRITE_ALLOWED' | 'REQUIRE_APPROVAL'
type JobStatus = 'RUNNING' | 'SUCCEEDED' | 'PARTIAL' | 'FAILED'
type RowStatus = 'STAGED' | 'VALIDATED' | 'ERROR' | 'COMMITTED' | 'FAILED' | 'SKIPPED' | 'PENDING_APPROVAL'
type RowAction = 'CREATE' | 'UPDATE' | 'SKIP'

type OnboardingConfig = {
  keyPatterns: {
    agency: string
    producer: string
  }
  agencyCode: {
    prefix: string
    digits: number
    startAt: number
  }
  requiredFields: {
    agency: { legalName: boolean; npnOrFeinLast4: boolean; contactOrAddress: boolean }
    producer: { firstAndLast: boolean; npn: boolean }
    license: { state: boolean; lineOfAuthority: boolean; status: boolean }
    appointment: { carrierCode: boolean; state: boolean; productCode: boolean; status: boolean }
    commission: { productCode: boolean; state: boolean; rates: boolean }
  }
  allowOverlappingEffectivePeriods: boolean
  defaultIdempotencyBySource: Record<string, IdempotencyStrategy>
  requireApprovalOnSensitiveChange: boolean
  requireApprovalOnMerge: boolean
  requireApprovalOnTermination: boolean
  requireApprovalOnCommissionOverride: boolean
  blockDeactivateWithActivePolicies: boolean
}

type ParsedInputRow = {
  sourceSheet: string
  entityType: EntityType
  rawPayload: Record<string, any>
}

type CanonicalStagingRow = {
  rowId: string
  rowNo: number
  sourceSheet: string
  entityType: EntityType
  rawPayload: Record<string, any>
  canonicalPayload: Record<string, any>
  actionType: RowAction
  rowStatus: RowStatus
  validationErrors: string[]
  validationWarnings: string[]
  matchCandidates: MatchCandidate[]
}

type MatchCandidate = {
  entityType: RootEntityType
  entityId: string
  entityKey: string
  displayName: string
  score: number
  reason: string
  source: 'EXTERNAL_ID' | 'NPN' | 'NAME' | 'EMAIL' | 'PHONE' | 'KEY'
}

type CommitResult = {
  status: RowStatus
  actionType: RowAction
  message: string
  linkedEntityType?: RootEntityType
  linkedEntityId?: string
  created: number
  updated: number
  skipped: number
  failed: number
}

const MODE_VALUES: OnboardingMode[] = ['UPLOAD', 'SERVICE_HIT', 'MANUAL']
const ENTITY_VALUES: EntityType[] = ['AGENCY', 'PRODUCER', 'LICENSE', 'APPOINTMENT', 'COMMISSION']
const ROOT_ENTITY_VALUES: RootEntityType[] = ['AGENCY', 'PRODUCER']
const IDEMPOTENCY_VALUES: IdempotencyStrategy[] = ['EXTERNAL_ID_WINS', 'KEY_WINS', 'ALWAYS_CREATE']
const CONFLICT_VALUES: ConflictBehavior[] = ['SKIP', 'OVERWRITE_ALLOWED', 'REQUIRE_APPROVAL']
const ROW_ACTION_VALUES: RowAction[] = ['CREATE', 'UPDATE', 'SKIP']
const ROW_STATUS_VALUES: RowStatus[] = ['STAGED', 'VALIDATED', 'ERROR', 'COMMITTED', 'FAILED', 'SKIPPED', 'PENDING_APPROVAL']
const JOB_STATUS_VALUES: JobStatus[] = ['RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED']
const LIC_STATUS_VALUES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'PENDING']
const APPOINTMENT_STATUS_VALUES = ['REQUESTED', 'ACTIVE', 'TERMINATED', 'PENDING']
const SERVICE_NAMES = [
  'Pull from CRM',
  'Pull from NIPR licensing feed',
  'Pull from MGA system',
  'Push to downstream appointment system',
  'Validate via external service'
] as const

const DEFAULT_ONBOARDING_CONFIG: OnboardingConfig = {
  keyPatterns: {
    agency: 'AGY-{TENANT}-{YYYY}-{SEQ6}',
    producer: 'PROD-{TENANT}-{YYYY}-{SEQ6}'
  },
  agencyCode: {
    prefix: 'AG',
    digits: 4,
    startAt: 1
  },
  requiredFields: {
    agency: { legalName: true, npnOrFeinLast4: true, contactOrAddress: true },
    producer: { firstAndLast: true, npn: true },
    license: { state: true, lineOfAuthority: true, status: true },
    appointment: { carrierCode: true, state: true, productCode: true, status: true },
    commission: { productCode: true, state: true, rates: true }
  },
  allowOverlappingEffectivePeriods: false,
  defaultIdempotencyBySource: { DEFAULT: 'EXTERNAL_ID_WINS' },
  requireApprovalOnSensitiveChange: true,
  requireApprovalOnMerge: true,
  requireApprovalOnTermination: true,
  requireApprovalOnCommissionOverride: true,
  blockDeactivateWithActivePolicies: true
}

export const onboardingAdminRoutes = Router()

onboardingAdminRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Agency onboarding requires database mode' })
  }
  next()
})

onboardingAdminRoutes.get('/settings', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  try {
    const settings = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadOnboardingConfig(q, tenantId)
    })
    return res.json(settings)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.patch('/settings', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  try {
    const payload = req.body || {}
    const next = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const current = await loadOnboardingConfig(q, tenantId)
      const normalized = normalizeOnboardingConfig(payload, current)
      await q('UPDATE tenants SET onboarding_config = $2::jsonb WHERE tenant_id = $1', [tenantId, JSON.stringify(normalized)])
      return normalized
    })
    return res.json(next)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.get('/agencies/search', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const qText = sanitizeText(req.query.q)
  const parentAgencyId = sanitizeText(req.query.parentAgencyId)
  const status = sanitizeText(req.query.status).toUpperCase()
  const limit = clampInt(req.query.limit, 25, 1, 200)
  const allowedStatuses = new Set(['PROSPECT', 'PENDING_COMPLIANCE', 'PENDING_CONTRACT', 'PENDING_APPOINTMENT', 'ACTIVE', 'SUSPENDED', 'TERMINATED'])
  if (parentAgencyId && !isUuid(parentAgencyId)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'parentAgencyId is invalid' })
  }
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const params: any[] = [tenantId]
      const clauses = ['a.tenant_id = $1']
      let idx = 2
      if (status && allowedStatuses.has(status)) {
        clauses.push(`a.status = $${idx}`)
        params.push(status)
        idx += 1
      }
      if (parentAgencyId) {
        clauses.push(`a.parent_agency_id = $${idx}::uuid`)
        params.push(parentAgencyId)
        idx += 1
      }
      if (qText) {
        clauses.push(`(
          a.agency_key ILIKE $${idx}
          OR a.agency_code ILIKE $${idx}
          OR a.legal_name ILIKE $${idx}
          OR coalesce(a.dba_name, '') ILIKE $${idx}
          OR coalesce(a.agency_np_number, '') ILIKE $${idx}
          OR coalesce(p.agency_code, '') ILIKE $${idx}
          OR coalesce(p.legal_name, '') ILIKE $${idx}
        )`)
        params.push(`%${qText}%`)
        idx += 1
      }
      params.push(limit)
      const rows = await q(
        `SELECT a.agency_id, a.agency_key, a.agency_code, a.legal_name, a.dba_name, a.agency_np_number, a.agency_type, a.commission_rate,
                a.status, a.updated_at, a.created_at, a.updated_by, a.parent_agency_id,
                p.agency_key AS parent_agency_key, p.agency_code AS parent_agency_code, p.legal_name AS parent_legal_name
           FROM agencies a
      LEFT JOIN agencies p
             ON p.tenant_id = a.tenant_id
            AND p.agency_id = a.parent_agency_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY a.updated_at DESC, a.legal_name ASC
          LIMIT $${idx}`,
        params
      )
      return (rows.rows || []).map((row: any) => ({
        agencyId: row.agency_id,
        agencyKey: row.agency_key,
        agencyCode: row.agency_code,
        legalName: row.legal_name,
        dbaName: row.dba_name || null,
        npn: row.agency_np_number || null,
        agencyType: row.agency_type || null,
        commissionRate: row.commission_rate === null || row.commission_rate === undefined ? null : Number(row.commission_rate),
        status: row.status,
        parentAgencyId: row.parent_agency_id || null,
        parentAgencyKey: row.parent_agency_key || null,
        parentAgencyCode: row.parent_agency_code || null,
        parentAgencyName: row.parent_legal_name || null,
        updatedAt: normalizeTimestamp(row.updated_at),
        createdAt: normalizeTimestamp(row.created_at),
        updatedBy: row.updated_by || null
      }))
    })
    return res.json(output)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.get('/agencies/:agencyId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const agencyId = sanitizeText(req.params.agencyId)
  if (!isUuid(agencyId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const agency = await loadAgencyRowWithParent(q, tenantId, agencyId)
      if (!agency.rowCount) throw new Error('NOT_FOUND')
      const contacts = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid
          ORDER BY preferred_flag DESC, contact_type ASC, created_at ASC`,
        [tenantId, agencyId]
      )
      return {
        agency: mapAgencyRow(agency.rows[0]),
        contacts: (contacts.rows || []).map(mapContactRow)
      }
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

onboardingAdminRoutes.post('/agencies', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const config = await loadOnboardingConfig(q, tenantId)
      const payload = req.body && typeof req.body === 'object' ? req.body : {}
      const result = await upsertAgencyEntity(q, tenantId, payload, {
        actor,
        strategy: 'ALWAYS_CREATE',
        conflictBehavior: 'SKIP',
        canApprove: true,
        config,
        reason: 'AGENCY_MANUAL_CREATE'
      })
      if (!result.linkedEntityId) throw new Error('CREATE_FAILED')
      const contactsResult = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid
          ORDER BY preferred_flag DESC, contact_type ASC, created_at ASC`,
        [tenantId, result.linkedEntityId]
      )
      const agencyResult = await loadAgencyRowWithParent(q, tenantId, result.linkedEntityId)
      return {
        agency: mapAgencyRow(agencyResult.rows[0]),
        contacts: (contactsResult.rows || []).map(mapContactRow)
      }
    })
    return res.status(201).json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg.includes('duplicate key value')) {
      return res.status(409).json({ code: 'DUPLICATE', message: 'Agency key/code/NPN already exists for this tenant' })
    }
    if (msg === 'PARENT_AGENCY_ID_INVALID') return res.status(400).json({ code: 'INVALID_INPUT', message: 'parentAgencyId is invalid' })
    if (msg === 'PARENT_AGENCY_NOT_FOUND') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Parent agency was not found' })
    if (msg === 'PARENT_AGENCY_SELF_REFERENCE') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Agency cannot be its own parent' })
    return res.status(400).json({ code: 'CREATE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.patch('/agencies/:agencyId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const agencyId = sanitizeText(req.params.agencyId)
  if (!isUuid(agencyId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const beforeResult = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_id=$2::uuid LIMIT 1', [tenantId, agencyId])
      if (!beforeResult.rowCount) throw new Error('NOT_FOUND')
      const before = beforeResult.rows[0]
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const shouldResolveParentAgency =
        hasOwn(body, 'parentAgencyId') ||
        hasOwn(body, 'parentAgencyKey') ||
        hasOwn(body, 'parentAgencyCode') ||
        hasOwn(body, 'parent_agency_id') ||
        hasOwn(body, 'parent_agency_key') ||
        hasOwn(body, 'parent_agency_code')
      const legalName = sanitizeText(body.legalName || before.legal_name)
      const npn = sanitizeText(body.npn || before.agency_np_number)
      const feinLast4Input = normalizeLast4(body.feinLast4 || before.fein_last4)
      if (!legalName) throw new Error('LEGAL_NAME_REQUIRED')
      if (!npn && !feinLast4Input) throw new Error('NPN_OR_FEIN_REQUIRED')

      const settings = await loadOnboardingConfig(q, tenantId)
      const agencyCode = sanitizeText(body.agencyCode || before.agency_code).toUpperCase() || (await nextAgencyCode(q, tenantId, settings))
      const parentAgencyId = shouldResolveParentAgency
        ? await resolveParentAgencyId(q, tenantId, body, agencyId)
        : (before.parent_agency_id || null)
      const feinNormalized = normalizeSensitiveValue(feinLast4Input || '')
      const feinEncrypted = feinNormalized ? encryptSensitiveValue(feinNormalized) : before.fein_encrypted
      const feinHash = feinNormalized ? hashSensitiveValue(feinNormalized) : before.fein_hash
      const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : (before.metadata || {})

      await q(
        `UPDATE agencies
            SET agency_code=$3,
                agency_key=$4,
                status=$5,
                legal_name=$6,
                dba_name=$7,
                fein_encrypted=$8,
                fein_last4=$9,
                fein_hash=$10,
                agency_np_number=$11,
                agency_type=$12,
                commission_rate=$13,
                eo_carrier=$14,
                eo_policy_no=$15,
                eo_expiry_date=$16::date,
                ach_token_ref=$17,
                effective_from=$18::date,
                effective_to=$19::date,
                metadata=$20::jsonb,
                parent_agency_id=$21::uuid,
                updated_at=now(),
                updated_by=$22,
                version=version+1
          WHERE tenant_id=$1 AND agency_id=$2::uuid`,
        [
          tenantId,
          agencyId,
          agencyCode,
          sanitizeText(body.agencyKey || before.agency_key),
          normalizeAgencyStatus(body.status || before.status),
          legalName,
          toNullable(body.dbaName ?? before.dba_name),
          feinEncrypted,
          feinLast4Input || null,
          feinHash,
          toNullable(npn),
          normalizeAgencyType(body.agencyType || before.agency_type),
          toOptionalNumber(body.commissionRate ?? before.commission_rate),
          toNullable(body.eoCarrier ?? before.eo_carrier),
          toNullable(body.eoPolicyNo ?? before.eo_policy_no),
          normalizeDate(body.eoExpiryDate ?? before.eo_expiry_date),
          toNullable(body.achTokenRef ?? before.ach_token_ref),
          normalizeDate(body.effectiveFrom ?? before.effective_from),
          normalizeDate(body.effectiveTo ?? before.effective_to),
          JSON.stringify(metadata),
          parentAgencyId,
          actor
        ]
      )
      const afterResult = await loadAgencyRowWithParent(q, tenantId, agencyId)
      await appendAuditEvent(q, {
        tenantId,
        entityType: 'AGENCY',
        entityId: agencyId,
        eventType: 'AGENCY_UPDATED',
        actor,
        reason: 'AGENCY_MANUAL_UPDATE',
        beforeJson: before,
        afterJson: afterResult.rows[0]
      })
      const contactsResult = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid
          ORDER BY preferred_flag DESC, contact_type ASC, created_at ASC`,
        [tenantId, agencyId]
      )
      return {
        agency: mapAgencyRow(afterResult.rows[0]),
        contacts: (contactsResult.rows || []).map(mapContactRow)
      }
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'LEGAL_NAME_REQUIRED') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Agency legal name is required' })
    if (msg === 'NPN_OR_FEIN_REQUIRED') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Agency NPN or FEIN last4 is required' })
    if (msg === 'PARENT_AGENCY_ID_INVALID') return res.status(400).json({ code: 'INVALID_INPUT', message: 'parentAgencyId is invalid' })
    if (msg === 'PARENT_AGENCY_NOT_FOUND') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Parent agency was not found' })
    if (msg === 'PARENT_AGENCY_SELF_REFERENCE') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Agency cannot be its own parent' })
    if (msg.includes('duplicate key value')) {
      return res.status(409).json({ code: 'DUPLICATE', message: 'Agency key/code/NPN already exists for this tenant' })
    }
    return res.status(400).json({ code: 'UPDATE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.get('/agencies/:agencyId/contacts', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const agencyId = sanitizeText(req.params.agencyId)
  if (!isUuid(agencyId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const agency = await q('SELECT agency_id FROM agencies WHERE tenant_id=$1 AND agency_id=$2::uuid LIMIT 1', [tenantId, agencyId])
      if (!agency.rowCount) throw new Error('NOT_FOUND')
      const contacts = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid
          ORDER BY preferred_flag DESC, contact_type ASC, created_at ASC`,
        [tenantId, agencyId]
      )
      return (contacts.rows || []).map(mapContactRow)
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: msg })
  }
})

onboardingAdminRoutes.post('/agencies/:agencyId/contacts', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const agencyId = sanitizeText(req.params.agencyId)
  if (!isUuid(agencyId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const agency = await q('SELECT agency_id FROM agencies WHERE tenant_id=$1 AND agency_id=$2::uuid LIMIT 1', [tenantId, agencyId])
      if (!agency.rowCount) throw new Error('NOT_FOUND')
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const contactType = sanitizeText(body.contactType).toUpperCase()
      const value = sanitizeText(body.value)
      if (!['PHONE', 'EMAIL'].includes(contactType)) throw new Error('CONTACT_TYPE_INVALID')
      if (!value) throw new Error('CONTACT_VALUE_REQUIRED')
      const preferred = toBoolean(body.preferred, false)
      if (preferred) {
        await q(
          `UPDATE onboarding_contact_points
              SET preferred_flag=false, updated_at=now(), updated_by=$4
            WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_type=$3`,
          [tenantId, agencyId, contactType, actor]
        )
      }
      const inserted = await q(
        `INSERT INTO onboarding_contact_points (
          contact_id, tenant_id, entity_type, entity_id, contact_type, sub_type, value, normalized_value,
          extension, preferred_flag, verified_flag, bounce_flag, sms_consent, email_consent,
          contact_window, language_preference, effective_from, effective_to, metadata,
          created_at, created_by, updated_at, updated_by
        ) VALUES (
          $1::uuid,$2,'AGENCY',$3::uuid,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17::date,$18::jsonb,now(),$19,now(),$19
        )
        RETURNING *`,
        [
          uuidv4(),
          tenantId,
          agencyId,
          contactType,
          toNullable(body.subType),
          value,
          contactType === 'EMAIL' ? value.toLowerCase() : value.replace(/\D+/g, ''),
          toNullable(body.extension),
          preferred,
          toBoolean(body.verified, false),
          toBoolean(body.bounce, false),
          toBoolean(body.smsConsent, false),
          toBoolean(body.emailConsent, false),
          toNullable(body.contactWindow),
          toNullable(body.languagePreference),
          normalizeDate(body.effectiveFrom),
          normalizeDate(body.effectiveTo),
          JSON.stringify(normalizeObject(body.metadata)),
          actor
        ]
      )
      await appendAuditEvent(q, {
        tenantId,
        entityType: 'AGENCY',
        entityId: agencyId,
        eventType: 'AGENCY_CONTACT_ADDED',
        actor,
        reason: 'AGENCY_CONTACT_ADD',
        beforeJson: null,
        afterJson: inserted.rows[0]
      })
      return mapContactRow(inserted.rows[0])
    })
    return res.status(201).json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'CONTACT_TYPE_INVALID') return res.status(400).json({ code: 'INVALID_INPUT', message: 'contactType must be PHONE or EMAIL' })
    if (msg === 'CONTACT_VALUE_REQUIRED') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Contact value is required' })
    return res.status(400).json({ code: 'CONTACT_CREATE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.patch('/agencies/:agencyId/contacts/:contactId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const agencyId = sanitizeText(req.params.agencyId)
  const contactId = sanitizeText(req.params.contactId)
  if (!isUuid(agencyId) || !isUuid(contactId)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId or contactId is invalid' })
  }
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existingResult = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_id=$3::uuid
          LIMIT 1`,
        [tenantId, agencyId, contactId]
      )
      if (!existingResult.rowCount) throw new Error('NOT_FOUND')
      const existing = existingResult.rows[0]
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const contactType = sanitizeText(body.contactType || existing.contact_type).toUpperCase()
      const value = sanitizeText(body.value ?? existing.value)
      if (!['PHONE', 'EMAIL'].includes(contactType)) throw new Error('CONTACT_TYPE_INVALID')
      if (!value) throw new Error('CONTACT_VALUE_REQUIRED')
      const preferred = toBoolean(body.preferred, existing.preferred_flag)
      if (preferred) {
        await q(
          `UPDATE onboarding_contact_points
              SET preferred_flag=false, updated_at=now(), updated_by=$4
            WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_type=$3 AND contact_id<>$5::uuid`,
          [tenantId, agencyId, contactType, actor, contactId]
        )
      }
      const updatedResult = await q(
        `UPDATE onboarding_contact_points
            SET contact_type=$4,
                sub_type=$5,
                value=$6,
                normalized_value=$7,
                extension=$8,
                preferred_flag=$9,
                verified_flag=$10,
                bounce_flag=$11,
                sms_consent=$12,
                email_consent=$13,
                contact_window=$14,
                language_preference=$15,
                effective_from=$16::date,
                effective_to=$17::date,
                metadata=$18::jsonb,
                updated_at=now(),
                updated_by=$19
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_id=$3::uuid
          RETURNING *`,
        [
          tenantId,
          agencyId,
          contactId,
          contactType,
          toNullable(body.subType ?? existing.sub_type),
          value,
          contactType === 'EMAIL' ? value.toLowerCase() : value.replace(/\D+/g, ''),
          toNullable(body.extension ?? existing.extension),
          preferred,
          toBoolean(body.verified, existing.verified_flag),
          toBoolean(body.bounce, existing.bounce_flag),
          toBoolean(body.smsConsent, existing.sms_consent),
          toBoolean(body.emailConsent, existing.email_consent),
          toNullable(body.contactWindow ?? existing.contact_window),
          toNullable(body.languagePreference ?? existing.language_preference),
          normalizeDate(body.effectiveFrom ?? existing.effective_from),
          normalizeDate(body.effectiveTo ?? existing.effective_to),
          JSON.stringify(normalizeObject(body.metadata ?? existing.metadata)),
          actor
        ]
      )
      await appendAuditEvent(q, {
        tenantId,
        entityType: 'AGENCY',
        entityId: agencyId,
        eventType: 'AGENCY_CONTACT_UPDATED',
        actor,
        reason: 'AGENCY_CONTACT_UPDATE',
        beforeJson: existing,
        afterJson: updatedResult.rows[0]
      })
      return mapContactRow(updatedResult.rows[0])
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'CONTACT_TYPE_INVALID') return res.status(400).json({ code: 'INVALID_INPUT', message: 'contactType must be PHONE or EMAIL' })
    if (msg === 'CONTACT_VALUE_REQUIRED') return res.status(400).json({ code: 'INVALID_INPUT', message: 'Contact value is required' })
    return res.status(400).json({ code: 'CONTACT_UPDATE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.delete('/agencies/:agencyId/contacts/:contactId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const agencyId = sanitizeText(req.params.agencyId)
  const contactId = sanitizeText(req.params.contactId)
  if (!isUuid(agencyId) || !isUuid(contactId)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'agencyId or contactId is invalid' })
  }
  try {
    await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existingResult = await q(
        `SELECT *
           FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_id=$3::uuid
          LIMIT 1`,
        [tenantId, agencyId, contactId]
      )
      if (!existingResult.rowCount) throw new Error('NOT_FOUND')
      const existing = existingResult.rows[0]
      await q(
        `DELETE FROM onboarding_contact_points
          WHERE tenant_id=$1 AND entity_type='AGENCY' AND entity_id=$2::uuid AND contact_id=$3::uuid`,
        [tenantId, agencyId, contactId]
      )
      await appendAuditEvent(q, {
        tenantId,
        entityType: 'AGENCY',
        entityId: agencyId,
        eventType: 'AGENCY_CONTACT_DELETED',
        actor,
        reason: 'AGENCY_CONTACT_DELETE',
        beforeJson: existing,
        afterJson: null
      })
    })
    return res.status(204).send()
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(400).json({ code: 'CONTACT_DELETE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.get('/template', async (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase()
  if (format === 'json') return res.json(buildTemplateJson())
  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    for (const sheet of buildTemplateSheets()) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet.rows), sheet.name)
    }
    const data = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename=\"agency-onboarding-template.xlsx\"')
    return res.send(data)
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename=\"agency-onboarding-template.csv\"')
  return res.send(buildTemplateCsv())
})

onboardingAdminRoutes.post('/jobs', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const mode = normalizeMode(req.body?.mode)
  if (!mode) return res.status(400).json({ code: 'INVALID_INPUT', message: 'mode is required' })
  try {
    const settings = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadOnboardingConfig(q, tenantId)
    })
    const sourceSystem = sanitizeText(req.body?.sourceSystem) || 'DEFAULT'
    const strategy = normalizeIdempotency(req.body?.idempotencyStrategy) ||
      settings.defaultIdempotencyBySource[sourceSystem] ||
      settings.defaultIdempotencyBySource.DEFAULT ||
      'EXTERNAL_ID_WINS'
    const conflictBehavior = normalizeConflictBehavior(req.body?.conflictBehavior) || 'SKIP'
    const created = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const result = await q(
        `INSERT INTO onboarding_jobs (
          job_id, tenant_id, mode, source_type, source_name, source_system,
          idempotency_strategy, conflict_behavior, status, request_payload,
          created_at, created_by, updated_at, updated_by, started_at
        ) VALUES (
          $1::uuid,$2,$3,$4,$5,$6,$7,$8,'RUNNING',$9::jsonb,now(),$10,now(),$10,now()
        )
        RETURNING *`,
        [
          uuidv4(),
          tenantId,
          mode,
          sanitizeText(req.body?.sourceType) || null,
          sanitizeText(req.body?.sourceName) || null,
          sourceSystem,
          strategy,
          conflictBehavior,
          JSON.stringify(req.body?.requestPayload || {}),
          actor
        ]
      )
      return mapJobRow(result.rows[0])
    })
    return res.status(201).json(created)
  } catch (e: any) {
    return res.status(500).json({ code: 'JOB_CREATE_FAILED', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/upload', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.upload', 'admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.upload' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  const fileName = sanitizeText(req.body?.fileName) || 'upload.json'
  const mimeType = sanitizeText(req.body?.mimeType) || ''
  const dataBase64 = String(req.body?.dataBase64 || '').trim()
  if (!dataBase64) return res.status(400).json({ code: 'INVALID_INPUT', message: 'dataBase64 is required' })

  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const job = await loadJobRow(q, tenantId, jobId)
      if (!job) throw new Error('JOB_NOT_FOUND')
      const parsedRows = parseUploadedRows({ fileName, mimeType, dataBase64 })
      if (!parsedRows.length) throw new Error('NO_ROWS')
      await q('DELETE FROM onboarding_job_rows WHERE tenant_id=$1 AND job_id=$2::uuid', [tenantId, jobId])
      let rowNo = 1
      for (const parsed of parsedRows) {
        await q(
          `INSERT INTO onboarding_job_rows (
            row_id, tenant_id, job_id, row_no, source_sheet, entity_type, raw_payload,
            canonical_payload, action_type, row_status, validation_errors, validation_warnings, match_candidates,
            created_at, updated_at
          ) VALUES (
            $1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,'{}'::jsonb,'CREATE','STAGED','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,now(),now()
          )`,
          [uuidv4(), tenantId, jobId, rowNo++, parsed.sourceSheet, parsed.entityType, JSON.stringify(parsed.rawPayload || {})]
        )
      }
      await q(
        `UPDATE onboarding_jobs
            SET mode='UPLOAD',
                source_type='UPLOAD',
                source_name=$3,
                request_payload=$4::jsonb,
                total_received=$5,
                total_validated=0,
                total_created=0,
                total_updated=0,
                total_skipped=0,
                total_failed=0,
                status='RUNNING',
                finished_at=null,
                updated_at=now(),
                updated_by=$6
          WHERE tenant_id=$1 AND job_id=$2::uuid`,
        [tenantId, jobId, fileName, JSON.stringify({ fileName, mimeType }), parsedRows.length, actor]
      )
      await appendJobLog(q, tenantId, jobId, `Upload parsed: ${fileName} (${parsedRows.length} rows)`, actor)
      return {
        jobId,
        received: parsedRows.length,
        previewByEntity: summarizeRows(parsedRows.map((x) => x.entityType))
      }
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'NO_ROWS') return res.status(400).json({ code: 'NO_ROWS', message: 'No rows found in payload' })
    return res.status(400).json({ code: 'UPLOAD_FAILED', message: msg })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/service-run', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.service', 'admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.service' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  const serviceName = normalizeServiceName(req.body?.serviceName)
  if (!serviceName) return res.status(400).json({ code: 'INVALID_INPUT', message: 'serviceName is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const job = await loadJobRow(q, tenantId, jobId)
      if (!job) throw new Error('JOB_NOT_FOUND')
      const serviceResult = simulateServiceRun(serviceName, req.body?.inputs || {})
      await q('DELETE FROM onboarding_job_rows WHERE tenant_id=$1 AND job_id=$2::uuid', [tenantId, jobId])
      let rowNo = 1
      for (const parsed of serviceResult.rows) {
        await q(
          `INSERT INTO onboarding_job_rows (
            row_id, tenant_id, job_id, row_no, source_sheet, entity_type, raw_payload,
            canonical_payload, action_type, row_status, validation_errors, validation_warnings, match_candidates,
            created_at, updated_at
          ) VALUES (
            $1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,'{}'::jsonb,'CREATE','STAGED','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,now(),now()
          )`,
          [uuidv4(), tenantId, jobId, rowNo++, parsed.sourceSheet, parsed.entityType, JSON.stringify(parsed.rawPayload || {})]
        )
      }
      await q(
        `UPDATE onboarding_jobs
            SET mode='SERVICE_HIT',
                source_type='SERVICE_HIT',
                source_name=$3,
                source_system=$4,
                request_payload=$5::jsonb,
                response_preview=$6::jsonb,
                total_received=$7,
                total_validated=0,
                total_created=0,
                total_updated=0,
                total_skipped=0,
                total_failed=0,
                status='RUNNING',
                finished_at=null,
                updated_at=now(),
                updated_by=$8
          WHERE tenant_id=$1 AND job_id=$2::uuid`,
        [
          tenantId,
          jobId,
          serviceName,
          sanitizeText(req.body?.inputs?.sourceSystem) || 'SERVICE',
          JSON.stringify(req.body?.inputs || {}),
          JSON.stringify(serviceResult.responsePreview || {}),
          serviceResult.rows.length,
          actor
        ]
      )
      await appendJobLog(q, tenantId, jobId, `Service run parsed: ${serviceName} (${serviceResult.rows.length} rows)`, actor)
      return {
        jobId,
        received: serviceResult.rows.length,
        serviceName,
        responsePreview: serviceResult.responsePreview,
        previewByEntity: summarizeRows(serviceResult.rows.map((x) => x.entityType))
      }
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(400).json({ code: 'SERVICE_RUN_FAILED', message: msg })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/normalize', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  const fieldMap = req.body?.fieldMap && typeof req.body.fieldMap === 'object' ? req.body.fieldMap : {}
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return normalizeJobRows(q, tenantId, jobId, actor, fieldMap)
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(400).json({ code: 'NORMALIZE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/validate', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return validateJobRows(q, tenantId, jobId, actor)
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(400).json({ code: 'VALIDATE_FAILED', message: msg })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/commit', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return commitJobRows(q, tenantId, jobId, actor, hasAnyPermission(req, ['admin.onboarding.approve']))
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(400).json({ code: 'COMMIT_FAILED', message: msg })
  }
})

onboardingAdminRoutes.post('/jobs/:jobId/retry-failed', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return retryFailedRows(q, tenantId, jobId, actor)
    })
    return res.status(201).json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'NO_FAILED_ROWS') return res.status(400).json({ code: 'NO_FAILED_ROWS' })
    return res.status(400).json({ code: 'RETRY_FAILED', message: msg })
  }
})

onboardingAdminRoutes.get('/jobs/:jobId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const job = await loadJobRow(q, tenantId, jobId)
      if (!job) throw new Error('JOB_NOT_FOUND')
      const rowsResult = await q(
        `SELECT *
           FROM onboarding_job_rows
          WHERE tenant_id=$1 AND job_id=$2::uuid
          ORDER BY row_no ASC, entity_type ASC`,
        [tenantId, jobId]
      )
      return {
        job: mapJobRow(job),
        rows: (rowsResult.rows || []).map(mapJobRowDetail)
      }
    })
    return res.json(output)
  } catch (e: any) {
    if (String(e?.message || e) === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.patch('/jobs/:jobId/rows/:rowId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  if (!hasAnyPermission(req, ['admin.onboarding.manage'])) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Permission required: admin.onboarding.manage' })
  }
  const jobId = sanitizeText(req.params.jobId)
  const rowId = sanitizeText(req.params.rowId)
  if (!isUuid(jobId) || !isUuid(rowId)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId or rowId is invalid' })
  }
  const actionType = sanitizeText(req.body?.actionType).toUpperCase()
  const canonicalPayload = req.body?.canonicalPayload
  if (actionType && !ROW_ACTION_VALUES.includes(actionType as RowAction)) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'actionType is invalid' })
  }
  if (canonicalPayload != null && (typeof canonicalPayload !== 'object' || Array.isArray(canonicalPayload))) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'canonicalPayload must be an object' })
  }
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const current = await q(
        `SELECT *
           FROM onboarding_job_rows
          WHERE tenant_id = $1 AND job_id = $2::uuid AND row_id = $3::uuid
          LIMIT 1`,
        [tenantId, jobId, rowId]
      )
      if (!current.rowCount) throw new Error('NOT_FOUND')
      const currentRow = current.rows[0] || {}
      const nextCanonical = canonicalPayload != null && typeof canonicalPayload === 'object' && !Array.isArray(canonicalPayload)
        ? { ...(canonicalPayload as Record<string, any>) }
        : { ...((currentRow.canonical_payload as Record<string, any>) || {}) }
      if (actionType) {
        nextCanonical.__manualActionType = actionType
      }
      const result = await q(
        `UPDATE onboarding_job_rows
            SET canonical_payload = $4::jsonb,
                action_type = COALESCE($5, action_type),
                row_status = CASE WHEN row_status = 'COMMITTED' THEN row_status ELSE 'STAGED' END,
                validation_errors = CASE WHEN row_status = 'COMMITTED' THEN validation_errors ELSE '[]'::jsonb END,
                validation_warnings = CASE WHEN row_status = 'COMMITTED' THEN validation_warnings ELSE '[]'::jsonb END,
                match_candidates = CASE WHEN row_status = 'COMMITTED' THEN match_candidates ELSE '[]'::jsonb END,
                updated_at = now()
          WHERE tenant_id = $1 AND job_id = $2::uuid AND row_id = $3::uuid
        RETURNING *`,
        [
          tenantId,
          jobId,
          rowId,
          JSON.stringify(nextCanonical),
          actionType || null
        ]
      )
      await q(
        `UPDATE onboarding_jobs
            SET updated_at=now(), updated_by=$3
          WHERE tenant_id=$1 AND job_id=$2::uuid`,
        [tenantId, jobId, actor]
      )
      return mapJobRowDetail(result.rows[0])
    })
    return res.json(output)
  } catch (e: any) {
    if (String(e?.message || e) === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.get('/jobs/:jobId/results', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const jobId = sanitizeText(req.params.jobId)
  if (!isUuid(jobId)) return res.status(400).json({ code: 'INVALID_INPUT', message: 'jobId is invalid' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const job = await loadJobRow(q, tenantId, jobId)
      if (!job) throw new Error('JOB_NOT_FOUND')
      const rowsResult = await q(
        `SELECT row_no, source_sheet, entity_type, row_status, action_type, validation_errors, commit_message, canonical_payload
           FROM onboarding_job_rows
          WHERE tenant_id=$1 AND job_id=$2::uuid
          ORDER BY row_no ASC, entity_type ASC`,
        [tenantId, jobId]
      )
      const rows = (rowsResult.rows || []).map((row: any) => ({
        rowNo: Number(row.row_no),
        sourceSheet: row.source_sheet || '',
        entityType: row.entity_type,
        rowStatus: row.row_status,
        actionType: row.action_type,
        validationErrors: normalizeStringArray(row.validation_errors),
        commitMessage: row.commit_message || null,
        canonicalPayload: row.canonical_payload || {}
      }))
      const errorsCsv = buildErrorCsv(rows)
      const normalizedOutput = rows.filter((row: any) => row.rowStatus === 'COMMITTED')
      return {
        job: mapJobRow(job),
        artifacts: {
          normalized_output: normalizedOutput,
          errors_csv: errorsCsv
        }
      }
    })
    return res.json(output)
  } catch (e: any) {
    if (String(e?.message || e) === 'JOB_NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.get('/history', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const status = normalizeJobStatus(req.query.status)
  const mode = normalizeMode(req.query.mode)
  const limit = clampInt(req.query.limit, 100, 1, 500)
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id=$1']
      const params: any[] = [tenantId]
      let idx = 2
      if (status) {
        clauses.push(`status=$${idx}`)
        params.push(status)
        idx += 1
      }
      if (mode) {
        clauses.push(`mode=$${idx}`)
        params.push(mode)
        idx += 1
      }
      clauses.push(`started_at >= $${idx}`)
      params.push(toTimestampOrDefault(req.query.fromDate, '1970-01-01T00:00:00Z'))
      idx += 1
      clauses.push(`started_at <= $${idx}`)
      params.push(toTimestampOrDefault(req.query.toDate, '2999-12-31T23:59:59Z'))
      idx += 1
      const sql = `
        SELECT *
          FROM onboarding_jobs
         WHERE ${clauses.join(' AND ')}
         ORDER BY started_at DESC
         LIMIT $${idx}
      `
      params.push(limit)
      return q(sql, params)
    })
    return res.json((rows.rows || []).map(mapJobRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

onboardingAdminRoutes.get('/audit', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const entityType = sanitizeText(req.query.entityType).toUpperCase()
  const entityId = sanitizeText(req.query.entityId)
  const limit = clampInt(req.query.limit, 100, 1, 500)
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['tenant_id=$1']
      const params: any[] = [tenantId]
      let idx = 2
      if (entityType) {
        clauses.push(`entity_type = $${idx}`)
        params.push(entityType)
        idx += 1
      }
      if (entityId && isUuid(entityId)) {
        clauses.push(`entity_id = $${idx}::uuid`)
        params.push(entityId)
        idx += 1
      }
      const sql = `
        SELECT *
          FROM onboarding_audit_events
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${idx}
      `
      params.push(limit)
      return q(sql, params)
    })
    return res.json(
      (rows.rows || []).map((row: any) => ({
        eventId: row.event_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        eventType: row.event_type,
        actor: row.actor || null,
        reason: row.reason || null,
        correlationId: row.correlation_id || null,
        before: row.before_json || null,
        after: row.after_json || null,
        fieldDiffs: row.field_diffs || [],
        createdAt: normalizeTimestamp(row.created_at)
      }))
    )
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

async function loadOnboardingConfig(q: QueryFn, tenantId: string): Promise<OnboardingConfig> {
  const result = await q('SELECT onboarding_config FROM tenants WHERE tenant_id=$1 LIMIT 1', [tenantId])
  if (!result.rowCount) return clone(DEFAULT_ONBOARDING_CONFIG)
  return normalizeOnboardingConfig(result.rows[0]?.onboarding_config || {}, DEFAULT_ONBOARDING_CONFIG)
}

function normalizeOnboardingConfig(input: any, fallback: OnboardingConfig): OnboardingConfig {
  const source = input && typeof input === 'object' ? input : {}
  const next: OnboardingConfig = clone(fallback)
  next.keyPatterns = {
    agency: sanitizeText(source?.keyPatterns?.agency) || fallback.keyPatterns.agency,
    producer: sanitizeText(source?.keyPatterns?.producer) || fallback.keyPatterns.producer
  }
  next.agencyCode = {
    prefix: normalizeAgencyCodePrefix(source?.agencyCode?.prefix ?? fallback.agencyCode.prefix),
    digits: clampInt(source?.agencyCode?.digits, fallback.agencyCode.digits, 3, 10),
    startAt: clampInt(source?.agencyCode?.startAt, fallback.agencyCode.startAt, 1, 999999999)
  }
  next.requiredFields = {
    agency: {
      legalName: toBoolean(source?.requiredFields?.agency?.legalName, fallback.requiredFields.agency.legalName),
      npnOrFeinLast4: toBoolean(source?.requiredFields?.agency?.npnOrFeinLast4, fallback.requiredFields.agency.npnOrFeinLast4),
      contactOrAddress: toBoolean(source?.requiredFields?.agency?.contactOrAddress, fallback.requiredFields.agency.contactOrAddress)
    },
    producer: {
      firstAndLast: toBoolean(source?.requiredFields?.producer?.firstAndLast, fallback.requiredFields.producer.firstAndLast),
      npn: toBoolean(source?.requiredFields?.producer?.npn, fallback.requiredFields.producer.npn)
    },
    license: {
      state: toBoolean(source?.requiredFields?.license?.state, fallback.requiredFields.license.state),
      lineOfAuthority: toBoolean(source?.requiredFields?.license?.lineOfAuthority, fallback.requiredFields.license.lineOfAuthority),
      status: toBoolean(source?.requiredFields?.license?.status, fallback.requiredFields.license.status)
    },
    appointment: {
      carrierCode: toBoolean(source?.requiredFields?.appointment?.carrierCode, fallback.requiredFields.appointment.carrierCode),
      state: toBoolean(source?.requiredFields?.appointment?.state, fallback.requiredFields.appointment.state),
      productCode: toBoolean(source?.requiredFields?.appointment?.productCode, fallback.requiredFields.appointment.productCode),
      status: toBoolean(source?.requiredFields?.appointment?.status, fallback.requiredFields.appointment.status)
    },
    commission: {
      productCode: toBoolean(source?.requiredFields?.commission?.productCode, fallback.requiredFields.commission.productCode),
      state: toBoolean(source?.requiredFields?.commission?.state, fallback.requiredFields.commission.state),
      rates: toBoolean(source?.requiredFields?.commission?.rates, fallback.requiredFields.commission.rates)
    }
  }
  next.allowOverlappingEffectivePeriods = toBoolean(
    source?.allowOverlappingEffectivePeriods,
    fallback.allowOverlappingEffectivePeriods
  )
  next.defaultIdempotencyBySource = normalizeIdempotencyMap(
    source?.defaultIdempotencyBySource,
    fallback.defaultIdempotencyBySource
  )
  next.requireApprovalOnSensitiveChange = toBoolean(
    source?.requireApprovalOnSensitiveChange,
    fallback.requireApprovalOnSensitiveChange
  )
  next.requireApprovalOnMerge = toBoolean(source?.requireApprovalOnMerge, fallback.requireApprovalOnMerge)
  next.requireApprovalOnTermination = toBoolean(
    source?.requireApprovalOnTermination,
    fallback.requireApprovalOnTermination
  )
  next.requireApprovalOnCommissionOverride = toBoolean(
    source?.requireApprovalOnCommissionOverride,
    fallback.requireApprovalOnCommissionOverride
  )
  next.blockDeactivateWithActivePolicies = toBoolean(
    source?.blockDeactivateWithActivePolicies,
    fallback.blockDeactivateWithActivePolicies
  )
  return next
}

function normalizeIdempotencyMap(input: any, fallback: Record<string, IdempotencyStrategy>) {
  const out: Record<string, IdempotencyStrategy> = {}
  const source = input && typeof input === 'object' ? input : {}
  for (const [keyRaw, valueRaw] of Object.entries(source)) {
    const key = sanitizeText(keyRaw).toUpperCase()
    const normalized = normalizeIdempotency(valueRaw)
    if (!key || !normalized) continue
    out[key] = normalized
  }
  if (!Object.keys(out).length) return { ...fallback }
  if (!out.DEFAULT) out.DEFAULT = fallback.DEFAULT || 'EXTERNAL_ID_WINS'
  return out
}

function parseUploadedRows(input: { fileName: string; mimeType: string; dataBase64: string }): ParsedInputRow[] {
  const fileName = input.fileName.toLowerCase()
  const mimeType = input.mimeType.toLowerCase()
  const buffer = Buffer.from(input.dataBase64, 'base64')
  if (!buffer.length) return []

  if (fileName.endsWith('.json') || mimeType.includes('json')) {
    const parsed = JSON.parse(buffer.toString('utf8'))
    return parseJsonRows(parsed)
  }

  const wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true })
  const out: ParsedInputRow[] = []
  for (const sheetName of wb.SheetNames || []) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' })
    const fallbackEntity = inferEntityTypeFromSheet(sheetName)
    for (const row of rows) {
      const entityType = inferEntityTypeFromRow(row) || fallbackEntity
      if (!entityType) continue
      out.push({
        sourceSheet: sheetName,
        entityType,
        rawPayload: row
      })
    }
  }
  return out
}

function parseJsonRows(parsed: any): ParsedInputRow[] {
  const out: ParsedInputRow[] = []
  if (Array.isArray(parsed)) {
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue
      const entityType = inferEntityTypeFromRow(row)
      if (!entityType) continue
      out.push({ sourceSheet: 'JSON', entityType, rawPayload: row })
    }
    return out
  }
  if (parsed && typeof parsed === 'object') {
    const knownSheets = [
      ['Agencies', 'AGENCY'],
      ['Producers', 'PRODUCER'],
      ['Licenses', 'LICENSE'],
      ['Appointments', 'APPOINTMENT'],
      ['Commission', 'COMMISSION']
    ] as Array<[string, EntityType]>
    for (const [sheetName, entityType] of knownSheets) {
      if (!Array.isArray(parsed[sheetName])) continue
      for (const row of parsed[sheetName]) {
        if (!row || typeof row !== 'object') continue
        out.push({ sourceSheet: sheetName, entityType, rawPayload: row })
      }
    }
    if (Array.isArray(parsed.rows)) {
      for (const row of parsed.rows) {
        if (!row || typeof row !== 'object') continue
        const entityType = inferEntityTypeFromRow(row)
        if (!entityType) continue
        out.push({ sourceSheet: 'rows', entityType, rawPayload: row })
      }
    }
  }
  return out
}

function inferEntityTypeFromSheet(sheetName: string): EntityType | null {
  const key = normalizeTextForMatch(sheetName)
  if (!key) return null
  if (key.includes('agenc')) return 'AGENCY'
  if (key.includes('producer') || key.includes('broker') || key.includes('agent')) return 'PRODUCER'
  if (key.includes('license')) return 'LICENSE'
  if (key.includes('appoint')) return 'APPOINTMENT'
  if (key.includes('commission')) return 'COMMISSION'
  return null
}

function inferEntityTypeFromRow(row: Record<string, any>): EntityType | null {
  const explicit = sanitizeText(pick(row, ['entityType', 'entity_type', 'type'])).toUpperCase()
  if (ENTITY_VALUES.includes(explicit as EntityType)) return explicit as EntityType
  if (sanitizeText(pick(row, ['legalName', 'legal_name', 'agencyKey', 'agency_key']))) return 'AGENCY'
  if (sanitizeText(pick(row, ['firstName', 'first_name', 'producerKey', 'producer_key']))) return 'PRODUCER'
  if (sanitizeText(pick(row, ['lineOfAuthority', 'line_of_authority', 'licenseNo', 'license_no']))) return 'LICENSE'
  if (sanitizeText(pick(row, ['appointmentStatus', 'appointment_status', 'carrierCode', 'carrier_code']))) return 'APPOINTMENT'
  if (sanitizeText(pick(row, ['nbRate', 'nb_rate', 'rnRate', 'rn_rate']))) return 'COMMISSION'
  return null
}

function simulateServiceRun(serviceName: string, inputs: Record<string, any>) {
  const limit = clampInt(inputs?.limit || inputs?.count, 25, 1, 500)
  const sourceSystem = sanitizeText(inputs?.sourceSystem) || 'SERVICE'
  const rows: ParsedInputRow[] = []
  if (serviceName === 'Pull from CRM') {
    for (let i = 0; i < limit; i += 1) {
      rows.push({
        sourceSheet: 'service.crm.producers',
        entityType: 'PRODUCER',
        rawPayload: {
          sourceSystem,
          externalId: `CRM-PROD-${10000 + i}`,
          firstName: `Producer${i + 1}`,
          lastName: 'Demo',
          npn: `NPN${20000 + i}`,
          email: `producer${i + 1}@demo.example`,
          phone: `555-100-${String(i).padStart(4, '0')}`,
          status: i % 7 === 0 ? 'PENDING_LICENSE' : 'ACTIVE'
        }
      })
    }
  } else if (serviceName === 'Pull from NIPR licensing feed') {
    for (let i = 0; i < limit; i += 1) {
      rows.push({
        sourceSheet: 'service.nipr.licenses',
        entityType: 'LICENSE',
        rawPayload: {
          sourceSystem,
          externalId: `NIPR-PROD-${20000 + i}`,
          entityType: 'PRODUCER',
          state: i % 2 === 0 ? 'TX' : 'NY',
          lineOfAuthority: i % 3 === 0 ? 'P&C' : 'AUTO',
          licenseNo: `LIC-${30000 + i}`,
          status: 'ACTIVE',
          effectiveFrom: todayDate()
        }
      })
    }
  } else if (serviceName === 'Pull from MGA system') {
    for (let i = 0; i < limit; i += 1) {
      rows.push({
        sourceSheet: 'service.mga.agencies',
        entityType: 'AGENCY',
        rawPayload: {
          sourceSystem,
          externalId: `MGA-AGY-${15000 + i}`,
          legalName: `MGA Partner ${i + 1} LLC`,
          npn: `MGA${40000 + i}`,
          agencyType: 'MGA',
          state: i % 2 === 0 ? 'CA' : 'FL',
          email: `onboarding${i + 1}@mga-partner.example`,
          status: i % 5 === 0 ? 'PENDING_CONTRACT' : 'ACTIVE'
        }
      })
    }
  } else if (serviceName === 'Push to downstream appointment system') {
    for (let i = 0; i < Math.max(1, Math.min(limit, 20)); i += 1) {
      rows.push({
        sourceSheet: 'service.downstream.appointments',
        entityType: 'APPOINTMENT',
        rawPayload: {
          sourceSystem,
          entityType: 'PRODUCER',
          carrierCode: sanitizeText(inputs?.carrierCode) || 'CARR-01',
          productCode: sanitizeText(inputs?.productCode) || 'personal-auto',
          state: sanitizeText(inputs?.state) || 'TX',
          appointmentStatus: 'REQUESTED',
          appointmentEffectiveDate: todayDate()
        }
      })
    }
  } else {
    for (let i = 0; i < Math.max(1, Math.min(limit, 100)); i += 1) {
      rows.push({
        sourceSheet: 'service.validation.preview',
        entityType: i % 2 === 0 ? 'AGENCY' : 'PRODUCER',
        rawPayload: i % 2 === 0
          ? {
            sourceSystem,
            externalId: `VAL-AGY-${50000 + i}`,
            legalName: `Validation Agency ${i + 1}`,
            npn: `VN${70000 + i}`,
            status: 'PROSPECT'
          }
          : {
            sourceSystem,
            externalId: `VAL-PROD-${50000 + i}`,
            firstName: `Val${i + 1}`,
            lastName: 'Producer',
            npn: `VPN${70000 + i}`,
            status: 'INVITED'
          }
      })
    }
  }
  return {
    rows,
    responsePreview: {
      serviceName,
      requestedAt: new Date().toISOString(),
      returnedRows: rows.length
    }
  }
}

async function normalizeJobRows(
  q: QueryFn,
  tenantId: string,
  jobId: string,
  actor: string,
  fieldMap: Record<string, any>
) {
  const job = await loadJobRow(q, tenantId, jobId)
  if (!job) throw new Error('JOB_NOT_FOUND')
  const rows = await loadJobRows(q, tenantId, jobId)
  const normalizedRows: any[] = []
  for (const row of rows) {
    const mappedRaw = applyFieldMap(row.rawPayload, fieldMap)
    const canonical = normalizeCanonicalPayload(row.entityType, mappedRaw)
    await q(
      `UPDATE onboarding_job_rows
          SET canonical_payload=$4::jsonb,
              row_status='STAGED',
              action_type='CREATE',
              validation_errors='[]'::jsonb,
              validation_warnings='[]'::jsonb,
              match_candidates='[]'::jsonb,
              updated_at=now()
        WHERE tenant_id=$1 AND job_id=$2::uuid AND row_id=$3::uuid`,
      [tenantId, jobId, row.rowId, JSON.stringify(canonical)]
    )
    normalizedRows.push({ rowNo: row.rowNo, entityType: row.entityType, canonicalPayload: canonical })
  }
  await q(
    `UPDATE onboarding_jobs
        SET normalized_output=$3::jsonb, updated_at=now(), updated_by=$4
      WHERE tenant_id=$1 AND job_id=$2::uuid`,
    [tenantId, jobId, JSON.stringify(normalizedRows), actor]
  )
  await appendJobLog(q, tenantId, jobId, `Normalized ${rows.length} rows`, actor)
  return {
    jobId,
    normalizedCount: rows.length,
    previewByEntity: summarizeRows(rows.map((row) => row.entityType)),
    rows: normalizedRows
  }
}

async function validateJobRows(q: QueryFn, tenantId: string, jobId: string, actor: string) {
  const job = await loadJobRow(q, tenantId, jobId)
  if (!job) throw new Error('JOB_NOT_FOUND')
  const settings = await loadOnboardingConfig(q, tenantId)
  const rows = await loadJobRows(q, tenantId, jobId)
  let validCount = 0
  let errorCount = 0
  const summary: any[] = []

  for (const row of rows) {
    const canonical = row.canonicalPayload && Object.keys(row.canonicalPayload).length
      ? row.canonicalPayload
      : normalizeCanonicalPayload(row.entityType, row.rawPayload || {})
    const validation = validateCanonicalRow(row.entityType, canonical, settings)
    const matches = await findMatchCandidates(q, tenantId, row.entityType, canonical)
    const actionType = chooseRowAction({
      row,
      canonical,
      candidates: matches,
      idempotencyStrategy: normalizeIdempotency(job.idempotency_strategy || job.idempotencyStrategy) || 'EXTERNAL_ID_WINS'
    })
    const rowStatus: RowStatus = validation.errors.length ? 'ERROR' : 'VALIDATED'
    await q(
      `UPDATE onboarding_job_rows
          SET canonical_payload=$4::jsonb,
              action_type=$5,
              row_status=$6,
              validation_errors=$7::jsonb,
              validation_warnings=$8::jsonb,
              match_candidates=$9::jsonb,
              updated_at=now()
        WHERE tenant_id=$1 AND job_id=$2::uuid AND row_id=$3::uuid`,
      [
        tenantId,
        jobId,
        row.rowId,
        JSON.stringify(canonical),
        actionType,
        rowStatus,
        JSON.stringify(validation.errors),
        JSON.stringify(validation.warnings),
        JSON.stringify(matches)
      ]
    )
    if (rowStatus === 'VALIDATED') validCount += 1
    else errorCount += 1
    summary.push({
      rowId: row.rowId,
      rowNo: row.rowNo,
      entityType: row.entityType,
      actionType,
      rowStatus,
      errors: validation.errors,
      warnings: validation.warnings,
      candidates: matches
    })
  }

  await q(
    `UPDATE onboarding_jobs
        SET total_validated=$3,
            total_failed=$4,
            status='RUNNING',
            updated_at=now(),
            updated_by=$5
      WHERE tenant_id=$1 AND job_id=$2::uuid`,
    [tenantId, jobId, validCount, errorCount, actor]
  )
  await appendJobLog(q, tenantId, jobId, `Validation completed: validated=${validCount}, errors=${errorCount}`, actor)
  return {
    jobId,
    validated: validCount,
    errors: errorCount,
    rows: summary
  }
}

async function commitJobRows(
  q: QueryFn,
  tenantId: string,
  jobId: string,
  actor: string,
  canApprove: boolean
) {
  const job = await loadJobRow(q, tenantId, jobId)
  if (!job) throw new Error('JOB_NOT_FOUND')
  const settings = await loadOnboardingConfig(q, tenantId)
  const rows = await loadJobRows(q, tenantId, jobId)
  const strategy = normalizeIdempotency(job.idempotency_strategy || job.idempotencyStrategy) || 'EXTERNAL_ID_WINS'
  const conflictBehavior = normalizeConflictBehavior(job.conflict_behavior || job.conflictBehavior) || 'SKIP'

  let created = 0
  let updated = 0
  let skipped = 0
  let failed = 0
  let pendingApproval = 0

  for (const row of rows) {
    if (row.rowStatus !== 'VALIDATED') continue
    const requestedAction = normalizeRowAction((row.canonicalPayload as any)?.__manualActionType) || row.actionType || 'CREATE'
    let result: CommitResult
    const mergeRequest = normalizeObject((row.canonicalPayload as any)?.mergeRequest)
    try {
      if (requestedAction === 'SKIP') {
        if (mergeRequest && Object.keys(mergeRequest).length) {
          const targetEntityType =
            normalizeRootEntityType(mergeRequest.targetEntityType) ||
            normalizeRootEntityType(mergeRequest.entityType) ||
            (row.entityType === 'AGENCY' ? 'AGENCY' : 'PRODUCER')
          const targetEntityId = sanitizeText(mergeRequest.targetEntityId || mergeRequest.entityId)
          const reason = sanitizeText(mergeRequest.reason) || 'Merge request from onboarding row'
          await createApprovalTask(q, {
            tenantId,
            jobId,
            rowId: row.rowId,
            entityType: targetEntityType,
            entityId: isUuid(targetEntityId) ? targetEntityId : null,
            actionType: 'MERGE_REQUEST',
            reason,
            payload: {
              sourceEntityType: row.entityType,
              sourceRowId: row.rowId,
              targetEntityType: mergeRequest.targetEntityType || mergeRequest.entityType || null,
              targetEntityId: targetEntityId || null,
              targetEntityKey: sanitizeText(mergeRequest.targetEntityKey) || null,
              candidateScore: mergeRequest.candidateScore ?? null,
              requestedAction
            },
            actor
          })
          result = {
            status: 'PENDING_APPROVAL',
            actionType: 'SKIP',
            message: `Pending approval: merge request (${reason})`,
            created: 0,
            updated: 0,
            skipped: 1,
            failed: 0
          }
        } else {
          result = {
            status: 'SKIPPED',
            actionType: 'SKIP',
            message: 'Row skipped by action override',
            created: 0,
            updated: 0,
            skipped: 1,
            failed: 0
          }
        }
      } else if (row.entityType === 'AGENCY') {
        const forceEntityId = requestedAction === 'UPDATE' ? sanitizeText((row.canonicalPayload as any)?.entityId) : ''
        result = await upsertAgencyEntity(q, tenantId, row.canonicalPayload, {
          actor,
          strategy: requestedAction === 'CREATE' ? 'ALWAYS_CREATE' : strategy,
          conflictBehavior,
          canApprove,
          config: settings,
          reason: `JOB_COMMIT:${jobId}`,
          forceEntityId: isUuid(forceEntityId) ? forceEntityId : undefined
        })
      } else if (row.entityType === 'PRODUCER') {
        const forceEntityId = requestedAction === 'UPDATE' ? sanitizeText((row.canonicalPayload as any)?.entityId) : ''
        result = await upsertProducerEntity(q, tenantId, row.canonicalPayload, {
          actor,
          strategy: requestedAction === 'CREATE' ? 'ALWAYS_CREATE' : strategy,
          conflictBehavior,
          canApprove,
          config: settings,
          reason: `JOB_COMMIT:${jobId}`,
          forceEntityId: isUuid(forceEntityId) ? forceEntityId : undefined
        })
      } else if (row.entityType === 'LICENSE') {
        result = await upsertLicenseRow(q, tenantId, row.canonicalPayload, {
          actor,
          conflictBehavior,
          reason: `JOB_COMMIT:${jobId}`
        })
      } else if (row.entityType === 'APPOINTMENT') {
        result = await upsertAppointmentRow(q, tenantId, row.canonicalPayload, {
          actor,
          conflictBehavior,
          canApprove,
          config: settings,
          reason: `JOB_COMMIT:${jobId}`,
          jobId,
          rowId: row.rowId
        })
      } else {
        result = await upsertCommissionRow(q, tenantId, row.canonicalPayload, {
          actor,
          conflictBehavior,
          canApprove,
          config: settings,
          reason: `JOB_COMMIT:${jobId}`,
          jobId,
          rowId: row.rowId
        })
      }
    } catch (e: any) {
      result = {
        status: 'FAILED',
        actionType: requestedAction,
        message: String(e?.message || e),
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 1
      }
    }

    created += result.created
    updated += result.updated
    skipped += result.skipped
    failed += result.failed
    if (result.status === 'PENDING_APPROVAL') pendingApproval += 1

    await q(
      `UPDATE onboarding_job_rows
          SET row_status=$4,
              action_type=$5,
              commit_message=$6,
              linked_entity_type=$7,
              linked_entity_id=$8::uuid,
              updated_at=now()
        WHERE tenant_id=$1 AND job_id=$2::uuid AND row_id=$3::uuid`,
      [
        tenantId,
        jobId,
        row.rowId,
        result.status,
        result.actionType,
        result.message,
        result.linkedEntityType || null,
        result.linkedEntityId || null
      ]
    )
  }

  const totalProcessed = created + updated + skipped + failed + pendingApproval
  let status: JobStatus = 'SUCCEEDED'
  if (failed > 0 && totalProcessed > failed) status = 'PARTIAL'
  else if (failed > 0 && totalProcessed === failed) status = 'FAILED'
  else if (pendingApproval > 0) status = 'PARTIAL'

  await q(
    `UPDATE onboarding_jobs
        SET total_created=$3,
            total_updated=$4,
            total_skipped=$5,
            total_failed=$6,
            status=$7,
            finished_at=now(),
            updated_at=now(),
            updated_by=$8
      WHERE tenant_id=$1 AND job_id=$2::uuid`,
    [tenantId, jobId, created, updated, skipped + pendingApproval, failed, status, actor]
  )
  await appendJobLog(
    q,
    tenantId,
    jobId,
    `Commit completed: created=${created}, updated=${updated}, skipped=${skipped}, failed=${failed}, pendingApproval=${pendingApproval}`,
    actor
  )
  const refreshed = await loadJobRow(q, tenantId, jobId)
  return {
    job: refreshed ? mapJobRow(refreshed) : null,
    counts: {
      created,
      updated,
      skipped,
      failed,
      pendingApproval
    }
  }
}

async function retryFailedRows(q: QueryFn, tenantId: string, jobId: string, actor: string) {
  const sourceJob = await loadJobRow(q, tenantId, jobId)
  if (!sourceJob) throw new Error('JOB_NOT_FOUND')
  const failedRows = await q(
    `SELECT *
       FROM onboarding_job_rows
      WHERE tenant_id=$1 AND job_id=$2::uuid AND row_status IN ('FAILED','ERROR')
      ORDER BY row_no ASC`,
    [tenantId, jobId]
  )
  if (!failedRows.rowCount) throw new Error('NO_FAILED_ROWS')
  const newJobId = uuidv4()
  await q(
    `INSERT INTO onboarding_jobs (
      job_id, tenant_id, mode, source_type, source_name, source_system,
      idempotency_strategy, conflict_behavior, status, request_payload,
      created_at, created_by, updated_at, updated_by, started_at
    ) VALUES (
      $1::uuid,$2,$3,$4,$5,$6,$7,$8,'RUNNING',$9::jsonb,now(),$10,now(),$10,now()
    )`,
    [
      newJobId,
      tenantId,
      sourceJob.mode,
      sourceJob.source_type,
      sourceJob.source_name,
      sourceJob.source_system,
      sourceJob.idempotency_strategy,
      sourceJob.conflict_behavior,
      sourceJob.request_payload || {},
      actor
    ]
  )
  let rowNo = 1
  for (const row of failedRows.rows || []) {
    await q(
      `INSERT INTO onboarding_job_rows (
        row_id, tenant_id, job_id, row_no, source_sheet, entity_type, raw_payload, canonical_payload,
        action_type, row_status, validation_errors, validation_warnings, match_candidates, created_at, updated_at
      ) VALUES (
        $1::uuid,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8::jsonb,'CREATE','STAGED','[]'::jsonb,'[]'::jsonb,'[]'::jsonb,now(),now()
      )`,
      [
        uuidv4(),
        tenantId,
        newJobId,
        rowNo++,
        row.source_sheet || null,
        row.entity_type,
        JSON.stringify(row.raw_payload || {}),
        JSON.stringify(row.canonical_payload || {})
      ]
    )
  }
  await q(
    `UPDATE onboarding_jobs
        SET total_received=$3, updated_at=now(), updated_by=$4
      WHERE tenant_id=$1 AND job_id=$2::uuid`,
    [tenantId, newJobId, failedRows.rowCount, actor]
  )
  await appendJobLog(q, tenantId, newJobId, `Retry created from job ${jobId} with ${failedRows.rowCount} failed rows`, actor)
  const created = await loadJobRow(q, tenantId, newJobId)
  return { newJob: created ? mapJobRow(created) : null }
}

async function upsertAgencyEntity(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  opts: {
    actor: string
    strategy: IdempotencyStrategy
    conflictBehavior: ConflictBehavior
    canApprove: boolean
    config: OnboardingConfig
    reason: string
    jobId?: string
    rowId?: string
    forceEntityId?: string
  }
): Promise<CommitResult> {
  const next = normalizeAgencyPayload(payload)
  const providedAgencyCode = sanitizeText(next.agencyCode).toUpperCase()
  const existing = opts.forceEntityId
    ? await findAgencyById(q, tenantId, opts.forceEntityId)
    : await findAgencyForUpsert(q, tenantId, next, opts.strategy)
  const feinNormalized = normalizeSensitiveValue(next.fein || next.feinLast4 || '')
  const feinLast4 = feinNormalized ? feinNormalized.slice(-4) : ''
  const feinEncrypted = feinNormalized ? encryptSensitiveValue(feinNormalized) : null
  const feinHash = feinNormalized ? hashSensitiveValue(feinNormalized) : null

  if (existing) {
    const agencyCode = providedAgencyCode || sanitizeText(existing.agency_code) || (await nextAgencyCode(q, tenantId, opts.config))
    const parentAgencyId = await resolveParentAgencyId(q, tenantId, next, existing.agency_id)
    const before = await loadEntityFull(q, tenantId, 'AGENCY', existing.agency_id)
    await q(
      `UPDATE agencies
          SET agency_code=$3,
              legal_name=$4,
              dba_name=$5,
              fein_encrypted=$6,
              fein_last4=$7,
              fein_hash=$8,
              agency_np_number=$9,
              agency_type=$10,
              commission_rate=$11,
              eo_carrier=$12,
              eo_policy_no=$13,
              eo_expiry_date=$14::date,
              ach_token_ref=$15,
              effective_from=$16::date,
              effective_to=$17::date,
              status=$18,
              metadata=$19::jsonb,
              parent_agency_id=$20::uuid,
              updated_at=now(),
              updated_by=$21,
              version=version+1
        WHERE tenant_id=$1 AND agency_id=$2::uuid`,
      [
        tenantId,
        existing.agency_id,
        agencyCode,
        next.legalName,
        toNullable(next.dbaName),
        feinEncrypted,
        feinLast4 || null,
        feinHash,
        toNullable(next.npn),
        normalizeAgencyType(next.agencyType),
        toOptionalNumber(next.commissionRate),
        toNullable(next.eoCarrier),
        toNullable(next.eoPolicyNo),
        normalizeDate(next.eoExpiryDate),
        toNullable(next.achTokenRef),
        normalizeDate(next.effectiveFrom),
        normalizeDate(next.effectiveTo),
        normalizeAgencyStatus(next.status),
        JSON.stringify(next.metadata || {}),
        parentAgencyId,
        opts.actor
      ]
    )
    await upsertEntityContacts(q, tenantId, 'AGENCY', existing.agency_id, normalizeContacts(next.contacts), opts.actor)
    await upsertEntityAddresses(q, tenantId, 'AGENCY', existing.agency_id, normalizeAddresses(next.addresses), opts.actor)
    await upsertExternalIdentifiers(q, tenantId, 'AGENCY', existing.agency_id, normalizeExternalIdentifiers(next.externalIdentifiers), opts.actor)
    const after = await loadEntityFull(q, tenantId, 'AGENCY', existing.agency_id)
    await appendAuditEvent(q, {
      tenantId,
      entityType: 'AGENCY',
      entityId: existing.agency_id,
      eventType: 'AGENCY_UPDATED',
      actor: opts.actor,
      reason: opts.reason,
      beforeJson: before,
      afterJson: after
    })
    return {
      status: 'COMMITTED',
      actionType: 'UPDATE',
      message: 'Agency updated',
      linkedEntityType: 'AGENCY',
      linkedEntityId: existing.agency_id,
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0
    }
  }

  const agencyId = opts.forceEntityId && isUuid(opts.forceEntityId) ? opts.forceEntityId : uuidv4()
  const agencyCode = providedAgencyCode || (await nextAgencyCode(q, tenantId, opts.config))
  const agencyKey = sanitizeText(next.agencyKey) || (await nextEntityKey(q, tenantId, 'AGENCY', opts.config))
  const parentAgencyId = await resolveParentAgencyId(q, tenantId, next, agencyId)
  await q(
    `INSERT INTO agencies (
      agency_id, tenant_id, agency_key, agency_code, status, legal_name, dba_name,
      fein_encrypted, fein_last4, fein_hash, agency_np_number, agency_type, commission_rate,
      eo_carrier, eo_policy_no, eo_expiry_date, ach_token_ref, effective_from, effective_to,
      parent_agency_id, metadata, version, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::date,$17,$18::date,$19::date,$20::uuid,$21::jsonb,1,now(),$22,now(),$22
    )`,
    [
      agencyId,
      tenantId,
      agencyKey,
      agencyCode,
      normalizeAgencyStatus(next.status),
      next.legalName,
      toNullable(next.dbaName),
      feinEncrypted,
      feinLast4 || null,
      feinHash,
      toNullable(next.npn),
      normalizeAgencyType(next.agencyType),
      toOptionalNumber(next.commissionRate),
      toNullable(next.eoCarrier),
      toNullable(next.eoPolicyNo),
      normalizeDate(next.eoExpiryDate),
      toNullable(next.achTokenRef),
      normalizeDate(next.effectiveFrom),
      normalizeDate(next.effectiveTo),
      parentAgencyId,
      JSON.stringify(next.metadata || {}),
      opts.actor
    ]
  )
  await upsertEntityContacts(q, tenantId, 'AGENCY', agencyId, normalizeContacts(next.contacts), opts.actor)
  await upsertEntityAddresses(q, tenantId, 'AGENCY', agencyId, normalizeAddresses(next.addresses), opts.actor)
  await upsertExternalIdentifiers(q, tenantId, 'AGENCY', agencyId, normalizeExternalIdentifiers(next.externalIdentifiers), opts.actor)
  const after = await loadEntityFull(q, tenantId, 'AGENCY', agencyId)
  await appendAuditEvent(q, {
    tenantId,
    entityType: 'AGENCY',
    entityId: agencyId,
    eventType: 'AGENCY_CREATED',
    actor: opts.actor,
    reason: opts.reason,
    beforeJson: null,
    afterJson: after
  })
  return {
    status: 'COMMITTED',
    actionType: 'CREATE',
    message: 'Agency created',
    linkedEntityType: 'AGENCY',
    linkedEntityId: agencyId,
    created: 1,
    updated: 0,
    skipped: 0,
    failed: 0
  }
}

async function upsertProducerEntity(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  opts: {
    actor: string
    strategy: IdempotencyStrategy
    conflictBehavior: ConflictBehavior
    canApprove: boolean
    config: OnboardingConfig
    reason: string
    jobId?: string
    rowId?: string
    forceEntityId?: string
  }
): Promise<CommitResult> {
  const next = normalizeProducerPayload(payload)
  const existing = opts.forceEntityId
    ? await findProducerById(q, tenantId, opts.forceEntityId)
    : await findProducerForUpsert(q, tenantId, next, opts.strategy)
  const dobNormalized = normalizeSensitiveValue(next.dob || '')
  const dobEncrypted = dobNormalized ? encryptSensitiveValue(dobNormalized) : null
  const dobHash = dobNormalized ? hashSensitiveValue(dobNormalized) : null

  if (existing) {
    const before = await loadEntityFull(q, tenantId, 'PRODUCER', existing.producer_id)
    await q(
      `UPDATE producers
          SET first_name=$3,
              middle_name=$4,
              last_name=$5,
              dob_encrypted=$6,
              dob_hash=$7,
              npn=$8,
              status=$9,
              metadata=$10::jsonb,
              updated_at=now(),
              updated_by=$11,
              version=version+1
        WHERE tenant_id=$1 AND producer_id=$2::uuid`,
      [
        tenantId,
        existing.producer_id,
        next.firstName,
        toNullable(next.middleName),
        next.lastName,
        dobEncrypted,
        dobHash,
        toNullable(next.npn),
        normalizeProducerStatus(next.status),
        JSON.stringify(next.metadata || {}),
        opts.actor
      ]
    )
    await upsertEntityContacts(q, tenantId, 'PRODUCER', existing.producer_id, normalizeContacts(next.contacts), opts.actor)
    await upsertEntityAddresses(q, tenantId, 'PRODUCER', existing.producer_id, normalizeAddresses(next.addresses), opts.actor)
    await upsertAffiliations(q, tenantId, existing.producer_id, normalizeAffiliations(next.affiliations), opts.actor)
    await upsertExternalIdentifiers(q, tenantId, 'PRODUCER', existing.producer_id, normalizeExternalIdentifiers(next.externalIdentifiers), opts.actor)
    const after = await loadEntityFull(q, tenantId, 'PRODUCER', existing.producer_id)
    await appendAuditEvent(q, {
      tenantId,
      entityType: 'PRODUCER',
      entityId: existing.producer_id,
      eventType: 'PRODUCER_UPDATED',
      actor: opts.actor,
      reason: opts.reason,
      beforeJson: before,
      afterJson: after
    })
    return {
      status: 'COMMITTED',
      actionType: 'UPDATE',
      message: 'Producer updated',
      linkedEntityType: 'PRODUCER',
      linkedEntityId: existing.producer_id,
      created: 0,
      updated: 1,
      skipped: 0,
      failed: 0
    }
  }

  const producerId = opts.forceEntityId && isUuid(opts.forceEntityId) ? opts.forceEntityId : uuidv4()
  const producerKey = sanitizeText(next.producerKey) || (await nextEntityKey(q, tenantId, 'PRODUCER', opts.config))
  await q(
    `INSERT INTO producers (
      producer_id, tenant_id, producer_key, status, first_name, middle_name, last_name,
      dob_encrypted, dob_hash, npn, metadata, version, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,1,now(),$12,now(),$12
    )`,
    [
      producerId,
      tenantId,
      producerKey,
      normalizeProducerStatus(next.status),
      next.firstName,
      toNullable(next.middleName),
      next.lastName,
      dobEncrypted,
      dobHash,
      toNullable(next.npn),
      JSON.stringify(next.metadata || {}),
      opts.actor
    ]
  )
  await upsertEntityContacts(q, tenantId, 'PRODUCER', producerId, normalizeContacts(next.contacts), opts.actor)
  await upsertEntityAddresses(q, tenantId, 'PRODUCER', producerId, normalizeAddresses(next.addresses), opts.actor)
  await upsertAffiliations(q, tenantId, producerId, normalizeAffiliations(next.affiliations), opts.actor)
  await upsertExternalIdentifiers(q, tenantId, 'PRODUCER', producerId, normalizeExternalIdentifiers(next.externalIdentifiers), opts.actor)
  const after = await loadEntityFull(q, tenantId, 'PRODUCER', producerId)
  await appendAuditEvent(q, {
    tenantId,
    entityType: 'PRODUCER',
    entityId: producerId,
    eventType: 'PRODUCER_CREATED',
    actor: opts.actor,
    reason: opts.reason,
    beforeJson: null,
    afterJson: after
  })
  return {
    status: 'COMMITTED',
    actionType: 'CREATE',
    message: 'Producer created',
    linkedEntityType: 'PRODUCER',
    linkedEntityId: producerId,
    created: 1,
    updated: 0,
    skipped: 0,
    failed: 0
  }
}

async function upsertLicenseRow(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  opts: { actor: string; conflictBehavior: ConflictBehavior; reason: string }
): Promise<CommitResult> {
  const next = normalizeLicensePayload(payload)
  const resolved = await resolveEntityReference(q, tenantId, next)
  if (!resolved) {
    return { status: 'FAILED', actionType: 'SKIP', message: 'Unable to resolve entity for license', created: 0, updated: 0, skipped: 0, failed: 1 }
  }
  const existing = await q(
    `SELECT license_id
       FROM onboarding_licenses
      WHERE tenant_id=$1
        AND entity_type=$2
        AND entity_id=$3::uuid
        AND state=$4
        AND line_of_authority=$5
        AND license_no=$6
        AND coalesce(effective_from,'1900-01-01'::date)=coalesce($7::date,'1900-01-01'::date)
      LIMIT 1`,
    [tenantId, resolved.entityType, resolved.entityId, next.state, next.lineOfAuthority, next.licenseNo, normalizeDate(next.effectiveFrom)]
  )
  if (existing.rowCount > 0) {
    if (opts.conflictBehavior === 'SKIP') {
      return {
        status: 'SKIPPED',
        actionType: 'SKIP',
        message: 'License duplicate skipped',
        linkedEntityType: resolved.entityType,
        linkedEntityId: resolved.entityId,
        created: 0,
        updated: 0,
        skipped: 1,
        failed: 0
      }
    }
    await q(
      `UPDATE onboarding_licenses
          SET status=$8,
              effective_to=$9::date,
              last_verified_at=$10::timestamptz,
              source_system=$11,
              metadata=$12::jsonb,
              updated_at=now(),
              updated_by=$13
        WHERE tenant_id=$1 AND license_id=$2::uuid`,
      [
        tenantId,
        existing.rows[0].license_id,
        resolved.entityType,
        resolved.entityId,
        next.state,
        next.lineOfAuthority,
        next.licenseNo,
        normalizeLicenseStatus(next.status),
        normalizeDate(next.effectiveTo),
        normalizeTimestamp(next.lastVerifiedAt),
        toNullable(next.sourceSystem),
        JSON.stringify(next.metadata || {}),
        opts.actor
      ]
    )
    return { status: 'COMMITTED', actionType: 'UPDATE', message: 'License updated', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 1, skipped: 0, failed: 0 }
  }
  await q(
    `INSERT INTO onboarding_licenses (
      license_id, tenant_id, entity_type, entity_id, state, line_of_authority, license_no,
      status, effective_from, effective_to, last_verified_at, source_system, metadata, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::date,$10::date,$11::timestamptz,$12,$13::jsonb,now(),$14,now(),$14
    )`,
    [
      uuidv4(),
      tenantId,
      resolved.entityType,
      resolved.entityId,
      next.state,
      next.lineOfAuthority,
      next.licenseNo,
      normalizeLicenseStatus(next.status),
      normalizeDate(next.effectiveFrom),
      normalizeDate(next.effectiveTo),
      normalizeTimestamp(next.lastVerifiedAt),
      toNullable(next.sourceSystem),
      JSON.stringify(next.metadata || {}),
      opts.actor
    ]
  )
  return { status: 'COMMITTED', actionType: 'CREATE', message: 'License created', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 1, updated: 0, skipped: 0, failed: 0 }
}

async function upsertAppointmentRow(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  opts: {
    actor: string
    conflictBehavior: ConflictBehavior
    canApprove: boolean
    config: OnboardingConfig
    reason: string
    jobId?: string
    rowId?: string
  }
): Promise<CommitResult> {
  const next = normalizeAppointmentPayload(payload)
  const resolved = await resolveEntityReference(q, tenantId, next)
  if (!resolved) {
    return { status: 'FAILED', actionType: 'SKIP', message: 'Unable to resolve entity for appointment', created: 0, updated: 0, skipped: 0, failed: 1 }
  }
  const isTermination = normalizeAppointmentStatus(next.appointmentStatus) === 'TERMINATED'
  if (isTermination && opts.config.requireApprovalOnTermination && !opts.canApprove) {
    await createApprovalTask(q, {
      tenantId,
      jobId: opts.jobId || null,
      rowId: opts.rowId || null,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
      actionType: 'APPOINTMENT_TERMINATION',
      reason: opts.reason,
      payload: next,
      actor: opts.actor
    })
    return { status: 'PENDING_APPROVAL', actionType: 'UPDATE', message: 'Pending approval: appointment termination', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 0, skipped: 1, failed: 0 }
  }
  const existing = await q(
    `SELECT appointment_id
       FROM onboarding_appointments
      WHERE tenant_id=$1
        AND entity_type=$2
        AND entity_id=$3::uuid
        AND carrier_code=$4
        AND state=$5
        AND product_code=$6
        AND coalesce(appointment_effective_date,'1900-01-01'::date)=coalesce($7::date,'1900-01-01'::date)
      LIMIT 1`,
    [tenantId, resolved.entityType, resolved.entityId, next.carrierCode, next.state, next.productCode, normalizeDate(next.appointmentEffectiveDate)]
  )
  if (existing.rowCount > 0) {
    if (opts.conflictBehavior === 'SKIP') {
      return { status: 'SKIPPED', actionType: 'SKIP', message: 'Appointment duplicate skipped', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 0, skipped: 1, failed: 0 }
    }
    await q(
      `UPDATE onboarding_appointments
          SET appointment_status=$8,
              termination_date=$9::date,
              metadata=$10::jsonb,
              updated_at=now(),
              updated_by=$11
        WHERE tenant_id=$1 AND appointment_id=$2::uuid`,
      [
        tenantId,
        existing.rows[0].appointment_id,
        resolved.entityType,
        resolved.entityId,
        next.carrierCode,
        next.state,
        next.productCode,
        normalizeAppointmentStatus(next.appointmentStatus),
        normalizeDate(next.terminationDate),
        JSON.stringify(next.metadata || {}),
        opts.actor
      ]
    )
    return { status: 'COMMITTED', actionType: 'UPDATE', message: 'Appointment updated', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 1, skipped: 0, failed: 0 }
  }
  await q(
    `INSERT INTO onboarding_appointments (
      appointment_id, tenant_id, entity_type, entity_id, carrier_code, state, product_code, appointment_status,
      appointment_effective_date, termination_date, metadata, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::date,$10::date,$11::jsonb,now(),$12,now(),$12
    )`,
    [
      uuidv4(),
      tenantId,
      resolved.entityType,
      resolved.entityId,
      next.carrierCode,
      next.state,
      next.productCode,
      normalizeAppointmentStatus(next.appointmentStatus),
      normalizeDate(next.appointmentEffectiveDate),
      normalizeDate(next.terminationDate),
      JSON.stringify(next.metadata || {}),
      opts.actor
    ]
  )
  return { status: 'COMMITTED', actionType: 'CREATE', message: 'Appointment created', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 1, updated: 0, skipped: 0, failed: 0 }
}

async function upsertCommissionRow(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  opts: {
    actor: string
    conflictBehavior: ConflictBehavior
    canApprove: boolean
    config: OnboardingConfig
    reason: string
    jobId?: string
    rowId?: string
  }
): Promise<CommitResult> {
  const next = normalizeCommissionPayload(payload)
  const resolved = await resolveEntityReference(q, tenantId, next)
  if (!resolved) {
    return { status: 'FAILED', actionType: 'SKIP', message: 'Unable to resolve entity for commission', created: 0, updated: 0, skipped: 0, failed: 1 }
  }
  const hasOverrides = next.overrides && Object.keys(next.overrides).length > 0
  if (hasOverrides && opts.config.requireApprovalOnCommissionOverride && !opts.canApprove) {
    await createApprovalTask(q, {
      tenantId,
      jobId: opts.jobId || null,
      rowId: opts.rowId || null,
      entityType: resolved.entityType,
      entityId: resolved.entityId,
      actionType: 'COMMISSION_OVERRIDE',
      reason: opts.reason,
      payload: next,
      actor: opts.actor
    })
    return { status: 'PENDING_APPROVAL', actionType: 'UPDATE', message: 'Pending approval: commission override', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 0, skipped: 1, failed: 0 }
  }

  const existing = await q(
    `SELECT commission_plan_id
       FROM onboarding_commission_plans
      WHERE tenant_id=$1
        AND assigned_to=$2
        AND entity_id=$3::uuid
        AND product_code=$4
        AND state=$5
        AND coalesce(effective_from,'1900-01-01'::date)=coalesce($6::date,'1900-01-01'::date)
      LIMIT 1`,
    [tenantId, resolved.entityType, resolved.entityId, next.productCode, next.state, normalizeDate(next.effectiveFrom)]
  )
  if (existing.rowCount > 0) {
    if (opts.conflictBehavior === 'SKIP') {
      return { status: 'SKIPPED', actionType: 'SKIP', message: 'Commission duplicate skipped', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 0, skipped: 1, failed: 0 }
    }
    await q(
      `UPDATE onboarding_commission_plans
          SET nb_rate=$8,
              rn_rate=$9,
              endorsements_rate=$10,
              overrides=$11::jsonb,
              chargeback_rules=$12::jsonb,
              effective_to=$13::date,
              metadata=$14::jsonb,
              updated_at=now(),
              updated_by=$15
        WHERE tenant_id=$1 AND commission_plan_id=$2::uuid`,
      [
        tenantId,
        existing.rows[0].commission_plan_id,
        resolved.entityType,
        resolved.entityId,
        next.productCode,
        next.state,
        normalizeDate(next.effectiveFrom),
        toNumber(next.nbRate),
        toNumber(next.rnRate),
        toNumber(next.endorsementsRate),
        JSON.stringify(next.overrides || {}),
        JSON.stringify(next.chargebackRules || {}),
        normalizeDate(next.effectiveTo),
        JSON.stringify(next.metadata || {}),
        opts.actor
      ]
    )
    return { status: 'COMMITTED', actionType: 'UPDATE', message: 'Commission updated', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 0, updated: 1, skipped: 0, failed: 0 }
  }
  await q(
    `INSERT INTO onboarding_commission_plans (
      commission_plan_id, tenant_id, assigned_to, entity_id, product_code, state, nb_rate, rn_rate, endorsements_rate,
      overrides, chargeback_rules, effective_from, effective_to, metadata, created_at, created_by, updated_at, updated_by
    ) VALUES (
      $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::date,$13::date,$14::jsonb,now(),$15,now(),$15
    )`,
    [
      uuidv4(),
      tenantId,
      resolved.entityType,
      resolved.entityId,
      next.productCode,
      next.state,
      toNumber(next.nbRate),
      toNumber(next.rnRate),
      toNumber(next.endorsementsRate),
      JSON.stringify(next.overrides || {}),
      JSON.stringify(next.chargebackRules || {}),
      normalizeDate(next.effectiveFrom),
      normalizeDate(next.effectiveTo),
      JSON.stringify(next.metadata || {}),
      opts.actor
    ]
  )
  return { status: 'COMMITTED', actionType: 'CREATE', message: 'Commission created', linkedEntityType: resolved.entityType, linkedEntityId: resolved.entityId, created: 1, updated: 0, skipped: 0, failed: 0 }
}

async function findAgencyForUpsert(q: QueryFn, tenantId: string, payload: Record<string, any>, strategy: IdempotencyStrategy) {
  if (strategy === 'EXTERNAL_ID_WINS') {
    const sourceSystem = sanitizeText(payload.sourceSystem)
    const externalId = sanitizeText(payload.externalId)
    if (sourceSystem && externalId) {
      const ext = await q(
        `SELECT entity_id
           FROM onboarding_external_identifiers
          WHERE tenant_id=$1 AND source_system=$2 AND external_id=$3 AND entity_type='AGENCY'
          LIMIT 1`,
        [tenantId, sourceSystem, externalId]
      )
      if (ext.rowCount > 0) {
        return findAgencyById(q, tenantId, ext.rows[0].entity_id)
      }
    }
  }
  if (strategy === 'KEY_WINS') {
    const key = sanitizeText(payload.agencyKey)
    if (key) {
      const result = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_key=$2 LIMIT 1', [tenantId, key])
      if (result.rowCount > 0) return result.rows[0]
    }
    const code = sanitizeText(payload.agencyCode).toUpperCase()
    if (code) {
      const result = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_code=$2 LIMIT 1', [tenantId, code])
      if (result.rowCount > 0) return result.rows[0]
    }
  }
  const code = sanitizeText(payload.agencyCode).toUpperCase()
  if (code) {
    const result = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_code=$2 LIMIT 1', [tenantId, code])
    if (result.rowCount > 0) return result.rows[0]
  }
  const npn = sanitizeText(payload.npn)
  if (npn) {
    const result = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_np_number=$2 LIMIT 1', [tenantId, npn])
    if (result.rowCount > 0) return result.rows[0]
  }
  return null
}

async function findProducerForUpsert(q: QueryFn, tenantId: string, payload: Record<string, any>, strategy: IdempotencyStrategy) {
  if (strategy === 'EXTERNAL_ID_WINS') {
    const sourceSystem = sanitizeText(payload.sourceSystem)
    const externalId = sanitizeText(payload.externalId)
    if (sourceSystem && externalId) {
      const ext = await q(
        `SELECT entity_id
           FROM onboarding_external_identifiers
          WHERE tenant_id=$1 AND source_system=$2 AND external_id=$3 AND entity_type='PRODUCER'
          LIMIT 1`,
        [tenantId, sourceSystem, externalId]
      )
      if (ext.rowCount > 0) {
        return findProducerById(q, tenantId, ext.rows[0].entity_id)
      }
    }
  }
  if (strategy === 'KEY_WINS') {
    const key = sanitizeText(payload.producerKey)
    if (key) {
      const result = await q('SELECT * FROM producers WHERE tenant_id=$1 AND producer_key=$2 LIMIT 1', [tenantId, key])
      if (result.rowCount > 0) return result.rows[0]
    }
  }
  const npn = sanitizeText(payload.npn)
  if (npn) {
    const result = await q('SELECT * FROM producers WHERE tenant_id=$1 AND npn=$2 LIMIT 1', [tenantId, npn])
    if (result.rowCount > 0) return result.rows[0]
  }
  return null
}

async function findAgencyById(q: QueryFn, tenantId: string, agencyId: string) {
  const result = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_id=$2::uuid LIMIT 1', [tenantId, agencyId])
  return result.rowCount > 0 ? result.rows[0] : null
}

async function findProducerById(q: QueryFn, tenantId: string, producerId: string) {
  const result = await q('SELECT * FROM producers WHERE tenant_id=$1 AND producer_id=$2::uuid LIMIT 1', [tenantId, producerId])
  return result.rowCount > 0 ? result.rows[0] : null
}

async function resolveEntityReference(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>
): Promise<{ entityType: RootEntityType; entityId: string } | null> {
  const explicit = normalizeRootEntityType(payload.entityType)
  if (explicit === 'AGENCY') {
    const agencyId = sanitizeText(payload.entityId || payload.agencyId)
    if (isUuid(agencyId)) return { entityType: 'AGENCY', entityId: agencyId }
    const agencyKey = sanitizeText(payload.agencyKey)
    if (agencyKey) {
      const byKey = await q('SELECT agency_id FROM agencies WHERE tenant_id=$1 AND agency_key=$2 LIMIT 1', [tenantId, agencyKey])
      if (byKey.rowCount > 0) return { entityType: 'AGENCY', entityId: byKey.rows[0].agency_id }
    }
  }
  if (explicit === 'PRODUCER') {
    const producerId = sanitizeText(payload.entityId || payload.producerId)
    if (isUuid(producerId)) return { entityType: 'PRODUCER', entityId: producerId }
    const producerKey = sanitizeText(payload.producerKey)
    if (producerKey) {
      const byKey = await q('SELECT producer_id FROM producers WHERE tenant_id=$1 AND producer_key=$2 LIMIT 1', [tenantId, producerKey])
      if (byKey.rowCount > 0) return { entityType: 'PRODUCER', entityId: byKey.rows[0].producer_id }
    }
  }
  const sourceSystem = sanitizeText(payload.sourceSystem)
  const externalId = sanitizeText(payload.externalId)
  if (sourceSystem && externalId) {
    const byExternal = await q(
      `SELECT entity_type, entity_id
         FROM onboarding_external_identifiers
        WHERE tenant_id=$1 AND source_system=$2 AND external_id=$3
        LIMIT 1`,
      [tenantId, sourceSystem, externalId]
    )
    if (byExternal.rowCount > 0) {
      const entityType = normalizeRootEntityType(byExternal.rows[0].entity_type)
      if (entityType) {
        return { entityType, entityId: byExternal.rows[0].entity_id }
      }
    }
  }
  return null
}

async function findMatchCandidates(
  q: QueryFn,
  tenantId: string,
  entityType: EntityType,
  canonical: Record<string, any>
): Promise<MatchCandidate[]> {
  if (entityType === 'AGENCY') return findAgencyMatchCandidates(q, tenantId, canonical)
  if (entityType === 'PRODUCER') return findProducerMatchCandidates(q, tenantId, canonical)
  return []
}

async function findAgencyMatchCandidates(
  q: QueryFn,
  tenantId: string,
  canonical: Record<string, any>
): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = []
  const agencyCode = sanitizeText(canonical.agencyCode).toUpperCase()
  if (agencyCode) {
    const byCode = await q('SELECT agency_id, agency_key, agency_code, legal_name FROM agencies WHERE tenant_id=$1 AND agency_code=$2 LIMIT 1', [tenantId, agencyCode])
    if (byCode.rowCount > 0) {
      out.push({
        entityType: 'AGENCY',
        entityId: byCode.rows[0].agency_id,
        entityKey: byCode.rows[0].agency_key,
        displayName: `${byCode.rows[0].agency_code || ''} - ${byCode.rows[0].legal_name || ''}`.trim(),
        score: 100,
        reason: 'Agency code exact match',
        source: 'KEY'
      })
    }
  }
  const agencyKey = sanitizeText(canonical.agencyKey)
  if (agencyKey) {
    const byKey = await q('SELECT agency_id, agency_key, legal_name FROM agencies WHERE tenant_id=$1 AND agency_key=$2 LIMIT 1', [tenantId, agencyKey])
    if (byKey.rowCount > 0) {
      out.push({
        entityType: 'AGENCY',
        entityId: byKey.rows[0].agency_id,
        entityKey: byKey.rows[0].agency_key,
        displayName: byKey.rows[0].legal_name || '',
        score: 100,
        reason: 'Agency key exact match',
        source: 'KEY'
      })
    }
  }
  const npn = sanitizeText(canonical.npn)
  if (npn) {
    const byNpn = await q('SELECT agency_id, agency_key, legal_name FROM agencies WHERE tenant_id=$1 AND agency_np_number=$2 LIMIT 10', [tenantId, npn])
    for (const row of byNpn.rows || []) {
      out.push({
        entityType: 'AGENCY',
        entityId: row.agency_id,
        entityKey: row.agency_key,
        displayName: row.legal_name || '',
        score: 98,
        reason: 'Agency NPN exact match',
        source: 'NPN'
      })
    }
  }
  return dedupeCandidates(out)
}

async function findProducerMatchCandidates(
  q: QueryFn,
  tenantId: string,
  canonical: Record<string, any>
): Promise<MatchCandidate[]> {
  const out: MatchCandidate[] = []
  const producerKey = sanitizeText(canonical.producerKey)
  if (producerKey) {
    const byKey = await q('SELECT producer_id, producer_key, first_name, last_name FROM producers WHERE tenant_id=$1 AND producer_key=$2 LIMIT 1', [tenantId, producerKey])
    if (byKey.rowCount > 0) {
      out.push({
        entityType: 'PRODUCER',
        entityId: byKey.rows[0].producer_id,
        entityKey: byKey.rows[0].producer_key,
        displayName: `${byKey.rows[0].first_name || ''} ${byKey.rows[0].last_name || ''}`.trim(),
        score: 100,
        reason: 'Producer key exact match',
        source: 'KEY'
      })
    }
  }
  const npn = sanitizeText(canonical.npn)
  if (npn) {
    const byNpn = await q('SELECT producer_id, producer_key, first_name, last_name FROM producers WHERE tenant_id=$1 AND npn=$2 LIMIT 10', [tenantId, npn])
    for (const row of byNpn.rows || []) {
      out.push({
        entityType: 'PRODUCER',
        entityId: row.producer_id,
        entityKey: row.producer_key,
        displayName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        score: 99,
        reason: 'Producer NPN exact match',
        source: 'NPN'
      })
    }
  }
  return dedupeCandidates(out)
}

function validateCanonicalRow(entityType: EntityType, payload: Record<string, any>, config: OnboardingConfig) {
  const errors: string[] = []
  const warnings: string[] = []
  if (entityType === 'AGENCY') {
    if (config.requiredFields.agency.legalName && !sanitizeText(payload.legalName)) errors.push('Agency legal name is required')
    const agencyCode = sanitizeText(payload.agencyCode).toUpperCase()
    if (agencyCode && !/^[A-Z]{2,}[0-9]{3,}$/.test(agencyCode)) {
      errors.push('Agency code must use alphabet prefix followed by numeric sequence (example AG0001)')
    }
    if (config.requiredFields.agency.npnOrFeinLast4) {
      const npn = sanitizeText(payload.npn)
      const fein = normalizeLast4(payload.fein || payload.feinLast4)
      if (!npn && !fein) errors.push('Agency NPN or FEIN last4 is required')
    }
  } else if (entityType === 'PRODUCER') {
    if (config.requiredFields.producer.firstAndLast) {
      if (!sanitizeText(payload.firstName) || !sanitizeText(payload.lastName)) errors.push('Producer first and last name are required')
    }
    if (config.requiredFields.producer.npn && !sanitizeText(payload.npn)) errors.push('Producer NPN is required')
  } else if (entityType === 'LICENSE') {
    if (config.requiredFields.license.state && !sanitizeText(payload.state)) errors.push('License state is required')
    if (config.requiredFields.license.lineOfAuthority && !sanitizeText(payload.lineOfAuthority)) errors.push('License line of authority is required')
    if (!sanitizeText(payload.licenseNo)) errors.push('License number is required')
    if (config.requiredFields.license.status && !normalizeLicenseStatus(payload.status)) errors.push('License status is invalid')
  } else if (entityType === 'APPOINTMENT') {
    if (config.requiredFields.appointment.carrierCode && !sanitizeText(payload.carrierCode)) errors.push('Appointment carrier code is required')
    if (config.requiredFields.appointment.state && !sanitizeText(payload.state)) errors.push('Appointment state is required')
    if (config.requiredFields.appointment.productCode && !sanitizeText(payload.productCode)) errors.push('Appointment product code is required')
    if (config.requiredFields.appointment.status && !normalizeAppointmentStatus(payload.appointmentStatus)) errors.push('Appointment status is invalid')
  } else {
    if (config.requiredFields.commission.productCode && !sanitizeText(payload.productCode)) errors.push('Commission product code is required')
    if (config.requiredFields.commission.state && !sanitizeText(payload.state)) errors.push('Commission state is required')
    if (config.requiredFields.commission.rates) {
      if (!isFiniteNumber(payload.nbRate) || !isFiniteNumber(payload.rnRate) || !isFiniteNumber(payload.endorsementsRate)) {
        errors.push('Commission rates must be numeric')
      }
    }
  }
  const email = sanitizeText(payload.email)
  if (email && !isValidEmail(email)) warnings.push('Email format appears invalid')
  return { errors, warnings }
}

function normalizeCanonicalPayload(entityType: EntityType, rawPayload: Record<string, any>) {
  if (entityType === 'AGENCY') return normalizeAgencyPayload(rawPayload)
  if (entityType === 'PRODUCER') return normalizeProducerPayload(rawPayload)
  if (entityType === 'LICENSE') return normalizeLicensePayload(rawPayload)
  if (entityType === 'APPOINTMENT') return normalizeAppointmentPayload(rawPayload)
  return normalizeCommissionPayload(rawPayload)
}

function normalizeAgencyPayload(raw: Record<string, any>) {
  const sourceSystem = sanitizeText(pick(raw, ['sourceSystem', 'source_system'])) || 'DEFAULT'
  const externalId = sanitizeText(pick(raw, ['externalId', 'external_id']))
  return {
    agencyKey: sanitizeText(pick(raw, ['agencyKey', 'agency_key'])),
    agencyCode: sanitizeText(pick(raw, ['agencyCode', 'agency_code'])).toUpperCase(),
    parentAgencyId: sanitizeText(pick(raw, ['parentAgencyId', 'parent_agency_id'])),
    parentAgencyKey: sanitizeText(pick(raw, ['parentAgencyKey', 'parent_agency_key'])),
    parentAgencyCode: sanitizeText(pick(raw, ['parentAgencyCode', 'parent_agency_code'])).toUpperCase(),
    status: sanitizeText(pick(raw, ['status'])) || 'PROSPECT',
    legalName: sanitizeText(pick(raw, ['legalName', 'legal_name'])),
    dbaName: sanitizeText(pick(raw, ['dbaName', 'dba_name'])),
    fein: sanitizeText(pick(raw, ['fein', 'tin'])),
    feinLast4: sanitizeText(pick(raw, ['feinLast4', 'fein_last4'])),
    npn: sanitizeText(pick(raw, ['npn', 'agencyNpn', 'agency_np_number'])),
    agencyType: sanitizeText(pick(raw, ['agencyType', 'agency_type'])) || 'INDEPENDENT',
    commissionRate: toOptionalNumber(pick(raw, ['commissionRate', 'commission_rate'])),
    eoCarrier: sanitizeText(pick(raw, ['eoCarrier', 'eo_carrier'])),
    eoPolicyNo: sanitizeText(pick(raw, ['eoPolicyNo', 'eo_policy_no'])),
    eoExpiryDate: normalizeDate(pick(raw, ['eoExpiryDate', 'eo_expiry_date'])),
    achTokenRef: sanitizeText(pick(raw, ['achTokenRef', 'ach_token_ref'])),
    effectiveFrom: normalizeDate(pick(raw, ['effectiveFrom', 'effective_from'])),
    effectiveTo: normalizeDate(pick(raw, ['effectiveTo', 'effective_to'])),
    sourceSystem,
    externalId,
    contacts: normalizeContactsInput(raw),
    addresses: normalizeAddressesInput(raw),
    externalIdentifiers: normalizeExternalIdentifiersInput(raw, sourceSystem, externalId),
    metadata: normalizeObject(pick(raw, ['metadata'])) || {}
  }
}

function normalizeProducerPayload(raw: Record<string, any>) {
  const sourceSystem = sanitizeText(pick(raw, ['sourceSystem', 'source_system'])) || 'DEFAULT'
  const externalId = sanitizeText(pick(raw, ['externalId', 'external_id']))
  return {
    producerKey: sanitizeText(pick(raw, ['producerKey', 'producer_key'])),
    status: sanitizeText(pick(raw, ['status'])) || 'INVITED',
    firstName: sanitizeText(pick(raw, ['firstName', 'first_name'])),
    middleName: sanitizeText(pick(raw, ['middleName', 'middle_name'])),
    lastName: sanitizeText(pick(raw, ['lastName', 'last_name'])),
    dob: normalizeDate(pick(raw, ['dob', 'dateOfBirth', 'date_of_birth'])),
    npn: sanitizeText(pick(raw, ['npn'])),
    sourceSystem,
    externalId,
    contacts: normalizeContactsInput(raw),
    addresses: normalizeAddressesInput(raw),
    affiliations: normalizeAffiliationsInput(raw),
    externalIdentifiers: normalizeExternalIdentifiersInput(raw, sourceSystem, externalId),
    metadata: normalizeObject(pick(raw, ['metadata'])) || {}
  }
}

function normalizeLicensePayload(raw: Record<string, any>) {
  return {
    entityType: normalizeRootEntityType(pick(raw, ['entityType', 'entity_type'])) || 'PRODUCER',
    entityId: sanitizeText(pick(raw, ['entityId', 'entity_id'])),
    agencyId: sanitizeText(pick(raw, ['agencyId', 'agency_id'])),
    producerId: sanitizeText(pick(raw, ['producerId', 'producer_id'])),
    agencyKey: sanitizeText(pick(raw, ['agencyKey', 'agency_key'])),
    producerKey: sanitizeText(pick(raw, ['producerKey', 'producer_key'])),
    sourceSystem: sanitizeText(pick(raw, ['sourceSystem', 'source_system'])) || 'DEFAULT',
    externalId: sanitizeText(pick(raw, ['externalId', 'external_id'])),
    state: sanitizeText(pick(raw, ['state'])) || '',
    lineOfAuthority: sanitizeText(pick(raw, ['lineOfAuthority', 'line_of_authority', 'loa'])) || '',
    licenseNo: sanitizeText(pick(raw, ['licenseNo', 'license_no'])) || '',
    status: sanitizeText(pick(raw, ['status'])) || 'PENDING',
    effectiveFrom: normalizeDate(pick(raw, ['effectiveFrom', 'effective_from'])),
    effectiveTo: normalizeDate(pick(raw, ['effectiveTo', 'effective_to'])),
    lastVerifiedAt: normalizeTimestamp(pick(raw, ['lastVerifiedAt', 'last_verified_at'])),
    metadata: normalizeObject(pick(raw, ['metadata'])) || {}
  }
}

function normalizeAppointmentPayload(raw: Record<string, any>) {
  return {
    entityType: normalizeRootEntityType(pick(raw, ['entityType', 'entity_type'])) || 'PRODUCER',
    entityId: sanitizeText(pick(raw, ['entityId', 'entity_id'])),
    agencyId: sanitizeText(pick(raw, ['agencyId', 'agency_id'])),
    producerId: sanitizeText(pick(raw, ['producerId', 'producer_id'])),
    agencyKey: sanitizeText(pick(raw, ['agencyKey', 'agency_key'])),
    producerKey: sanitizeText(pick(raw, ['producerKey', 'producer_key'])),
    sourceSystem: sanitizeText(pick(raw, ['sourceSystem', 'source_system'])) || 'DEFAULT',
    externalId: sanitizeText(pick(raw, ['externalId', 'external_id'])),
    carrierCode: sanitizeText(pick(raw, ['carrierCode', 'carrier_code'])) || '',
    state: sanitizeText(pick(raw, ['state'])) || '',
    productCode: sanitizeText(pick(raw, ['productCode', 'product_code'])) || '',
    appointmentStatus: sanitizeText(pick(raw, ['appointmentStatus', 'appointment_status', 'status'])) || 'PENDING',
    appointmentEffectiveDate: normalizeDate(pick(raw, ['appointmentEffectiveDate', 'appointment_effective_date', 'effectiveFrom', 'effective_from'])),
    terminationDate: normalizeDate(pick(raw, ['terminationDate', 'termination_date', 'effectiveTo', 'effective_to'])),
    metadata: normalizeObject(pick(raw, ['metadata'])) || {}
  }
}

function normalizeCommissionPayload(raw: Record<string, any>) {
  return {
    entityType: normalizeRootEntityType(pick(raw, ['entityType', 'entity_type'])) || 'PRODUCER',
    entityId: sanitizeText(pick(raw, ['entityId', 'entity_id'])),
    agencyId: sanitizeText(pick(raw, ['agencyId', 'agency_id'])),
    producerId: sanitizeText(pick(raw, ['producerId', 'producer_id'])),
    agencyKey: sanitizeText(pick(raw, ['agencyKey', 'agency_key'])),
    producerKey: sanitizeText(pick(raw, ['producerKey', 'producer_key'])),
    sourceSystem: sanitizeText(pick(raw, ['sourceSystem', 'source_system'])) || 'DEFAULT',
    externalId: sanitizeText(pick(raw, ['externalId', 'external_id'])),
    productCode: sanitizeText(pick(raw, ['productCode', 'product_code'])) || '',
    state: sanitizeText(pick(raw, ['state'])) || '',
    nbRate: toNumber(pick(raw, ['nbRate', 'nb_rate']), 0),
    rnRate: toNumber(pick(raw, ['rnRate', 'rn_rate']), 0),
    endorsementsRate: toNumber(pick(raw, ['endorsementsRate', 'endorsements_rate']), 0),
    overrides: normalizeObject(pick(raw, ['overrides'])) || {},
    chargebackRules: normalizeObject(pick(raw, ['chargebackRules', 'chargeback_rules'])) || {},
    effectiveFrom: normalizeDate(pick(raw, ['effectiveFrom', 'effective_from'])),
    effectiveTo: normalizeDate(pick(raw, ['effectiveTo', 'effective_to'])),
    metadata: normalizeObject(pick(raw, ['metadata'])) || {}
  }
}

type JobRowRecord = {
  rowId: string
  rowNo: number
  sourceSheet: string
  entityType: EntityType
  rawPayload: Record<string, any>
  canonicalPayload: Record<string, any>
  actionType: RowAction
  rowStatus: RowStatus
  validationErrors: string[]
  validationWarnings: string[]
  matchCandidates: MatchCandidate[]
  commitMessage?: string | null
  linkedEntityType?: string | null
  linkedEntityId?: string | null
}

type AuditEventInput = {
  tenantId: string
  entityType: string
  entityId: string | null
  eventType: string
  actor: string
  reason: string | null
  correlationId?: string | null
  beforeJson: any
  afterJson: any
}

function hasAnyPermission(req: Request, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(req, permission))
}

function resolveActor(req: Request): string {
  return sanitizeText(req.user?.username) || sanitizeText(req.user?.id) || 'system'
}

function normalizeMode(value: any): OnboardingMode | null {
  const raw = sanitizeText(value).toUpperCase()
  return MODE_VALUES.includes(raw as OnboardingMode) ? (raw as OnboardingMode) : null
}

function normalizeJobStatus(value: any): JobStatus | null {
  const raw = sanitizeText(value).toUpperCase()
  return JOB_STATUS_VALUES.includes(raw as JobStatus) ? (raw as JobStatus) : null
}

function normalizeIdempotency(value: any): IdempotencyStrategy | null {
  const raw = sanitizeText(value).toUpperCase()
  return IDEMPOTENCY_VALUES.includes(raw as IdempotencyStrategy) ? (raw as IdempotencyStrategy) : null
}

function normalizeConflictBehavior(value: any): ConflictBehavior | null {
  const raw = sanitizeText(value).toUpperCase()
  return CONFLICT_VALUES.includes(raw as ConflictBehavior) ? (raw as ConflictBehavior) : null
}

function normalizeServiceName(value: any): (typeof SERVICE_NAMES)[number] | null {
  const raw = sanitizeText(value)
  const match = SERVICE_NAMES.find((item) => item === raw)
  return match || null
}

function normalizeAgencyStatus(value: any): string {
  const allowed = ['PROSPECT', 'PENDING_COMPLIANCE', 'PENDING_CONTRACT', 'PENDING_APPOINTMENT', 'ACTIVE', 'SUSPENDED', 'TERMINATED']
  const raw = sanitizeText(value).toUpperCase()
  return allowed.includes(raw) ? raw : 'PROSPECT'
}

function normalizeProducerStatus(value: any): string {
  const allowed = ['INVITED', 'PENDING_LICENSE', 'PENDING_APPOINTMENT', 'ACTIVE', 'RESTRICTED', 'SUSPENDED']
  const raw = sanitizeText(value).toUpperCase()
  return allowed.includes(raw) ? raw : 'INVITED'
}

function normalizeAgencyType(value: any): string {
  const allowed = ['INDEPENDENT', 'CAPTIVE', 'MGA', 'WHOLESALER']
  const raw = sanitizeText(value).toUpperCase()
  return allowed.includes(raw) ? raw : 'INDEPENDENT'
}

function normalizeAgencyCodePrefix(value: any): string {
  const raw = sanitizeText(value).toUpperCase().replace(/[^A-Z]/g, '')
  if (!raw) return 'AG'
  if (raw.length === 1) return `${raw}A`
  return raw.slice(0, 6)
}

function normalizeLicenseStatus(value: any): string | null {
  const raw = sanitizeText(value).toUpperCase()
  return LIC_STATUS_VALUES.includes(raw) ? raw : null
}

function normalizeAppointmentStatus(value: any): string | null {
  const raw = sanitizeText(value).toUpperCase()
  return APPOINTMENT_STATUS_VALUES.includes(raw) ? raw : null
}

function normalizeRootEntityType(value: any): RootEntityType | null {
  const raw = sanitizeText(value).toUpperCase()
  return ROOT_ENTITY_VALUES.includes(raw as RootEntityType) ? (raw as RootEntityType) : null
}

function normalizeRowAction(value: any): RowAction | null {
  const raw = sanitizeText(value).toUpperCase()
  return ROW_ACTION_VALUES.includes(raw as RowAction) ? (raw as RowAction) : null
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => sanitizeText(item)).filter(Boolean)
}

function normalizeObject(value: any): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}



function toNullable(value: any): string | null {
  const next = sanitizeText(value)
  return next || null
}

function normalizeTextForMatch(value: any): string {
  return sanitizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function normalizeLast4(value: any): string {
  const digits = sanitizeText(value).replace(/\D+/g, '')
  return digits.length >= 4 ? digits.slice(-4) : ''
}

function isUuid(value: any): boolean {
  const text = sanitizeText(value)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
}

function isFiniteNumber(value: any): boolean {
  const n = Number(value)
  return Number.isFinite(n)
}

function toNumber(value: any, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function toOptionalNumber(value: any): number | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function clampInt(value: any, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

function toBoolean(value: any, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  const raw = sanitizeText(value).toLowerCase()
  if (!raw) return fallback
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false
  return fallback
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function normalizeDate(value: any): string | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(raw)) {
    const parts = raw.replace(/\//g, '-').split('-')
    const dt = new Date(`${parts[2]}-${parts[0]}-${parts[1]}T00:00:00Z`)
    if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10)
  }
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString().slice(0, 10)
}

function normalizeTimestamp(value: any): string | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

function toTimestampOrDefault(value: any, fallbackIso: string): string {
  return normalizeTimestamp(value) || fallbackIso
}

const todayDate = today

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function hasOwn(source: any, key: string): boolean {
  return Boolean(source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key))
}

function pick(source: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null && source[key] !== '') {
      return source[key]
    }
  }
  return ''
}

function applyFieldMap(raw: Record<string, any>, fieldMap: Record<string, any>): Record<string, any> {
  if (!fieldMap || typeof fieldMap !== 'object' || !Object.keys(fieldMap).length) {
    return { ...(raw || {}) }
  }
  const out: Record<string, any> = { ...(raw || {}) }
  for (const [sourceField, targetField] of Object.entries(fieldMap)) {
    if (typeof targetField !== 'string') continue
    if (!Object.prototype.hasOwnProperty.call(raw, sourceField)) continue
    out[targetField] = raw[sourceField]
  }
  return out
}

function dedupeCandidates(items: MatchCandidate[]): MatchCandidate[] {
  const byKey = new Map<string, MatchCandidate>()
  for (const item of items) {
    const key = `${item.entityType}:${item.entityId}`
    const current = byKey.get(key)
    if (!current || item.score > current.score) byKey.set(key, item)
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score)
}

function summarizeRows(entityTypes: EntityType[]): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const entityType of entityTypes) {
    summary[entityType] = (summary[entityType] || 0) + 1
  }
  return summary
}

function chooseRowAction(input: {
  row: JobRowRecord
  canonical: Record<string, any>
  candidates: MatchCandidate[]
  idempotencyStrategy: IdempotencyStrategy
}): RowAction {
  const manual = normalizeRowAction((input.canonical as any)?.__manualActionType)
  if (manual) return manual
  if (input.idempotencyStrategy === 'ALWAYS_CREATE') return 'CREATE'
  if (input.idempotencyStrategy === 'KEY_WINS') {
    const hasKeyMatch = input.candidates.some((candidate) => candidate.source === 'KEY')
    return hasKeyMatch ? 'UPDATE' : 'CREATE'
  }
  const best = input.candidates[0]
  if (best && best.score >= 95) return 'UPDATE'
  return 'CREATE'
}

async function loadJobRow(q: QueryFn, tenantId: string, jobId: string): Promise<any | null> {
  const result = await q('SELECT * FROM onboarding_jobs WHERE tenant_id=$1 AND job_id=$2::uuid LIMIT 1', [tenantId, jobId])
  return result.rowCount > 0 ? result.rows[0] : null
}

async function loadJobRows(q: QueryFn, tenantId: string, jobId: string): Promise<JobRowRecord[]> {
  const result = await q(
    `SELECT *
       FROM onboarding_job_rows
      WHERE tenant_id=$1 AND job_id=$2::uuid
      ORDER BY row_no ASC, entity_type ASC`,
    [tenantId, jobId]
  )
  return (result.rows || []).map(mapJobRowDetail)
}

function mapJobRow(row: any) {
  return {
    jobId: row.job_id,
    tenantId: row.tenant_id,
    mode: row.mode,
    sourceType: row.source_type || null,
    sourceName: row.source_name || null,
    sourceSystem: row.source_system || null,
    idempotencyStrategy: row.idempotency_strategy,
    conflictBehavior: row.conflict_behavior,
    status: row.status,
    requestPayload: row.request_payload || {},
    responsePreview: row.response_preview || {},
    normalizedOutput: row.normalized_output || [],
    errorRows: row.error_rows || [],
    logLines: Array.isArray(row.log_lines) ? row.log_lines : [],
    counts: {
      received: Number(row.total_received || 0),
      validated: Number(row.total_validated || 0),
      created: Number(row.total_created || 0),
      updated: Number(row.total_updated || 0),
      skipped: Number(row.total_skipped || 0),
      failed: Number(row.total_failed || 0)
    },
    startedAt: normalizeTimestamp(row.started_at),
    finishedAt: normalizeTimestamp(row.finished_at),
    createdAt: normalizeTimestamp(row.created_at),
    createdBy: row.created_by || null,
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedBy: row.updated_by || null
  }
}

function mapJobRowDetail(row: any): JobRowRecord {
  return {
    rowId: row.row_id,
    rowNo: Number(row.row_no || 0),
    sourceSheet: row.source_sheet || '',
    entityType: row.entity_type,
    rawPayload: normalizeObject(row.raw_payload),
    canonicalPayload: normalizeObject(row.canonical_payload),
    actionType: ROW_ACTION_VALUES.includes(row.action_type) ? row.action_type : 'CREATE',
    rowStatus: ROW_STATUS_VALUES.includes(row.row_status) ? row.row_status : 'STAGED',
    validationErrors: normalizeStringArray(row.validation_errors),
    validationWarnings: normalizeStringArray(row.validation_warnings),
    matchCandidates: Array.isArray(row.match_candidates) ? row.match_candidates : [],
    commitMessage: row.commit_message || null,
    linkedEntityType: row.linked_entity_type || null,
    linkedEntityId: row.linked_entity_id || null
  }
}

function mapAgencyRow(row: any) {
  return {
    agencyId: row.agency_id,
    agencyKey: row.agency_key,
    agencyCode: row.agency_code,
    parentAgencyId: row.parent_agency_id || null,
    parentAgencyKey: row.parent_agency_key || null,
    parentAgencyCode: row.parent_agency_code || null,
    parentAgencyName: row.parent_legal_name || null,
    status: row.status,
    legalName: row.legal_name,
    dbaName: row.dba_name || null,
    feinLast4: row.fein_last4 || null,
    npn: row.agency_np_number || null,
    agencyType: row.agency_type,
    commissionRate: row.commission_rate === null || row.commission_rate === undefined ? null : Number(row.commission_rate),
    eoCarrier: row.eo_carrier || null,
    eoPolicyNo: row.eo_policy_no || null,
    eoExpiryDate: normalizeDate(row.eo_expiry_date),
    achTokenRef: row.ach_token_ref || null,
    effectiveFrom: normalizeDate(row.effective_from),
    effectiveTo: normalizeDate(row.effective_to),
    metadata: row.metadata || {},
    version: Number(row.version || 1),
    createdAt: normalizeTimestamp(row.created_at),
    createdBy: row.created_by || null,
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedBy: row.updated_by || null
  }
}

function mapContactRow(row: any) {
  return {
    contactId: row.contact_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    contactType: row.contact_type,
    subType: row.sub_type || '',
    value: row.value || '',
    extension: row.extension || '',
    preferred: Boolean(row.preferred_flag),
    verified: Boolean(row.verified_flag),
    bounce: Boolean(row.bounce_flag),
    smsConsent: Boolean(row.sms_consent),
    emailConsent: Boolean(row.email_consent),
    contactWindow: row.contact_window || '',
    languagePreference: row.language_preference || '',
    effectiveFrom: normalizeDate(row.effective_from),
    effectiveTo: normalizeDate(row.effective_to),
    metadata: row.metadata || {},
    createdAt: normalizeTimestamp(row.created_at),
    createdBy: row.created_by || null,
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedBy: row.updated_by || null
  }
}

function buildTemplateSheets(): Array<{ name: string; rows: Record<string, any>[] }> {
  return [
    {
      name: 'Agencies',
      rows: [
        {
          entityType: 'AGENCY',
          sourceSystem: 'CRM',
          externalId: 'CRM-AGY-1001',
          agencyKey: '',
          agencyCode: '',
          parentAgencyCode: '',
          legalName: 'North Shore Insurance LLC',
          dbaName: 'North Shore Insurance',
          npn: 'AG123456',
          feinLast4: '6789',
          agencyType: 'INDEPENDENT',
          status: 'PROSPECT',
          email: 'agency@example.com',
          phone: '555-100-1000',
          line1: '10 Main St',
          city: 'Dallas',
          state: 'TX',
          postalCode: '75201',
          country: 'US'
        }
      ]
    },
    {
      name: 'Producers',
      rows: [
        {
          entityType: 'PRODUCER',
          sourceSystem: 'CRM',
          externalId: 'CRM-PROD-1001',
          producerKey: '',
          firstName: 'Alex',
          lastName: 'Morgan',
          npn: 'PR123456',
          status: 'INVITED',
          email: 'alex.morgan@example.com',
          phone: '555-200-2000',
          line1: '22 River Rd',
          city: 'Austin',
          state: 'TX',
          postalCode: '78701',
          country: 'US'
        }
      ]
    },
    {
      name: 'Licenses',
      rows: [
        {
          entityType: 'LICENSE',
          sourceSystem: 'NIPR',
          externalId: 'NIPR-PROD-1001',
          producerKey: 'PROD-SAMPLE-CARRIER-2026-000001',
          state: 'TX',
          lineOfAuthority: 'P&C',
          licenseNo: 'LIC-102934',
          status: 'ACTIVE',
          effectiveFrom: '2026-01-01'
        }
      ]
    },
    {
      name: 'Appointments',
      rows: [
        {
          entityType: 'APPOINTMENT',
          producerKey: 'PROD-SAMPLE-CARRIER-2026-000001',
          carrierCode: 'CARR-01',
          state: 'TX',
          productCode: 'personal-auto',
          appointmentStatus: 'REQUESTED',
          appointmentEffectiveDate: '2026-01-01'
        }
      ]
    },
    {
      name: 'Commission',
      rows: [
        {
          entityType: 'COMMISSION',
          producerKey: 'PROD-SAMPLE-CARRIER-2026-000001',
          productCode: 'personal-auto',
          state: 'TX',
          nbRate: 0.12,
          rnRate: 0.08,
          endorsementsRate: 0.05,
          effectiveFrom: '2026-01-01'
        }
      ]
    }
  ]
}

function buildTemplateJson() {
  const output: Record<string, Record<string, any>[]> = {}
  for (const sheet of buildTemplateSheets()) output[sheet.name] = sheet.rows
  return output
}

function buildTemplateCsv(): string {
  const rows = buildTemplateSheets().flatMap((sheet) => sheet.rows)
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  const lines = [headers.join(',')]
  for (const row of rows) {
    const values = headers.map((header) => csvEscape(row[header]))
    lines.push(values.join(','))
  }
  return lines.join('\n')
}

function buildErrorCsv(rows: Array<{ rowNo: number; entityType: string; rowStatus: string; validationErrors: string[] }>): string {
  const headers = ['rowNo', 'entityType', 'rowStatus', 'validationErrors']
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push([
      row.rowNo,
      csvEscape(row.entityType),
      csvEscape(row.rowStatus),
      csvEscape((row.validationErrors || []).join('; '))
    ].join(','))
  }
  return lines.join('\n')
}



async function appendJobLog(q: QueryFn, tenantId: string, jobId: string, message: string, actor: string) {
  const row = await loadJobRow(q, tenantId, jobId)
  if (!row) return
  const current = Array.isArray(row.log_lines) ? row.log_lines : []
  const next = [...current, `${new Date().toISOString()} [${actor}] ${message}`].slice(-1000)
  await q(
    `UPDATE onboarding_jobs
        SET log_lines=$3::jsonb, updated_at=now(), updated_by=$4
      WHERE tenant_id=$1 AND job_id=$2::uuid`,
    [tenantId, jobId, JSON.stringify(next), actor]
  )
}

async function appendAuditEvent(q: QueryFn, input: AuditEventInput) {
  await q(
    `INSERT INTO onboarding_audit_events (
      event_id, tenant_id, entity_type, entity_id, event_type, actor, reason, correlation_id,
      before_json, after_json, field_diffs, created_at
    ) VALUES (
      $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,now()
    )`,
    [
      uuidv4(),
      input.tenantId,
      input.entityType,
      input.entityId || null,
      input.eventType,
      input.actor,
      input.reason || null,
      input.correlationId || null,
      JSON.stringify(input.beforeJson ?? null),
      JSON.stringify(input.afterJson ?? null),
      JSON.stringify(buildFieldDiffs(input.beforeJson, input.afterJson))
    ]
  )
}

function buildFieldDiffs(beforeValue: any, afterValue: any): Array<{ field: string; before: any; after: any }> {
  const before = beforeValue && typeof beforeValue === 'object' ? beforeValue : {}
  const after = afterValue && typeof afterValue === 'object' ? afterValue : {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const out: Array<{ field: string; before: any; after: any }> = []
  for (const key of keys) {
    const left = JSON.stringify((before as any)[key] ?? null)
    const right = JSON.stringify((after as any)[key] ?? null)
    if (left !== right) {
      out.push({ field: key, before: (before as any)[key] ?? null, after: (after as any)[key] ?? null })
    }
  }
  return out
}

async function createApprovalTask(
  q: QueryFn,
  input: {
    tenantId: string
    jobId: string | null
    rowId: string | null
    entityType: string
    entityId: string | null
    actionType: string
    reason: string
    payload: any
    actor: string
  }
) {
  await q(
    `INSERT INTO onboarding_approval_tasks (
      task_id, tenant_id, job_id, row_id, entity_type, entity_id,
      action_type, status, reason, payload, requested_by, requested_at
    ) VALUES (
      $1::uuid,$2,$3::uuid,$4::uuid,$5,$6::uuid,$7,'PENDING',$8,$9::jsonb,$10,now()
    )`,
    [
      uuidv4(),
      input.tenantId,
      input.jobId || null,
      input.rowId || null,
      input.entityType,
      input.entityId || null,
      input.actionType,
      input.reason,
      JSON.stringify(input.payload || {}),
      input.actor
    ]
  )
}

async function loadAgencyRowWithParent(q: QueryFn, tenantId: string, agencyId: string) {
  return q(
    `SELECT a.*,
            p.agency_key AS parent_agency_key,
            p.agency_code AS parent_agency_code,
            p.legal_name AS parent_legal_name
       FROM agencies a
  LEFT JOIN agencies p
         ON p.tenant_id = a.tenant_id
        AND p.agency_id = a.parent_agency_id
      WHERE a.tenant_id = $1
        AND a.agency_id = $2::uuid
      LIMIT 1`,
    [tenantId, agencyId]
  )
}

async function resolveParentAgencyId(
  q: QueryFn,
  tenantId: string,
  payload: Record<string, any>,
  currentAgencyId: string
): Promise<string | null> {
  const parentAgencyIdInput = sanitizeText(pick(payload, ['parentAgencyId', 'parent_agency_id']))
  const parentAgencyKey = sanitizeText(pick(payload, ['parentAgencyKey', 'parent_agency_key']))
  const parentAgencyCode = sanitizeText(pick(payload, ['parentAgencyCode', 'parent_agency_code'])).toUpperCase()

  if (!parentAgencyIdInput && !parentAgencyKey && !parentAgencyCode) return null

  let resolvedId = ''

  if (parentAgencyIdInput) {
    if (!isUuid(parentAgencyIdInput)) throw new Error('PARENT_AGENCY_ID_INVALID')
    const byId = await q(
      `SELECT agency_id
         FROM agencies
        WHERE tenant_id = $1
          AND agency_id = $2::uuid
        LIMIT 1`,
      [tenantId, parentAgencyIdInput]
    )
    if (!byId.rowCount) throw new Error('PARENT_AGENCY_NOT_FOUND')
    resolvedId = sanitizeText(byId.rows[0].agency_id)
  } else if (parentAgencyKey) {
    const byKey = await q(
      `SELECT agency_id
         FROM agencies
        WHERE tenant_id = $1
          AND agency_key = $2
        LIMIT 1`,
      [tenantId, parentAgencyKey]
    )
    if (!byKey.rowCount) throw new Error('PARENT_AGENCY_NOT_FOUND')
    resolvedId = sanitizeText(byKey.rows[0].agency_id)
  } else {
    const byCode = await q(
      `SELECT agency_id
         FROM agencies
        WHERE tenant_id = $1
          AND agency_code = $2
        LIMIT 1`,
      [tenantId, parentAgencyCode]
    )
    if (!byCode.rowCount) throw new Error('PARENT_AGENCY_NOT_FOUND')
    resolvedId = sanitizeText(byCode.rows[0].agency_id)
  }

  if (!resolvedId) throw new Error('PARENT_AGENCY_NOT_FOUND')
  if (resolvedId.toLowerCase() === currentAgencyId.toLowerCase()) throw new Error('PARENT_AGENCY_SELF_REFERENCE')
  return resolvedId
}

async function loadEntityFull(q: QueryFn, tenantId: string, entityType: RootEntityType, entityId: string): Promise<any> {
  if (entityType === 'AGENCY') {
    const base = await q('SELECT * FROM agencies WHERE tenant_id=$1 AND agency_id=$2::uuid LIMIT 1', [tenantId, entityId])
    if (!base.rowCount) return null
    const contacts = await q('SELECT * FROM onboarding_contact_points WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
    const addresses = await q('SELECT * FROM onboarding_addresses WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
    const externalIds = await q('SELECT * FROM onboarding_external_identifiers WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
    const affiliations = await q('SELECT * FROM agency_producer_affiliations WHERE tenant_id=$1 AND agency_id=$2::uuid ORDER BY created_at ASC', [tenantId, entityId])
    return { ...base.rows[0], contacts: contacts.rows || [], addresses: addresses.rows || [], externalIdentifiers: externalIds.rows || [], affiliations: affiliations.rows || [] }
  }
  const base = await q('SELECT * FROM producers WHERE tenant_id=$1 AND producer_id=$2::uuid LIMIT 1', [tenantId, entityId])
  if (!base.rowCount) return null
  const contacts = await q('SELECT * FROM onboarding_contact_points WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
  const addresses = await q('SELECT * FROM onboarding_addresses WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
  const externalIds = await q('SELECT * FROM onboarding_external_identifiers WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid ORDER BY created_at ASC', [tenantId, entityType, entityId])
  const affiliations = await q('SELECT * FROM agency_producer_affiliations WHERE tenant_id=$1 AND producer_id=$2::uuid ORDER BY created_at ASC', [tenantId, entityId])
  return { ...base.rows[0], contacts: contacts.rows || [], addresses: addresses.rows || [], externalIdentifiers: externalIds.rows || [], affiliations: affiliations.rows || [] }
}

async function upsertEntityContacts(
  q: QueryFn,
  tenantId: string,
  entityType: RootEntityType,
  entityId: string,
  contacts: Array<Record<string, any>>,
  actor: string
) {
  await q('DELETE FROM onboarding_contact_points WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid', [tenantId, entityType, entityId])
  for (const contact of contacts) {
    const type = sanitizeText(contact.contactType).toUpperCase()
    if (!['PHONE', 'EMAIL'].includes(type)) continue
    const value = sanitizeText(contact.value)
    if (!value) continue
    const normalizedValue = type === 'EMAIL' ? value.toLowerCase() : value.replace(/\D+/g, '')
    await q(
      `INSERT INTO onboarding_contact_points (
        contact_id, tenant_id, entity_type, entity_id, contact_type, sub_type, value, normalized_value, extension,
        preferred_flag, verified_flag, bounce_flag, sms_consent, email_consent, contact_window, language_preference,
        effective_from, effective_to, metadata, created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::date,$18::date,$19::jsonb,now(),$20,now(),$20
      )`,
      [
        uuidv4(), tenantId, entityType, entityId, type, toNullable(contact.subType), value, normalizedValue || null,
        toNullable(contact.extension), toBoolean(contact.preferred, false), toBoolean(contact.verified, false),
        toBoolean(contact.bounce, false), toBoolean(contact.smsConsent, false), toBoolean(contact.emailConsent, false),
        toNullable(contact.contactWindow), toNullable(contact.languagePreference),
        normalizeDate(contact.effectiveFrom), normalizeDate(contact.effectiveTo),
        JSON.stringify(normalizeObject(contact.metadata)), actor
      ]
    )
  }
}

async function upsertEntityAddresses(
  q: QueryFn,
  tenantId: string,
  entityType: RootEntityType,
  entityId: string,
  addresses: Array<Record<string, any>>,
  actor: string
) {
  await q('DELETE FROM onboarding_addresses WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3::uuid', [tenantId, entityType, entityId])
  for (const address of addresses) {
    await q(
      `INSERT INTO onboarding_addresses (
        address_id, tenant_id, entity_type, entity_id, address_type, line1, line2, line3, city, state,
        postal_code, country, county, primary_flag, validation_status, geocode_lat, geocode_lng,
        effective_from, effective_to, metadata, created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::date,$19::date,$20::jsonb,now(),$21,now(),$21
      )`,
      [
        uuidv4(), tenantId, entityType, entityId, sanitizeText(address.addressType) || 'mailing', toNullable(address.line1),
        toNullable(address.line2), toNullable(address.line3), toNullable(address.city), toNullable(address.state),
        toNullable(address.postalCode), toNullable(address.country), toNullable(address.county), toBoolean(address.primary, false),
        sanitizeText(address.validationStatus) || 'unvalidated', address.geocodeLat == null ? null : Number(address.geocodeLat),
        address.geocodeLng == null ? null : Number(address.geocodeLng), normalizeDate(address.effectiveFrom),
        normalizeDate(address.effectiveTo), JSON.stringify(normalizeObject(address.metadata)), actor
      ]
    )
  }
}

async function upsertExternalIdentifiers(
  q: QueryFn,
  tenantId: string,
  entityType: RootEntityType,
  entityId: string,
  externalIds: Array<Record<string, any>>,
  actor: string
) {
  for (const external of externalIds) {
    const sourceSystem = sanitizeText(external.sourceSystem).toUpperCase()
    const externalId = sanitizeText(external.externalId)
    if (!sourceSystem || !externalId) continue
    await q(
      `INSERT INTO onboarding_external_identifiers (
        external_identifier_id, tenant_id, entity_type, entity_id, source_system, external_id, id_type,
        active_flag, last_sync_at, metadata, created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1::uuid,$2,$3,$4::uuid,$5,$6,$7,$8,$9::timestamptz,$10::jsonb,now(),$11,now(),$11
      )
      ON CONFLICT (tenant_id, source_system, external_id)
      DO UPDATE SET
        entity_type=excluded.entity_type,
        entity_id=excluded.entity_id,
        id_type=excluded.id_type,
        active_flag=excluded.active_flag,
        last_sync_at=excluded.last_sync_at,
        metadata=excluded.metadata,
        updated_at=now(),
        updated_by=excluded.updated_by`,
      [
        uuidv4(), tenantId, entityType, entityId, sourceSystem, externalId, toNullable(external.idType),
        toBoolean(external.active, true), normalizeTimestamp(external.lastSyncAt), JSON.stringify(normalizeObject(external.metadata)), actor
      ]
    )
  }
}

async function upsertAffiliations(
  q: QueryFn,
  tenantId: string,
  producerId: string,
  affiliations: Array<Record<string, any>>,
  actor: string
) {
  await q('DELETE FROM agency_producer_affiliations WHERE tenant_id=$1 AND producer_id=$2::uuid', [tenantId, producerId])
  for (const affiliation of affiliations) {
    const agencyIdRaw = sanitizeText(affiliation.agencyId)
    let agencyId = agencyIdRaw
    if (!isUuid(agencyId)) {
      const agencyKey = sanitizeText(affiliation.agencyKey)
      if (!agencyKey) continue
      const result = await q('SELECT agency_id FROM agencies WHERE tenant_id=$1 AND agency_key=$2 LIMIT 1', [tenantId, agencyKey])
      if (!result.rowCount) continue
      agencyId = result.rows[0].agency_id
    }
    await q(
      `INSERT INTO agency_producer_affiliations (
        affiliation_id, tenant_id, agency_id, producer_id, affiliation_role,
        effective_from, effective_to, metadata, created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1::uuid,$2,$3::uuid,$4::uuid,$5,$6::date,$7::date,$8::jsonb,now(),$9,now(),$9
      )`,
      [
        uuidv4(), tenantId, agencyId, producerId, sanitizeText(affiliation.affiliationRole) || 'PRODUCER',
        normalizeDate(affiliation.effectiveFrom), normalizeDate(affiliation.effectiveTo),
        JSON.stringify(normalizeObject(affiliation.metadata)), actor
      ]
    )
  }
}

function normalizeContactsInput(raw: Record<string, any>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  if (Array.isArray(raw.contacts)) {
    for (const item of raw.contacts) if (item && typeof item === 'object') out.push(item)
  }
  const email = sanitizeText(pick(raw, ['email', 'emailAddress']))
  if (email) out.push({ contactType: 'EMAIL', subType: 'primary', value: email, preferred: true, emailConsent: true })
  const phone = sanitizeText(pick(raw, ['phone', 'phoneNumber', 'mobile']))
  if (phone) out.push({ contactType: 'PHONE', subType: 'mobile', value: phone, preferred: !email, smsConsent: true })
  return out
}

function normalizeAddressesInput(raw: Record<string, any>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  if (Array.isArray(raw.addresses)) {
    for (const item of raw.addresses) if (item && typeof item === 'object') out.push(item)
  } else if (sanitizeText(raw.line1) || sanitizeText(raw.city) || sanitizeText(raw.state)) {
    out.push({
      addressType: sanitizeText(raw.addressType) || 'mailing',
      line1: sanitizeText(raw.line1),
      line2: sanitizeText(raw.line2),
      line3: sanitizeText(raw.line3),
      city: sanitizeText(raw.city),
      state: sanitizeText(raw.state),
      postalCode: sanitizeText(raw.postalCode),
      country: sanitizeText(raw.country) || 'US',
      county: sanitizeText(raw.county),
      primary: true
    })
  }
  return out
}

function normalizeAffiliationsInput(raw: Record<string, any>): Array<Record<string, any>> {
  if (!Array.isArray(raw.affiliations)) return []
  return raw.affiliations.filter((item: any) => item && typeof item === 'object')
}

function normalizeExternalIdentifiersInput(
  raw: Record<string, any>,
  sourceSystem: string,
  externalId: string
): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  if (Array.isArray(raw.externalIdentifiers)) {
    for (const item of raw.externalIdentifiers) if (item && typeof item === 'object') out.push(item)
  }
  if (sourceSystem && externalId) out.push({ sourceSystem, externalId, idType: 'source', active: true })
  return out
}

function normalizeContacts(input: Array<Record<string, any>>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  let preferredEmailAssigned = false
  let preferredPhoneAssigned = false
  for (const item of input || []) {
    const type = sanitizeText(item.contactType || item.type).toUpperCase()
    const value = sanitizeText(item.value)
    if (!['PHONE', 'EMAIL'].includes(type) || !value) continue
    const preferred = toBoolean(item.preferred, false)
    if (type === 'EMAIL') {
      const nextPreferred: boolean = Boolean(preferred && !preferredEmailAssigned)
      preferredEmailAssigned = preferredEmailAssigned || nextPreferred
      out.push({
        contactType: 'EMAIL',
        subType: sanitizeText(item.subType),
        value: value.toLowerCase(),
        preferred: nextPreferred,
        verified: toBoolean(item.verified, false),
        bounce: toBoolean(item.bounce, false),
        emailConsent: toBoolean(item.emailConsent, false),
        smsConsent: toBoolean(item.smsConsent, false),
        contactWindow: sanitizeText(item.contactWindow),
        languagePreference: sanitizeText(item.languagePreference),
        effectiveFrom: normalizeDate(item.effectiveFrom),
        effectiveTo: normalizeDate(item.effectiveTo),
        metadata: normalizeObject(item.metadata)
      })
    } else {
      const nextPreferred: boolean = Boolean(preferred && !preferredPhoneAssigned)
      preferredPhoneAssigned = preferredPhoneAssigned || nextPreferred
      out.push({
        contactType: 'PHONE',
        subType: sanitizeText(item.subType),
        value,
        extension: sanitizeText(item.extension),
        preferred: nextPreferred,
        verified: toBoolean(item.verified, false),
        bounce: toBoolean(item.bounce, false),
        emailConsent: toBoolean(item.emailConsent, false),
        smsConsent: toBoolean(item.smsConsent, false),
        contactWindow: sanitizeText(item.contactWindow),
        languagePreference: sanitizeText(item.languagePreference),
        effectiveFrom: normalizeDate(item.effectiveFrom),
        effectiveTo: normalizeDate(item.effectiveTo),
        metadata: normalizeObject(item.metadata)
      })
    }
  }
  return out
}

function normalizeAddresses(input: Array<Record<string, any>>): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = []
  const primaryByType = new Set<string>()
  for (const item of input || []) {
    const addressType = sanitizeText(item.addressType).toLowerCase() || 'mailing'
    const primaryRequested = toBoolean(item.primary, false)
    const primary = primaryRequested && !primaryByType.has(addressType)
    if (primary) primaryByType.add(addressType)
    out.push({
      addressType,
      line1: sanitizeText(item.line1),
      line2: sanitizeText(item.line2),
      line3: sanitizeText(item.line3),
      city: sanitizeText(item.city),
      state: sanitizeText(item.state).toUpperCase(),
      postalCode: sanitizeText(item.postalCode),
      country: sanitizeText(item.country).toUpperCase() || 'US',
      county: sanitizeText(item.county),
      primary,
      validationStatus: sanitizeText(item.validationStatus) || 'unvalidated',
      geocodeLat: item.geocodeLat,
      geocodeLng: item.geocodeLng,
      effectiveFrom: normalizeDate(item.effectiveFrom),
      effectiveTo: normalizeDate(item.effectiveTo),
      metadata: normalizeObject(item.metadata)
    })
  }
  return out
}

function normalizeAffiliations(input: Array<Record<string, any>>): Array<Record<string, any>> {
  return (input || [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      agencyId: sanitizeText(item.agencyId),
      agencyKey: sanitizeText(item.agencyKey),
      affiliationRole: sanitizeText(item.affiliationRole || item.role) || 'PRODUCER',
      effectiveFrom: normalizeDate(item.effectiveFrom),
      effectiveTo: normalizeDate(item.effectiveTo),
      metadata: normalizeObject(item.metadata)
    }))
}

function normalizeExternalIdentifiers(input: Array<Record<string, any>>): Array<Record<string, any>> {
  const deduped = new Map<string, Record<string, any>>()
  for (const item of input || []) {
    const sourceSystem = sanitizeText(item.sourceSystem).toUpperCase()
    const externalId = sanitizeText(item.externalId)
    if (!sourceSystem || !externalId) continue
    deduped.set(`${sourceSystem}:${externalId}`, {
      sourceSystem,
      externalId,
      idType: sanitizeText(item.idType),
      active: toBoolean(item.active, true),
      lastSyncAt: normalizeTimestamp(item.lastSyncAt),
      metadata: normalizeObject(item.metadata)
    })
  }
  return Array.from(deduped.values())
}

async function nextAgencyCode(q: QueryFn, tenantId: string, config: OnboardingConfig): Promise<string> {
  const prefix = normalizeAgencyCodePrefix(config.agencyCode?.prefix)
  const digits = clampInt(config.agencyCode?.digits, 4, 3, 10)
  const startAt = clampInt(config.agencyCode?.startAt, 1, 1, 999999999)

  for (let i = 0; i < 25; i += 1) {
    const currentMaxResult = await q(
      `SELECT max((regexp_replace(agency_code, '^' || $2, ''))::bigint) AS max_seq
         FROM agencies
        WHERE tenant_id=$1
          AND agency_code ~ ('^' || $2 || '[0-9]{' || $3 || '}$')`,
      [tenantId, prefix, String(digits)]
    )
    const currentMax = Number(currentMaxResult.rows?.[0]?.max_seq || 0)
    const seedValue = Math.max(startAt - 1, currentMax)
    const seqResult = await q(
      `INSERT INTO onboarding_agency_code_sequences (tenant_id, code_prefix, last_value, updated_at)
       VALUES ($1,$2,$3 + 1,now())
       ON CONFLICT (tenant_id, code_prefix)
       DO UPDATE SET last_value = onboarding_agency_code_sequences.last_value + 1, updated_at = now()
       RETURNING last_value`,
      [tenantId, prefix, seedValue]
    )
    const seq = Number(seqResult.rows?.[0]?.last_value || 0)
    const code = `${prefix}${String(seq).padStart(digits, '0')}`
    const exists = await q('SELECT 1 FROM agencies WHERE tenant_id=$1 AND agency_code=$2 LIMIT 1', [tenantId, code])
    if (!exists.rowCount) return code
  }
  throw new Error('AGENCY_CODE_GENERATION_FAILED')
}

async function nextEntityKey(
  q: QueryFn,
  tenantId: string,
  entityKind: 'AGENCY' | 'PRODUCER',
  config: OnboardingConfig
): Promise<string> {
  const year = new Date().getUTCFullYear()
  const upsert = await q(
    `INSERT INTO onboarding_key_sequences (tenant_id, entity_kind, sequence_year, last_value, updated_at)
     VALUES ($1,$2,$3,1,now())
     ON CONFLICT (tenant_id, entity_kind, sequence_year)
     DO UPDATE SET last_value = onboarding_key_sequences.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [tenantId, entityKind, year]
  )
  const seq = Number(upsert.rows[0]?.last_value || 1)
  const tenantToken = sanitizeText(tenantId).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || 'TENANT'
  const template = entityKind === 'AGENCY' ? config.keyPatterns.agency : config.keyPatterns.producer
  return (template || `${entityKind}-{TENANT}-{YYYY}-{SEQ6}`)
    .replace(/\{TENANT\}/g, tenantToken)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{SEQ\}/g, String(seq))
    .replace(/\{SEQ6\}/g, String(seq).padStart(6, '0'))
}
