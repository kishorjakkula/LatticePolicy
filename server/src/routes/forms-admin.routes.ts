import type { Request } from 'express'
import { Router } from 'express'
import { getDb, withTenantTx, toRawQuery } from '../db.js'
import { v4 as uuidv4 } from '../uuid.js'
import { hasPermission } from '../auth.js'
import { buildCacheKey, cacheDeletePrefix } from '../cache.js'
import { asDateOnly as _asDateOnly } from '../lib/date.utils.js'
import { sanitizeInlineFileName } from '../lib/utils.js'

export const formsAdminRoutes = Router()

const WORKFLOW_STATUSES = ['Draft', 'Reviewed', 'Approved'] as const
const REGULATORY_STATUSES = ['Approved', 'Filed', 'Pending', 'Withdrawn'] as const
const TRANSACTION_TYPES = [
  'Quote',
  'Bind',
  'Issue',
  'Endorsement',
  'Renewal',
  'Cancellation',
  'Reinstatement',
  'Rewrite'
] as const
const RISK_UNIT_ASSOCIATIONS = ['Policy', 'Vehicle', 'Driver', 'Location', 'Dwelling'] as const
const TRIGGER_TYPES = ['Always', 'Coverage Selected', 'Threshold', 'UW Rule', 'Attribute-based', 'Expression'] as const
const DEFAULT_FUTURE_DATE = '9999-12-31'
const US_STATE_CODES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC'
]

type QueryFn = (text: string, params?: any[]) => Promise<any>

type FormRow = {
  form_id: string
  carrier_code: string
  authority: string
  form_number: string
  form_title: string
  edition_date: string
  form_type: string
  line_of_business: string
  workflow_status: string
  active: boolean
  change_reason: string | null
  previous_form_id: string | null
  edit_lock: boolean
  require_approved_jurisdiction: boolean
  metadata: any
  created_at: string
  created_by: string | null
  updated_at: string
  updated_by: string | null
}

formsAdminRoutes.use((_req, res, next) => {
  if (!getDb()) {
    return res.status(400).json({ code: 'NO_DB', message: 'Forms administration requires database mode' })
  }
  next()
})

formsAdminRoutes.use((req, res, next) => {
  if (req.method === 'GET') {
    return next()
  }
  const tenantId = req.tenant?.tenantId
  res.on('finish', () => {
    if (tenantId && res.statusCode < 400) {
      void cacheDeletePrefix(buildCacheKey(['forms-preview', tenantId]))
    }
  })
  next()
})

