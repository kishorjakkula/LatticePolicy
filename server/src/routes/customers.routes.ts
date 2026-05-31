import { Router } from 'express'
import { v4 as uuidv4 } from '../uuid.js'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { requirePermission } from '../auth.js'
import { inferCustomerAiInsights } from '../aiMl.js'
import { loadTenantAiMlConfig } from '../tenantAi.js'
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
  hashSensitiveValue,
  normalizeSensitiveValue
} from '../customerCrypto.js'
import { today, asDateOnly as _asDateOnly } from '../lib/date.utils.js'
import { sanitizeText } from '../lib/utils.js'

type QueryFn = (text: string, params?: any[]) => Promise<any>

type CustomerEntityType = 'INDIVIDUAL' | 'COMPANY' | 'BOTH'
type CustomerStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'MERGED' | 'PENDING_APPROVAL' | 'ARCHIVED'
type CustomerContactType = 'PHONE' | 'EMAIL'

type CustomerValidationConfig = {
  individual: {
    requireFirstAndLast: boolean
    requireDobOrSsnLast4: boolean
  }
  company: {
    requireLegalName: boolean
    requireFeinLast4OrIncorporationState: boolean
  }
  requireContactOrAddress: boolean
  updateExistingOnExternalId: boolean
}

type CustomerWorkflowConfig = {
  requireApprovalOnSensitiveChange: boolean
  requireApprovalOnMerge: boolean
  requireApprovalOnDeactivateWithActivePolicies: boolean
}

type CustomerSettings = {
  keyPattern: string
  validation: CustomerValidationConfig
  workflow: CustomerWorkflowConfig
}

type ValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

type PotentialMatch = {
  customerId: string
  customerKey: string
  entityType: CustomerEntityType
  status: CustomerStatus
  displayName: string
  matchScore: number
  reasons: string[]
}

type NormalizedCustomerInput = {
  entityType: CustomerEntityType
  status: CustomerStatus
  identity: {
    person: {
      firstName: string
      middleName: string
      lastName: string
      suffix: string
      preferredName: string
      dob: string
      gender: string
      maritalStatus: string
      ssn: string
      ssnLast4: string
      driverLicenseNo: string
      driverLicenseState: string
      driverLicenseExpiry: string
      nationality: string
      residency: string
    }
    company: {
      legalName: string
      dbaName: string
      fein: string
      feinLast4: string
      entityLegalType: string
      incorporationState: string
      incorporationCountry: string
      incorporationDate: string
      naics: string
      sic: string
      website: string
    }
  }
  contactPoints: Array<{
    contactPointId?: string
    contactType: CustomerContactType
    subType: string
    value: string
    preferred: boolean
    verified: boolean
    bounce: boolean
    smsConsent: boolean
    emailConsent: boolean
    callConsent: boolean
    contactWindow: string
    languagePreference: string
    effectiveFrom: string
    effectiveTo: string
    metadata: Record<string, any>
  }>
  addresses: Array<{
    addressId?: string
    addressType: string
    line1: string
    line2: string
    line3: string
    city: string
    state: string
    postalCode: string
    country: string
    county: string
    primary: boolean
    validationStatus: string
    geocodeLat: number | null
    geocodeLng: number | null
    effectiveFrom: string
    effectiveTo: string
    metadata: Record<string, any>
  }>
  relationships: Array<{
    relationshipId?: string
    relatedCustomerId: string
    relationshipType: string
    startDate: string
    endDate: string
    percentOwnership: number | null
    notes: string
    metadata: Record<string, any>
  }>
  externalIdentifiers: Array<{
    externalIdentifierId?: string
    sourceSystem: string
    externalId: string
    idType: string
    active: boolean
    lastSyncAt: string
    metadata: Record<string, any>
  }>
  compliance: {
    kycStatus: string
    kycVerificationDate: string
    kycMethod: string
    sanctionsStatus: string
    sanctionsLastCheckedAt: string
    doNotContact: boolean
    dataRetentionHold: boolean
    rightToBeForgottenRequested: boolean
    privacyRegion: string
    metadata: Record<string, any>
  }
  notes: Array<{
    noteId?: string
    category: string
    noteText: string
    metadata: Record<string, any>
  }>
  attachments: Array<{
    attachmentId?: string
    documentId: string
    fileName: string
    fileType: string
    metadata: Record<string, any>
  }>
  metadata: Record<string, any>
}

const DEFAULT_CUSTOMER_KEY_PATTERN = 'CUST-{YYYY}-{SEQ6}'

const DEFAULT_VALIDATION_CONFIG: CustomerValidationConfig = {
  individual: {
    requireFirstAndLast: true,
    requireDobOrSsnLast4: true
  },
  company: {
    requireLegalName: true,
    requireFeinLast4OrIncorporationState: true
  },
  requireContactOrAddress: true,
  updateExistingOnExternalId: true
}

const DEFAULT_WORKFLOW_CONFIG: CustomerWorkflowConfig = {
  requireApprovalOnSensitiveChange: true,
  requireApprovalOnMerge: true,
  requireApprovalOnDeactivateWithActivePolicies: true
}

const CUSTOMER_STATUSES: CustomerStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE', 'MERGED', 'PENDING_APPROVAL', 'ARCHIVED']
const CUSTOMER_ENTITY_TYPES: CustomerEntityType[] = ['INDIVIDUAL', 'COMPANY', 'BOTH']
const CONTACT_TYPES: CustomerContactType[] = ['PHONE', 'EMAIL']

export const customerAdminRoutes = Router()

customerAdminRoutes.get(
  '/settings',
  requirePermission(['admin.customers.read', 'admin.tenant.read']),
  async (req, res) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
    try {
      const settings = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        return loadCustomerSettings(q, tenantId)
      })
      return res.json(settings)
    } catch (e: any) {
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }
)

customerAdminRoutes.patch(
  '/settings',
  requirePermission(['admin.customers.manage', 'admin.tenant.manage']),
  async (req, res) => {
    const tenantId = req.tenant!.tenantId
    const db = getDb()
    if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
    try {
      const payload = req.body || {}
      const response = await withTenantTx(tenantId, async (db) => {
        const q = toRawQuery(db)
        const current = await loadCustomerSettings(q, tenantId)
        const keyPattern = normalizeCustomerKeyPattern(payload.keyPattern, current.keyPattern)
        const validation = normalizeValidationConfig(payload.validation, current.validation)
        const workflow = normalizeWorkflowConfig(payload.workflow, current.workflow)
        await q(
          `UPDATE tenants
              SET customer_key_pattern = $2,
                  customer_validation_config = $3::jsonb,
                  customer_workflow_config = $4::jsonb
            WHERE tenant_id = $1`,
          [tenantId, keyPattern, JSON.stringify(validation), JSON.stringify(workflow)]
        )
        return { keyPattern, validation, workflow }
      })
      return res.json(response)
    } catch (e: any) {
      return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
    }
  }
)

customerAdminRoutes.post('/seed-samples', requirePermission(['admin.customers.manage', 'admin.customers.read']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const samples = buildSampleCustomerPayloads()
      const bySeedCode = new Map<string, { customerId: string; customerKey: string; status: string }>()
      const created: Array<{ seedCode: string; customerId: string; customerKey: string }> = []
      const existing: Array<{ seedCode: string; customerId: string; customerKey: string }> = []

      for (const sample of samples) {
        const existingRow = await q(
          `SELECT customer_id
             FROM customers
            WHERE tenant_id = $1
              AND metadata ->> 'seedCode' = $2
            LIMIT 1`,
          [tenantId, sample.seedCode]
        )
        if ((existingRow.rowCount || 0) > 0) {
          const loaded = await loadCustomerRecordById(q, tenantId, String(existingRow.rows[0].customer_id), false)
          if (loaded) {
            bySeedCode.set(sample.seedCode, {
              customerId: loaded.customerId,
              customerKey: loaded.customerKey,
              status: loaded.status
            })
            existing.push({
              seedCode: sample.seedCode,
              customerId: loaded.customerId,
              customerKey: loaded.customerKey
            })
          }
          continue
        }
        const payload = normalizeCustomerInput(sample.payload)
        const createdResult = await createCustomerRecord(q, {
          tenantId,
          payload,
          actor,
          reason: 'SEED_SAMPLE',
          createAnyway: true
        })
        const customer = createdResult.customer
        bySeedCode.set(sample.seedCode, {
          customerId: customer.customerId,
          customerKey: customer.customerKey,
          status: customer.status
        })
        created.push({
          seedCode: sample.seedCode,
          customerId: customer.customerId,
          customerKey: customer.customerKey
        })
      }

      const relationships = buildSampleCustomerRelationships()
      let relationshipsCreated = 0
      for (const relation of relationships) {
        const source = bySeedCode.get(relation.fromSeedCode)
        const target = bySeedCode.get(relation.toSeedCode)
        if (!source || !target) continue
        const exists = await q(
          `SELECT 1
             FROM customer_relationships
            WHERE tenant_id = $1
              AND customer_id = $2::uuid
              AND related_customer_id = $3::uuid
              AND relationship_type = $4
            LIMIT 1`,
          [tenantId, source.customerId, target.customerId, relation.relationshipType]
        )
        if ((exists.rowCount || 0) > 0) continue
        await q(
          `INSERT INTO customer_relationships (
            relationship_id, tenant_id, customer_id, related_customer_id, relationship_type, start_date, end_date,
            percent_ownership, notes, metadata, created_by, updated_by, created_at, updated_at
          ) VALUES (
            $1,$2,$3::uuid,$4::uuid,$5,$6::date,$7::date,$8,$9,$10::jsonb,$11,$11,now(),now()
          )`,
          [
            uuidv4(),
            tenantId,
            source.customerId,
            target.customerId,
            relation.relationshipType,
            relation.startDate || null,
            relation.endDate || null,
            relation.percentOwnership == null ? null : relation.percentOwnership,
            relation.notes || null,
            JSON.stringify({ seeded: true, seedCode: relation.seedCode }),
            actor
          ]
        )
        relationshipsCreated += 1
      }

      return {
        createdCount: created.length,
        existingCount: existing.length,
        relationshipsCreated,
        customers: Array.from(bySeedCode.entries()).map(([seedCode, value]) => ({
          seedCode,
          customerId: value.customerId,
          customerKey: value.customerKey,
          status: value.status
        }))
      }
    })
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'SEED_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.get('/search', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return searchCustomers(q, tenantId, {
        q: req.query.q,
        customerKey: req.query.customerKey,
        name: req.query.name,
        phone: req.query.phone,
        email: req.query.email,
        taxId: req.query.taxId,
        externalId: req.query.externalId,
        address: req.query.address,
        status: req.query.status,
        entityType: req.query.entityType,
        limit: req.query.limit
      })
    })
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

customerAdminRoutes.get('/policy-links/unlinked', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return listUnlinkedPolicies(q, tenantId, {
        q: req.query.q,
        productCode: req.query.productCode,
        status: req.query.status,
        limit: req.query.limit
      })
    })
    return res.json(rows)
  } catch (e: any) {
    return res.status(500).json({ code: 'UNLINKED_POLICIES_LOAD_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.post('/policy-links/assign', requirePermission('admin.customers.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const policyId = sanitizeText(req.body?.policyId)
  const customerLookup = sanitizeText(req.body?.customerId || req.body?.customerKey || req.body?.customerIdOrKey)
  const relationshipType = normalizePolicyCustomerRelationshipType(req.body?.relationshipType ?? req.body?.roleCode)
  const isPrimary = req.body?.isPrimary == null ? relationshipType === 'PRIMARY_NAMED_INSURED' : req.body?.isPrimary === true
  const source = sanitizeText(req.body?.source) || 'admin_manual'
  if (!isUuid(policyId)) {
    return res.status(400).json({ code: 'INVALID_POLICY_ID', message: 'policyId is required' })
  }
  if (!customerLookup) {
    return res.status(400).json({ code: 'INVALID_CUSTOMER', message: 'customerId or customerKey is required' })
  }
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const actor = resolveActor(req)
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const [policyRes, customer] = await Promise.all([
        q(
          `SELECT policy_id, policy_number, metadata
             FROM policies
            WHERE tenant_id = $1 AND policy_id = $2::uuid
            LIMIT 1`,
          [tenantId, policyId]
        ),
        loadCustomerRecordByIdOrKey(q, tenantId, customerLookup, false)
      ])
      if ((policyRes.rowCount || 0) === 0) throw new Error('POLICY_NOT_FOUND')
      if (!customer) throw new Error('CUSTOMER_NOT_FOUND')

      if (isPrimary) {
        await q(
          `UPDATE policy_customer_links
              SET is_primary = false,
                  updated_at = now()
            WHERE tenant_id = $1
              AND policy_id = $2::uuid
              AND role_code = $3
              AND customer_id <> $4::uuid
              AND is_primary = true`,
          [tenantId, policyId, relationshipType, customer.customerId]
        )
      }

      await q(
        `INSERT INTO policy_customer_links (
          policy_customer_link_id, tenant_id, policy_id, customer_id, role_code, is_primary, source, metadata, created_at, updated_at
        ) VALUES (
          $1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8::jsonb, now(), now()
        )
        ON CONFLICT (tenant_id, policy_id, customer_id, role_code)
        DO UPDATE SET
          is_primary = EXCLUDED.is_primary,
          source = EXCLUDED.source,
          metadata = EXCLUDED.metadata,
          updated_at = now()`,
        [
          uuidv4(),
          tenantId,
          policyId,
          customer.customerId,
          relationshipType,
          isPrimary,
          source,
          JSON.stringify({
            customerKey: customer.customerKey || null,
            displayName: customer.displayName || null,
            mappedBy: actor
          })
        ]
      )

      if (relationshipType === 'PRIMARY_NAMED_INSURED' && isPrimary) {
        await q(
          `UPDATE policies
              SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(
                    jsonb_build_object(
                      'customerId', $3,
                      'customerKey', $4,
                      'customerName', $5
                    )
                  ),
                  updated_at = now()
            WHERE tenant_id = $1 AND policy_id = $2::uuid`,
          [tenantId, policyId, customer.customerId, customer.customerKey || null, customer.displayName || null]
        )
      }

      return {
        policyId,
        policyNumber: policyRes.rows[0].policy_number,
        customerId: customer.customerId,
        customerKey: customer.customerKey,
        customerName: customer.displayName,
        relationshipType,
        roleCode: relationshipType,
        isPrimary,
        source
      }
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'POLICY_NOT_FOUND') return res.status(404).json({ code: 'POLICY_NOT_FOUND' })
    if (msg === 'CUSTOMER_NOT_FOUND') return res.status(404).json({ code: 'CUSTOMER_NOT_FOUND' })
    return res.status(500).json({ code: 'POLICY_LINK_ASSIGN_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/validate', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = normalizeCustomerInput(req.body || {})
    const excludeCustomerId = sanitizeText(req.body?.excludeCustomerId)
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const settings = await loadCustomerSettings(q, tenantId)
      const validation = validateCustomerPayload(payload, settings.validation)
      const matches = await findPotentialMatches(q, tenantId, payload, excludeCustomerId || null)
      return {
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        potentialMatches: matches
      }
    })
    return res.json(result)
  } catch (e: any) {
    return res.status(400).json({ code: 'VALIDATION_ERROR', message: String(e?.message || e) })
  }
})