formsAdminRoutes.get('/', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const status = normalizeWorkflowStatus(req.query.status)
  const active = normalizeOptionalBoolean(req.query.active)
  const authority = normalizeLabel(req.query.authority)
  const lineOfBusiness = normalizeLabel(req.query.lineOfBusiness)
  const carrierCode = normalizeCode(req.query.carrierCode)
  const search = normalizeLabel(req.query.q)

  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const clauses = ['f.tenant_id = $1']
      const params: any[] = [tenantId]
      let idx = 2

      if (status) {
        clauses.push(`f.workflow_status = $${idx}`)
        params.push(status)
        idx += 1
      }
      if (active != null) {
        clauses.push(`f.active = $${idx}`)
        params.push(active)
        idx += 1
      }
      if (authority) {
        clauses.push(`f.authority = $${idx}`)
        params.push(authority)
        idx += 1
      }
      if (lineOfBusiness) {
        clauses.push(`f.line_of_business = $${idx}`)
        params.push(lineOfBusiness)
        idx += 1
      }
      if (carrierCode) {
        clauses.push(`f.carrier_code = $${idx}`)
        params.push(carrierCode)
        idx += 1
      }
      if (search) {
        clauses.push(`(f.form_number ILIKE $${idx} OR f.form_title ILIKE $${idx} OR f.authority ILIKE $${idx + 1})`)
        params.push(`%${search}%`, `%${search}%`)
        idx += 2
      }

      return q(
        `SELECT f.*,
                EXISTS (
                  SELECT 1
                    FROM forms_admin_jurisdictions j
                   WHERE j.tenant_id = f.tenant_id
                     AND j.form_id = f.form_id
                     AND j.regulatory_status = 'Approved'
                ) AS has_approved_jurisdiction,
                (SELECT COUNT(*)::int FROM forms_admin_jurisdictions j WHERE j.tenant_id = f.tenant_id AND j.form_id = f.form_id) AS jurisdiction_count,
                (SELECT COUNT(*)::int FROM forms_admin_applicability a WHERE a.tenant_id = f.tenant_id AND a.form_id = f.form_id) AS applicability_count,
                (SELECT COUNT(*)::int FROM forms_admin_triggers t WHERE t.tenant_id = f.tenant_id AND t.form_id = f.form_id) AS trigger_count
           FROM forms_admin_forms f
          WHERE ${clauses.join(' AND ')}
          ORDER BY f.updated_at DESC, f.form_number ASC`,
        params
      )
    })
    return res.json(rows.rows.map(mapFormSummaryRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = currentActor(req)
  const payload = req.body || {}

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  const normalized = normalizeFormPayload(payload)
  const validationError = validateCreateFormPayload(normalized)
  if (validationError) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: validationError })
  }

  try {
    const created = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      await ensureUniqueFormIdentity(q, {
        tenantId,
        carrierCode: normalized.carrierCode!,
        authority: normalized.authority!,
        formNumber: normalized.formNumber!,
        editionDate: normalized.editionDate!
      })

      if (normalized.active) {
        return { code: 'INVALID_INPUT', message: 'New forms cannot be active before approval' }
      }

      const insert = await q(
        `INSERT INTO forms_admin_forms (
            tenant_id, carrier_code, authority, form_number, form_title, edition_date,
            form_type, line_of_business, workflow_status, active, change_reason, previous_form_id,
            edit_lock, require_approved_jurisdiction, metadata, created_by, updated_by, updated_at
         ) VALUES (
            $1,$2,$3,$4,$5,$6,
            $7,$8,$9,$10,$11,$12,
            $13,$14,$15,$16,$17,now()
         )
         RETURNING *`,
        [
          tenantId,
          normalized.carrierCode,
          normalized.authority,
          normalized.formNumber,
          normalized.formTitle,
          normalized.editionDate,
          normalized.formType,
          normalized.lineOfBusiness,
          normalized.workflowStatus,
          false,
          normalized.changeReason,
          normalized.previousFormId,
          normalized.editLock,
          normalized.requireApprovedJurisdiction,
          normalized.metadata,
          actor,
          actor
        ]
      )
      const row: FormRow = insert.rows[0]

      await ensureDefaultFormRows(q, tenantId, row.form_id, actor)

      if (Array.isArray(payload.jurisdictions)) {
        for (const entry of payload.jurisdictions) {
          const j = normalizeJurisdictionPayload(entry)
          const jError = validateJurisdictionPayload(j)
          if (jError) return { code: 'INVALID_INPUT', message: jError }
          await ensureNoJurisdictionOverlap(q, {
            tenantId,
            formId: row.form_id,
            stateCode: j.stateCode!,
            effectiveDate: j.effectiveDate!,
            sunsetDate: j.sunsetDate || null
          })
          await q(
            `INSERT INTO forms_admin_jurisdictions (
                tenant_id, form_id, state_code, regulatory_status, approval_tracking_id,
                effective_date, sunset_date, has_state_exceptions, notes, created_by, updated_by, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,now())`,
            [
              tenantId,
              row.form_id,
              j.stateCode,
              j.regulatoryStatus,
              j.approvalTrackingId,
              j.effectiveDate,
              j.sunsetDate,
              j.hasStateExceptions,
              j.notes,
              actor
            ]
          )
        }
      }

      if (Array.isArray(payload.applicability)) {
        for (const entry of payload.applicability) {
          const a = normalizeApplicabilityPayload(entry)
          const aError = validateApplicabilityPayload(a)
          if (aError) return { code: 'INVALID_INPUT', message: aError }
          await q(
            `INSERT INTO forms_admin_applicability (
                tenant_id, form_id, line_of_business, product_code, risk_unit_association,
                transaction_types, active, created_by, updated_by, updated_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,now())`,
            [
              tenantId,
              row.form_id,
              a.lineOfBusiness,
              a.productCode,
              a.riskUnitAssociation,
              a.transactionTypes,
              a.active,
              actor
            ]
          )
        }
      }

      // Trigger/inference authoring is intentionally ignored in deterministic attachment mode.

      if (payload.output && typeof payload.output === 'object') {
        const output = normalizeOutputPayload(payload.output)
        await upsertFormOutput(q, tenantId, row.form_id, actor, output)
      }
      if (payload.delivery && typeof payload.delivery === 'object') {
        const delivery = normalizeDeliveryPayload(payload.delivery)
        await upsertFormDelivery(q, tenantId, row.form_id, actor, delivery)
      }
      if (payload.security && typeof payload.security === 'object') {
        const security = normalizeSecurityPayload(payload.security)
        await upsertFormSecurity(q, tenantId, row.form_id, actor, security)
      }

      const details = await loadFormDetails(q, tenantId, row.form_id)
      const snapshot = makeVersionSnapshot(details)
      const correlationId = uuidv4()
      await insertFormVersion(q, tenantId, row.form_id, actor, row.workflow_status, normalized.changeReason || null, correlationId, snapshot)
      await insertAuditEvent(q, {
        tenantId,
        formId: row.form_id,
        entityType: 'Form',
        entityId: row.form_id,
        eventType: 'FORM_CREATED',
        correlationId,
        beforeSnapshot: null,
        afterSnapshot: snapshot,
        reason: normalized.changeReason || null,
        changedBy: actor
      })

      return details
    })

    if (created && typeof created === 'object' && 'code' in created) {
      return res.status(400).json(created)
    }

    return res.status(201).json(created)
  } catch (e: any) {
    if (e?.code === 'FORM_IDENTITY_EXISTS') {
      return res.status(409).json({ code: 'DUPLICATE', message: e.message })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/seed/iso-personal-auto-us', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const actor = currentActor(req)
  const body = req.body || {}

  if (!isComplianceAdmin(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
  }

  const carrierCode = normalizeCode(body.carrierCode) || 'ISO'
  const authority = normalizeLabel(body.authority) || 'ISO'
  const editionDate = parseEditionDate(body.editionDate) || '2026-01-01'
  const effectiveDate = parseDateOnly(body.effectiveDate) || editionDate
  const includeStateAmendatory = body.includeStateAmendatory !== false

  const templates: Array<{
    formNumber: string
    formTitle: string
    formType: string
    stateSpecific?: boolean
  }> = [
    { formNumber: 'PP 00 01', formTitle: 'Personal Auto Policy', formType: 'Policy' }
  ]

  if (includeStateAmendatory) {
    for (const stateCode of US_STATE_CODES) {
      templates.push({
        formNumber: `PP 01 ${stateCode}`,
        formTitle: `${stateCode} Changes - Personal Auto`,
        formType: 'Endorsement',
        stateSpecific: true
      })
    }
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const created: string[] = []
      const skipped: string[] = []

      for (const template of templates) {
        const existing = await q(
          `SELECT form_id
             FROM forms_admin_forms
            WHERE tenant_id = $1
              AND carrier_code = $2
              AND authority = $3
              AND form_number = $4
              AND edition_date = $5
            LIMIT 1`,
          [tenantId, carrierCode, authority, template.formNumber, editionDate]
        )
        if (existing.rowCount > 0) {
          skipped.push(template.formNumber)
          continue
        }

        const inserted = await q(
          `INSERT INTO forms_admin_forms (
              tenant_id, carrier_code, authority, form_number, form_title, edition_date,
              form_type, line_of_business, workflow_status, active, change_reason,
              edit_lock, require_approved_jurisdiction, metadata, created_by, updated_by, updated_at
           ) VALUES (
              $1,$2,$3,$4,$5,$6,
              $7,'personal-auto','Approved',true,$8,
              true,true,$9,$10,$10,now()
           )
           RETURNING form_id`,
          [
            tenantId,
            carrierCode,
            authority,
            template.formNumber,
            template.formTitle,
            editionDate,
            template.formType,
            'ISO seed load',
            { seed: 'iso-personal-auto-us', stateSpecific: Boolean(template.stateSpecific) },
            actor
          ]
        )
        const formId = inserted.rows[0]?.form_id as string
        created.push(template.formNumber)

        await ensureDefaultFormRows(q, tenantId, formId, actor)

        await q(
          `INSERT INTO forms_admin_applicability (
              tenant_id, form_id, line_of_business, product_code, risk_unit_association, transaction_types,
              active, created_by, updated_by, updated_at
           ) VALUES (
              $1,$2,'personal-auto','personal-auto','Policy',
              ARRAY['Quote','Bind','Issue','Endorsement','Renewal','Cancellation','Reinstatement','Rewrite']::text[],
              true,$3,$3,now()
           )`,
          [tenantId, formId, actor]
        )

        if (template.stateSpecific) {
          const state = template.formNumber.slice(-2)
          await q(
            `INSERT INTO forms_admin_jurisdictions (
                tenant_id, form_id, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
                has_state_exceptions, notes, created_by, updated_by, updated_at
             ) VALUES ($1,$2,$3,'Approved',$4,$5,NULL,false,$6,$7,$7,now())`,
            [tenantId, formId, state, `ISO-${state}-${editionDate}`, effectiveDate, 'State-specific amendatory endorsement', actor]
          )
        } else {
          for (const state of US_STATE_CODES) {
            await q(
              `INSERT INTO forms_admin_jurisdictions (
                  tenant_id, form_id, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
                  has_state_exceptions, notes, created_by, updated_by, updated_at
               ) VALUES ($1,$2,$3,'Approved',$4,$5,NULL,false,$6,$7,$7,now())`,
              [tenantId, formId, state, `ISO-${state}-${editionDate}`, effectiveDate, 'Approved for personal auto use', actor]
            )
          }
        }

        const details = await loadFormDetails(q, tenantId, formId)
        const snapshot = makeVersionSnapshot(details)
        const correlationId = uuidv4()
        await insertFormVersion(q, tenantId, formId, actor, 'Approved', 'ISO seed load', correlationId, snapshot)
        await insertAuditEvent(q, {
          tenantId,
          formId,
          entityType: 'Form',
          entityId: formId,
          eventType: 'FORM_SEEDED_ISO_PERSONAL_AUTO_US',
          correlationId,
          beforeSnapshot: null,
          afterSnapshot: snapshot,
          reason: 'ISO seed load',
          changedBy: actor
        })
      }

      return {
        createdCount: created.length,
        skippedCount: skipped.length,
        created,
        skipped,
        carrierCode,
        authority,
        editionDate,
        effectiveDate
      }
    })

    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id

  try {
    const details = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return loadFormDetails(q, tenantId, formId)
    })
    if (!details?.form) {
      return res.status(404).json({ code: 'NOT_FOUND' })
    }
    return res.json(details)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.patch('/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeFormPayload(req.body || {})

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const updated = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const current = await loadFormRow(q, tenantId, formId)
      if (!current) return null

      const changes: Record<string, any> = {}
      if (payload.carrierCode != null && payload.carrierCode !== current.carrier_code) changes.carrier_code = payload.carrierCode
      if (payload.authority != null && payload.authority !== current.authority) changes.authority = payload.authority
      if (payload.formNumber != null && payload.formNumber !== current.form_number) changes.form_number = payload.formNumber
      if (payload.formTitle != null && payload.formTitle !== current.form_title) changes.form_title = payload.formTitle
      if (payload.editionDate != null && payload.editionDate !== current.edition_date) changes.edition_date = payload.editionDate
      if (payload.formType != null && payload.formType !== current.form_type) changes.form_type = payload.formType
      if (payload.lineOfBusiness != null && payload.lineOfBusiness !== current.line_of_business) changes.line_of_business = payload.lineOfBusiness
      if (payload.editLock != null && payload.editLock !== current.edit_lock) changes.edit_lock = payload.editLock
      if (
        payload.requireApprovedJurisdiction != null &&
        payload.requireApprovedJurisdiction !== current.require_approved_jurisdiction
      ) {
        changes.require_approved_jurisdiction = payload.requireApprovedJurisdiction
      }
      if (payload.metadata != null && JSON.stringify(payload.metadata) !== JSON.stringify(current.metadata || {})) {
        changes.metadata = payload.metadata
      }

      if (Object.keys(changes).length === 0) {
        return loadFormDetails(q, tenantId, formId)
      }

      if (current.workflow_status === 'Approved' && current.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }

      if (current.workflow_status === 'Approved' && !payload.changeReason) {
        return { code: 'INVALID_INPUT', message: 'Change reason is required for approved form changes' }
      }

      const nextCarrier = changes.carrier_code ?? current.carrier_code
      const nextAuthority = changes.authority ?? current.authority
      const nextNumber = changes.form_number ?? current.form_number
      const nextEdition = changes.edition_date ?? current.edition_date
      await ensureUniqueFormIdentity(q, {
        tenantId,
        carrierCode: nextCarrier,
        authority: nextAuthority,
        formNumber: nextNumber,
        editionDate: nextEdition,
        excludeFormId: formId
      })

      const setSql = Object.keys(changes)
        .map((col, i) => `${col} = $${i + 3}`)
        .concat(['updated_by = $2', 'updated_at = now()', 'change_reason = $' + (Object.keys(changes).length + 3)])
        .join(', ')
      const params = [tenantId, actor, ...Object.values(changes), payload.changeReason || null, formId]

      await q(
        `UPDATE forms_admin_forms
            SET ${setSql}
          WHERE tenant_id = $1 AND form_id = $${params.length}
          RETURNING form_id`,
        params
      )

      const before = await loadFormDetails(q, tenantId, formId, true)
      const details = await loadFormDetails(q, tenantId, formId)
      if (!details.form) return { code: 'NOT_FOUND' }
      const snapshot = makeVersionSnapshot(details)
      const correlationId = uuidv4()
      await insertFormVersion(
        q,
        tenantId,
        formId,
        actor,
        details.form.workflowStatus,
        payload.changeReason || null,
        correlationId,
        snapshot
      )
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'Form',
        entityId: formId,
        eventType: 'FORM_UPDATED',
        correlationId,
        beforeSnapshot: makeVersionSnapshot(before),
        afterSnapshot: snapshot,
        reason: payload.changeReason || null,
        changedBy: actor
      })
      return details
    })

    if (!updated) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((updated as any).code === 'LOCKED') return res.status(409).json(updated)
    if ((updated as any).code === 'INVALID_INPUT') return res.status(400).json(updated)
    return res.json(updated)
  } catch (e: any) {
    if (e?.code === 'FORM_IDENTITY_EXISTS') {
      return res.status(409).json({ code: 'DUPLICATE', message: e.message })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/clone', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const sourceFormId = req.params.id
  const actor = currentActor(req)
  const body = req.body || {}
  const newEditionDate = parseEditionDate(body.editionDate)
  const changeReason = normalizeLabel(body.changeReason)

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  if (!newEditionDate) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'editionDate is required to clone a form' })
  }

  try {
    const cloned = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const source = await loadFormDetails(q, tenantId, sourceFormId)
      if (!source.form) return null

      const nextCarrier = normalizeCode(body.carrierCode) || source.form.carrierCode
      const nextAuthority = normalizeLabel(body.authority) || source.form.authority
      const nextFormNumber = normalizeFormNumber(body.formNumber) || source.form.formNumber
      const nextFormTitle = normalizeLabel(body.formTitle) || source.form.formTitle

      await ensureUniqueFormIdentity(q, {
        tenantId,
        carrierCode: nextCarrier,
        authority: nextAuthority,
        formNumber: nextFormNumber,
        editionDate: newEditionDate
      })

      const inserted = await q(
        `INSERT INTO forms_admin_forms (
            tenant_id, carrier_code, authority, form_number, form_title, edition_date, form_type,
            line_of_business, workflow_status, active, change_reason, previous_form_id, edit_lock,
            require_approved_jurisdiction, metadata, created_by, updated_by, updated_at
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,
            $8,'Draft',false,$9,$10,$11,
            $12,$13,$14,$14,now()
         )
         RETURNING form_id`,
        [
          tenantId,
          nextCarrier,
          nextAuthority,
          nextFormNumber,
          nextFormTitle,
          newEditionDate,
          source.form.formType,
          source.form.lineOfBusiness,
          changeReason || source.form.changeReason || null,
          source.form.formId,
          source.form.editLock,
          source.form.requireApprovedJurisdiction,
          source.form.metadata || {},
          actor
        ]
      )
      const newFormId = inserted.rows[0]?.form_id as string

      await ensureDefaultFormRows(q, tenantId, newFormId, actor)
      await copyFormChildren(q, tenantId, source.form.formId, newFormId, actor)

      const details = await loadFormDetails(q, tenantId, newFormId)
      const snapshot = makeVersionSnapshot(details)
      const correlationId = uuidv4()
      await insertFormVersion(q, tenantId, newFormId, actor, 'Draft', changeReason || null, correlationId, snapshot)
      await insertAuditEvent(q, {
        tenantId,
        formId: newFormId,
        entityType: 'Form',
        entityId: newFormId,
        eventType: 'FORM_CLONED',
        correlationId,
        beforeSnapshot: null,
        afterSnapshot: snapshot,
        reason: changeReason || null,
        changedBy: actor
      })
      return details
    })

    if (!cloned) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(201).json(cloned)
  } catch (e: any) {
    if (e?.code === 'FORM_IDENTITY_EXISTS') {
      return res.status(409).json({ code: 'DUPLICATE', message: e.message })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.delete('/:id', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (!isComplianceAdmin(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
  }

  try {
    const deleted = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const existing = await loadFormDetails(q, tenantId, formId)
      if (!existing.form) return null
      if (existing.form.active) {
        return { code: 'INVALID_STATE', message: 'Active forms cannot be deleted' }
      }
      if (existing.form.workflowStatus === 'Approved') {
        return { code: 'INVALID_STATE', message: 'Approved forms cannot be deleted. Deactivate and keep for audit traceability.' }
      }
      await q('DELETE FROM forms_admin_forms WHERE tenant_id = $1 AND form_id = $2', [tenantId, formId])
      await insertAuditEvent(q, {
        tenantId,
        formId: null,
        entityType: 'Form',
        entityId: formId,
        eventType: 'FORM_DELETED',
        correlationId: uuidv4(),
        beforeSnapshot: makeVersionSnapshot(existing),
        afterSnapshot: null,
        reason: reason || null,
        changedBy: actor
      })
      return { deleted: true }
    })

    if (!deleted) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((deleted as any).code) return res.status(409).json(deleted)
    return res.status(204).end()
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/submit', async (req, res) => {
  return transitionWorkflow(req, res, {
    expectedCurrent: 'Draft',
    nextStatus: 'Reviewed',
    eventType: 'FORM_SUBMITTED',
    requireComplianceRole: false
  })
})

formsAdminRoutes.post('/:id/approve', async (req, res) => {
  return transitionWorkflow(req, res, {
    expectedCurrent: 'Reviewed',
    nextStatus: 'Approved',
    eventType: 'FORM_APPROVED',
    requireComplianceRole: true
  })
})
formsAdminRoutes.post('/:id/activate', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (!isComplianceAdmin(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
  }
  if (!reason) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'reason is required for activation' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const before = await loadFormDetails(q, tenantId, formId)
      if (!before.form) return null
      if (before.form.workflowStatus !== 'Approved') {
        return { code: 'INVALID_STATE', message: 'Only approved forms can be activated' }
      }
      if (before.form.requireApprovedJurisdiction) {
        const approvedCount = before.jurisdictions.filter((j: any) => j.regulatoryStatus === 'Approved').length
        if (approvedCount < 1) {
          return { code: 'INVALID_STATE', message: 'Activation requires at least one approved jurisdiction' }
        }
      }

      await q(
        `UPDATE forms_admin_forms
            SET active = true,
                change_reason = $3,
                updated_by = $4,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2`,
        [tenantId, formId, reason, actor]
      )
      const details = await loadFormDetails(q, tenantId, formId)
      if (!details.form) return { code: 'NOT_FOUND' }
      const correlationId = uuidv4()
      const snapshot = makeVersionSnapshot(details)
      await insertFormVersion(q, tenantId, formId, actor, details.form.workflowStatus, reason, correlationId, snapshot)
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'Form',
        entityId: formId,
        eventType: 'FORM_ACTIVATED',
        correlationId,
        beforeSnapshot: makeVersionSnapshot(before),
        afterSnapshot: snapshot,
        reason,
        changedBy: actor
      })
      return details
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code) return res.status(409).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/deactivate', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (!isComplianceAdmin(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
  }
  if (!reason) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'reason is required for deactivation' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const before = await loadFormDetails(q, tenantId, formId)
      if (!before.form) return null
      await q(
        `UPDATE forms_admin_forms
            SET active = false,
                change_reason = $3,
                updated_by = $4,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2`,
        [tenantId, formId, reason, actor]
      )
      const details = await loadFormDetails(q, tenantId, formId)
      if (!details.form) return { code: 'NOT_FOUND' }
      const correlationId = uuidv4()
      const snapshot = makeVersionSnapshot(details)
      await insertFormVersion(q, tenantId, formId, actor, details.form.workflowStatus, reason, correlationId, snapshot)
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'Form',
        entityId: formId,
        eventType: 'FORM_DEACTIVATED',
        correlationId,
        beforeSnapshot: makeVersionSnapshot(before),
        afterSnapshot: snapshot,
        reason,
        changedBy: actor
      })
      return details
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/jurisdictions', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT jurisdiction_id, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
                has_state_exceptions, notes, created_at, created_by, updated_at, updated_by
           FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY state_code, effective_date`,
        [tenantId, formId]
      )
    })
    return res.json(rows.rows.map(mapJurisdictionRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/jurisdictions', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeJurisdictionPayload(req.body || {})

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  const error = validateJurisdictionPayload(payload)
  if (error) return res.status(400).json({ code: 'INVALID_INPUT', message: error })

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      await ensureNoJurisdictionOverlap(q, {
        tenantId,
        formId,
        stateCode: payload.stateCode!,
        effectiveDate: payload.effectiveDate!,
        sunsetDate: payload.sunsetDate || null
      })
      const insert = await q(
        `INSERT INTO forms_admin_jurisdictions (
            tenant_id, form_id, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
            has_state_exceptions, notes, created_by, updated_by, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,now())
         RETURNING *`,
        [
          tenantId,
          formId,
          payload.stateCode,
          payload.regulatoryStatus,
          payload.approvalTrackingId,
          payload.effectiveDate,
          payload.sunsetDate,
          payload.hasStateExceptions,
          payload.notes,
          actor
        ]
      )
      const before = await loadFormDetails(q, tenantId, formId, true)
      const details = await loadFormDetails(q, tenantId, formId)
      const correlationId = uuidv4()
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'Jurisdiction',
        entityId: insert.rows[0].jurisdiction_id,
        eventType: 'FORM_JURISDICTION_ADDED',
        correlationId,
        beforeSnapshot: makeVersionSnapshot(before),
        afterSnapshot: makeVersionSnapshot(details),
        reason: null,
        changedBy: actor
      })
      return mapJurisdictionRow(insert.rows[0])
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    return res.status(201).json(result)
  } catch (e: any) {
    if (e?.code === 'JURISDICTION_OVERLAP') {
      return res.status(409).json({ code: 'JURISDICTION_OVERLAP', message: e.message })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.patch('/:id/jurisdictions/:jurisdictionId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const jurisdictionId = req.params.jurisdictionId
  const actor = currentActor(req)

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const existing = await q(
        `SELECT * FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = $2 AND jurisdiction_id = $3`,
        [tenantId, formId, jurisdictionId]
      )
      if (!existing.rowCount) return { code: 'NOT_FOUND' }
      const current = existing.rows[0]
      const payload = normalizeJurisdictionPayload({
        stateCode: req.body?.stateCode ?? current.state_code,
        regulatoryStatus: req.body?.regulatoryStatus ?? current.regulatory_status,
        approvalTrackingId: req.body?.approvalTrackingId ?? current.approval_tracking_id,
        effectiveDate: req.body?.effectiveDate ?? current.effective_date,
        sunsetDate: req.body?.sunsetDate ?? current.sunset_date,
        hasStateExceptions: req.body?.hasStateExceptions ?? current.has_state_exceptions,
        notes: req.body?.notes ?? current.notes
      })
      const error = validateJurisdictionPayload(payload)
      if (error) return { code: 'INVALID_INPUT', message: error }
      await ensureNoJurisdictionOverlap(q, {
        tenantId,
        formId,
        stateCode: payload.stateCode!,
        effectiveDate: payload.effectiveDate!,
        sunsetDate: payload.sunsetDate || null,
        excludeJurisdictionId: jurisdictionId
      })
      await q(
        `UPDATE forms_admin_jurisdictions
            SET state_code = $4,
                regulatory_status = $5,
                approval_tracking_id = $6,
                effective_date = $7,
                sunset_date = $8,
                has_state_exceptions = $9,
                notes = $10,
                updated_by = $11,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2 AND jurisdiction_id = $3`,
        [
          tenantId,
          formId,
          jurisdictionId,
          payload.stateCode,
          payload.regulatoryStatus,
          payload.approvalTrackingId,
          payload.effectiveDate,
          payload.sunsetDate,
          payload.hasStateExceptions,
          payload.notes,
          actor
        ]
      )

      const after = await q(
        `SELECT * FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = $2 AND jurisdiction_id = $3`,
        [tenantId, formId, jurisdictionId]
      )
      return mapJurisdictionRow(after.rows[0])
    })

    if (!result || (result as any).code === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    if ((result as any).code === 'INVALID_INPUT') return res.status(400).json(result)
    return res.json(result)
  } catch (e: any) {
    if (e?.code === 'JURISDICTION_OVERLAP') {
      return res.status(409).json({ code: 'JURISDICTION_OVERLAP', message: e.message })
    }
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.delete('/:id/jurisdictions/:jurisdictionId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const jurisdictionId = req.params.jurisdictionId

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const deleted = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const result = await q(
        `DELETE FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = $2 AND jurisdiction_id = $3`,
        [tenantId, formId, jurisdictionId]
      )
      if (!result.rowCount) return { code: 'NOT_FOUND' }
      return { deleted: true }
    })
    if (!deleted) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((deleted as any).code === 'LOCKED') return res.status(409).json(deleted)
    if ((deleted as any).code === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(204).end()
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/applicability', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT * FROM forms_admin_applicability
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY line_of_business, product_code`,
        [tenantId, formId]
      )
    })
    return res.json(rows.rows.map(mapApplicabilityRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})