customerAdminRoutes.post('/merge', requirePermission(['admin.customers.merge', 'admin.customers.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const sourceId = sanitizeText(req.body?.sourceCustomerId)
  const targetId = sanitizeText(req.body?.targetCustomerId)
  const reason = sanitizeText(req.body?.reason) || 'MERGE'
  if (!isUuid(sourceId) || !isUuid(targetId) || sourceId === targetId) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'sourceCustomerId and targetCustomerId are required' })
  }
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const output = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const settings = await loadCustomerSettings(q, tenantId)
      const [source, target] = await Promise.all([
        loadCustomerRecordById(q, tenantId, sourceId, true),
        loadCustomerRecordById(q, tenantId, targetId, true)
      ])
      if (!source || !target) throw new Error('NOT_FOUND')
      const correlationId = uuidv4()
      if (settings.workflow.requireApprovalOnMerge && !hasPermission(req.user?.permissions, 'admin.customers.approve')) {
        await createApprovalRequest(q, tenantId, target.customerId, 'MERGE', actor, reason, {
          sourceCustomerId: source.customerId,
          targetCustomerId: target.customerId,
          resolution: req.body?.resolution || {}
        })
        await q(
          `UPDATE customers
              SET status = 'PENDING_APPROVAL',
                  pending_approval = true,
                  updated_at = now(),
                  updated_by = $3
            WHERE tenant_id = $1 AND customer_id = $2`,
          [tenantId, target.customerId, actor]
        )
        await addCustomerAuditEvent(q, {
          tenantId,
          customerId: target.customerId,
          eventType: 'MERGE_SUBMITTED_FOR_APPROVAL',
          actor,
          reason,
          correlationId,
          beforeJson: target,
          afterJson: target,
          fieldDiffs: []
        })
        return {
          submittedForApproval: true,
          sourceCustomerId: source.customerId,
          targetCustomerId: target.customerId
        }
      }
      const merged = await mergeCustomers(q, tenantId, source.customerId, target.customerId, req.body?.resolution || {}, actor, reason)
      return {
        submittedForApproval: false,
        sourceCustomerId: source.customerId,
        targetCustomerId: target.customerId,
        customer: merged
      }
    })
    return res.json(output)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'MERGE_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/import', requirePermission(['admin.customers.import', 'admin.customers.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = normalizeCustomerInput(req.body?.payload || req.body || {})
    const mode = String(req.body?.mode || 'upsert').toLowerCase()
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const settings = await loadCustomerSettings(q, tenantId)
      const matchByExternal = await findExistingCustomerByExternalIdentifiers(q, tenantId, payload.externalIdentifiers)
      if (matchByExternal && mode !== 'create-only' && settings.validation.updateExistingOnExternalId) {
        const current = await loadCustomerRecordById(q, tenantId, matchByExternal, true)
        if (!current) throw new Error('NOT_FOUND')
        const updated = await updateCustomerRecord(q, {
          tenantId,
          customerId: current.customerId,
          expectedVersion: Number(current.version),
          payload,
          actor,
          reason: sanitizeText(req.body?.reason) || 'IMPORT_UPDATE',
          allowIdentityUpdate: true
        })
        return { mode: 'updated', customer: updated }
      }
      const created = await createCustomerRecord(q, {
        tenantId,
        payload,
        actor,
        reason: sanitizeText(req.body?.reason) || 'IMPORT_CREATE',
        createAnyway: true
      })
      return { mode: 'created', customer: created.customer }
    })
    return res.json(result)
  } catch (e: any) {
    return res.status(400).json({ code: 'IMPORT_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.post('/', requirePermission('admin.customers.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const payload = normalizeCustomerInput(req.body || {})
    const createAnyway = req.body?.createAnyway === true
    const reason = sanitizeText(req.body?.reason) || 'CREATE'
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return createCustomerRecord(q, {
        tenantId,
        payload,
        actor,
        reason,
        createAnyway
      })
    })
    if (result.potentialMatches.length && !createAnyway) {
      return res.status(409).json({
        code: 'POTENTIAL_DUPLICATE',
        message: 'Potential duplicate customers found',
        potentialMatches: result.potentialMatches
      })
    }
    return res.status(201).json(result.customer)
  } catch (e: any) {
    return res.status(400).json({ code: 'CREATE_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.get('/:idOrKey/export', requirePermission(['admin.customers.export', 'admin.customers.read']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const customer = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
    })
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(customer)
  } catch (e: any) {
    return res.status(500).json({ code: 'EXPORT_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.get('/:idOrKey/audit', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const customer = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, false)
    })
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND' })
    const limit = clampNumber(req.query.limit, 100, 1, 1000)
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT event_id, event_type, actor, reason, correlation_id, before_json, after_json, field_diffs, created_at
           FROM customer_audit_events
          WHERE tenant_id = $1 AND customer_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [tenantId, customer.customerId, limit]
      )
    })
    return res.json((rows.rows || []).map(mapAuditEvent))
  } catch (e: any) {
    return res.status(500).json({ code: 'AUDIT_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.post('/:idOrKey/reveal', requirePermission('admin.customers.pii_reveal'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const reason = sanitizeText(req.body?.reason)
  const field = sanitizeText(req.body?.field).toLowerCase()
  if (!reason) return res.status(400).json({ code: 'REASON_REQUIRED', message: 'Reason is required' })
  if (!['ssn', 'fein', 'dob'].includes(field)) {
    return res.status(400).json({ code: 'INVALID_FIELD', message: 'field must be one of ssn, fein, dob' })
  }
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      let value: string | null = null
      if (field === 'ssn') {
        value = decryptSensitiveValue(customer.identity?.person?.ssnEncrypted)
      } else if (field === 'fein') {
        value = decryptSensitiveValue(customer.identity?.company?.feinEncrypted)
      } else {
        value = decryptSensitiveValue(customer.identity?.person?.dobEncrypted)
      }
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'PII_REVEAL',
        actor,
        reason,
        beforeJson: null,
        afterJson: { field, revealed: value ? true : false },
        fieldDiffs: [{ path: `/pii/${field}`, before: null, after: value ? '<revealed>' : null }]
      })
      return { field, value: value || null }
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'REVEAL_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/:idOrKey/submit-approval', requirePermission('admin.customers.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const reason = sanitizeText(req.body?.reason) || 'SUBMIT_APPROVAL'
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      await createApprovalRequest(q, tenantId, customer.customerId, 'UPDATE', actor, reason, req.body?.payload || {})
      await q(
        `UPDATE customers
            SET status = 'PENDING_APPROVAL',
                pending_approval = true,
                updated_at = now(),
                updated_by = $3
          WHERE tenant_id = $1 AND customer_id = $2`,
        [tenantId, customer.customerId, actor]
      )
      const updated = await loadCustomerRecordById(q, tenantId, customer.customerId, true)
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'SUBMIT_FOR_APPROVAL',
        actor,
        reason,
        beforeJson: customer,
        afterJson: updated,
        fieldDiffs: diffObjects(customer, updated)
      })
      return updated
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'APPROVAL_SUBMIT_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/:idOrKey/approve', requirePermission('admin.customers.approve'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const reason = sanitizeText(req.body?.reason) || 'APPROVED'
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      await q(
        `UPDATE customer_approvals
            SET status = 'APPROVED',
                reviewed_by = $3,
                reviewed_at = now(),
                reason = COALESCE($4, reason)
          WHERE tenant_id = $1
            AND customer_id = $2
            AND status = 'PENDING'`,
        [tenantId, customer.customerId, actor, reason]
      )
      await q(
        `UPDATE customers
            SET status = CASE
                           WHEN status = 'PENDING_APPROVAL' THEN 'ACTIVE'
                           ELSE status
                         END,
                pending_approval = false,
                updated_at = now(),
                updated_by = $3
          WHERE tenant_id = $1 AND customer_id = $2`,
        [tenantId, customer.customerId, actor]
      )
      const updated = await loadCustomerRecordById(q, tenantId, customer.customerId, true)
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'APPROVED',
        actor,
        reason,
        beforeJson: customer,
        afterJson: updated,
        fieldDiffs: diffObjects(customer, updated)
      })
      return updated
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'APPROVAL_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/:idOrKey/deactivate', requirePermission(['admin.customers.deactivate', 'admin.customers.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const reason = sanitizeText(req.body?.reason)
  const effectiveDate = normalizeDate(req.body?.effectiveDate) || todayDate()
  if (!reason) return res.status(400).json({ code: 'REASON_REQUIRED', message: 'reason is required' })
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      const settings = await loadCustomerSettings(q, tenantId)
      const activePolicyCount = await countActivePolicyReferences(q, tenantId, customer.customerId)
      if (activePolicyCount > 0 && settings.workflow.requireApprovalOnDeactivateWithActivePolicies) {
        await createApprovalRequest(q, tenantId, customer.customerId, 'DEACTIVATE', actor, reason, {
          effectiveDate,
          activePolicyCount
        })
        await q(
          `UPDATE customers
              SET status = 'PENDING_APPROVAL',
                  pending_approval = true,
                  updated_at = now(),
                  updated_by = $3
            WHERE tenant_id = $1 AND customer_id = $2`,
          [tenantId, customer.customerId, actor]
        )
        const updatedPending = await loadCustomerRecordById(q, tenantId, customer.customerId, true)
        return { submittedForApproval: true, customer: updatedPending, activePolicyCount }
      }
      await q(
        `UPDATE customers
            SET status = 'INACTIVE',
                pending_approval = false,
                deactivation_reason = $3,
                deactivation_effective_date = $4,
                deactivated_at = now(),
                updated_at = now(),
                updated_by = $5,
                version = version + 1
          WHERE tenant_id = $1 AND customer_id = $2`,
        [tenantId, customer.customerId, reason, effectiveDate, actor]
      )
      const updated = await loadCustomerRecordById(q, tenantId, customer.customerId, true)
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'DEACTIVATED',
        actor,
        reason,
        beforeJson: customer,
        afterJson: updated,
        fieldDiffs: diffObjects(customer, updated)
      })
      return { submittedForApproval: false, customer: updated, activePolicyCount }
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'DEACTIVATE_FAILED', message: msg })
  }
})

customerAdminRoutes.post('/:idOrKey/reactivate', requirePermission(['admin.customers.deactivate', 'admin.customers.manage']), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const reason = sanitizeText(req.body?.reason) || 'REACTIVATE'
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      await q(
        `UPDATE customers
            SET status = 'ACTIVE',
                pending_approval = false,
                deactivation_reason = null,
                deactivation_effective_date = null,
                deactivated_at = null,
                updated_at = now(),
                updated_by = $3,
                version = version + 1
          WHERE tenant_id = $1 AND customer_id = $2`,
        [tenantId, customer.customerId, actor]
      )
      const updated = await loadCustomerRecordById(q, tenantId, customer.customerId, true)
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'REACTIVATED',
        actor,
        reason,
        beforeJson: customer,
        afterJson: updated,
        fieldDiffs: diffObjects(customer, updated)
      })
      return updated
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'REACTIVATE_FAILED', message: msg })
  }
})

customerAdminRoutes.get('/:idOrKey/policies', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, false)
      if (!customer) throw new Error('NOT_FOUND')
      return listCustomerPolicies(q, tenantId, customer.customerId, req.query.limit)
    })
    return res.json(rows)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'POLICY_LINKS_LOAD_FAILED', message: msg })
  }
})

customerAdminRoutes.get('/:idOrKey/quotes', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, false)
      if (!customer) throw new Error('NOT_FOUND')
      return listCustomerOpenQuotes(q, tenantId, customer, req.query.limit)
    })
    return res.json(rows)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'CUSTOMER_QUOTES_LOAD_FAILED', message: msg })
  }
})

customerAdminRoutes.get('/:idOrKey/ai-insights', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const aiMlConfig = await loadTenantAiMlConfig(tenantId)
    const payload = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      const [policies, quotes] = await Promise.all([
        listCustomerPolicies(q, tenantId, customer.customerId, 500),
        listCustomerOpenQuotes(q, tenantId, customer, 500)
      ])
      return { customer, policies, quotes }
    })

    const aiInsights = inferCustomerAiInsights(aiMlConfig, {
      customer: {
        entityType: payload.customer?.entityType,
        status: payload.customer?.status
      },
      policies: (payload.policies || []).map((row: any) => ({
        productCode: row.productCode,
        status: row.status,
        internalStatus: row.internalStatus,
        effectiveDate: row.effectiveDate,
        expirationDate: row.expirationDate,
        premiumTotal: Number(row.premiumTotal || 0)
      })),
      quotes: (payload.quotes || []).map((row: any) => ({
        productCode: row.productCode,
        status: row.status,
        effectiveDate: row.effectiveDate,
        premiumTotal: 0
      }))
    })

    return res.json({
      tenantId,
      customerId: payload.customer.customerId,
      customerKey: payload.customer.customerKey,
      aiInsights
    })
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(500).json({ code: 'AI_CUSTOMER_ERROR', message: msg })
  }
})

customerAdminRoutes.get('/:idOrKey', requirePermission('admin.customers.read'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const customer = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
    })
    if (!customer) return res.status(404).json({ code: 'NOT_FOUND' })
    if (customer.status === 'MERGED' && customer.survivorCustomerId) {
      return res.json({ ...customer, mergedRedirectCustomerId: customer.survivorCustomerId })
    }
    return res.json(customer)
  } catch (e: any) {
    return res.status(500).json({ code: 'LOAD_FAILED', message: String(e?.message || e) })
  }
})

customerAdminRoutes.patch(
  '/:idOrKey',
  requirePermission(['admin.customers.manage', 'admin.customers.contact.manage']),
  async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = resolveActor(req)
  const expectedVersion = clampNumber(req.body?.expectedVersion, NaN, 1, Number.MAX_SAFE_INTEGER)
  const reason = sanitizeText(req.body?.reason) || 'UPDATE'
  if (!Number.isFinite(expectedVersion)) {
    return res.status(400).json({ code: 'EXPECTED_VERSION_REQUIRED', message: 'expectedVersion is required' })
  }
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existing = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!existing) throw new Error('NOT_FOUND')
      const customerServiceMode = hasPermission(req.user?.permissions, 'admin.customers.contact.manage') &&
        !hasPermission(req.user?.permissions, 'admin.customers.manage')
      const payload = normalizeCustomerInput(req.body || {})
      const updated = await updateCustomerRecord(q, {
        tenantId,
        customerId: existing.customerId,
        expectedVersion,
        payload,
        actor,
        reason,
        allowIdentityUpdate: !customerServiceMode
      })
      return updated
    })
    return res.json(result)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'VERSION_MISMATCH') return res.status(409).json({ code: 'VERSION_MISMATCH' })
    if (msg === 'IDENTITY_EDIT_FORBIDDEN') return res.status(403).json({ code: 'IDENTITY_EDIT_FORBIDDEN' })
    if (msg === 'POTENTIAL_DUPLICATE') {
      return res.status(409).json({ code: 'POTENTIAL_DUPLICATE', message: 'Potential duplicate customers found' })
    }
    return res.status(400).json({ code: 'UPDATE_FAILED', message: msg })
  }
  }
)

customerAdminRoutes.delete('/:idOrKey', requirePermission('admin.customers.manage'), async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const db = getDb()
  if (!db) return res.status(503).json({ code: 'DB_REQUIRED', message: 'Database mode required' })
  try {
    const actor = resolveActor(req)
    const reason = sanitizeText(req.body?.reason) || 'DELETE'
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const customer = await loadCustomerRecordByIdOrKey(q, tenantId, req.params.idOrKey, true)
      if (!customer) throw new Error('NOT_FOUND')
      const refs = await countCustomerReferences(q, tenantId, customer.customerId)
      if (refs > 0) throw new Error('HAS_REFERENCES')
      await q('DELETE FROM customers WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customer.customerId])
      await addCustomerAuditEvent(q, {
        tenantId,
        customerId: customer.customerId,
        eventType: 'DELETED',
        actor,
        reason,
        beforeJson: customer,
        afterJson: null,
        fieldDiffs: diffObjects(customer, null)
      })
      return true
    })
    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(204).end()
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (msg === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if (msg === 'HAS_REFERENCES') {
      return res.status(409).json({ code: 'HAS_REFERENCES', message: 'Customer is referenced and cannot be deleted' })
    }
    return res.status(500).json({ code: 'DELETE_FAILED', message: msg })
  }
})

async function createCustomerRecord(
  q: QueryFn,
  input: {
    tenantId: string
    payload: NormalizedCustomerInput
    actor: string
    reason: string
    createAnyway: boolean
  }
): Promise<{ customer: any; potentialMatches: PotentialMatch[] }> {
  const settings = await loadCustomerSettings(q, input.tenantId)
  const validation = validateCustomerPayload(input.payload, settings.validation)
  if (!validation.valid) {
    throw new Error(validation.errors.join('; '))
  }
  const potentialMatches = await findPotentialMatches(q, input.tenantId, input.payload, null)
  if (potentialMatches.length > 0 && !input.createAnyway) {
    return { customer: null, potentialMatches }
  }
  const customerId = uuidv4()
  const customerKey = await allocateCustomerKey(q, input.tenantId, settings.keyPattern)
  const displayName = deriveDisplayName(input.payload)
  const normalizedStatus = normalizeCustomerStatus(input.payload.status, 'DRAFT')
  await q(
    `INSERT INTO customers (
      tenant_id, customer_id, customer_key, entity_type, status, version, display_name, created_by, updated_by, metadata
    ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$7,$8::jsonb)`,
    [
      input.tenantId,
      customerId,
      customerKey,
      input.payload.entityType,
      normalizedStatus,
      displayName,
      input.actor,
      JSON.stringify(input.payload.metadata || {})
    ]
  )
  await persistCustomerSections(q, input.tenantId, customerId, input.payload, input.actor, {
    preserveMissingAsHistory: false
  })
  const customer = await loadCustomerRecordById(q, input.tenantId, customerId, true)
  await addCustomerAuditEvent(q, {
    tenantId: input.tenantId,
    customerId,
    eventType: 'CREATED',
    actor: input.actor,
    reason: input.reason,
    beforeJson: null,
    afterJson: customer,
    fieldDiffs: diffObjects(null, customer)
  })
  return { customer, potentialMatches }
}

async function updateCustomerRecord(
  q: QueryFn,
  input: {
    tenantId: string
    customerId: string
    expectedVersion: number
    payload: NormalizedCustomerInput
    actor: string
    reason: string
    allowIdentityUpdate: boolean
  }
): Promise<any> {
  const settings = await loadCustomerSettings(q, input.tenantId)
  const existing = await loadCustomerRecordById(q, input.tenantId, input.customerId, true)
  if (!existing) throw new Error('NOT_FOUND')
  if (existing.version !== input.expectedVersion) throw new Error('VERSION_MISMATCH')
  if (!input.allowIdentityUpdate && identitySectionsChanged(existing, input.payload)) {
    throw new Error('IDENTITY_EDIT_FORBIDDEN')
  }
  const validation = validateCustomerPayload(input.payload, settings.validation)
  if (!validation.valid) throw new Error(validation.errors.join('; '))
  const potentialMatches = await findPotentialMatches(q, input.tenantId, input.payload, input.customerId)
  if (potentialMatches.length > 0 && input.reason.toUpperCase() !== 'MERGE') {
    throw new Error('POTENTIAL_DUPLICATE')
  }
  const displayName = deriveDisplayName(input.payload)
  const nextStatus = normalizeCustomerStatus(input.payload.status, existing.status || 'DRAFT')
  await q(
    `UPDATE customers
        SET entity_type = $3,
            status = $4,
            display_name = $5,
            metadata = $6::jsonb,
            version = version + 1,
            updated_at = now(),
            updated_by = $7
      WHERE tenant_id = $1
        AND customer_id = $2
        AND version = $8`,
    [
      input.tenantId,
      input.customerId,
      input.payload.entityType,
      nextStatus,
      displayName,
      JSON.stringify(input.payload.metadata || {}),
      input.actor,
      input.expectedVersion
    ]
  )
  await persistCustomerSections(q, input.tenantId, input.customerId, input.payload, input.actor, {
    preserveMissingAsHistory: true
  })
  const updated = await loadCustomerRecordById(q, input.tenantId, input.customerId, true)
  await addCustomerAuditEvent(q, {
    tenantId: input.tenantId,
    customerId: input.customerId,
    eventType: 'UPDATED',
    actor: input.actor,
    reason: input.reason,
    beforeJson: existing,
    afterJson: updated,
    fieldDiffs: diffObjects(existing, updated)
  })
  return updated
}

async function persistCustomerSections(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  payload: NormalizedCustomerInput,
  actor: string,
  options: { preserveMissingAsHistory: boolean }
) {
  await upsertPersonDetails(q, tenantId, customerId, payload.identity.person)
  await upsertCompanyDetails(q, tenantId, customerId, payload.identity.company)
  await syncContactPoints(q, tenantId, customerId, payload.contactPoints, options.preserveMissingAsHistory)
  await syncAddresses(q, tenantId, customerId, payload.addresses, options.preserveMissingAsHistory)
  await syncExternalIdentifiers(q, tenantId, customerId, payload.externalIdentifiers)
  await syncRelationships(q, tenantId, customerId, payload.relationships, options.preserveMissingAsHistory, actor)
  await upsertCompliance(q, tenantId, customerId, payload.compliance)
  await syncNotes(q, tenantId, customerId, payload.notes, actor)
  await syncAttachments(q, tenantId, customerId, payload.attachments, actor)
}

async function upsertPersonDetails(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  person: NormalizedCustomerInput['identity']['person']
) {
  const ssnLast4 = normalizeLast4(person.ssnLast4 || person.ssn)
  const ssnHash = hashSensitiveValue(person.ssn || person.ssnLast4)
  const ssnEncrypted = encryptSensitiveValue(person.ssn)
  const dobEncrypted = encryptSensitiveValue(person.dob)
  const dobHash = hashSensitiveValue(person.dob)
  await q(
    `INSERT INTO customer_person_details (
      tenant_id, customer_id, first_name, middle_name, last_name, suffix, preferred_name, dob_encrypted, dob_hash,
      gender, marital_status, ssn_encrypted, ssn_last4, ssn_hash, driver_license_no, driver_license_state,
      driver_license_expiry, nationality, residency, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,now())
    ON CONFLICT (tenant_id, customer_id) DO UPDATE
      SET first_name = EXCLUDED.first_name,
          middle_name = EXCLUDED.middle_name,
          last_name = EXCLUDED.last_name,
          suffix = EXCLUDED.suffix,
          preferred_name = EXCLUDED.preferred_name,
          dob_encrypted = EXCLUDED.dob_encrypted,
          dob_hash = EXCLUDED.dob_hash,
          gender = EXCLUDED.gender,
          marital_status = EXCLUDED.marital_status,
          ssn_encrypted = EXCLUDED.ssn_encrypted,
          ssn_last4 = EXCLUDED.ssn_last4,
          ssn_hash = EXCLUDED.ssn_hash,
          driver_license_no = EXCLUDED.driver_license_no,
          driver_license_state = EXCLUDED.driver_license_state,
          driver_license_expiry = EXCLUDED.driver_license_expiry,
          nationality = EXCLUDED.nationality,
          residency = EXCLUDED.residency,
          updated_at = now()`,
    [
      tenantId,
      customerId,
      person.firstName || null,
      person.middleName || null,
      person.lastName || null,
      person.suffix || null,
      person.preferredName || null,
      dobEncrypted,
      dobHash,
      person.gender || null,
      person.maritalStatus || null,
      ssnEncrypted,
      ssnLast4,
      ssnHash,
      person.driverLicenseNo || null,
      person.driverLicenseState || null,
      normalizeDate(person.driverLicenseExpiry),
      person.nationality || null,
      person.residency || null
    ]
  )
}

async function upsertCompanyDetails(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  company: NormalizedCustomerInput['identity']['company']
) {
  const feinLast4 = normalizeLast4(company.feinLast4 || company.fein)
  const feinHash = hashSensitiveValue(company.fein || company.feinLast4)
  const feinEncrypted = encryptSensitiveValue(company.fein)
  await q(
    `INSERT INTO customer_company_details (
      tenant_id, customer_id, legal_name, dba_name, fein_encrypted, fein_last4, fein_hash, entity_legal_type,
      incorporation_state, incorporation_country, incorporation_date, naics, sic, website, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
    ON CONFLICT (tenant_id, customer_id) DO UPDATE
      SET legal_name = EXCLUDED.legal_name,
          dba_name = EXCLUDED.dba_name,
          fein_encrypted = EXCLUDED.fein_encrypted,
          fein_last4 = EXCLUDED.fein_last4,
          fein_hash = EXCLUDED.fein_hash,
          entity_legal_type = EXCLUDED.entity_legal_type,
          incorporation_state = EXCLUDED.incorporation_state,
          incorporation_country = EXCLUDED.incorporation_country,
          incorporation_date = EXCLUDED.incorporation_date,
          naics = EXCLUDED.naics,
          sic = EXCLUDED.sic,
          website = EXCLUDED.website,
          updated_at = now()`,
    [
      tenantId,
      customerId,
      company.legalName || null,
      company.dbaName || null,
      feinEncrypted,
      feinLast4,
      feinHash,
      company.entityLegalType || null,
      company.incorporationState || null,
      company.incorporationCountry || null,
      normalizeDate(company.incorporationDate),
      company.naics || null,
      company.sic || null,
      company.website || null
    ]
  )
}

async function syncContactPoints(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  items: NormalizedCustomerInput['contactPoints'],
  preserveMissingAsHistory: boolean
) {
  const existingRes = await q(
    `SELECT contact_point_id, contact_type
       FROM customer_contact_points
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  )
  const existingIds = new Set<string>(((existingRes.rows || []) as any[]).map((row) => String(row.contact_point_id)))
  const seenIds = new Set<string>()
  const primaryPerType = new Map<CustomerContactType, boolean>()

  for (const item of items) {
    if (!item.value) continue
    const contactType = normalizeContactType(item.contactType)
    if (!contactType) continue
    const requestedPrimary = item.preferred === true
    const preferred = requestedPrimary && !primaryPerType.get(contactType)
    if (preferred) primaryPerType.set(contactType, true)
    const id = isUuid(item.contactPointId || '') ? String(item.contactPointId) : uuidv4()
    seenIds.add(id)
    const normalizedValue = contactType === 'PHONE' ? normalizePhone(item.value) : normalizeEmail(item.value)
    await q(
      `INSERT INTO customer_contact_points (
        contact_point_id, tenant_id, customer_id, contact_type, sub_type, value, normalized_value,
        preferred_flag, verified_flag, bounce_flag, sms_consent, email_consent, call_consent, contact_window,
        language_preference, effective_from, effective_to, metadata, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,now(),now()
      )
      ON CONFLICT (contact_point_id) DO UPDATE
        SET contact_type = EXCLUDED.contact_type,
            sub_type = EXCLUDED.sub_type,
            value = EXCLUDED.value,
            normalized_value = EXCLUDED.normalized_value,
            preferred_flag = EXCLUDED.preferred_flag,
            verified_flag = EXCLUDED.verified_flag,
            bounce_flag = EXCLUDED.bounce_flag,
            sms_consent = EXCLUDED.sms_consent,
            email_consent = EXCLUDED.email_consent,
            call_consent = EXCLUDED.call_consent,
            contact_window = EXCLUDED.contact_window,
            language_preference = EXCLUDED.language_preference,
            effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to,
            metadata = EXCLUDED.metadata,
            updated_at = now()`,
      [
        id,
        tenantId,
        customerId,
        contactType,
        item.subType || null,
        item.value,
        normalizedValue || null,
        preferred,
        item.verified === true,
        item.bounce === true,
        item.smsConsent === true,
        item.emailConsent === true,
        item.callConsent === true,
        item.contactWindow || null,
        item.languagePreference || null,
        normalizeDate(item.effectiveFrom),
        normalizeDate(item.effectiveTo),
        JSON.stringify(item.metadata || {})
      ]
    )
  }

  if (preserveMissingAsHistory) {
    for (const existingId of existingIds) {
      if (seenIds.has(existingId)) continue
      await q(
        `UPDATE customer_contact_points
            SET effective_to = COALESCE(effective_to, $3::date),
                preferred_flag = false,
                updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2 AND contact_point_id = $4`,
        [tenantId, customerId, todayDate(), existingId]
      )
    }
  }
}

async function syncAddresses(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  items: NormalizedCustomerInput['addresses'],
  preserveMissingAsHistory: boolean
) {
  const existingRes = await q(
    `SELECT address_id
       FROM customer_addresses
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  )
  const existingIds = new Set<string>(((existingRes.rows || []) as any[]).map((row) => String(row.address_id)))
  const seenIds = new Set<string>()
  const primaryByType = new Map<string, boolean>()

  for (const item of items) {
    if (!item.addressType) continue
    const addressType = sanitizeText(item.addressType).toUpperCase()
    const requestedPrimary = item.primary === true
    const primary = requestedPrimary && !primaryByType.get(addressType)
    if (primary) primaryByType.set(addressType, true)
    const id = isUuid(item.addressId || '') ? String(item.addressId) : uuidv4()
    seenIds.add(id)
    await q(
      `INSERT INTO customer_addresses (
        address_id, tenant_id, customer_id, address_type, line1, line2, line3, city, state, postal_code, country,
        county, primary_flag, validation_status, geocode_lat, geocode_lng, effective_from, effective_to, metadata,
        created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,now(),now()
      )
      ON CONFLICT (address_id) DO UPDATE
        SET address_type = EXCLUDED.address_type,
            line1 = EXCLUDED.line1,
            line2 = EXCLUDED.line2,
            line3 = EXCLUDED.line3,
            city = EXCLUDED.city,
            state = EXCLUDED.state,
            postal_code = EXCLUDED.postal_code,
            country = EXCLUDED.country,
            county = EXCLUDED.county,
            primary_flag = EXCLUDED.primary_flag,
            validation_status = EXCLUDED.validation_status,
            geocode_lat = EXCLUDED.geocode_lat,
            geocode_lng = EXCLUDED.geocode_lng,
            effective_from = EXCLUDED.effective_from,
            effective_to = EXCLUDED.effective_to,
            metadata = EXCLUDED.metadata,
            updated_at = now()`,
      [
        id,
        tenantId,
        customerId,
        addressType,
        item.line1 || null,
        item.line2 || null,
        item.line3 || null,
        item.city || null,
        item.state || null,
        item.postalCode || null,
        item.country || null,
        item.county || null,
        primary,
        sanitizeText(item.validationStatus) || 'unvalidated',
        item.geocodeLat,
        item.geocodeLng,
        normalizeDate(item.effectiveFrom),
        normalizeDate(item.effectiveTo),
        JSON.stringify(item.metadata || {})
      ]
    )
  }

  if (preserveMissingAsHistory) {
    for (const existingId of existingIds) {
      if (seenIds.has(existingId)) continue
      await q(
        `UPDATE customer_addresses
            SET effective_to = COALESCE(effective_to, $3::date),
                primary_flag = false,
                updated_at = now()
          WHERE tenant_id = $1 AND customer_id = $2 AND address_id = $4`,
        [tenantId, customerId, todayDate(), existingId]
      )
    }
  }
}

async function syncExternalIdentifiers(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  items: NormalizedCustomerInput['externalIdentifiers']
) {
  const seenKeys = new Set<string>()
  for (const item of items) {
    const source = sanitizeText(item.sourceSystem)
    const externalId = sanitizeText(item.externalId)
    if (!source || !externalId) continue
    const key = `${source.toUpperCase()}::${externalId.toUpperCase()}`
    seenKeys.add(key)
    await q(
      `INSERT INTO customer_external_identifiers (
        external_identifier_id, tenant_id, customer_id, source_system, external_id, id_type, active_flag, last_sync_at, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now(),now())
      ON CONFLICT (tenant_id, source_system, external_id) DO UPDATE
        SET customer_id = EXCLUDED.customer_id,
            id_type = EXCLUDED.id_type,
            active_flag = EXCLUDED.active_flag,
            last_sync_at = EXCLUDED.last_sync_at,
            metadata = EXCLUDED.metadata,
            updated_at = now()`,
      [
        isUuid(item.externalIdentifierId || '') ? String(item.externalIdentifierId) : uuidv4(),
        tenantId,
        customerId,
        source.toUpperCase(),
        externalId,
        sanitizeText(item.idType) || null,
        item.active !== false,
        normalizeTimestamp(item.lastSyncAt) || null,
        JSON.stringify(item.metadata || {})
      ]
    )
  }
  if (!seenKeys.size) return
  const existing = await q(
    `SELECT external_identifier_id, source_system, external_id
       FROM customer_external_identifiers
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  )
  for (const row of existing.rows || []) {
    const key = `${String(row.source_system || '').toUpperCase()}::${String(row.external_id || '').toUpperCase()}`
    if (seenKeys.has(key)) continue
    await q(
      `UPDATE customer_external_identifiers
          SET active_flag = false,
              updated_at = now()
        WHERE tenant_id = $1 AND external_identifier_id = $2`,
      [tenantId, row.external_identifier_id]
    )
  }
}

async function syncRelationships(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  items: NormalizedCustomerInput['relationships'],
  preserveMissingAsHistory: boolean,
  actor: string
) {
  const existingRes = await q(
    `SELECT relationship_id
       FROM customer_relationships
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, customerId]
  )
  const existingIds = new Set<string>(((existingRes.rows || []) as any[]).map((row) => String(row.relationship_id)))
  const seenIds = new Set<string>()
  for (const item of items) {
    if (!isUuid(item.relatedCustomerId || '')) continue
    const relationshipType = sanitizeText(item.relationshipType)
    if (!relationshipType) continue
    const id = isUuid(item.relationshipId || '') ? String(item.relationshipId) : uuidv4()
    seenIds.add(id)
    await q(
      `INSERT INTO customer_relationships (
        relationship_id, tenant_id, customer_id, related_customer_id, relationship_type, start_date, end_date,
        percent_ownership, notes, metadata, created_by, updated_by, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$11,now(),now()
      )
      ON CONFLICT (relationship_id) DO UPDATE
        SET related_customer_id = EXCLUDED.related_customer_id,
            relationship_type = EXCLUDED.relationship_type,
            start_date = EXCLUDED.start_date,
            end_date = EXCLUDED.end_date,
            percent_ownership = EXCLUDED.percent_ownership,
            notes = EXCLUDED.notes,
            metadata = EXCLUDED.metadata,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()`,
      [
        id,
        tenantId,
        customerId,
        item.relatedCustomerId,
        relationshipType,
        normalizeDate(item.startDate),
        normalizeDate(item.endDate),
        item.percentOwnership,
        item.notes || null,
        JSON.stringify(item.metadata || {}),
        actor
      ]
    )
  }
  for (const existingId of existingIds) {
    if (seenIds.has(existingId)) continue
    if (preserveMissingAsHistory) {
      await q(
        `UPDATE customer_relationships
            SET end_date = COALESCE(end_date, $3::date),
                updated_at = now(),
                updated_by = $4
          WHERE tenant_id = $1 AND customer_id = $2 AND relationship_id = $5`,
        [tenantId, customerId, todayDate(), actor, existingId]
      )
    } else {
      await q(
        `DELETE FROM customer_relationships
          WHERE tenant_id = $1 AND customer_id = $2 AND relationship_id = $3`,
        [tenantId, customerId, existingId]
      )
    }
  }
}