formsAdminRoutes.post('/:id/applicability', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeApplicabilityPayload(req.body || {})

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  const error = validateApplicabilityPayload(payload)
  if (error) return res.status(400).json({ code: 'INVALID_INPUT', message: error })

  try {
    const inserted = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const result = await q(
        `INSERT INTO forms_admin_applicability (
            tenant_id, form_id, line_of_business, product_code, risk_unit_association, transaction_types,
            active, created_by, updated_by, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,now())
         RETURNING *`,
        [
          tenantId,
          formId,
          payload.lineOfBusiness,
          payload.productCode,
          payload.riskUnitAssociation,
          payload.transactionTypes,
          payload.active,
          actor
        ]
      )
      return mapApplicabilityRow(result.rows[0])
    })
    if (!inserted) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((inserted as any).code === 'LOCKED') return res.status(409).json(inserted)
    return res.status(201).json(inserted)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.patch('/:id/applicability/:applicabilityId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const applicabilityId = req.params.applicabilityId
  const actor = currentActor(req)

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const updated = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const existing = await q(
        `SELECT * FROM forms_admin_applicability
          WHERE tenant_id = $1 AND form_id = $2 AND applicability_id = $3`,
        [tenantId, formId, applicabilityId]
      )
      if (!existing.rowCount) return { code: 'NOT_FOUND' }
      const current = existing.rows[0]
      const payload = normalizeApplicabilityPayload({
        lineOfBusiness: req.body?.lineOfBusiness ?? current.line_of_business,
        productCode: req.body?.productCode ?? current.product_code,
        riskUnitAssociation: req.body?.riskUnitAssociation ?? current.risk_unit_association,
        transactionTypes: req.body?.transactionTypes ?? current.transaction_types,
        active: req.body?.active ?? current.active
      })
      const error = validateApplicabilityPayload(payload)
      if (error) return { code: 'INVALID_INPUT', message: error }
      const result = await q(
        `UPDATE forms_admin_applicability
            SET line_of_business = $4,
                product_code = $5,
                risk_unit_association = $6,
                transaction_types = $7,
                active = $8,
                updated_by = $9,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2 AND applicability_id = $3
          RETURNING *`,
        [
          tenantId,
          formId,
          applicabilityId,
          payload.lineOfBusiness,
          payload.productCode,
          payload.riskUnitAssociation,
          payload.transactionTypes,
          payload.active,
          actor
        ]
      )
      return mapApplicabilityRow(result.rows[0])
    })

    if (!updated || (updated as any).code === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    if ((updated as any).code === 'LOCKED') return res.status(409).json(updated)
    if ((updated as any).code === 'INVALID_INPUT') return res.status(400).json(updated)
    return res.json(updated)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.delete('/:id/applicability/:applicabilityId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const applicabilityId = req.params.applicabilityId

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const deleted = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const result = await q(
        `DELETE FROM forms_admin_applicability
          WHERE tenant_id = $1 AND form_id = $2 AND applicability_id = $3`,
        [tenantId, formId, applicabilityId]
      )
      if (!result.rowCount) return { code: 'NOT_FOUND' }
      return { deleted: true }
    })
    if (!deleted) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((deleted as any).code === 'LOCKED') return res.status(409).json(deleted)
    if ((deleted as any).code === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(204).end()
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/triggers', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT * FROM forms_admin_triggers
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY priority ASC, created_at ASC`,
        [tenantId, formId]
      )
    })
    return res.json(rows.rows.map(mapTriggerRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/triggers', async (req, res) => {
  return res.status(410).json({
    code: 'FEATURE_DISABLED',
    message: 'Trigger-rule authoring is disabled. Use explicit jurisdiction and applicability configuration.'
  })
})

formsAdminRoutes.patch('/:id/triggers/:triggerId', async (req, res) => {
  return res.status(410).json({
    code: 'FEATURE_DISABLED',
    message: 'Trigger-rule authoring is disabled. Use explicit jurisdiction and applicability configuration.'
  })
})

formsAdminRoutes.delete('/:id/triggers/:triggerId', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const triggerId = req.params.triggerId

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const deleted = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      const result = await q(
        `DELETE FROM forms_admin_triggers
          WHERE tenant_id = $1 AND form_id = $2 AND trigger_id = $3`,
        [tenantId, formId, triggerId]
      )
      if (!result.rowCount) return { code: 'NOT_FOUND' }
      return { deleted: true }
    })
    if (!deleted) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((deleted as any).code === 'LOCKED') return res.status(409).json(deleted)
    if ((deleted as any).code === 'NOT_FOUND') return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(204).end()
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/output', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT * FROM forms_admin_output WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
    })
    return res.json(row.rowCount ? mapOutputRow(row.rows[0]) : null)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/document', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const data = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const [formRes, outputRes, jurisdictionsRes, assetRes] = await Promise.all([
        q(
          `SELECT form_id, carrier_code, authority, form_number, form_title, edition_date,
                  form_type, line_of_business, workflow_status, active
             FROM forms_admin_forms
            WHERE tenant_id = $1 AND form_id = $2
            LIMIT 1`,
          [tenantId, formId]
        ),
        q(
          `SELECT template_source, template_uri, output_format, merge_scope, packet_placement
             FROM forms_admin_output
            WHERE tenant_id = $1 AND form_id = $2
            LIMIT 1`,
          [tenantId, formId]
        ),
        q(
          `SELECT state_code, regulatory_status, effective_date, sunset_date, approval_tracking_id
             FROM forms_admin_jurisdictions
            WHERE tenant_id = $1 AND form_id = $2
            ORDER BY state_code ASC, effective_date ASC`,
          [tenantId, formId]
        ),
        q(
          `SELECT asset_id, file_name, mime_type, size_bytes, content, updated_at
             FROM forms_admin_template_assets
            WHERE tenant_id = $1 AND form_id = $2
            LIMIT 1`,
          [tenantId, formId]
        )
      ])
      if (!formRes.rowCount) return null
      return {
        form: formRes.rows[0],
        output: outputRes.rowCount ? outputRes.rows[0] : null,
        jurisdictions: jurisdictionsRes.rows,
        templateAsset: assetRes.rowCount ? assetRes.rows[0] : null
      }
    })

    if (!data) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Form not found' })
    }

    if (data.templateAsset?.content) {
      const fileName = String(data.templateAsset.file_name || 'form-template.pdf')
      const mimeType = String(data.templateAsset.mime_type || 'application/pdf')
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Content-Disposition', `inline; filename="${sanitizeInlineFileName(fileName)}"`)
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).send(data.templateAsset.content)
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(200).send(buildFormDocumentHtml(data.form, data.output, data.jurisdictions))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/output/template', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT asset_id, file_name, mime_type, size_bytes, created_at, created_by, updated_at, updated_by
           FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      )
    })
    return res.json(row.rowCount ? mapTemplateAssetRow(row.rows[0]) : null)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/:id/output/template', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  const payload = normalizeTemplateAssetPayload(req.body || {})
  if (!payload.fileName || !payload.mimeType || !payload.dataBase64) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'fileName, mimeType, and dataBase64 are required' })
  }
  if (payload.mimeType !== 'application/pdf') {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Only PDF files are supported' })
  }

  const content = decodeBase64ToBuffer(payload.dataBase64)
  if (!content) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Invalid base64 payload' })
  }
  if (content.length === 0) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'Empty file is not allowed' })
  }
  if (content.length > 10 * 1024 * 1024) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'File exceeds 10MB size limit' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        if (!isComplianceAdmin(req)) {
          return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
        }
        if (!reason) {
          return { code: 'INVALID_INPUT', message: 'Reason is required to upload template on approved locked forms' }
        }
      }

      const beforeAssetRes = await q(
        `SELECT asset_id, file_name, mime_type, size_bytes
           FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      )
      const beforeAsset = beforeAssetRes.rowCount ? mapTemplateAssetRow(beforeAssetRes.rows[0]) : null

      const upsert = await q(
        `INSERT INTO forms_admin_template_assets (
            tenant_id, form_id, file_name, mime_type, size_bytes, content, created_by, updated_by, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,now())
         ON CONFLICT (tenant_id, form_id)
         DO UPDATE SET file_name = EXCLUDED.file_name,
                       mime_type = EXCLUDED.mime_type,
                       size_bytes = EXCLUDED.size_bytes,
                       content = EXCLUDED.content,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()
         RETURNING asset_id, file_name, mime_type, size_bytes, created_at, created_by, updated_at, updated_by`,
        [tenantId, formId, payload.fileName, payload.mimeType, content.length, content, actor]
      )

      const assetRow = mapTemplateAssetRow(upsert.rows[0])
      const assetUri = `asset://${assetRow.assetId}`
      await q(
        `INSERT INTO forms_admin_output (
            tenant_id, form_id, template_source, template_uri, output_format, merge_scope, packet_placement,
            sort_order, active, created_by, updated_by, updated_at
         ) VALUES ($1,$2,'Uploaded PDF',$3,'PDF','policy','End',100,true,$4,$4,now())
         ON CONFLICT (tenant_id, form_id)
         DO UPDATE SET template_source = 'Uploaded PDF',
                       template_uri = EXCLUDED.template_uri,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [tenantId, formId, assetUri, actor]
      )

      const correlationId = uuidv4()
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'TemplateAsset',
        entityId: formId,
        eventType: beforeAsset ? 'TEMPLATE_REPLACED' : 'TEMPLATE_UPLOADED',
        correlationId,
        beforeSnapshot: beforeAsset,
        afterSnapshot: assetRow,
        reason: reason || null,
        changedBy: actor
      })

      return assetRow
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    if ((result as any).code === 'INVALID_INPUT') return res.status(400).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.delete('/:id/output/template', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        if (!isComplianceAdmin(req)) {
          return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
        }
        if (!reason) {
          return { code: 'INVALID_INPUT', message: 'Reason is required to delete template on approved locked forms' }
        }
      }

      const beforeRes = await q(
        `SELECT asset_id, file_name, mime_type, size_bytes, created_at, created_by, updated_at, updated_by
           FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [tenantId, formId]
      )
      if (!beforeRes.rowCount) return { deleted: false }
      const beforeAsset = mapTemplateAssetRow(beforeRes.rows[0])

      await q(
        `DELETE FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2`,
        [tenantId, formId]
      )
      await q(
        `UPDATE forms_admin_output
            SET template_source = CASE WHEN template_source = 'Uploaded PDF' THEN 'Static PDF' ELSE template_source END,
                template_uri = CASE WHEN template_uri LIKE 'asset://%' THEN null ELSE template_uri END,
                updated_by = $3,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2`,
        [tenantId, formId, actor]
      )

      const correlationId = uuidv4()
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'TemplateAsset',
        entityId: formId,
        eventType: 'TEMPLATE_DELETED',
        correlationId,
        beforeSnapshot: beforeAsset,
        afterSnapshot: null,
        reason: reason || null,
        changedBy: actor
      })

      return { deleted: true }
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    if ((result as any).code === 'INVALID_INPUT') return res.status(400).json(result)
    if (!(result as any).deleted) return res.status(404).json({ code: 'NOT_FOUND' })
    return res.status(204).end()
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.put('/:id/output', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeOutputPayload(req.body || {})

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      await upsertFormOutput(q, tenantId, formId, actor, payload)
      const row = await q('SELECT * FROM forms_admin_output WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
      return mapOutputRow(row.rows[0])
    })
    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})