async function upsertCompliance(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  compliance: NormalizedCustomerInput['compliance']
) {
  await q(
    `INSERT INTO customer_compliance (
      tenant_id, customer_id, kyc_status, kyc_verification_date, kyc_method, sanctions_status, sanctions_last_checked_at,
      do_not_contact, data_retention_hold, right_to_be_forgotten_requested, privacy_region, metadata, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,now(),now()
    )
    ON CONFLICT (tenant_id, customer_id) DO UPDATE
      SET kyc_status = EXCLUDED.kyc_status,
          kyc_verification_date = EXCLUDED.kyc_verification_date,
          kyc_method = EXCLUDED.kyc_method,
          sanctions_status = EXCLUDED.sanctions_status,
          sanctions_last_checked_at = EXCLUDED.sanctions_last_checked_at,
          do_not_contact = EXCLUDED.do_not_contact,
          data_retention_hold = EXCLUDED.data_retention_hold,
          right_to_be_forgotten_requested = EXCLUDED.right_to_be_forgotten_requested,
          privacy_region = EXCLUDED.privacy_region,
          metadata = EXCLUDED.metadata,
          updated_at = now()`,
    [
      tenantId,
      customerId,
      sanitizeText(compliance.kycStatus) || null,
      normalizeDate(compliance.kycVerificationDate),
      sanitizeText(compliance.kycMethod) || null,
      sanitizeText(compliance.sanctionsStatus) || null,
      normalizeTimestamp(compliance.sanctionsLastCheckedAt) || null,
      compliance.doNotContact === true,
      compliance.dataRetentionHold === true,
      compliance.rightToBeForgottenRequested === true,
      sanitizeText(compliance.privacyRegion) || null,
      JSON.stringify(compliance.metadata || {})
    ]
  )
}

async function syncNotes(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  notes: NormalizedCustomerInput['notes'],
  actor: string
) {
  await q('DELETE FROM customer_notes WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId])
  for (const note of notes) {
    if (!note.noteText) continue
    await q(
      `INSERT INTO customer_notes (
        note_id, tenant_id, customer_id, category, note_text, created_by, metadata, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())`,
      [
        isUuid(note.noteId || '') ? String(note.noteId) : uuidv4(),
        tenantId,
        customerId,
        sanitizeText(note.category) || 'general',
        note.noteText,
        actor,
        JSON.stringify(note.metadata || {})
      ]
    )
  }
}

async function syncAttachments(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  attachments: NormalizedCustomerInput['attachments'],
  actor: string
) {
  await q('DELETE FROM customer_attachments WHERE tenant_id = $1 AND customer_id = $2', [tenantId, customerId])
  for (const item of attachments) {
    if (!item.documentId) continue
    await q(
      `INSERT INTO customer_attachments (
        attachment_id, tenant_id, customer_id, document_id, file_name, file_type, created_by, metadata, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())`,
      [
        isUuid(item.attachmentId || '') ? String(item.attachmentId) : uuidv4(),
        tenantId,
        customerId,
        item.documentId,
        item.fileName || null,
        item.fileType || null,
        actor,
        JSON.stringify(item.metadata || {})
      ]
    )
  }
}

async function findExistingCustomerByExternalIdentifiers(
  q: QueryFn,
  tenantId: string,
  identifiers: NormalizedCustomerInput['externalIdentifiers']
): Promise<string | null> {
  for (const id of identifiers) {
    const source = sanitizeText(id.sourceSystem).toUpperCase()
    const external = sanitizeText(id.externalId)
    if (!source || !external) continue
    const result = await q(
      `SELECT customer_id
         FROM customer_external_identifiers
        WHERE tenant_id = $1 AND source_system = $2 AND external_id = $3
        LIMIT 1`,
      [tenantId, source, external]
    )
    if ((result.rowCount || 0) > 0) return String(result.rows[0].customer_id)
  }
  return null
}

async function mergeCustomers(
  q: QueryFn,
  tenantId: string,
  sourceCustomerId: string,
  targetCustomerId: string,
  resolution: any,
  actor: string,
  reason: string
): Promise<any> {
  const source = await loadCustomerRecordById(q, tenantId, sourceCustomerId, true)
  const target = await loadCustomerRecordById(q, tenantId, targetCustomerId, true)
  if (!source || !target) throw new Error('NOT_FOUND')
  const resolvedPayload = normalizeCustomerInput({
    ...(target || {}),
    ...(resolution || {}),
    entityType: resolution?.entityType || target.entityType || source.entityType,
    identity: {
      person: {
        ...(source.identity?.person || {}),
        ...(target.identity?.person || {}),
        ...((resolution || {}).identity?.person || {})
      },
      company: {
        ...(source.identity?.company || {}),
        ...(target.identity?.company || {}),
        ...((resolution || {}).identity?.company || {})
      }
    },
    contactPoints: uniqueByKey(
      [
        ...(target.contactPoints || []),
        ...(source.contactPoints || []),
        ...(((resolution || {}).contactPoints || []) as any[])
      ],
      (item) => `${String(item.contactType || '').toUpperCase()}::${normalizeContactIdentity(item.value)}::${String(item.subType || '').toLowerCase()}`
    ),
    addresses: uniqueByKey(
      [
        ...(target.addresses || []),
        ...(source.addresses || []),
        ...(((resolution || {}).addresses || []) as any[])
      ],
      (item) =>
        `${String(item.addressType || '').toUpperCase()}::${normalizeTextForMatch(item.line1)}::${normalizeTextForMatch(
          item.postalCode
        )}`
    ),
    relationships: uniqueByKey(
      [
        ...(target.relationships || []),
        ...(source.relationships || []),
        ...(((resolution || {}).relationships || []) as any[])
      ],
      (item) =>
        `${String(item.relatedCustomerId || '')}::${String(item.relationshipType || '').toUpperCase()}::${String(
          item.startDate || ''
        )}`
    ),
    externalIdentifiers: uniqueByKey(
      [
        ...(target.externalIdentifiers || []),
        ...(source.externalIdentifiers || []),
        ...(((resolution || {}).externalIdentifiers || []) as any[])
      ],
      (item) => `${String(item.sourceSystem || '').toUpperCase()}::${String(item.externalId || '').toUpperCase()}`
    ),
    compliance: {
      ...(source.compliance || {}),
      ...(target.compliance || {}),
      ...((resolution || {}).compliance || {})
    },
    notes: uniqueByKey(
      [
        ...(target.notes || []),
        ...(source.notes || []),
        ...(((resolution || {}).notes || []) as any[])
      ],
      (item) => `${String(item.category || '').toLowerCase()}::${String(item.noteText || '').trim()}`
    ),
    attachments: uniqueByKey(
      [
        ...(target.attachments || []),
        ...(source.attachments || []),
        ...(((resolution || {}).attachments || []) as any[])
      ],
      (item) => `${String(item.documentId || '')}`
    ),
    metadata: {
      ...(source.metadata || {}),
      ...(target.metadata || {}),
      ...((resolution || {}).metadata || {}),
      mergedFromCustomerIds: uniqueStringArray([
        ...(target.metadata?.mergedFromCustomerIds || []),
        source.customerId
      ])
    }
  })
  await q(
    `UPDATE customers
        SET status = 'MERGED',
            pending_approval = false,
            survivor_customer_id = $3,
            updated_at = now(),
            updated_by = $4,
            version = version + 1
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, sourceCustomerId, targetCustomerId, actor]
  )
  await q(
    `UPDATE customer_relationships
        SET related_customer_id = $3,
            updated_at = now(),
            updated_by = $4
      WHERE tenant_id = $1 AND related_customer_id = $2`,
    [tenantId, sourceCustomerId, targetCustomerId, actor]
  )
  await q(
    `UPDATE customer_relationships
        SET customer_id = $3,
            updated_at = now(),
            updated_by = $4
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, sourceCustomerId, targetCustomerId, actor]
  )
  await q(
    `UPDATE customer_external_identifiers
        SET customer_id = $3,
            updated_at = now()
      WHERE tenant_id = $1 AND customer_id = $2`,
    [tenantId, sourceCustomerId, targetCustomerId]
  )
  const targetExpected = Number(target.version || 1)
  return updateCustomerRecord(q, {
    tenantId,
    customerId: targetCustomerId,
    expectedVersion: targetExpected,
    payload: resolvedPayload,
    actor,
    reason,
    allowIdentityUpdate: true
  })
}

async function countActivePolicyReferences(q: QueryFn, tenantId: string, customerId: string): Promise<number> {
  const result = await q(
    `SELECT COUNT(*)::int AS count
       FROM policies
      WHERE tenant_id = $1
        AND status IN ('Draft', 'Bound', 'Issued')
        AND (
          EXISTS (
            SELECT 1
              FROM policy_customer_links pcl
             WHERE pcl.tenant_id = policies.tenant_id
               AND pcl.policy_id = policies.policy_id
               AND pcl.customer_id = $2::uuid
          )
          OR metadata ->> 'customerId' = $2
          OR risk_summary ->> 'customerId' = $2
        )`,
    [tenantId, customerId]
  )
  return Number(result.rows?.[0]?.count || 0)
}

async function listUnlinkedPolicies(
  q: QueryFn,
  tenantId: string,
  filters: {
    q?: unknown
    productCode?: unknown
    status?: unknown
    limit?: unknown
  }
) {
  const queryText = sanitizeText(filters.q)
  const productCode = sanitizeText(filters.productCode)
  const status = sanitizeText(filters.status)
  const limit = clampNumber(filters.limit, 100, 1, 500)
  const result = await q(
    `SELECT
       p.policy_id,
       p.policy_number,
       p.product_code,
       p.status,
       p.term_effective_date,
       p.term_expiration_date,
       p.created_at,
       p.updated_at,
       p.metadata ->> 'customerId' AS metadata_customer_id,
       latest.transaction_number,
       latest.processed_at,
       trim(coalesce(latest.payload #>> '{insureds,primary,firstName}', '')) AS primary_first_name,
       trim(coalesce(latest.payload #>> '{insureds,primary,lastName}', '')) AS primary_last_name,
       trim(coalesce(latest.payload #>> '{insureds,primary,displayName}', '')) AS primary_display_name,
       lower(trim(coalesce(latest.payload #>> '{insureds,primary,email}', ''))) AS primary_email
     FROM policies p
     LEFT JOIN LATERAL (
       SELECT pv.transaction_number, pv.processed_at, coalesce(pv.payload, '{}'::jsonb) AS payload
         FROM policy_versions pv
        WHERE pv.tenant_id = p.tenant_id
          AND pv.policy_id = p.policy_id
        ORDER BY pv.processed_at DESC NULLS LAST, pv.version_id DESC
        LIMIT 1
     ) latest ON true
    WHERE p.tenant_id = $1
      AND NOT EXISTS (
        SELECT 1
          FROM policy_customer_links pcl
         WHERE pcl.tenant_id = p.tenant_id
           AND pcl.policy_id = p.policy_id
      )
      AND ($2 = '' OR p.product_code = $2)
      AND ($3 = '' OR lower(p.status::text) = lower($3))
      AND (
        $4 = ''
        OR p.policy_number ILIKE '%' || $4 || '%'
        OR p.product_code ILIKE '%' || $4 || '%'
        OR coalesce(latest.payload #>> '{insureds,primary,displayName}', '') ILIKE '%' || $4 || '%'
        OR (
          coalesce(latest.payload #>> '{insureds,primary,firstName}', '') || ' ' ||
          coalesce(latest.payload #>> '{insureds,primary,lastName}', '')
        ) ILIKE '%' || $4 || '%'
        OR coalesce(latest.payload #>> '{insureds,primary,email}', '') ILIKE '%' || $4 || '%'
      )
    ORDER BY p.updated_at DESC
    LIMIT $5`,
    [tenantId, productCode, status, queryText, limit]
  )

  return (result.rows || []).map((row: any) => {
    const effectiveDate = asDateOnly(row.term_effective_date)
    const expirationDate = asDateOnly(row.term_expiration_date)
    const firstName = sanitizeText(row.primary_first_name)
    const lastName = sanitizeText(row.primary_last_name)
    const displayName = sanitizeText(row.primary_display_name) || [firstName, lastName].filter(Boolean).join(' ').trim()
    return {
      policyId: row.policy_id,
      policyNumber: row.policy_number,
      productCode: row.product_code,
      status: deriveCustomerPolicyStatus(row.status, effectiveDate, expirationDate),
      internalStatus: String(row.status || ''),
      effectiveDate,
      expirationDate,
      latestTransactionNumber: row.transaction_number || '',
      latestProcessedAt: normalizeTimestamp(row.processed_at),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      metadataCustomerId: sanitizeText(row.metadata_customer_id),
      suggestedPrimaryInsured: {
        firstName,
        lastName,
        displayName,
        email: sanitizeText(row.primary_email)
      }
    }
  })
}

async function listCustomerPolicies(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  limitRaw?: unknown
) {
  const limit = clampNumber(limitRaw, 100, 1, 500)
  const linkedResult = await q(
    `SELECT
       p.policy_id,
       p.policy_number,
       p.product_code,
       p.status,
       p.term_effective_date,
       p.term_expiration_date,
       p.lifecycle ->> 'updatedBy' AS updated_by,
       p.created_at,
       p.updated_at,
       ARRAY_REMOVE(ARRAY_AGG(DISTINCT pcl.role_code), NULL) AS relationship_types,
       latest.transaction_number,
       latest.processed_at,
       COALESCE(latest.premium_total, 0) AS premium_total
     FROM policy_customer_links pcl
     JOIN policies p
       ON p.tenant_id = pcl.tenant_id
      AND p.policy_id = pcl.policy_id
     LEFT JOIN LATERAL (
       SELECT pv.transaction_number, pv.processed_at, pv.premium_total
         FROM policy_versions pv
        WHERE pv.tenant_id = p.tenant_id
          AND pv.policy_id = p.policy_id
        ORDER BY pv.processed_at DESC NULLS LAST
        LIMIT 1
     ) latest ON true
    WHERE pcl.tenant_id = $1
      AND pcl.customer_id = $2::uuid
    GROUP BY
      p.policy_id,
      p.policy_number,
      p.product_code,
      p.status,
      p.term_effective_date,
      p.term_expiration_date,
      p.lifecycle ->> 'updatedBy',
      p.created_at,
      p.updated_at,
      latest.transaction_number,
      latest.processed_at,
      latest.premium_total
    ORDER BY p.updated_at DESC
    LIMIT $3`,
    [tenantId, customerId, limit]
  )

  let rows = linkedResult.rows || []
  if (!rows.length) {
    const fallback = await q(
      `SELECT
         p.policy_id,
         p.policy_number,
         p.product_code,
         p.status,
         p.term_effective_date,
         p.term_expiration_date,
         p.lifecycle ->> 'updatedBy' AS updated_by,
         p.created_at,
         p.updated_at,
         ARRAY[]::text[] AS relationship_types,
         latest.transaction_number,
         latest.processed_at,
         COALESCE(latest.premium_total, 0) AS premium_total
       FROM policies p
       LEFT JOIN LATERAL (
         SELECT pv.transaction_number, pv.processed_at, pv.premium_total
           FROM policy_versions pv
          WHERE pv.tenant_id = p.tenant_id
            AND pv.policy_id = p.policy_id
          ORDER BY pv.processed_at DESC NULLS LAST
          LIMIT 1
       ) latest ON true
      WHERE p.tenant_id = $1
        AND (
          p.metadata ->> 'customerId' = $2
          OR p.risk_summary ->> 'customerId' = $2
        )
      ORDER BY p.updated_at DESC
      LIMIT $3`,
      [tenantId, customerId, limit]
    )
    rows = fallback.rows || []
  }

  return rows.map((row: any) => {
    const effectiveDate = asDateOnly(row.term_effective_date)
    const expirationDate = asDateOnly(row.term_expiration_date)
    return {
      policyId: row.policy_id,
      policyNumber: row.policy_number,
      productCode: row.product_code,
      status: deriveCustomerPolicyStatus(row.status, effectiveDate, expirationDate),
      internalStatus: String(row.status || ''),
      effectiveDate,
      expirationDate,
      relationshipTypes: Array.isArray(row.relationship_types) ? row.relationship_types : [],
      roles: Array.isArray(row.relationship_types) ? row.relationship_types : [],
      latestTransactionNumber: row.transaction_number || '',
      latestProcessedAt: normalizeTimestamp(row.processed_at),
      premiumTotal: Number(row.premium_total || 0),
      createdAt: normalizeTimestamp(row.created_at),
      updatedAt: normalizeTimestamp(row.updated_at),
      updatedUser: sanitizeText(row.updated_by)
    }
  })
}

async function listCustomerOpenQuotes(
  q: QueryFn,
  tenantId: string,
  customer: {
    customerId: string
    customerKey: string
    displayName?: string
    identity?: { person?: { firstName?: string; lastName?: string } }
  },
  limitRaw?: unknown
) {
  const limit = clampNumber(limitRaw, 100, 1, 500)
  const customerId = sanitizeText(customer?.customerId)
  const customerKey = sanitizeText(customer?.customerKey)
  const firstName = sanitizeText(customer?.identity?.person?.firstName)
  const lastName = sanitizeText(customer?.identity?.person?.lastName)
  const displayName = sanitizeText(customer?.displayName)
  const result = await q(
    `SELECT
       quote_id,
       quote_number,
       product_code,
       effective_date,
       status,
       progress_step,
       created_at,
       updated_at,
       updated_by
     FROM quotes
    WHERE tenant_id = $1
      AND converted_policy_id IS NULL
      AND UPPER(COALESCE(status, 'DRAFT')) NOT IN ('CONVERTED', 'BOUND', 'ISSUED')
      AND (
        payload ->> 'customerId' = $2
        OR ($3 <> '' AND payload ->> 'customerKey' = $3)
        OR payload #>> '{insureds,primary,customerId}' = $2
        OR ($3 <> '' AND payload #>> '{insureds,primary,customerKey}' = $3)
        OR payload #>> '{insureds,secondary,customerId}' = $2
        OR ($3 <> '' AND payload #>> '{insureds,secondary,customerKey}' = $3)
        OR payload #>> '{applicant,customerId}' = $2
        OR ($3 <> '' AND payload #>> '{applicant,customerKey}' = $3)
        OR (
          $4 <> '' AND $5 <> ''
          AND LOWER(TRIM(COALESCE(payload #>> '{insureds,primary,firstName}', ''))) = LOWER($4)
          AND LOWER(TRIM(COALESCE(payload #>> '{insureds,primary,lastName}', ''))) = LOWER($5)
        )
        OR (
          $4 <> '' AND $5 <> ''
          AND LOWER(TRIM(COALESCE(payload #>> '{applicant,firstName}', ''))) = LOWER($4)
          AND LOWER(TRIM(COALESCE(payload #>> '{applicant,lastName}', ''))) = LOWER($5)
        )
        OR (
          $6 <> ''
          AND LOWER(TRIM(COALESCE(payload #>> '{insureds,primary,displayName}', ''))) = LOWER($6)
        )
        OR EXISTS (
          SELECT 1
            FROM jsonb_array_elements(
              CASE
                WHEN jsonb_typeof(payload #> '{insureds,additional}') = 'array'
                  THEN payload #> '{insureds,additional}'
                ELSE '[]'::jsonb
              END
            ) AS addl
           WHERE addl ->> 'customerId' = $2
              OR ($3 <> '' AND addl ->> 'customerKey' = $3)
        )
      )
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT $7`,
    [tenantId, customerId, customerKey || '', firstName || '', lastName || '', displayName || '', limit]
  )

  return (result.rows || []).map((row: any) => ({
    quoteId: row.quote_id,
    quoteNumber: row.quote_number,
    productCode: row.product_code,
    status: sanitizeText(row.status) || 'Draft',
    progressStep: clampNumber(row.progress_step, 1, 1, 20),
    effectiveDate: asDateOnly(row.effective_date),
    createdAt: normalizeTimestamp(row.created_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedUser: sanitizeText(row.updated_by)
  }))
}

async function countCustomerReferences(q: QueryFn, tenantId: string, customerId: string): Promise<number> {
  const [rel, ext, notes, atts, approvals, activePolicies] = await Promise.all([
    q(
      `SELECT COUNT(*)::int AS count
         FROM customer_relationships
        WHERE tenant_id = $1 AND (customer_id = $2 OR related_customer_id = $2)`,
      [tenantId, customerId]
    ),
    q(
      `SELECT COUNT(*)::int AS count
         FROM customer_external_identifiers
        WHERE tenant_id = $1 AND customer_id = $2 AND active_flag = true`,
      [tenantId, customerId]
    ),
    q(
      `SELECT COUNT(*)::int AS count
         FROM customer_notes
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId]
    ),
    q(
      `SELECT COUNT(*)::int AS count
         FROM customer_attachments
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId]
    ),
    q(
      `SELECT COUNT(*)::int AS count
         FROM customer_approvals
        WHERE tenant_id = $1 AND customer_id = $2`,
      [tenantId, customerId]
    ),
    countActivePolicyReferences(q, tenantId, customerId)
  ])
  return (
    Number(rel.rows?.[0]?.count || 0) +
    Number(ext.rows?.[0]?.count || 0) +
    Number(notes.rows?.[0]?.count || 0) +
    Number(atts.rows?.[0]?.count || 0) +
    Number(approvals.rows?.[0]?.count || 0) +
    Number(activePolicies || 0)
  )
}

async function createApprovalRequest(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  actionType: string,
  actor: string,
  reason: string,
  payload: any
) {
  await q(
    `INSERT INTO customer_approvals (
      approval_id, tenant_id, customer_id, action_type, status, requested_by, requested_at, reason, payload
    ) VALUES ($1,$2,$3,$4,'PENDING',$5,now(),$6,$7::jsonb)`,
    [uuidv4(), tenantId, customerId, actionType, actor, reason, JSON.stringify(payload || {})]
  )
}

async function addCustomerAuditEvent(
  q: QueryFn,
  input: {
    tenantId: string
    customerId: string
    eventType: string
    actor: string
    reason: string
    correlationId?: string
    beforeJson: any
    afterJson: any
    fieldDiffs: Array<{ path: string; before: any; after: any }>
  }
) {
  await q(
    `INSERT INTO customer_audit_events (
      event_id, tenant_id, customer_id, event_type, actor, reason, correlation_id, before_json, after_json, field_diffs, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,now())`,
    [
      uuidv4(),
      input.tenantId,
      input.customerId,
      input.eventType,
      input.actor || null,
      input.reason || null,
      input.correlationId || null,
      JSON.stringify(input.beforeJson),
      JSON.stringify(input.afterJson),
      JSON.stringify(input.fieldDiffs || [])
    ]
  )
}

async function searchCustomers(
  q: QueryFn,
  tenantId: string,
  filters: {
    q?: unknown
    customerKey?: unknown
    name?: unknown
    phone?: unknown
    email?: unknown
    taxId?: unknown
    externalId?: unknown
    address?: unknown
    status?: unknown
    entityType?: unknown
    limit?: unknown
  }
) {
  const qText = sanitizeText(filters.q)
  const customerKey = sanitizeText(filters.customerKey)
  const name = sanitizeText(filters.name)
  const phone = normalizePhone(filters.phone)
  const email = normalizeEmail(filters.email)
  const taxId = normalizeSensitiveValue(filters.taxId)
  const externalId = sanitizeText(filters.externalId)
  const address = sanitizeText(filters.address)
  const status = sanitizeText(filters.status).toUpperCase()
  const entityType = sanitizeText(filters.entityType).toUpperCase()
  const limit = clampNumber(filters.limit, 50, 1, 200)

  const sql = `
    SELECT
      c.customer_id,
      c.customer_key,
      c.entity_type,
      c.status,
      c.display_name,
      c.pending_approval,
      c.created_at,
      c.updated_at,
      p.first_name,
      p.last_name,
      p.ssn_last4,
      co.legal_name,
      co.fein_last4,
      cmp.kyc_status,
      cmp.sanctions_status,
      (
        SELECT COUNT(DISTINCT p2.policy_id)::int
        FROM policies p2
        LEFT JOIN policy_customer_links pcl2
          ON pcl2.tenant_id = p2.tenant_id
         AND pcl2.policy_id = p2.policy_id
        WHERE p2.tenant_id = c.tenant_id
          AND (
            pcl2.customer_id = c.customer_id
            OR p2.metadata ->> 'customerId' = c.customer_id::text
            OR p2.risk_summary ->> 'customerId' = c.customer_id::text
          )
      ) AS policy_count
    FROM customers c
    LEFT JOIN customer_person_details p
      ON p.tenant_id = c.tenant_id AND p.customer_id = c.customer_id
    LEFT JOIN customer_company_details co
      ON co.tenant_id = c.tenant_id AND co.customer_id = c.customer_id
    LEFT JOIN customer_compliance cmp
      ON cmp.tenant_id = c.tenant_id AND cmp.customer_id = c.customer_id
    WHERE c.tenant_id = $1
      AND ($2 = '' OR c.status = $2)
      AND ($3 = '' OR c.entity_type = $3)
      AND (
        $4 = ''
        OR c.customer_key ILIKE '%' || $4 || '%'
        OR c.display_name ILIKE '%' || $4 || '%'
        OR co.legal_name ILIKE '%' || $4 || '%'
        OR (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) ILIKE '%' || $4 || '%'
      )
      AND ($5 = '' OR c.customer_key ILIKE '%' || $5 || '%')
      AND (
        $6 = ''
        OR c.display_name ILIKE '%' || $6 || '%'
        OR co.legal_name ILIKE '%' || $6 || '%'
        OR (coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) ILIKE '%' || $6 || '%'
      )
      AND (
        $7 = ''
        OR EXISTS (
          SELECT 1
          FROM customer_contact_points cp
          WHERE cp.tenant_id = c.tenant_id
            AND cp.customer_id = c.customer_id
            AND cp.contact_type = 'PHONE'
            AND cp.normalized_value = $7
        )
      )
      AND (
        $8 = ''
        OR EXISTS (
          SELECT 1
          FROM customer_contact_points cp
          WHERE cp.tenant_id = c.tenant_id
            AND cp.customer_id = c.customer_id
            AND cp.contact_type = 'EMAIL'
            AND cp.normalized_value = $8
        )
      )
      AND (
        $9 = ''
        OR p.ssn_last4 = right($9, 4)
        OR co.fein_last4 = right($9, 4)
      )
      AND (
        $10 = ''
        OR EXISTS (
          SELECT 1
          FROM customer_external_identifiers ei
          WHERE ei.tenant_id = c.tenant_id
            AND ei.customer_id = c.customer_id
            AND ei.external_id ILIKE '%' || $10 || '%'
        )
      )
      AND (
        $11 = ''
        OR EXISTS (
          SELECT 1
          FROM customer_addresses a
          WHERE a.tenant_id = c.tenant_id
            AND a.customer_id = c.customer_id
            AND (
              a.line1 ILIKE '%' || $11 || '%'
              OR a.city ILIKE '%' || $11 || '%'
              OR a.state ILIKE '%' || $11 || '%'
              OR a.postal_code ILIKE '%' || $11 || '%'
            )
        )
      )
    ORDER BY c.updated_at DESC
    LIMIT $12
  `
  const result = await q(sql, [
    tenantId,
    status,
    entityType,
    qText,
    customerKey,
    name,
    phone,
    email,
    taxId,
    externalId,
    address,
    limit
  ])
  const rows = result.rows || []
  return rows.map((row: any) => {
    const displayName = String(
      row.display_name ||
        row.legal_name ||
        [row.first_name, row.last_name].filter(Boolean).join(' ') ||
        row.customer_key
    )
    const score = computeSearchMatchScore(row, {
      qText,
      customerKey,
      name,
      phone,
      email,
      taxId,
      externalId,
      address
    })
    const flags: string[] = []
    if (row.pending_approval) flags.push('PENDING_APPROVAL')
    if (String(row.kyc_status || '').toUpperCase() === 'FAILED') flags.push('KYC')
    if (String(row.sanctions_status || '').toUpperCase() === 'MATCH') flags.push('SANCTIONS')
    return {
      customerId: row.customer_id,
      customerKey: row.customer_key,
      entityType: normalizeEntityType(row.entity_type),
      name: displayName,
      status: normalizeCustomerStatus(row.status, 'DRAFT'),
      lastUpdated: row.updated_at,
      createdAt: row.created_at,
      policyCount: Number(row.policy_count || 0),
      matchScore: score,
      flags
    }
  })
}