formsAdminRoutes.get('/:id/delivery', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT * FROM forms_admin_delivery WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
    })
    return res.json(row.rowCount ? mapDeliveryRow(row.rows[0]) : null)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.put('/:id/delivery', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeDeliveryPayload(req.body || {})

  if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      await upsertFormDelivery(q, tenantId, formId, actor, payload)
      const row = await q('SELECT * FROM forms_admin_delivery WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
      return mapDeliveryRow(row.rows[0])
    })
    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/security', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  try {
    const row = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q('SELECT * FROM forms_admin_security WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
    })
    return res.json(row.rowCount ? mapSecurityRow(row.rows[0]) : null)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.put('/:id/security', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const payload = normalizeSecurityPayload(req.body || {})

  if (!isComplianceAdmin(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const form = await loadFormRow(q, tenantId, formId)
      if (!form) return null
      if (form.workflow_status === 'Approved' && form.edit_lock) {
        return { code: 'LOCKED', message: 'Approved forms are edit-locked. Clone to create a new draft.' }
      }
      await upsertFormSecurity(q, tenantId, formId, actor, payload)
      const row = await q('SELECT * FROM forms_admin_security WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
      return mapSecurityRow(row.rows[0])
    })
    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'LOCKED') return res.status(409).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.get('/:id/audit', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const limit = Math.max(1, Math.min(500, Number(req.query.limit || 100)))
  try {
    const rows = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      return q(
        `SELECT audit_id, form_id, entity_type, entity_id, event_type, correlation_id, before_snapshot,
                after_snapshot, reason, changed_by, changed_at
           FROM forms_admin_audit_events
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY changed_at DESC
          LIMIT $3`,
        [tenantId, formId, limit]
      )
    })
    return res.json(rows.rows.map(mapAuditRow))
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/preview', async (req, res) => {
  const tenantId = req.tenant!.tenantId
  const payload = req.body || {}
  const effectiveDate = parseDateOnly(payload.effectiveDate) || new Date().toISOString().slice(0, 10)
  const lineOfBusiness = normalizeLabel(payload.lineOfBusiness)
  const productCode = normalizeProductCode(payload.productCode)
  const transactionType = normalizeTransactionType(payload.transactionType)
  const stateCode = normalizeCode(payload.state)
  const coverages = normalizeStringArray(payload.coverages).map((item) => item.toUpperCase())
  const attributes = payload.attributes && typeof payload.attributes === 'object' ? payload.attributes : {}
  const uw = payload.uw && typeof payload.uw === 'object' ? payload.uw : {}

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const formsRes = await q(
        `SELECT *
           FROM forms_admin_forms
          WHERE tenant_id = $1
            AND active = true
            AND workflow_status = 'Approved'
          ORDER BY updated_at DESC`,
        [tenantId]
      )
      const formRows = formsRes.rows as FormRow[]
      if (!formRows.length) return []

      const formIds = formRows.map((row) => row.form_id)
      const jurisdictionsRes = await q(
        `SELECT * FROM forms_admin_jurisdictions
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[])`,
        [tenantId, formIds]
      )
      const applicabilityRes = await q(
        `SELECT * FROM forms_admin_applicability
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[]) AND active = true`,
        [tenantId, formIds]
      )
      const outputRes = await q(
        `SELECT * FROM forms_admin_output
          WHERE tenant_id = $1 AND form_id = ANY($2::uuid[])`,
        [tenantId, formIds]
      )

      const jurisdictionsByForm = mapRowsByForm(jurisdictionsRes.rows)
      const applicabilityByForm = mapRowsByForm(applicabilityRes.rows)
      const outputByForm = mapRowsByForm(outputRes.rows)

      const attached: any[] = []
      for (const form of formRows) {
        const reasons: string[] = []
        if (lineOfBusiness && form.line_of_business !== lineOfBusiness) continue

        const jurisdictionRows = jurisdictionsByForm[form.form_id] || []
        const jurisdictionMatch = pickMatchingJurisdiction(jurisdictionRows, stateCode, effectiveDate)
        if (form.require_approved_jurisdiction && !jurisdictionMatch) {
          continue
        }
        if (jurisdictionMatch) {
          reasons.push(`Jurisdiction ${jurisdictionMatch.state_code} approved`)
        }

        const applicabilityRows = applicabilityByForm[form.form_id] || []
        if (!isApplicabilityMatch(applicabilityRows, { lineOfBusiness, productCode, transactionType })) {
          continue
        }
        if (applicabilityRows.length > 0) {
          reasons.push('Applicability matched')
        }

        // Explicit, deterministic matrix only: jurisdiction + applicability + effective window.
        // Coverage/UW/expression trigger inference is intentionally not used in attachment preview.
        if (coverages.length || Object.keys(attributes).length || Object.keys(uw).length) {
          reasons.push('Coverage/UW attributes are ignored in deterministic attachment mode')
        }

        const outputRow = (outputByForm[form.form_id] || [])[0]
        attached.push({
          formId: form.form_id,
          formNumber: form.form_number,
          formTitle: form.form_title,
          editionDate: asDateOnly(form.edition_date),
          authority: form.authority,
          lineOfBusiness: form.line_of_business,
          carrierCode: form.carrier_code,
          packetPlacement: outputRow?.packet_placement || 'End',
          sortOrder: Number(outputRow?.sort_order || 100),
          reasons
        })
      }

      attached.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
        return String(a.formNumber).localeCompare(String(b.formNumber))
      })
      return attached
    })

    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
})

formsAdminRoutes.post('/test-expression', async (req, res) => {
  return res.status(410).json({
    code: 'FEATURE_DISABLED',
    message: 'Expression testing is disabled in deterministic attachment mode.'
  })
})

async function transitionWorkflow(
  req: Request,
  res: any,
  input: { expectedCurrent: (typeof WORKFLOW_STATUSES)[number]; nextStatus: (typeof WORKFLOW_STATUSES)[number]; eventType: string; requireComplianceRole: boolean }
) {
  const tenantId = req.tenant!.tenantId
  const formId = req.params.id
  const actor = currentActor(req)
  const reason = normalizeLabel(req.body?.reason)

  if (input.requireComplianceRole) {
    if (!isComplianceAdmin(req)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Compliance admin role required' })
    }
  } else if (!isFormsEditor(req)) {
    return res.status(403).json({ code: 'FORBIDDEN', message: 'Forms admin role required' })
  }

  if (input.nextStatus === 'Approved' && !reason) {
    return res.status(400).json({ code: 'INVALID_INPUT', message: 'reason is required for approval' })
  }

  try {
    const result = await withTenantTx(tenantId, async (db) => {
      const q = toRawQuery(db)
      const before = await loadFormDetails(q, tenantId, formId)
      if (!before.form) return null
      if (before.form.workflowStatus !== input.expectedCurrent) {
        return {
          code: 'INVALID_STATE',
          message: `Form must be ${input.expectedCurrent} before moving to ${input.nextStatus}`
        }
      }
      await q(
        `UPDATE forms_admin_forms
            SET workflow_status = $3,
                change_reason = $4,
                updated_by = $5,
                updated_at = now()
          WHERE tenant_id = $1 AND form_id = $2`,
        [tenantId, formId, input.nextStatus, reason || null, actor]
      )
      const details = await loadFormDetails(q, tenantId, formId)
      if (!details.form) return { code: 'NOT_FOUND' }
      const correlationId = uuidv4()
      const snapshot = makeVersionSnapshot(details)
      await insertFormVersion(q, tenantId, formId, actor, input.nextStatus, reason || null, correlationId, snapshot)
      await insertAuditEvent(q, {
        tenantId,
        formId,
        entityType: 'Form',
        entityId: formId,
        eventType: input.eventType,
        correlationId,
        beforeSnapshot: makeVersionSnapshot(before),
        afterSnapshot: snapshot,
        reason: reason || null,
        changedBy: actor
      })
      return details
    })

    if (!result) return res.status(404).json({ code: 'NOT_FOUND' })
    if ((result as any).code === 'INVALID_STATE') return res.status(409).json(result)
    return res.json(result)
  } catch (e: any) {
    return res.status(500).json({ code: 'DB_ERROR', message: String(e?.message || e) })
  }
}
async function loadFormDetails(q: QueryFn, tenantId: string, formId: string, includeAudit = false) {
  const formRes = await q('SELECT * FROM forms_admin_forms WHERE tenant_id = $1 AND form_id = $2', [tenantId, formId])
  if (!formRes.rowCount) {
    return { form: null }
  }
  const form = mapFormRow(formRes.rows[0] as FormRow)
  const [jurisdictionsRes, applicabilityRes, triggersRes, outputRes, templateAssetRes, deliveryRes, securityRes, versionsRes, auditRes] = await Promise.all([
    q(
      `SELECT * FROM forms_admin_jurisdictions
        WHERE tenant_id = $1 AND form_id = $2
        ORDER BY state_code, effective_date`,
      [tenantId, formId]
    ),
    q(
      `SELECT * FROM forms_admin_applicability
        WHERE tenant_id = $1 AND form_id = $2
        ORDER BY line_of_business, product_code`,
      [tenantId, formId]
    ),
    q(
      `SELECT * FROM forms_admin_triggers
        WHERE tenant_id = $1 AND form_id = $2
        ORDER BY priority ASC, created_at ASC`,
      [tenantId, formId]
    ),
    q('SELECT * FROM forms_admin_output WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId]),
    q(
      `SELECT asset_id, file_name, mime_type, size_bytes, created_at, created_by, updated_at, updated_by
         FROM forms_admin_template_assets
        WHERE tenant_id = $1 AND form_id = $2
        LIMIT 1`,
      [tenantId, formId]
    ),
    q('SELECT * FROM forms_admin_delivery WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId]),
    q('SELECT * FROM forms_admin_security WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId]),
    q(
      `SELECT version_id, version_no, workflow_status, snapshot, change_reason, created_at, created_by, correlation_id
         FROM forms_admin_versions
        WHERE tenant_id = $1 AND form_id = $2
        ORDER BY version_no DESC`,
      [tenantId, formId]
    ),
    includeAudit
      ? q(
        `SELECT audit_id, entity_type, entity_id, event_type, correlation_id, before_snapshot, after_snapshot,
                reason, changed_by, changed_at
           FROM forms_admin_audit_events
          WHERE tenant_id = $1 AND form_id = $2
          ORDER BY changed_at DESC`,
        [tenantId, formId]
      )
      : Promise.resolve({ rows: [] })
  ])

  return {
    form,
    jurisdictions: jurisdictionsRes.rows.map(mapJurisdictionRow),
    applicability: applicabilityRes.rows.map(mapApplicabilityRow),
    triggers: triggersRes.rows.map(mapTriggerRow),
    output: outputRes.rowCount ? mapOutputRow(outputRes.rows[0]) : null,
    templateAsset: templateAssetRes.rowCount ? mapTemplateAssetRow(templateAssetRes.rows[0]) : null,
    delivery: deliveryRes.rowCount ? mapDeliveryRow(deliveryRes.rows[0]) : null,
    security: securityRes.rowCount ? mapSecurityRow(securityRes.rows[0]) : null,
    versions: versionsRes.rows.map((row: any) => ({
      versionId: row.version_id,
      versionNo: Number(row.version_no || 0),
      workflowStatus: row.workflow_status,
      snapshot: row.snapshot || {},
      changeReason: row.change_reason || null,
      correlationId: row.correlation_id || null,
      createdAt: row.created_at,
      createdBy: row.created_by || null
    })),
    audit: includeAudit ? auditRes.rows.map(mapAuditRow) : []
  }
}

async function loadFormRow(q: QueryFn, tenantId: string, formId: string): Promise<FormRow | null> {
  const row = await q('SELECT * FROM forms_admin_forms WHERE tenant_id = $1 AND form_id = $2 LIMIT 1', [tenantId, formId])
  return row.rowCount ? (row.rows[0] as FormRow) : null
}

async function ensureDefaultFormRows(q: QueryFn, tenantId: string, formId: string, actor: string) {
  await q(
    `INSERT INTO forms_admin_output (tenant_id, form_id, template_source, output_format, merge_scope, packet_placement, sort_order, active, created_by, updated_by, updated_at)
     VALUES ($1,$2,'Static PDF','PDF','policy','End',100,true,$3,$3,now())
     ON CONFLICT (tenant_id, form_id) DO NOTHING`,
    [tenantId, formId, actor]
  )
  await q(
    `INSERT INTO forms_admin_delivery (tenant_id, form_id, delivery_methods, visibility, acknowledgement_required, esign_required, active, created_by, updated_by, updated_at)
     VALUES ($1,$2,ARRAY['Portal']::text[],ARRAY['Insured','Agent','Internal']::text[],false,false,true,$3,$3,now())
     ON CONFLICT (tenant_id, form_id) DO NOTHING`,
    [tenantId, formId, actor]
  )
  await q(
    `INSERT INTO forms_admin_security (tenant_id, form_id, allowed_roles, edit_roles, view_roles, created_by, updated_by, updated_at)
     VALUES (
       $1,$2,
       ARRAY['forms_admin','compliance_admin','read_only']::text[],
       ARRAY['forms_admin','compliance_admin']::text[],
       ARRAY['forms_admin','compliance_admin','read_only','admin']::text[],
       $3,$3,now()
     )
     ON CONFLICT (tenant_id, form_id) DO NOTHING`,
    [tenantId, formId, actor]
  )
}

async function copyFormChildren(q: QueryFn, tenantId: string, sourceFormId: string, targetFormId: string, actor: string) {
  await q(
    `INSERT INTO forms_admin_jurisdictions (
        tenant_id, form_id, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
        has_state_exceptions, notes, created_by, updated_by, updated_at
     )
     SELECT tenant_id, $3, state_code, regulatory_status, approval_tracking_id, effective_date, sunset_date,
            has_state_exceptions, notes, $4, $4, now()
       FROM forms_admin_jurisdictions
      WHERE tenant_id = $1 AND form_id = $2`,
    [tenantId, sourceFormId, targetFormId, actor]
  )

  await q(
    `INSERT INTO forms_admin_applicability (
        tenant_id, form_id, line_of_business, product_code, risk_unit_association, transaction_types,
        active, created_by, updated_by, updated_at
     )
     SELECT tenant_id, $3, line_of_business, product_code, risk_unit_association, transaction_types,
            active, $4, $4, now()
       FROM forms_admin_applicability
      WHERE tenant_id = $1 AND form_id = $2`,
    [tenantId, sourceFormId, targetFormId, actor]
  )

  // Trigger/inference configuration is not copied in deterministic attachment mode.

  await q(
    `INSERT INTO forms_admin_output (
        tenant_id, form_id, template_source, template_uri, output_format, merge_scope, packet_placement,
        sort_order, active, created_by, updated_by, updated_at
     )
     SELECT tenant_id, $3, template_source, template_uri, output_format, merge_scope, packet_placement,
            sort_order, active, $4, $4, now()
       FROM forms_admin_output
      WHERE tenant_id = $1 AND form_id = $2
      ON CONFLICT (tenant_id, form_id) DO UPDATE
            SET template_source = EXCLUDED.template_source,
                template_uri = EXCLUDED.template_uri,
                output_format = EXCLUDED.output_format,
                merge_scope = EXCLUDED.merge_scope,
                packet_placement = EXCLUDED.packet_placement,
                sort_order = EXCLUDED.sort_order,
                active = EXCLUDED.active,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`,
    [tenantId, sourceFormId, targetFormId, actor]
  )

  await q(
    `INSERT INTO forms_admin_delivery (
        tenant_id, form_id, delivery_methods, visibility, acknowledgement_required, esign_required,
        active, created_by, updated_by, updated_at
     )
     SELECT tenant_id, $3, delivery_methods, visibility, acknowledgement_required, esign_required,
            active, $4, $4, now()
       FROM forms_admin_delivery
      WHERE tenant_id = $1 AND form_id = $2
      ON CONFLICT (tenant_id, form_id) DO UPDATE
            SET delivery_methods = EXCLUDED.delivery_methods,
                visibility = EXCLUDED.visibility,
                acknowledgement_required = EXCLUDED.acknowledgement_required,
                esign_required = EXCLUDED.esign_required,
                active = EXCLUDED.active,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`,
    [tenantId, sourceFormId, targetFormId, actor]
  )

  await q(
    `INSERT INTO forms_admin_security (
        tenant_id, form_id, allowed_roles, edit_roles, view_roles, created_by, updated_by, updated_at
     )
     SELECT tenant_id, $3, allowed_roles, edit_roles, view_roles, $4, $4, now()
       FROM forms_admin_security
      WHERE tenant_id = $1 AND form_id = $2
      ON CONFLICT (tenant_id, form_id) DO UPDATE
            SET allowed_roles = EXCLUDED.allowed_roles,
                edit_roles = EXCLUDED.edit_roles,
                view_roles = EXCLUDED.view_roles,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()`,
    [tenantId, sourceFormId, targetFormId, actor]
  )
}

async function ensureUniqueFormIdentity(
  q: QueryFn,
  input: {
    tenantId: string
    carrierCode: string
    authority: string
    formNumber: string
    editionDate: string
    excludeFormId?: string
  }
) {
  const params: any[] = [input.tenantId, input.carrierCode, input.authority, input.formNumber, input.editionDate]
  let sql = `SELECT 1
               FROM forms_admin_forms
              WHERE tenant_id = $1
                AND carrier_code = $2
                AND authority = $3
                AND form_number = $4
                AND edition_date = $5`
  if (input.excludeFormId) {
    sql += ' AND form_id <> $6'
    params.push(input.excludeFormId)
  }
  sql += ' LIMIT 1'
  const existing = await q(sql, params)
  if (existing.rowCount > 0) {
    const error: any = new Error(
      `Form identity already exists for ${input.carrierCode}/${input.authority}/${input.formNumber}/${input.editionDate}`
    )
    error.code = 'FORM_IDENTITY_EXISTS'
    throw error
  }
}

async function ensureNoJurisdictionOverlap(
  q: QueryFn,
  input: {
    tenantId: string
    formId: string
    stateCode: string
    effectiveDate: string
    sunsetDate?: string | null
    excludeJurisdictionId?: string
  }
) {
  const rows = await q(
    `SELECT jurisdiction_id, effective_date, sunset_date
       FROM forms_admin_jurisdictions
      WHERE tenant_id = $1
        AND form_id = $2
        AND state_code = $3`,
    [input.tenantId, input.formId, input.stateCode]
  )
  const nextStart = input.effectiveDate
  const nextEnd = input.sunsetDate || DEFAULT_FUTURE_DATE
  for (const row of rows.rows) {
    if (input.excludeJurisdictionId && row.jurisdiction_id === input.excludeJurisdictionId) continue
    const currentStart = parseDateOnly(row.effective_date)
    const currentEnd = parseDateOnly(row.sunset_date) || DEFAULT_FUTURE_DATE
    if (!currentStart) continue
    if (nextStart <= currentEnd && currentStart <= nextEnd) {
      const error: any = new Error(`Overlapping effective range for state ${input.stateCode}`)
      error.code = 'JURISDICTION_OVERLAP'
      throw error
    }
  }
}

async function insertFormVersion(
  q: QueryFn,
  tenantId: string,
  formId: string,
  actor: string,
  workflowStatus: string,
  changeReason: string | null,
  correlationId: string,
  snapshot: any
) {
  const current = await q(
    'SELECT COALESCE(MAX(version_no), 0) AS max_version FROM forms_admin_versions WHERE tenant_id = $1 AND form_id = $2',
    [tenantId, formId]
  )
  const nextVersion = Number(current.rows[0]?.max_version || 0) + 1
  await q(
    `INSERT INTO forms_admin_versions (
        tenant_id, form_id, version_no, workflow_status, snapshot, change_reason, created_by, correlation_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, formId, nextVersion, workflowStatus, snapshot, changeReason, actor, correlationId]
  )
}

async function insertAuditEvent(
  q: QueryFn,
  input: {
    tenantId: string
    formId?: string | null
    entityType: string
    entityId: string
    eventType: string
    correlationId: string
    beforeSnapshot: any
    afterSnapshot: any
    reason: string | null
    changedBy: string
  }
) {
  await q(
    `INSERT INTO forms_admin_audit_events (
        tenant_id, form_id, entity_type, entity_id, event_type, correlation_id,
        before_snapshot, after_snapshot, reason, changed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.tenantId,
      input.formId || null,
      input.entityType,
      input.entityId,
      input.eventType,
      input.correlationId,
      input.beforeSnapshot,
      input.afterSnapshot,
      input.reason,
      input.changedBy
    ]
  )
}

function mapRowsByForm(rows: any[]): Record<string, any[]> {
  const grouped: Record<string, any[]> = {}
  for (const row of rows) {
    const key = String(row.form_id || '')
    if (!key) continue
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(row)
  }
  return grouped
}

function mapFormSummaryRow(row: any) {
  return {
    formId: row.form_id,
    carrierCode: row.carrier_code,
    authority: row.authority,
    formNumber: row.form_number,
    formTitle: row.form_title,
    editionDate: asDateOnly(row.edition_date),
    formType: row.form_type,
    lineOfBusiness: row.line_of_business,
    workflowStatus: row.workflow_status,
    active: row.active,
    changeReason: row.change_reason || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null,
    hasApprovedJurisdiction: Boolean(row.has_approved_jurisdiction),
    jurisdictionCount: Number(row.jurisdiction_count || 0),
    applicabilityCount: Number(row.applicability_count || 0),
    triggerCount: Number(row.trigger_count || 0)
  }
}

function mapFormRow(row: FormRow) {
  return {
    formId: row.form_id,
    carrierCode: row.carrier_code,
    authority: row.authority,
    formNumber: row.form_number,
    formTitle: row.form_title,
    editionDate: asDateOnly(row.edition_date),
    formType: row.form_type,
    lineOfBusiness: row.line_of_business,
    workflowStatus: row.workflow_status,
    active: row.active,
    changeReason: row.change_reason || null,
    previousFormId: row.previous_form_id || null,
    editLock: row.edit_lock,
    requireApprovedJurisdiction: row.require_approved_jurisdiction,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapJurisdictionRow(row: any) {
  return {
    jurisdictionId: row.jurisdiction_id,
    stateCode: row.state_code,
    regulatoryStatus: row.regulatory_status,
    approvalTrackingId: row.approval_tracking_id || '',
    effectiveDate: asDateOnly(row.effective_date),
    sunsetDate: asDateOnly(row.sunset_date),
    hasStateExceptions: Boolean(row.has_state_exceptions),
    notes: row.notes || '',
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapApplicabilityRow(row: any) {
  return {
    applicabilityId: row.applicability_id,
    lineOfBusiness: row.line_of_business,
    productCode: row.product_code,
    riskUnitAssociation: row.risk_unit_association,
    transactionTypes: normalizeStringArray(row.transaction_types || []),
    active: Boolean(row.active),
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapTriggerRow(row: any) {
  return {
    triggerId: row.trigger_id,
    triggerType: row.trigger_type,
    conditionExpression: row.condition_expression || '',
    suppressExpression: row.suppress_expression || '',
    priority: Number(row.priority || 100),
    active: Boolean(row.active),
    createdAt: row.created_at,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapOutputRow(row: any) {
  return {
    outputId: row.output_id,
    templateSource: row.template_source,
    templateUri: row.template_uri || '',
    outputFormat: row.output_format,
    mergeScope: row.merge_scope,
    packetPlacement: row.packet_placement,
    sortOrder: Number(row.sort_order || 100),
    active: Boolean(row.active),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapTemplateAssetRow(row: any) {
  return {
    assetId: row.asset_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    createdAt: row.created_at || null,
    createdBy: row.created_by || null,
    updatedAt: row.updated_at || null,
    updatedBy: row.updated_by || null
  }
}

function mapDeliveryRow(row: any) {
  return {
    deliveryId: row.delivery_id,
    deliveryMethods: normalizeStringArray(row.delivery_methods || []),
    visibility: normalizeStringArray(row.visibility || []),
    acknowledgementRequired: Boolean(row.acknowledgement_required),
    esignRequired: Boolean(row.esign_required),
    active: Boolean(row.active),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapSecurityRow(row: any) {
  return {
    securityId: row.security_id,
    allowedRoles: normalizeStringArray(row.allowed_roles || []),
    editRoles: normalizeStringArray(row.edit_roles || []),
    viewRoles: normalizeStringArray(row.view_roles || []),
    updatedAt: row.updated_at,
    updatedBy: row.updated_by || null
  }
}

function mapAuditRow(row: any) {
  return {
    auditId: row.audit_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    correlationId: row.correlation_id,
    beforeSnapshot: row.before_snapshot || null,
    afterSnapshot: row.after_snapshot || null,
    reason: row.reason || null,
    changedBy: row.changed_by || null,
    changedAt: row.changed_at
  }
}

function makeVersionSnapshot(details: any) {
  return {
    form: details?.form || null,
    jurisdictions: Array.isArray(details?.jurisdictions) ? details.jurisdictions : [],
    applicability: Array.isArray(details?.applicability) ? details.applicability : [],
    triggers: Array.isArray(details?.triggers) ? details.triggers : [],
    output: details?.output || null,
    delivery: details?.delivery || null,
    security: details?.security || null
  }
}
function normalizeFormPayload(input: any) {
  return {
    carrierCode: input?.carrierCode != null ? normalizeCode(input.carrierCode) : undefined,
    authority: input?.authority != null ? normalizeLabel(input.authority) : undefined,
    formNumber: input?.formNumber != null ? normalizeFormNumber(input.formNumber) : undefined,
    formTitle: input?.formTitle != null ? normalizeLabel(input.formTitle) : undefined,
    editionDate: input?.editionDate != null ? parseEditionDate(input.editionDate) : undefined,
    formType: input?.formType != null ? normalizeLabel(input.formType) : undefined,
    lineOfBusiness: input?.lineOfBusiness != null ? normalizeLabel(input.lineOfBusiness) : undefined,
    workflowStatus: normalizeWorkflowStatus(input?.workflowStatus) || 'Draft',
    active: Boolean(input?.active),
    changeReason: normalizeLabel(input?.changeReason),
    previousFormId: normalizeUuid(input?.previousFormId),
    editLock: input?.editLock == null ? true : Boolean(input.editLock),
    requireApprovedJurisdiction:
      input?.requireApprovedJurisdiction == null ? true : Boolean(input.requireApprovedJurisdiction),
    metadata: input?.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  }
}

function validateCreateFormPayload(payload: ReturnType<typeof normalizeFormPayload>): string | null {
  if (!payload.carrierCode) return 'carrierCode is required'
  if (!payload.authority) return 'authority is required'
  if (!payload.formNumber) return 'formNumber is required'
  if (!payload.formTitle) return 'formTitle is required'
  if (!payload.editionDate) return 'editionDate is required (MM/YYYY or YYYY-MM-DD)'
  if (!payload.formType) return 'formType is required'
  if (!payload.lineOfBusiness) return 'lineOfBusiness is required'
  if (!WORKFLOW_STATUSES.includes(payload.workflowStatus as any)) return 'workflowStatus is invalid'
  return null
}

function normalizeJurisdictionPayload(input: any) {
  return {
    stateCode: input?.stateCode != null ? normalizeCode(input.stateCode) : undefined,
    regulatoryStatus: normalizeRegulatoryStatus(input?.regulatoryStatus) || 'Pending',
    approvalTrackingId: normalizeLabel(input?.approvalTrackingId),
    effectiveDate: input?.effectiveDate != null ? parseDateOnly(input.effectiveDate) : undefined,
    sunsetDate: input?.sunsetDate != null && String(input.sunsetDate).trim() ? parseDateOnly(input.sunsetDate) : undefined,
    hasStateExceptions: Boolean(input?.hasStateExceptions),
    notes: normalizeLabel(input?.notes)
  }
}

function validateJurisdictionPayload(payload: ReturnType<typeof normalizeJurisdictionPayload>): string | null {
  if (!payload.stateCode) return 'stateCode is required'
  if (!payload.regulatoryStatus) return 'regulatoryStatus is required'
  if (!REGULATORY_STATUSES.includes(payload.regulatoryStatus as any)) return 'regulatoryStatus is invalid'
  if (!payload.effectiveDate) return 'effectiveDate is required'
  if (payload.sunsetDate && payload.sunsetDate <= payload.effectiveDate) return 'sunsetDate must be after effectiveDate'
  return null
}

function normalizeApplicabilityPayload(input: any) {
  return {
    lineOfBusiness: normalizeLabel(input?.lineOfBusiness),
    productCode: normalizeProductCode(input?.productCode),
    riskUnitAssociation: normalizeRiskUnitAssociation(input?.riskUnitAssociation) || 'Policy',
    transactionTypes: normalizeTransactionTypeArray(input?.transactionTypes),
    active: input?.active == null ? true : Boolean(input.active)
  }
}

function validateApplicabilityPayload(payload: ReturnType<typeof normalizeApplicabilityPayload>): string | null {
  if (!payload.lineOfBusiness) return 'lineOfBusiness is required'
  if (!payload.productCode) return 'productCode is required'
  if (!payload.riskUnitAssociation) return 'riskUnitAssociation is required'
  if (!RISK_UNIT_ASSOCIATIONS.includes(payload.riskUnitAssociation as any)) return 'riskUnitAssociation is invalid'
  return null
}

function normalizeTriggerPayload(input: any) {
  return {
    triggerType: normalizeTriggerType(input?.triggerType) || 'Always',
    conditionExpression: normalizeLabel(input?.conditionExpression),
    suppressExpression: normalizeLabel(input?.suppressExpression),
    priority: Number.isFinite(Number(input?.priority)) ? Number(input.priority) : 100,
    active: input?.active == null ? true : Boolean(input.active)
  }
}

function validateTriggerPayload(payload: ReturnType<typeof normalizeTriggerPayload>): string | null {
  if (!payload.triggerType) return 'triggerType is required'
  if (!TRIGGER_TYPES.includes(payload.triggerType as any)) return 'triggerType is invalid'
  if (payload.triggerType !== 'Always' && !payload.conditionExpression) {
    return 'conditionExpression is required for this trigger type'
  }
  return null
}

function normalizeOutputPayload(input: any) {
  return {
    templateSource: normalizeLabel(input?.templateSource) || 'Static PDF',
    templateUri: normalizeLabel(input?.templateUri),
    outputFormat: normalizeLabel(input?.outputFormat) || 'PDF',
    mergeScope: normalizeLabel(input?.mergeScope) || 'policy',
    packetPlacement: normalizeLabel(input?.packetPlacement) || 'End',
    sortOrder: Number.isFinite(Number(input?.sortOrder)) ? Number(input.sortOrder) : 100,
    active: input?.active == null ? true : Boolean(input.active)
  }
}

function normalizeDeliveryPayload(input: any) {
  return {
    deliveryMethods: normalizeStringArray(input?.deliveryMethods || ['Portal']),
    visibility: normalizeStringArray(input?.visibility || ['Insured', 'Agent', 'Internal']),
    acknowledgementRequired: Boolean(input?.acknowledgementRequired),
    esignRequired: Boolean(input?.esignRequired),
    active: input?.active == null ? true : Boolean(input.active)
  }
}

function normalizeSecurityPayload(input: any) {
  return {
    allowedRoles: normalizeStringArray(input?.allowedRoles || ['forms_admin', 'compliance_admin', 'read_only']),
    editRoles: normalizeStringArray(input?.editRoles || ['forms_admin', 'compliance_admin']),
    viewRoles: normalizeStringArray(input?.viewRoles || ['forms_admin', 'compliance_admin', 'read_only', 'admin'])
  }
}

async function upsertFormOutput(
  q: QueryFn,
  tenantId: string,
  formId: string,
  actor: string,
  payload: ReturnType<typeof normalizeOutputPayload>
) {
  await q(
    `INSERT INTO forms_admin_output (
        tenant_id, form_id, template_source, template_uri, output_format, merge_scope, packet_placement,
        sort_order, active, created_by, updated_by, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,now())
     ON CONFLICT (tenant_id, form_id)
     DO UPDATE SET template_source = EXCLUDED.template_source,
                   template_uri = EXCLUDED.template_uri,
                   output_format = EXCLUDED.output_format,
                   merge_scope = EXCLUDED.merge_scope,
                   packet_placement = EXCLUDED.packet_placement,
                   sort_order = EXCLUDED.sort_order,
                   active = EXCLUDED.active,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()`,
    [
      tenantId,
      formId,
      payload.templateSource,
      payload.templateUri || null,
      payload.outputFormat,
      payload.mergeScope,
      payload.packetPlacement,
      payload.sortOrder,
      payload.active,
      actor
    ]
  )
}

async function upsertFormDelivery(
  q: QueryFn,
  tenantId: string,
  formId: string,
  actor: string,
  payload: ReturnType<typeof normalizeDeliveryPayload>
) {
  await q(
    `INSERT INTO forms_admin_delivery (
        tenant_id, form_id, delivery_methods, visibility, acknowledgement_required, esign_required,
        active, created_by, updated_by, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,now())
     ON CONFLICT (tenant_id, form_id)
     DO UPDATE SET delivery_methods = EXCLUDED.delivery_methods,
                   visibility = EXCLUDED.visibility,
                   acknowledgement_required = EXCLUDED.acknowledgement_required,
                   esign_required = EXCLUDED.esign_required,
                   active = EXCLUDED.active,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()`,
    [
      tenantId,
      formId,
      payload.deliveryMethods,
      payload.visibility,
      payload.acknowledgementRequired,
      payload.esignRequired,
      payload.active,
      actor
    ]
  )
}

async function upsertFormSecurity(
  q: QueryFn,
  tenantId: string,
  formId: string,
  actor: string,
  payload: ReturnType<typeof normalizeSecurityPayload>
) {
  await q(
    `INSERT INTO forms_admin_security (
        tenant_id, form_id, allowed_roles, edit_roles, view_roles, created_by, updated_by, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$6,now())
     ON CONFLICT (tenant_id, form_id)
     DO UPDATE SET allowed_roles = EXCLUDED.allowed_roles,
                   edit_roles = EXCLUDED.edit_roles,
                   view_roles = EXCLUDED.view_roles,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()`,
    [tenantId, formId, payload.allowedRoles, payload.editRoles, payload.viewRoles, actor]
  )
}

function pickMatchingJurisdiction(rows: any[], stateCode: string, effectiveDate: string): any | null {
  const approved = rows.filter((row) => row.regulatory_status === 'Approved')
  for (const row of approved) {
    const rowState = String(row.state_code || '')
    const eff = parseDateOnly(row.effective_date)
    const sunset = parseDateOnly(row.sunset_date) || DEFAULT_FUTURE_DATE
    if (!eff) continue
    if (stateCode && rowState !== stateCode && rowState !== 'ALL') continue
    if (eff <= effectiveDate && effectiveDate <= sunset) {
      return row
    }
  }
  return null
}

function isApplicabilityMatch(
  rows: any[],
  input: { lineOfBusiness: string; productCode: string; transactionType: string }
): boolean {
  if (!rows.length) return true
  return rows.some((row) => {
    const lobOk = !input.lineOfBusiness || String(row.line_of_business || '') === input.lineOfBusiness
    const productOk = !input.productCode || String(row.product_code || '') === input.productCode
    const txValues = normalizeTransactionTypeArray(row.transaction_types || [])
    const txOk = !input.transactionType || !txValues.length || txValues.includes(input.transactionType as any)
    return lobOk && productOk && txOk && row.active !== false
  })
}

function evaluateTriggers(
  rows: any[],
  input: { coverages: string[]; attributes: Record<string, any>; uw: Record<string, any>; transactionType: string }
): { attach: boolean; reason: string } {
  if (!rows.length) return { attach: true, reason: 'No trigger rules configured' }
  const coveragesSet = new Set(input.coverages.map((item) => item.toUpperCase()))
  let attached = false
  let suppressed = false
  let reason = ''

  for (const row of rows) {
    const suppressExpression = normalizeLabel(row.suppress_expression)
    if (suppressExpression) {
      const suppress = evaluateExpression(suppressExpression, input)
      if (suppress.result) {
        suppressed = true
        reason = `Suppressed by rule #${row.trigger_id}`
        break
      }
    }

    const triggerType = String(row.trigger_type || 'Always')
    const expression = normalizeLabel(row.condition_expression)
    let matched = false
    if (triggerType === 'Always') {
      matched = true
    } else if (triggerType === 'Coverage Selected') {
      if (expression) {
        const tokens = expression
          .split(/[|,]/)
          .map((token) => token.trim().toUpperCase())
          .filter(Boolean)
        matched = tokens.some((token) => coveragesSet.has(token))
      }
    } else if (expression) {
      matched = evaluateExpression(expression, input).result
    }

    if (matched) {
      attached = true
      reason = `${triggerType} matched`
      break
    }
  }

  if (suppressed) return { attach: false, reason }
  return { attach: attached, reason: attached ? reason : 'No trigger rule matched' }
}

function evaluateExpression(
  expression: string,
  input: { coverages: string[]; attributes: Record<string, any>; uw: Record<string, any>; transactionType: string }
): { result: boolean; error?: string } {
  try {
    const fn = new Function(
      'coverages',
      'attributes',
      'uw',
      'transactionType',
      `return Boolean(${expression});`
    ) as (coverages: string[], attributes: Record<string, any>, uw: Record<string, any>, transactionType: string) => boolean
    return { result: Boolean(fn(input.coverages, input.attributes, input.uw, input.transactionType)) }
  } catch (e: any) {
    return { result: false, error: String(e?.message || e) }
  }
}

function normalizeLabel(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ')
}

function normalizeCode(value: unknown): string {
  return normalizeLabel(value).toUpperCase()
}

function normalizeFormNumber(value: unknown): string {
  return normalizeLabel(value).toUpperCase()
}

function normalizeProductCode(value: unknown): string {
  return normalizeLabel(value).toLowerCase()
}

function parseDateOnly(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10)
  }
  const raw = normalizeLabel(value)
  if (!raw) return null
  const iso = /^(\d{4}-\d{2}-\d{2})T/.exec(raw)
  if (iso) return iso[1]
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

function asDateOnly(value: unknown): string {
  return _asDateOnly(value) ?? ''
}

function parseEditionDate(value: unknown): string | null {
  const raw = normalizeLabel(value)
  if (!raw) return null
  const m1 = /^(\d{2})\/(\d{4})$/.exec(raw)
  if (m1) {
    const mm = Number(m1[1])
    if (mm < 1 || mm > 12) return null
    return `${m1[2]}-${m1[1]}-01`
  }
  const m2 = /^(\d{4})-(\d{2})$/.exec(raw)
  if (m2) {
    const mm = Number(m2[2])
    if (mm < 1 || mm > 12) return null
    return `${m2[1]}-${m2[2]}-01`
  }
  const m3 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (m3) {
    const mm = Number(m3[2])
    if (mm < 1 || mm > 12) return null
    return `${m3[1]}-${m3[2]}-01`
  }
  return null
}

function normalizeWorkflowStatus(value: unknown): (typeof WORKFLOW_STATUSES)[number] | '' {
  const raw = normalizeLabel(value)
  if (!raw) return ''
  const match = WORKFLOW_STATUSES.find((item) => item.toLowerCase() === raw.toLowerCase())
  return match || ''
}

function normalizeRegulatoryStatus(value: unknown): (typeof REGULATORY_STATUSES)[number] | '' {
  const raw = normalizeLabel(value)
  if (!raw) return ''
  const match = REGULATORY_STATUSES.find((item) => item.toLowerCase() === raw.toLowerCase())
  return match || ''
}

function normalizeTriggerType(value: unknown): (typeof TRIGGER_TYPES)[number] | '' {
  const raw = normalizeLabel(value)
  if (!raw) return ''
  const match = TRIGGER_TYPES.find((item) => item.toLowerCase() === raw.toLowerCase())
  return match || ''
}

function normalizeRiskUnitAssociation(value: unknown): (typeof RISK_UNIT_ASSOCIATIONS)[number] | '' {
  const raw = normalizeLabel(value)
  if (!raw) return ''
  const match = RISK_UNIT_ASSOCIATIONS.find((item) => item.toLowerCase() === raw.toLowerCase())
  return match || ''
}

function normalizeTransactionType(value: unknown): (typeof TRANSACTION_TYPES)[number] | '' {
  const raw = normalizeLabel(value)
  if (!raw) return ''
  const lookup: Record<string, (typeof TRANSACTION_TYPES)[number]> = {
    quote: 'Quote',
    bind: 'Bind',
    issue: 'Issue',
    endorsement: 'Endorsement',
    endorse: 'Endorsement',
    renewal: 'Renewal',
    renew: 'Renewal',
    cancellation: 'Cancellation',
    cancel: 'Cancellation',
    reinstatement: 'Reinstatement',
    reinstate: 'Reinstatement',
    rewrite: 'Rewrite'
  }
  return lookup[raw.toLowerCase()] || ''
}

function normalizeTransactionTypeArray(value: unknown): string[] {
  const values = normalizeStringArray(value)
  const mapped = values
    .map((item) => normalizeTransactionType(item))
    .filter(Boolean)
  return Array.from(new Set(mapped))
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => normalizeLabel(item))
        .filter(Boolean)
    )
  )
}

function buildFormDocumentHtml(form: any, output: any, jurisdictions: any[]): string {
  const formNumber = escapeHtml(String(form?.form_number || ''))
  const formTitle = escapeHtml(String(form?.form_title || ''))
  const authority = escapeHtml(String(form?.authority || ''))
  const carrierCode = escapeHtml(String(form?.carrier_code || ''))
  const editionDate = escapeHtml(formatDisplayDate(form?.edition_date))
  const lineOfBusiness = escapeHtml(String(form?.line_of_business || ''))
  const formType = escapeHtml(String(form?.form_type || ''))
  const status = escapeHtml(String(form?.workflow_status || 'Draft'))
  const active = form?.active ? 'Yes' : 'No'
  const templateSource = escapeHtml(String(output?.template_source || 'Static PDF'))
  const templateUri = String(output?.template_uri || '').trim()
  const outputFormat = escapeHtml(String(output?.output_format || 'PDF'))
  const mergeScope = escapeHtml(String(output?.merge_scope || 'policy'))
  const packetPlacement = escapeHtml(String(output?.packet_placement || 'End'))

  const jurisdictionRows = Array.isArray(jurisdictions) ? jurisdictions : []
  const jurisdictionHtml = jurisdictionRows.length
    ? jurisdictionRows
      .map((row) => {
        const stateCode = escapeHtml(String(row.state_code || ''))
        const regulatoryStatus = escapeHtml(String(row.regulatory_status || 'Pending'))
        const effectiveDate = escapeHtml(formatDisplayDate(row.effective_date))
        const sunsetDate = escapeHtml(formatDisplayDate(row.sunset_date) || '-')
        const approvalId = escapeHtml(String(row.approval_tracking_id || '-'))
        return `<tr>
          <td>${stateCode}</td>
          <td>${regulatoryStatus}</td>
          <td>${effectiveDate}</td>
          <td>${sunsetDate}</td>
          <td>${approvalId}</td>
        </tr>`
      })
      .join('')
    : '<tr><td colspan="5">No jurisdictions configured.</td></tr>'

  const templateLink = templateUri && /^https?:\/\//i.test(templateUri)
    ? `<a href="${escapeHtml(templateUri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(templateUri)}</a>`
    : (templateUri ? escapeHtml(templateUri) : 'Not configured')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Form ${formNumber}</title>
  <style>
    :root { color-scheme: light; }
    body { font-family: Arial, sans-serif; margin: 24px; color: #1e2a44; }
    h1 { margin: 0 0 8px; font-size: 26px; }
    h2 { margin: 26px 0 10px; font-size: 18px; border-bottom: 1px solid #ccd4e3; padding-bottom: 6px; }
    .meta-grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 8px 16px; }
    .meta-item { background: #f7f9fe; border: 1px solid #dbe3f2; border-radius: 8px; padding: 10px; }
    .meta-item strong { display: block; font-size: 12px; color: #5c6b87; margin-bottom: 4px; text-transform: uppercase; letter-spacing: .03em; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #dbe3f2; padding: 8px 10px; text-align: left; font-size: 14px; }
    th { background: #eef2fb; color: #3d4d6d; }
    .note { margin-top: 18px; padding: 10px 12px; border: 1px solid #dbe3f2; border-radius: 8px; background: #f7f9fe; color: #4d5f80; }
  </style>
</head>
<body>
  <h1>${formNumber} - ${formTitle}</h1>
  <div class="meta-grid">
    <div class="meta-item"><strong>Edition Date</strong>${editionDate}</div>
    <div class="meta-item"><strong>Authority</strong>${authority}</div>
    <div class="meta-item"><strong>Carrier Code</strong>${carrierCode}</div>
    <div class="meta-item"><strong>Line Of Business</strong>${lineOfBusiness}</div>
    <div class="meta-item"><strong>Form Type</strong>${formType}</div>
    <div class="meta-item"><strong>Status</strong>${status} (Active: ${active})</div>
  </div>

  <h2>Output Configuration</h2>
  <div class="meta-grid">
    <div class="meta-item"><strong>Template Source</strong>${templateSource}</div>
    <div class="meta-item"><strong>Output Format</strong>${outputFormat}</div>
    <div class="meta-item"><strong>Merge Scope</strong>${mergeScope}</div>
    <div class="meta-item"><strong>Packet Placement</strong>${packetPlacement}</div>
    <div class="meta-item" style="grid-column: span 2;"><strong>Template URI</strong>${templateLink}</div>
  </div>

  <h2>Jurisdiction Approvals</h2>
  <table>
    <thead>
      <tr>
        <th>State</th>
        <th>Regulatory Status</th>
        <th>Effective</th>
        <th>Sunset</th>
        <th>Approval ID</th>
      </tr>
    </thead>
    <tbody>
      ${jurisdictionHtml}
    </tbody>
  </table>

  <p class="note">
    Document rendering is generated from configured metadata. Replace template URI with your filed form document source to show official carrier content.
  </p>
</body>
</html>`
}

function formatDisplayDate(value: unknown): string {
  const raw = parseDateOnly(value)
  if (!raw) return ''
  const [year, month, day] = raw.split('-')
  return `${month}/${day}/${year}`
}

function escapeHtml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}



function normalizeTemplateAssetPayload(input: any) {
  return {
    fileName: normalizeLabel(input?.fileName),
    mimeType: normalizeLabel(input?.mimeType).toLowerCase(),
    dataBase64: String(input?.dataBase64 || '').trim()
  }
}

function decodeBase64ToBuffer(value: string): Buffer | null {
  if (!value) return null
  try {
    const normalized = value.replace(/\s+/g, '')
    const buffer = Buffer.from(normalized, 'base64')
    if (!buffer.length) return null
    const compareA = normalized.replace(/=+$/g, '')
    const compareB = buffer.toString('base64').replace(/=+$/g, '')
    if (compareA !== compareB) return null
    return buffer
  } catch {
    return null
  }
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (value == null || value === '') return null
  const text = String(value).trim().toLowerCase()
  if (text === 'true') return true
  if (text === 'false') return false
  return null
}

function normalizeUuid(value: unknown): string | null {
  const raw = normalizeLabel(value)
  if (!raw) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null
}

function currentActor(req: Request): string {
  return req.user?.username || 'system'
}

function hasRole(req: Request, role: string): boolean {
  const roles = req.user?.roles || []
  return roles.includes(role) || roles.includes('admin')
}

function isFormsEditor(req: Request): boolean {
  return (
    hasPermission(req, 'admin.forms.manage') ||
    hasPermission(req, 'admin.forms.approve') ||
    hasRole(req, 'forms_admin') ||
    hasRole(req, 'compliance_admin')
  )
}

function isComplianceAdmin(req: Request): boolean {
  return hasPermission(req, 'admin.forms.approve') || hasRole(req, 'compliance_admin') || hasRole(req, 'admin')
}