async function findPotentialMatches(
  q: QueryFn,
  tenantId: string,
  payload: NormalizedCustomerInput,
  excludeCustomerId: string | null
): Promise<PotentialMatch[]> {
  const candidatesRes = await q(
    `SELECT
       c.customer_id,
       c.customer_key,
       c.entity_type,
       c.status,
       c.display_name,
       p.first_name,
       p.last_name,
       p.dob_hash,
       p.ssn_last4,
       co.legal_name,
       co.fein_last4
     FROM customers c
     LEFT JOIN customer_person_details p
       ON p.tenant_id = c.tenant_id AND p.customer_id = c.customer_id
     LEFT JOIN customer_company_details co
       ON co.tenant_id = c.tenant_id AND co.customer_id = c.customer_id
     WHERE c.tenant_id = $1
       AND c.status <> 'MERGED'
       AND ($2::uuid IS NULL OR c.customer_id <> $2::uuid)
     ORDER BY c.updated_at DESC
     LIMIT 400`,
    [tenantId, isUuid(excludeCustomerId || '') ? excludeCustomerId : null]
  )
  const candidates = candidatesRes.rows || []
  if (!candidates.length) return []

  const candidateIds = candidates.map((row: any) => String(row.customer_id))
  const contactsRes = await q(
    `SELECT customer_id, contact_type, normalized_value
       FROM customer_contact_points
      WHERE tenant_id = $1
        AND customer_id = ANY($2::uuid[])
        AND effective_to IS NULL`,
    [tenantId, candidateIds]
  )
  const addressesRes = await q(
    `SELECT customer_id, line1, city, state, postal_code
       FROM customer_addresses
      WHERE tenant_id = $1
        AND customer_id = ANY($2::uuid[])
        AND effective_to IS NULL`,
    [tenantId, candidateIds]
  )

  const contactsByCustomer = new Map<string, Array<{ type: string; value: string }>>()
  for (const row of contactsRes.rows || []) {
    const customerId = String(row.customer_id)
    const list = contactsByCustomer.get(customerId) || []
    list.push({ type: String(row.contact_type || ''), value: String(row.normalized_value || '') })
    contactsByCustomer.set(customerId, list)
  }
  const addressesByCustomer = new Map<string, Array<{ text: string }>>()
  for (const row of addressesRes.rows || []) {
    const customerId = String(row.customer_id)
    const text = `${row.line1 || ''} ${row.city || ''} ${row.state || ''} ${row.postal_code || ''}`.trim()
    const list = addressesByCustomer.get(customerId) || []
    list.push({ text })
    addressesByCustomer.set(customerId, list)
  }

  const incomingEmailSet = new Set(
    (payload.contactPoints || [])
      .filter((item) => item.contactType === 'EMAIL')
      .map((item) => normalizeEmail(item.value))
      .filter(Boolean)
  )
  const incomingPhoneSet = new Set(
    (payload.contactPoints || [])
      .filter((item) => item.contactType === 'PHONE')
      .map((item) => normalizePhone(item.value))
      .filter(Boolean)
  )
  const incomingPostalSet = new Set(
    (payload.addresses || []).map((item) => normalizeTextForMatch(item.postalCode)).filter(Boolean)
  )
  const incomingAddressText = (payload.addresses || [])
    .map((item) => `${item.line1 || ''} ${item.city || ''} ${item.state || ''} ${item.postalCode || ''}`.trim())
    .filter(Boolean)

  const incomingFirstName = normalizeTextForMatch(payload.identity.person.firstName)
  const incomingLastName = normalizeTextForMatch(payload.identity.person.lastName)
  const incomingDobHash = hashSensitiveValue(payload.identity.person.dob)
  const incomingSsnLast4 = normalizeLast4(payload.identity.person.ssn || payload.identity.person.ssnLast4)
  const incomingLegalName = normalizeTextForMatch(payload.identity.company.legalName)
  const incomingFeinLast4 = normalizeLast4(payload.identity.company.fein || payload.identity.company.feinLast4)

  const matches: PotentialMatch[] = []
  for (const row of candidates) {
    let score = 0
    const reasons: string[] = []
    const candidateId = String(row.customer_id)
    const contactList = contactsByCustomer.get(candidateId) || []
    const addressList = addressesByCustomer.get(candidateId) || []

    const candidateFirst = normalizeTextForMatch(row.first_name)
    const candidateLast = normalizeTextForMatch(row.last_name)
    const candidateDobHash = sanitizeText(row.dob_hash)
    const candidateSsnLast4 = sanitizeText(row.ssn_last4)
    const candidateLegalName = normalizeTextForMatch(row.legal_name)
    const candidateFeinLast4 = sanitizeText(row.fein_last4)

    if (incomingFirstName && incomingLastName && incomingDobHash && incomingDobHash === candidateDobHash &&
      incomingFirstName === candidateFirst && incomingLastName === candidateLast) {
      score += 75
      reasons.push('Individual name and DOB match')
    }
    if (incomingSsnLast4 && candidateSsnLast4 && incomingSsnLast4 === candidateSsnLast4) {
      const hasPostalOverlap = incomingPostalSet.size
        ? addressList.some((addr) => {
            const postal = normalizeTextForMatch(addr.text.split(' ').pop() || '')
            return incomingPostalSet.has(postal)
          })
        : true
      if (hasPostalOverlap) {
        score += 68
        reasons.push('SSN last4 and postal match')
      }
    }
    for (const contact of contactList) {
      if (contact.type === 'EMAIL' && incomingEmailSet.has(contact.value)) {
        score += 60
        reasons.push('Email match')
        break
      }
    }
    for (const contact of contactList) {
      if (contact.type === 'PHONE' && incomingPhoneSet.has(contact.value)) {
        score += 55
        reasons.push('Phone match')
        break
      }
    }
    if (incomingLegalName && candidateLegalName) {
      const similarity = textSimilarity(incomingLegalName, candidateLegalName)
      if (similarity >= 0.95) {
        score += 70
        reasons.push('Legal name exact/near exact match')
      } else if (similarity >= 0.85) {
        score += 40
        reasons.push('Legal name fuzzy match')
      }
    }
    if (incomingFeinLast4 && candidateFeinLast4 && incomingFeinLast4 === candidateFeinLast4) {
      score += 65
      reasons.push('FEIN last4 match')
    }
    if (incomingAddressText.length > 0 && addressList.length > 0 && incomingLegalName) {
      const hasAddressNameCombo = addressList.some((candidateAddress) =>
        incomingAddressText.some((incomingAddress) => textSimilarity(normalizeTextForMatch(incomingAddress), normalizeTextForMatch(candidateAddress.text)) >= 0.88)
      )
      if (hasAddressNameCombo) {
        score += 35
        reasons.push('Address similarity match')
      }
    }
    if (score < 40) continue
    matches.push({
      customerId: candidateId,
      customerKey: String(row.customer_key || ''),
      entityType: normalizeEntityType(row.entity_type),
      status: normalizeCustomerStatus(row.status, 'DRAFT'),
      displayName: String(row.display_name || row.legal_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || row.customer_key),
      matchScore: score,
      reasons: uniqueStringArray(reasons)
    })
  }
  matches.sort((a, b) => b.matchScore - a.matchScore || a.customerKey.localeCompare(b.customerKey))
  return matches.slice(0, 20)
}

async function loadCustomerRecordByIdOrKey(
  q: QueryFn,
  tenantId: string,
  idOrKey: string,
  includeCollections: boolean
) {
  const trimmed = sanitizeText(idOrKey)
  if (!trimmed) return null
  if (isUuid(trimmed)) return loadCustomerRecordById(q, tenantId, trimmed, includeCollections)
  const row = await q(
    `SELECT customer_id
       FROM customers
      WHERE tenant_id = $1 AND customer_key = $2
      LIMIT 1`,
    [tenantId, trimmed]
  )
  if (!((row.rowCount || 0) > 0)) return null
  return loadCustomerRecordById(q, tenantId, String(row.rows[0].customer_id), includeCollections)
}

async function loadCustomerRecordById(
  q: QueryFn,
  tenantId: string,
  customerId: string,
  includeCollections: boolean
) {
  const base = await q(
    `SELECT customer_id, customer_key, entity_type, status, version, survivor_customer_id,
            display_name, pending_approval, deactivation_reason, deactivation_effective_date, deactivated_at,
            created_at, created_by, updated_at, updated_by, metadata
       FROM customers
      WHERE tenant_id = $1 AND customer_id = $2
      LIMIT 1`,
    [tenantId, customerId]
  )
  if (!((base.rowCount || 0) > 0)) return null
  const baseRow = base.rows[0]

  const [personRes, companyRes, complianceRes] = await Promise.all([
    q(
      `SELECT first_name, middle_name, last_name, suffix, preferred_name, dob_encrypted, dob_hash, gender, marital_status,
              ssn_encrypted, ssn_last4, ssn_hash, driver_license_no, driver_license_state, driver_license_expiry,
              nationality, residency, updated_at
         FROM customer_person_details
        WHERE tenant_id = $1 AND customer_id = $2
        LIMIT 1`,
      [tenantId, customerId]
    ),
    q(
      `SELECT legal_name, dba_name, fein_encrypted, fein_last4, fein_hash, entity_legal_type, incorporation_state,
              incorporation_country, incorporation_date, naics, sic, website, updated_at
         FROM customer_company_details
        WHERE tenant_id = $1 AND customer_id = $2
        LIMIT 1`,
      [tenantId, customerId]
    ),
    q(
      `SELECT kyc_status, kyc_verification_date, kyc_method, sanctions_status, sanctions_last_checked_at,
              do_not_contact, data_retention_hold, right_to_be_forgotten_requested, privacy_region, metadata
         FROM customer_compliance
        WHERE tenant_id = $1 AND customer_id = $2
        LIMIT 1`,
      [tenantId, customerId]
    )
  ])

  const person = (personRes.rows || [])[0] || null
  const company = (companyRes.rows || [])[0] || null
  const compliance = (complianceRes.rows || [])[0] || null
  const result: any = {
    customerId: baseRow.customer_id,
    customerKey: baseRow.customer_key,
    entityType: normalizeEntityType(baseRow.entity_type),
    status: normalizeCustomerStatus(baseRow.status, 'DRAFT'),
    version: Number(baseRow.version || 1),
    survivorCustomerId: baseRow.survivor_customer_id || null,
    displayName: baseRow.display_name || null,
    pendingApproval: baseRow.pending_approval === true,
    deactivationReason: baseRow.deactivation_reason || null,
    deactivationEffectiveDate: asDateOnly(baseRow.deactivation_effective_date),
    deactivatedAt: normalizeTimestamp(baseRow.deactivated_at),
    createdAt: normalizeTimestamp(baseRow.created_at),
    createdBy: baseRow.created_by || null,
    updatedAt: normalizeTimestamp(baseRow.updated_at),
    updatedBy: baseRow.updated_by || null,
    metadata: baseRow.metadata || {},
    identity: {
      person: {
        firstName: person?.first_name || '',
        middleName: person?.middle_name || '',
        lastName: person?.last_name || '',
        suffix: person?.suffix || '',
        preferredName: person?.preferred_name || '',
        dobEncrypted: person?.dob_encrypted || null,
        dobMasked: person?.dob_encrypted ? '***-**-****' : null,
        gender: person?.gender || '',
        maritalStatus: person?.marital_status || '',
        ssnEncrypted: person?.ssn_encrypted || null,
        ssnLast4: person?.ssn_last4 || '',
        ssnMasked: person?.ssn_last4 ? `***-**-${person.ssn_last4}` : null,
        driverLicenseNo: person?.driver_license_no || '',
        driverLicenseState: person?.driver_license_state || '',
        driverLicenseExpiry: asDateOnly(person?.driver_license_expiry),
        nationality: person?.nationality || '',
        residency: person?.residency || ''
      },
      company: {
        legalName: company?.legal_name || '',
        dbaName: company?.dba_name || '',
        feinEncrypted: company?.fein_encrypted || null,
        feinLast4: company?.fein_last4 || '',
        feinMasked: company?.fein_last4 ? `**-***${company.fein_last4}` : null,
        entityLegalType: company?.entity_legal_type || '',
        incorporationState: company?.incorporation_state || '',
        incorporationCountry: company?.incorporation_country || '',
        incorporationDate: asDateOnly(company?.incorporation_date),
        naics: company?.naics || '',
        sic: company?.sic || '',
        website: company?.website || ''
      }
    },
    compliance: {
      kycStatus: compliance?.kyc_status || '',
      kycVerificationDate: asDateOnly(compliance?.kyc_verification_date),
      kycMethod: compliance?.kyc_method || '',
      sanctionsStatus: compliance?.sanctions_status || '',
      sanctionsLastCheckedAt: normalizeTimestamp(compliance?.sanctions_last_checked_at),
      doNotContact: compliance?.do_not_contact === true,
      dataRetentionHold: compliance?.data_retention_hold === true,
      rightToBeForgottenRequested: compliance?.right_to_be_forgotten_requested === true,
      privacyRegion: compliance?.privacy_region || '',
      metadata: compliance?.metadata || {}
    }
  }
  if (!includeCollections) {
    result.contactPoints = []
    result.addresses = []
    result.relationships = []
    result.externalIdentifiers = []
    result.notes = []
    result.attachments = []
    return result
  }
  const [contacts, addresses, relationships, externalIds, notes, attachments] = await Promise.all([
    q(
      `SELECT contact_point_id, contact_type, sub_type, value, normalized_value, preferred_flag, verified_flag, bounce_flag,
              sms_consent, email_consent, call_consent, contact_window, language_preference, effective_from, effective_to, metadata
         FROM customer_contact_points
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY preferred_flag DESC, updated_at DESC`,
      [tenantId, customerId]
    ),
    q(
      `SELECT address_id, address_type, line1, line2, line3, city, state, postal_code, country, county, primary_flag,
              validation_status, geocode_lat, geocode_lng, effective_from, effective_to, metadata
         FROM customer_addresses
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY primary_flag DESC, updated_at DESC`,
      [tenantId, customerId]
    ),
    q(
      `SELECT relationship_id, related_customer_id, relationship_type, start_date, end_date, percent_ownership, notes, metadata
         FROM customer_relationships
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY updated_at DESC`,
      [tenantId, customerId]
    ),
    q(
      `SELECT external_identifier_id, source_system, external_id, id_type, active_flag, last_sync_at, metadata
         FROM customer_external_identifiers
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY updated_at DESC`,
      [tenantId, customerId]
    ),
    q(
      `SELECT note_id, category, note_text, created_by, created_at, metadata
         FROM customer_notes
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY created_at DESC`,
      [tenantId, customerId]
    ),
    q(
      `SELECT attachment_id, document_id, file_name, file_type, created_by, created_at, metadata
         FROM customer_attachments
        WHERE tenant_id = $1 AND customer_id = $2
        ORDER BY created_at DESC`,
      [tenantId, customerId]
    )
  ])
  result.contactPoints = (contacts.rows || []).map((row: any) => ({
    contactPointId: row.contact_point_id,
    contactType: normalizeContactType(row.contact_type),
    subType: row.sub_type || '',
    value: row.value || '',
    preferred: row.preferred_flag === true,
    verified: row.verified_flag === true,
    bounce: row.bounce_flag === true,
    smsConsent: row.sms_consent === true,
    emailConsent: row.email_consent === true,
    callConsent: row.call_consent === true,
    contactWindow: row.contact_window || '',
    languagePreference: row.language_preference || '',
    effectiveFrom: asDateOnly(row.effective_from),
    effectiveTo: asDateOnly(row.effective_to),
    metadata: row.metadata || {}
  }))
  result.addresses = (addresses.rows || []).map((row: any) => ({
    addressId: row.address_id,
    addressType: row.address_type || '',
    line1: row.line1 || '',
    line2: row.line2 || '',
    line3: row.line3 || '',
    city: row.city || '',
    state: row.state || '',
    postalCode: row.postal_code || '',
    country: row.country || '',
    county: row.county || '',
    primary: row.primary_flag === true,
    validationStatus: row.validation_status || 'unvalidated',
    geocodeLat: row.geocode_lat == null ? null : Number(row.geocode_lat),
    geocodeLng: row.geocode_lng == null ? null : Number(row.geocode_lng),
    effectiveFrom: asDateOnly(row.effective_from),
    effectiveTo: asDateOnly(row.effective_to),
    metadata: row.metadata || {}
  }))
  result.relationships = (relationships.rows || []).map((row: any) => ({
    relationshipId: row.relationship_id,
    relatedCustomerId: row.related_customer_id,
    relationshipType: row.relationship_type || '',
    startDate: asDateOnly(row.start_date),
    endDate: asDateOnly(row.end_date),
    percentOwnership: row.percent_ownership == null ? null : Number(row.percent_ownership),
    notes: row.notes || '',
    metadata: row.metadata || {}
  }))
  result.externalIdentifiers = (externalIds.rows || []).map((row: any) => ({
    externalIdentifierId: row.external_identifier_id,
    sourceSystem: row.source_system || '',
    externalId: row.external_id || '',
    idType: row.id_type || '',
    active: row.active_flag !== false,
    lastSyncAt: normalizeTimestamp(row.last_sync_at),
    metadata: row.metadata || {}
  }))
  result.notes = (notes.rows || []).map((row: any) => ({
    noteId: row.note_id,
    category: row.category || '',
    noteText: row.note_text || '',
    createdBy: row.created_by || null,
    createdAt: normalizeTimestamp(row.created_at),
    metadata: row.metadata || {}
  }))
  result.attachments = (attachments.rows || []).map((row: any) => ({
    attachmentId: row.attachment_id,
    documentId: row.document_id || '',
    fileName: row.file_name || '',
    fileType: row.file_type || '',
    createdBy: row.created_by || null,
    createdAt: normalizeTimestamp(row.created_at),
    metadata: row.metadata || {}
  }))
  return result
}

async function allocateCustomerKey(q: QueryFn, tenantId: string, pattern: string): Promise<string> {
  const normalizedPattern = normalizeCustomerKeyPattern(pattern)
  const year = new Date().getUTCFullYear()
  const seqRes = await q(
    `INSERT INTO customer_key_sequences (tenant_id, sequence_year, last_value, updated_at)
     VALUES ($1, $2, 1, now())
     ON CONFLICT (tenant_id, sequence_year)
     DO UPDATE SET last_value = customer_key_sequences.last_value + 1, updated_at = now()
     RETURNING last_value`,
    [tenantId, year]
  )
  const sequence = Number(seqRes.rows?.[0]?.last_value || 1)
  const yy = String(year).slice(-2)
  const seqStr = String(sequence)
  return String(normalizedPattern || DEFAULT_CUSTOMER_KEY_PATTERN)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, yy)
    .replace(/\{SEQ\}/g, seqStr)
    .replace(/\{SEQ4\}/g, seqStr.padStart(4, '0'))
    .replace(/\{SEQ6\}/g, seqStr.padStart(6, '0'))
    .replace(/\{SEQ8\}/g, seqStr.padStart(8, '0'))
}

async function loadCustomerSettings(q: QueryFn, tenantId: string): Promise<CustomerSettings> {
  const result = await q(
    `SELECT customer_key_pattern, customer_validation_config, customer_workflow_config
       FROM tenants
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId]
  )
  if (!((result.rowCount || 0) > 0)) {
    return {
      keyPattern: DEFAULT_CUSTOMER_KEY_PATTERN,
      validation: DEFAULT_VALIDATION_CONFIG,
      workflow: DEFAULT_WORKFLOW_CONFIG
    }
  }
  const row = result.rows[0]
  return {
    keyPattern: normalizeCustomerKeyPattern(row.customer_key_pattern, DEFAULT_CUSTOMER_KEY_PATTERN),
    validation: normalizeValidationConfig(row.customer_validation_config, DEFAULT_VALIDATION_CONFIG),
    workflow: normalizeWorkflowConfig(row.customer_workflow_config, DEFAULT_WORKFLOW_CONFIG)
  }
}

function validateCustomerPayload(payload: NormalizedCustomerInput, config: CustomerValidationConfig): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const hasContacts = (payload.contactPoints || []).some((item) => Boolean(item.value))
  const hasAddresses = (payload.addresses || []).some((item) => Boolean(item.line1 || item.city || item.postalCode))
  if (config.requireContactOrAddress && !hasContacts && !hasAddresses) {
    errors.push('At least one contact method or address is required')
  }
  if (payload.entityType === 'INDIVIDUAL' || payload.entityType === 'BOTH') {
    const firstName = sanitizeText(payload.identity.person.firstName)
    const lastName = sanitizeText(payload.identity.person.lastName)
    const dob = sanitizeText(payload.identity.person.dob)
    const ssnLast4 = normalizeLast4(payload.identity.person.ssn || payload.identity.person.ssnLast4)
    if (config.individual.requireFirstAndLast && (!firstName || !lastName)) {
      errors.push('Individual requires first name and last name')
    }
    if (config.individual.requireDobOrSsnLast4 && !dob && !ssnLast4) {
      errors.push('Individual requires DOB or SSN last4')
    }
  }
  if (payload.entityType === 'COMPANY' || payload.entityType === 'BOTH') {
    const legalName = sanitizeText(payload.identity.company.legalName)
    const feinLast4 = normalizeLast4(payload.identity.company.fein || payload.identity.company.feinLast4)
    const incState = sanitizeText(payload.identity.company.incorporationState)
    if (config.company.requireLegalName && !legalName) {
      errors.push('Company requires legal name')
    }
    if (config.company.requireFeinLast4OrIncorporationState && !feinLast4 && !incState) {
      errors.push('Company requires FEIN last4 or incorporation state')
    }
  }
  const preferredEmailCount = (payload.contactPoints || []).filter((item) => item.contactType === 'EMAIL' && item.preferred).length
  if (preferredEmailCount > 1) errors.push('Only one preferred email is allowed')
  const preferredPhoneCount = (payload.contactPoints || []).filter((item) => item.contactType === 'PHONE' && item.preferred).length
  if (preferredPhoneCount > 1) errors.push('Only one preferred phone is allowed')
  const primaryAddressKeys = new Set<string>()
  for (const address of payload.addresses || []) {
    if (!address.primary) continue
    const key = sanitizeText(address.addressType).toUpperCase()
    if (!key) continue
    if (primaryAddressKeys.has(key)) errors.push(`Only one primary address is allowed for type ${key}`)
    primaryAddressKeys.add(key)
  }
  for (const contact of payload.contactPoints || []) {
    if (contact.contactType === 'EMAIL' && contact.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.value)) {
      errors.push(`Invalid email format: ${contact.value}`)
    }
    if (contact.contactType === 'PHONE' && contact.value) {
      const normalizedPhone = normalizePhone(contact.value)
      if (!normalizedPhone || normalizedPhone.length < 7) errors.push(`Invalid phone format: ${contact.value}`)
    }
  }
  for (const address of payload.addresses || []) {
    const from = normalizeDate(address.effectiveFrom)
    const to = normalizeDate(address.effectiveTo)
    if (from && to && from > to) errors.push(`Address date range is invalid for ${address.addressType || 'address'}`)
  }
  if (errors.length === 0 && !hasContacts) warnings.push('No contact points captured')
  return { valid: errors.length === 0, errors, warnings }
}

function normalizeCustomerInput(input: any): NormalizedCustomerInput {
  const entityType = normalizeEntityType(input.entityType)
  const status = normalizeCustomerStatus(input.status, 'DRAFT')
  const identityInput = input.identity || {}
  const personInput = identityInput.person || {}
  const companyInput = identityInput.company || {}
  return {
    entityType,
    status,
    identity: {
      person: {
        firstName: sanitizeText(personInput.firstName),
        middleName: sanitizeText(personInput.middleName),
        lastName: sanitizeText(personInput.lastName),
        suffix: sanitizeText(personInput.suffix),
        preferredName: sanitizeText(personInput.preferredName),
        dob: normalizeDate(personInput.dob) || '',
        gender: sanitizeText(personInput.gender),
        maritalStatus: sanitizeText(personInput.maritalStatus),
        ssn: sanitizeSensitive(personInput.ssn),
        ssnLast4: normalizeLast4(personInput.ssnLast4),
        driverLicenseNo: sanitizeText(personInput.driverLicenseNo),
        driverLicenseState: sanitizeText(personInput.driverLicenseState).toUpperCase(),
        driverLicenseExpiry: normalizeDate(personInput.driverLicenseExpiry) || '',
        nationality: sanitizeText(personInput.nationality),
        residency: sanitizeText(personInput.residency)
      },
      company: {
        legalName: sanitizeText(companyInput.legalName),
        dbaName: sanitizeText(companyInput.dbaName),
        fein: sanitizeSensitive(companyInput.fein),
        feinLast4: normalizeLast4(companyInput.feinLast4),
        entityLegalType: sanitizeText(companyInput.entityLegalType),
        incorporationState: sanitizeText(companyInput.incorporationState).toUpperCase(),
        incorporationCountry: sanitizeText(companyInput.incorporationCountry).toUpperCase(),
        incorporationDate: normalizeDate(companyInput.incorporationDate) || '',
        naics: sanitizeText(companyInput.naics),
        sic: sanitizeText(companyInput.sic),
        website: sanitizeText(companyInput.website)
      }
    },
    contactPoints: toArray(input.contactPoints).map((raw) => ({
      contactPointId: isUuid(raw?.contactPointId || '') ? String(raw.contactPointId) : undefined,
      contactType: normalizeContactType(raw?.contactType) || 'EMAIL',
      subType: sanitizeText(raw?.subType),
      value: sanitizeText(raw?.value),
      preferred: raw?.preferred === true,
      verified: raw?.verified === true,
      bounce: raw?.bounce === true,
      smsConsent: raw?.smsConsent === true,
      emailConsent: raw?.emailConsent === true,
      callConsent: raw?.callConsent === true,
      contactWindow: sanitizeText(raw?.contactWindow),
      languagePreference: sanitizeText(raw?.languagePreference),
      effectiveFrom: normalizeDate(raw?.effectiveFrom) || '',
      effectiveTo: normalizeDate(raw?.effectiveTo) || '',
      metadata: normalizeObject(raw?.metadata)
    })),
    addresses: toArray(input.addresses).map((raw) => ({
      addressId: isUuid(raw?.addressId || '') ? String(raw.addressId) : undefined,
      addressType: sanitizeText(raw?.addressType),
      line1: sanitizeText(raw?.line1),
      line2: sanitizeText(raw?.line2),
      line3: sanitizeText(raw?.line3),
      city: sanitizeText(raw?.city),
      state: sanitizeText(raw?.state).toUpperCase(),
      postalCode: sanitizeText(raw?.postalCode),
      country: sanitizeText(raw?.country).toUpperCase(),
      county: sanitizeText(raw?.county),
      primary: raw?.primary === true,
      validationStatus: sanitizeText(raw?.validationStatus) || 'unvalidated',
      geocodeLat: toNullableNumber(raw?.geocodeLat),
      geocodeLng: toNullableNumber(raw?.geocodeLng),
      effectiveFrom: normalizeDate(raw?.effectiveFrom) || '',
      effectiveTo: normalizeDate(raw?.effectiveTo) || '',
      metadata: normalizeObject(raw?.metadata)
    })),
    relationships: toArray(input.relationships).map((raw) => ({
      relationshipId: isUuid(raw?.relationshipId || '') ? String(raw.relationshipId) : undefined,
      relatedCustomerId: isUuid(raw?.relatedCustomerId || '') ? String(raw.relatedCustomerId) : '',
      relationshipType: sanitizeText(raw?.relationshipType),
      startDate: normalizeDate(raw?.startDate) || '',
      endDate: normalizeDate(raw?.endDate) || '',
      percentOwnership: toNullableNumber(raw?.percentOwnership),
      notes: sanitizeText(raw?.notes),
      metadata: normalizeObject(raw?.metadata)
    })),
    externalIdentifiers: toArray(input.externalIdentifiers).map((raw) => ({
      externalIdentifierId: isUuid(raw?.externalIdentifierId || '') ? String(raw.externalIdentifierId) : undefined,
      sourceSystem: sanitizeText(raw?.sourceSystem),
      externalId: sanitizeText(raw?.externalId),
      idType: sanitizeText(raw?.idType),
      active: raw?.active !== false,
      lastSyncAt: normalizeTimestamp(raw?.lastSyncAt),
      metadata: normalizeObject(raw?.metadata)
    })),
    compliance: {
      kycStatus: sanitizeText(input.compliance?.kycStatus),
      kycVerificationDate: normalizeDate(input.compliance?.kycVerificationDate) || '',
      kycMethod: sanitizeText(input.compliance?.kycMethod),
      sanctionsStatus: sanitizeText(input.compliance?.sanctionsStatus),
      sanctionsLastCheckedAt: normalizeTimestamp(input.compliance?.sanctionsLastCheckedAt),
      doNotContact: input.compliance?.doNotContact === true,
      dataRetentionHold: input.compliance?.dataRetentionHold === true,
      rightToBeForgottenRequested: input.compliance?.rightToBeForgottenRequested === true,
      privacyRegion: sanitizeText(input.compliance?.privacyRegion),
      metadata: normalizeObject(input.compliance?.metadata)
    },
    notes: toArray(input.notes).map((raw) => ({
      noteId: isUuid(raw?.noteId || '') ? String(raw.noteId) : undefined,
      category: sanitizeText(raw?.category),
      noteText: sanitizeText(raw?.noteText),
      metadata: normalizeObject(raw?.metadata)
    })),
    attachments: toArray(input.attachments).map((raw) => ({
      attachmentId: isUuid(raw?.attachmentId || '') ? String(raw.attachmentId) : undefined,
      documentId: sanitizeText(raw?.documentId),
      fileName: sanitizeText(raw?.fileName),
      fileType: sanitizeText(raw?.fileType),
      metadata: normalizeObject(raw?.metadata)
    })),
    metadata: normalizeObject(input.metadata)
  }
}

function normalizeValidationConfig(input: any, fallback: CustomerValidationConfig): CustomerValidationConfig {
  const source = input && typeof input === 'object' ? input : {}
  return {
    individual: {
      requireFirstAndLast: source?.individual?.requireFirstAndLast ?? fallback.individual.requireFirstAndLast,
      requireDobOrSsnLast4: source?.individual?.requireDobOrSsnLast4 ?? fallback.individual.requireDobOrSsnLast4
    },
    company: {
      requireLegalName: source?.company?.requireLegalName ?? fallback.company.requireLegalName,
      requireFeinLast4OrIncorporationState:
        source?.company?.requireFeinLast4OrIncorporationState ?? fallback.company.requireFeinLast4OrIncorporationState
    },
    requireContactOrAddress: source?.requireContactOrAddress ?? fallback.requireContactOrAddress,
    updateExistingOnExternalId: source?.updateExistingOnExternalId ?? fallback.updateExistingOnExternalId
  }
}

function normalizeWorkflowConfig(input: any, fallback: CustomerWorkflowConfig): CustomerWorkflowConfig {
  const source = input && typeof input === 'object' ? input : {}
  return {
    requireApprovalOnSensitiveChange:
      source?.requireApprovalOnSensitiveChange ?? fallback.requireApprovalOnSensitiveChange,
    requireApprovalOnMerge: source?.requireApprovalOnMerge ?? fallback.requireApprovalOnMerge,
    requireApprovalOnDeactivateWithActivePolicies:
      source?.requireApprovalOnDeactivateWithActivePolicies ?? fallback.requireApprovalOnDeactivateWithActivePolicies
  }
}

function normalizeEntityType(value: any): CustomerEntityType {
  const raw = sanitizeText(value).toUpperCase()
  if (CUSTOMER_ENTITY_TYPES.includes(raw as CustomerEntityType)) return raw as CustomerEntityType
  return 'INDIVIDUAL'
}

function normalizeCustomerStatus(value: any, fallback: CustomerStatus): CustomerStatus {
  const raw = sanitizeText(value).toUpperCase()
  if (CUSTOMER_STATUSES.includes(raw as CustomerStatus)) return raw as CustomerStatus
  return fallback
}

function normalizeContactType(value: any): CustomerContactType | null {
  const raw = sanitizeText(value).toUpperCase()
  if (CONTACT_TYPES.includes(raw as CustomerContactType)) return raw as CustomerContactType
  return null
}



function normalizeCustomerKeyPattern(value: any, fallback = DEFAULT_CUSTOMER_KEY_PATTERN): string {
  const raw = sanitizeText(value) || sanitizeText(fallback) || DEFAULT_CUSTOMER_KEY_PATTERN
  const withoutTenantToken = raw.replace(/\{TENANT\}/gi, '')
  const compactDashes = withoutTenantToken
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .trim()
  return compactDashes || DEFAULT_CUSTOMER_KEY_PATTERN
}

function sanitizeSensitive(value: any): string {
  return String(value || '').trim()
}

function normalizeDate(value: any): string | null {
  const raw = sanitizeText(value)
  if (!raw) return null
  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dateOnlyMatch) return raw
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function normalizeTimestamp(value: any): string {
  const raw = sanitizeText(value)
  if (!raw) return ''
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString()
}

function asDateOnly(value: any): string {
  return _asDateOnly(value) ?? ''
}

function toArray<T = any>(value: any): T[] {
  return Array.isArray(value) ? value : []
}

function normalizeObject(value: any): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value
}

function buildSampleCustomerPayloads(): Array<{ seedCode: string; payload: any }> {
  const today = todayDate()
  return [
    {
      seedCode: 'IND_PRIMARY_AUTO',
      payload: {
        entityType: 'INDIVIDUAL',
        status: 'ACTIVE',
        identity: {
          person: {
            firstName: 'John',
            lastName: 'Carter',
            preferredName: 'Johnny',
            dob: '1984-05-16',
            gender: 'Male',
            maritalStatus: 'Married',
            ssnLast4: '4821',
            driverLicenseNo: 'D2149876',
            driverLicenseState: 'NY',
            driverLicenseExpiry: '2029-05-31'
          },
          company: {}
        },
        contactPoints: [
          {
            contactType: 'PHONE',
            subType: 'mobile',
            value: '(917) 555-1001',
            preferred: true,
            verified: true,
            emailConsent: true,
            smsConsent: true,
            callConsent: true,
            effectiveFrom: today
          },
          {
            contactType: 'EMAIL',
            subType: 'personal',
            value: 'john.carter@example.com',
            preferred: true,
            verified: true,
            emailConsent: true,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'residence',
            line1: '120 Main St',
            city: 'New York',
            state: 'NY',
            postalCode: '10001',
            country: 'US',
            primary: true,
            validationStatus: 'validated',
            effectiveFrom: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'CRM', externalId: 'CRM-IND-1001', idType: 'customer', active: true, lastSyncAt: `${today}T12:00:00Z` },
          { sourceSystem: 'LEGACY_POL', externalId: 'LGC-PA-212001', idType: 'insured', active: true, lastSyncAt: `${today}T12:00:00Z` }
        ],
        compliance: {
          kycStatus: 'verified',
          kycVerificationDate: today,
          kycMethod: 'document+otp',
          sanctionsStatus: 'clear',
          sanctionsLastCheckedAt: `${today}T11:00:00Z`,
          doNotContact: false,
          dataRetentionHold: false,
          rightToBeForgottenRequested: false,
          privacyRegion: 'US'
        },
        notes: [
          { category: 'underwriting', noteText: 'Standard personal auto insured profile.' }
        ],
        attachments: [
          { documentId: 'DOC-KYC-1001', fileName: 'kyc-summary.pdf', fileType: 'application/pdf' }
        ],
        metadata: {
          seedCode: 'IND_PRIMARY_AUTO',
          customerSegment: 'PERSONAL_AUTO',
          source: 'sample_seed'
        }
      }
    },
    {
      seedCode: 'IND_SECONDARY_DUP_SIGNAL',
      payload: {
        entityType: 'INDIVIDUAL',
        status: 'DRAFT',
        identity: {
          person: {
            firstName: 'Jon',
            lastName: 'Carter',
            dob: '1984-05-16',
            ssnLast4: '4821',
            driverLicenseState: 'NY'
          },
          company: {}
        },
        contactPoints: [
          {
            contactType: 'EMAIL',
            subType: 'personal',
            value: 'jon.carter.alt@example.com',
            preferred: true,
            verified: false,
            emailConsent: true,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'mailing',
            line1: '125 Main Street',
            city: 'New York',
            state: 'NY',
            postalCode: '10001',
            country: 'US',
            primary: true,
            validationStatus: 'unvalidated',
            effectiveFrom: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'CRM', externalId: 'CRM-IND-1002', idType: 'prospect', active: true, lastSyncAt: `${today}T12:00:00Z` }
        ],
        compliance: {
          kycStatus: 'pending',
          sanctionsStatus: 'clear',
          doNotContact: false
        },
        notes: [{ category: 'service', noteText: 'Potential duplicate for testing match candidates.' }],
        attachments: [],
        metadata: {
          seedCode: 'IND_SECONDARY_DUP_SIGNAL',
          source: 'sample_seed'
        }
      }
    },
    {
      seedCode: 'COMP_NORTHWIND',
      payload: {
        entityType: 'COMPANY',
        status: 'ACTIVE',
        identity: {
          person: {},
          company: {
            legalName: 'Northwind Logistics LLC',
            dbaName: 'Northwind Transport',
            feinLast4: '7781',
            entityLegalType: 'LLC',
            incorporationState: 'TX',
            incorporationCountry: 'US',
            incorporationDate: '2014-03-20',
            naics: '484110',
            website: 'https://northwind-logistics.example'
          }
        },
        contactPoints: [
          {
            contactType: 'PHONE',
            subType: 'work',
            value: '(512) 555-2200',
            preferred: true,
            verified: true,
            callConsent: true,
            effectiveFrom: today
          },
          {
            contactType: 'EMAIL',
            subType: 'work',
            value: 'risk@northwind-logistics.example',
            preferred: true,
            verified: true,
            emailConsent: true,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'business',
            line1: '450 Commerce Ave',
            city: 'Austin',
            state: 'TX',
            postalCode: '78701',
            country: 'US',
            county: 'Travis',
            primary: true,
            validationStatus: 'validated',
            effectiveFrom: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'BILLING', externalId: 'BILL-COMP-3301', idType: 'account', active: true, lastSyncAt: `${today}T10:45:00Z` }
        ],
        compliance: {
          kycStatus: 'verified',
          kycVerificationDate: today,
          sanctionsStatus: 'clear',
          sanctionsLastCheckedAt: `${today}T10:45:00Z`,
          doNotContact: false
        },
        notes: [{ category: 'billing', noteText: 'Commercial insured with active monthly billing.' }],
        attachments: [{ documentId: 'DOC-COI-3301', fileName: 'certificate-of-insurance.pdf', fileType: 'application/pdf' }],
        metadata: {
          seedCode: 'COMP_NORTHWIND',
          customerSegment: 'COMMERCIAL',
          source: 'sample_seed'
        }
      }
    },
    {
      seedCode: 'BOTH_MAPLE_RETAIL',
      payload: {
        entityType: 'BOTH',
        status: 'PENDING_APPROVAL',
        identity: {
          person: {
            firstName: 'Alicia',
            lastName: 'Gomez',
            dob: '1990-11-02',
            ssnLast4: '3137',
            preferredName: 'Ali'
          },
          company: {
            legalName: 'Maple Retail Group Inc',
            dbaName: 'Maple Stores',
            feinLast4: '5529',
            entityLegalType: 'CORPORATION',
            incorporationState: 'CA',
            incorporationCountry: 'US',
            incorporationDate: '2018-07-10',
            naics: '452210',
            website: 'https://maple-retail.example'
          }
        },
        contactPoints: [
          {
            contactType: 'EMAIL',
            subType: 'work',
            value: 'alicia.gomez@maple-retail.example',
            preferred: true,
            verified: true,
            emailConsent: true,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'business',
            line1: '900 Market Plaza',
            city: 'San Diego',
            state: 'CA',
            postalCode: '92101',
            country: 'US',
            primary: true,
            validationStatus: 'validated',
            effectiveFrom: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'CRM', externalId: 'CRM-BOTH-5100', idType: 'account', active: true, lastSyncAt: `${today}T09:10:00Z` }
        ],
        compliance: {
          kycStatus: 'review',
          sanctionsStatus: 'clear',
          sanctionsLastCheckedAt: `${today}T09:10:00Z`,
          doNotContact: false
        },
        notes: [{ category: 'underwriting', noteText: 'Pending compliance approval due ownership verification.' }],
        attachments: [],
        metadata: {
          seedCode: 'BOTH_MAPLE_RETAIL',
          source: 'sample_seed',
          primaryContactRole: 'Owner'
        }
      }
    },
    {
      seedCode: 'IND_INACTIVE_HOME',
      payload: {
        entityType: 'INDIVIDUAL',
        status: 'INACTIVE',
        identity: {
          person: {
            firstName: 'Martha',
            lastName: 'Lane',
            dob: '1976-02-14',
            ssnLast4: '6620'
          },
          company: {}
        },
        contactPoints: [
          {
            contactType: 'PHONE',
            subType: 'home',
            value: '(303) 555-9191',
            preferred: true,
            verified: true,
            callConsent: false,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'residence',
            line1: '18 Cedar Creek Dr',
            city: 'Denver',
            state: 'CO',
            postalCode: '80202',
            country: 'US',
            primary: true,
            validationStatus: 'validated',
            effectiveFrom: '2020-01-01',
            effectiveTo: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'LEGACY_POL', externalId: 'LEG-HO-8820', idType: 'insured', active: false, lastSyncAt: `${today}T08:00:00Z` }
        ],
        compliance: {
          kycStatus: 'verified',
          sanctionsStatus: 'clear',
          doNotContact: true
        },
        notes: [{ category: 'service', noteText: 'Customer requested temporary inactivation.' }],
        attachments: [],
        metadata: {
          seedCode: 'IND_INACTIVE_HOME',
          source: 'sample_seed'
        }
      }
    },
    {
      seedCode: 'COMP_CANADA_LIABILITY',
      payload: {
        entityType: 'COMPANY',
        status: 'ACTIVE',
        identity: {
          person: {},
          company: {
            legalName: 'Great Lakes Contractors Ltd',
            dbaName: 'Great Lakes Build',
            feinLast4: '9012',
            entityLegalType: 'CORPORATION',
            incorporationState: 'ON',
            incorporationCountry: 'CA',
            incorporationDate: '2012-09-01',
            naics: '236220',
            website: 'https://greatlakes-contractors.example'
          }
        },
        contactPoints: [
          {
            contactType: 'EMAIL',
            subType: 'work',
            value: 'insurance@greatlakes-contractors.example',
            preferred: true,
            verified: true,
            emailConsent: true,
            effectiveFrom: today
          }
        ],
        addresses: [
          {
            addressType: 'business',
            line1: '77 King St W',
            city: 'Toronto',
            state: 'ON',
            postalCode: 'M5H2N2',
            country: 'CA',
            primary: true,
            validationStatus: 'validated',
            effectiveFrom: today
          }
        ],
        externalIdentifiers: [
          { sourceSystem: 'BILLING', externalId: 'BILL-COMP-CA-712', idType: 'account', active: true, lastSyncAt: `${today}T07:30:00Z` }
        ],
        compliance: {
          kycStatus: 'verified',
          sanctionsStatus: 'clear',
          privacyRegion: 'CA'
        },
        notes: [{ category: 'underwriting', noteText: 'Canadian operation with US exposure endorsement.' }],
        attachments: [{ documentId: 'DOC-CAN-712', fileName: 'canadian-schedule.pdf', fileType: 'application/pdf' }],
        metadata: {
          seedCode: 'COMP_CANADA_LIABILITY',
          source: 'sample_seed'
        }
      }
    }
  ]
}

function buildSampleCustomerRelationships(): Array<{
  seedCode: string
  fromSeedCode: string
  toSeedCode: string
  relationshipType: string
  startDate?: string
  endDate?: string
  percentOwnership?: number | null
  notes?: string
}> {
  return [
    {
      seedCode: 'REL_EMPLOYMENT_1',
      fromSeedCode: 'IND_PRIMARY_AUTO',
      toSeedCode: 'COMP_NORTHWIND',
      relationshipType: 'Employee',
      startDate: '2021-01-01',
      notes: 'Primary insured employed by the commercial customer.'
    },
    {
      seedCode: 'REL_CONTACT_1',
      fromSeedCode: 'COMP_NORTHWIND',
      toSeedCode: 'IND_PRIMARY_AUTO',
      relationshipType: 'Contact',
      startDate: '2021-01-01',
      notes: 'Operational contact for payroll deductions.'
    },
    {
      seedCode: 'REL_OWNER_1',
      fromSeedCode: 'BOTH_MAPLE_RETAIL',
      toSeedCode: 'COMP_NORTHWIND',
      relationshipType: 'Owner',
      startDate: '2022-01-01',
      percentOwnership: 0.15,
      notes: 'Minor ownership stake used to test percentage ownership.'
    }
  ]
}

function normalizePhone(value: any): string {
  const digits = String(value || '').replace(/\D/g, '')
  if (!digits) return ''
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

function normalizeEmail(value: any): string {
  return String(value || '').trim().toLowerCase()
}

function normalizeContactIdentity(value: any): string {
  const text = String(value || '')
  return text.includes('@') ? normalizeEmail(text) : normalizePhone(text)
}

function normalizeTextForMatch(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function normalizeLast4(value: any): string {
  const normalized = normalizeSensitiveValue(value)
  if (!normalized) return ''
  return normalized.slice(-4)
}

function toNullableNumber(value: any): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function clampNumber(value: any, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function deriveDisplayName(payload: NormalizedCustomerInput): string {
  if (payload.entityType === 'COMPANY') {
    return payload.identity.company.legalName || payload.identity.company.dbaName || 'Company Customer'
  }
  if (payload.entityType === 'BOTH') {
    const companyName = payload.identity.company.legalName || payload.identity.company.dbaName
    const personName = [payload.identity.person.firstName, payload.identity.person.lastName].filter(Boolean).join(' ')
    if (companyName && personName) return `${companyName} (${personName})`
    return companyName || personName || 'Customer'
  }
  const person = [payload.identity.person.firstName, payload.identity.person.lastName].filter(Boolean).join(' ')
  return person || 'Individual Customer'
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}

function resolveActor(req: any): string {
  return String(req?.user?.username || req?.user?.id || 'system')
}

const todayDate = today

function normalizePolicyCustomerRelationshipType(value: any): string {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '')
  if (normalized === 'SECONDARY_NAMED_INSURED') return normalized
  if (normalized === 'ADDITIONAL_NAMED_INSURED') return normalized
  return 'PRIMARY_NAMED_INSURED'
}

function deriveCustomerPolicyStatus(rawStatus: any, effectiveDate: string, expirationDate: string): string {
  const normalized = String(rawStatus || '').trim().toLowerCase()
  const today = todayDate()
  const eff = effectiveDate || today
  const exp = expirationDate || today
  if (normalized === 'cancelled') return 'Cancelled'
  if (exp < today) return 'Expired'
  if (normalized === 'bound') return 'Bind'
  if (normalized === 'issued') {
    if (eff <= today && exp >= today) return 'Inforced'
    return 'Issued'
  }
  if (normalized === 'rated') return 'Rated'
  if (normalized === 'draft' || normalized === 'quote') return 'Draft'
  if (!normalized) return 'Draft'
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1)
}

function hasPermission(permissions: string[] | undefined, permissionCode: string): boolean {
  if (!Array.isArray(permissions)) return false
  return permissions.includes(permissionCode)
}

function identitySectionsChanged(existing: any, incoming: NormalizedCustomerInput): boolean {
  const currentPerson = existing?.identity?.person || {}
  const currentCompany = existing?.identity?.company || {}
  const currentEntityType = normalizeEntityType(existing?.entityType)
  if (currentEntityType !== incoming.entityType) return true
  const personChanged =
    normalizeTextForMatch(currentPerson.firstName) !== normalizeTextForMatch(incoming.identity.person.firstName) ||
    normalizeTextForMatch(currentPerson.lastName) !== normalizeTextForMatch(incoming.identity.person.lastName) ||
    normalizeLast4(currentPerson.ssnLast4 || currentPerson.ssnMasked) !==
      normalizeLast4(incoming.identity.person.ssn || incoming.identity.person.ssnLast4)
  const companyChanged =
    normalizeTextForMatch(currentCompany.legalName) !== normalizeTextForMatch(incoming.identity.company.legalName) ||
    normalizeLast4(currentCompany.feinLast4 || currentCompany.feinMasked) !==
      normalizeLast4(incoming.identity.company.fein || incoming.identity.company.feinLast4)
  return personChanged || companyChanged
}

function computeSearchMatchScore(
  row: any,
  input: {
    qText: string
    customerKey: string
    name: string
    phone: string
    email: string
    taxId: string
    externalId: string
    address: string
  }
): number {
  let score = 0
  const key = String(row.customer_key || '').toLowerCase()
  const display = String(row.display_name || row.legal_name || '').toLowerCase()
  const personName = `${String(row.first_name || '')} ${String(row.last_name || '')}`.trim().toLowerCase()
  if (input.customerKey && key.includes(input.customerKey.toLowerCase())) score += 80
  if (input.name && (display.includes(input.name.toLowerCase()) || personName.includes(input.name.toLowerCase()))) score += 60
  if (input.qText && (key.includes(input.qText.toLowerCase()) || display.includes(input.qText.toLowerCase()) || personName.includes(input.qText.toLowerCase()))) score += 45
  if (input.phone) score += 25
  if (input.email) score += 25
  if (input.taxId) score += 20
  if (input.externalId) score += 20
  if (input.address) score += 20
  if (score === 0) score = 10
  return Math.min(100, score)
}

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  const pairsA = bigrams(a)
  const pairsB = bigrams(b)
  if (!pairsA.size || !pairsB.size) return 0
  let overlap = 0
  for (const pair of pairsA) {
    if (pairsB.has(pair)) overlap += 1
  }
  return (2 * overlap) / (pairsA.size + pairsB.size)
}

function bigrams(value: string): Set<string> {
  const out = new Set<string>()
  if (value.length < 2) return out
  for (let i = 0; i < value.length - 1; i += 1) {
    out.add(value.slice(i, i + 2))
  }
  return out
}

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    const key = keyFn(item)
    if (!key) continue
    map.set(key, item)
  }
  return Array.from(map.values())
}

function uniqueStringArray(values: any[]): string[] {
  const out = new Set<string>()
  for (const value of values || []) {
    const text = sanitizeText(value)
    if (!text) continue
    out.add(text)
  }
  return Array.from(out)
}

function mapAuditEvent(row: any) {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    actor: row.actor || null,
    reason: row.reason || null,
    correlationId: row.correlation_id || null,
    before: row.before_json || null,
    after: row.after_json || null,
    fieldDiffs: row.field_diffs || [],
    createdAt: normalizeTimestamp(row.created_at)
  }
}

function diffObjects(before: any, after: any, basePath = ''): Array<{ path: string; before: any; after: any }> {
  const out: Array<{ path: string; before: any; after: any }> = []
  const beforeValue = before ?? null
  const afterValue = after ?? null
  const beforeIsObj = typeof beforeValue === 'object' && beforeValue !== null
  const afterIsObj = typeof afterValue === 'object' && afterValue !== null
  if (!beforeIsObj || !afterIsObj) {
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      out.push({ path: basePath || '/', before: beforeValue, after: afterValue })
    }
    return out
  }
  if (Array.isArray(beforeValue) || Array.isArray(afterValue)) {
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      out.push({ path: basePath || '/', before: beforeValue, after: afterValue })
    }
    return out
  }
  const keys = new Set<string>([...Object.keys(beforeValue), ...Object.keys(afterValue)])
  for (const key of keys) {
    const path = `${basePath}/${key}`.replace('//', '/')
    out.push(...diffObjects(beforeValue[key], afterValue[key], path))
  }
  return out
}
