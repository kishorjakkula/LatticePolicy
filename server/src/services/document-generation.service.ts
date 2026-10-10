import crypto from 'crypto'
import { v4 as uuidv4 } from '../uuid.js'
import { toRawQuery, type DrizzleDB } from '../db.js'
import { BadRequestError } from '../errors/domain.errors.js'
import { logger } from '../logger.js'
import {
  getDocumentStorageAdapter,
  renderAndStoreDocument,
  retrieveAndVerifyStoredDocument,
} from './document-storage.service.js'
import {
  DOCX_TEMPLATE_MIME_TYPE,
  extractDocxPlaceholderTokens,
  renderDocxTemplate,
  resolveDocumentTemplateVariables,
  sha256Bytes,
  validateDocxPlaceholderTokens,
} from './document-template-variables.js'

export type PolicyDocumentTransactionType =
  | 'NB'
  | 'Issue'
  | 'Endorse'
  | 'Cancel'
  | 'Reinstate'
  | 'Rewrite'
  | 'Renew'
  | 'NonRenewal'

export type PolicyDocumentContext = {
  tenantId: string
  policyId: string
  policyNumber?: string | null
  transactionId: string
  transactionType: PolicyDocumentTransactionType
  transactionNumber?: string | null
  productCode: string
  state?: string | null
  effectiveDate: string
  generatedBy?: string | null
  correlationId?: string | null
  endorsementChanges?: EndorsementChangeSet | null
  versionId?: string | null
  generatedAt?: string | null
  inputSnapshot?: unknown
  requiredFormCodes?: string[]
  requiredDeliveryMethods?: string[]
}

export type EndorsementChangeType = 'added' | 'removed' | 'modified'

export type EndorsementChangeSet = {
  changedPaths: string[]
  addedCoverageCodes: string[]
  removedCoverageCodes: string[]
  modifiedCoverageCodes: string[]
}

export type EndorsementChangeCriteria = {
  alwaysAttachOnEndorsement?: boolean
  match?: 'any' | 'all'
  coverageCodes?: string[]
  changeTypes?: EndorsementChangeType[]
  changedPathPatterns?: string[]
}

export type SelectedPolicyForm = {
  policyFormId: string
  formId: string | null
  code: string
  title: string
  edition: string | null
  formType: string | null
  source: 'forms_admin' | 'forms_catalog'
  visibility: string[]
  customerSafe: boolean
  sortOrder: number
  metadata: Record<string, unknown>
}

export type GeneratedPolicyDocument = {
  documentId: string
  type: 'POLICY_PACKET' | 'POLICY_FORM_DOCUMENT'
  uri: string
  hash: string
  metadata: Record<string, unknown>
}

export type PolicyDocumentPacket = {
  forms: SelectedPolicyForm[]
  documents: GeneratedPolicyDocument[]
}

type QueryFn = ReturnType<typeof toRawQuery>

const CUSTOMER_VISIBILITY = new Set(['customer', 'insured', 'portal'])

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`
}

function sha256(value: unknown): string {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function normalizeText(value: unknown): string {
  return String(value || '').trim()
}

function normalizeTransactionType(type: string): string {
  const normalized = normalizeText(type).toLowerCase()
  if (normalized === 'issue' || normalized === 'newbusiness' || normalized === 'new_business') return 'nb'
  if (normalized === 'endorsement') return 'endorse'
  if (normalized === 'cancellation') return 'cancel'
  if (normalized === 'reinstatement') return 'reinstate'
  if (normalized === 'renewal') return 'renew'
  if (normalized === 'nonrenewal' || normalized === 'non-renewal' || normalized === 'non_renewal') return 'nonrenewal'
  return normalized
}

function matchesTransactionType(transactionTypes: unknown, transactionType: string): boolean {
  const normalized = normalizeTransactionType(transactionType)
  const values = Array.isArray(transactionTypes) ? transactionTypes : []
  if (!values.length) return true
  return values.some((value) => normalizeTransactionType(String(value)) === normalized)
}

function isCustomerSafe(visibility: string[]): boolean {
  return visibility.map((item) => item.toLowerCase()).some((item) => CUSTOMER_VISIBILITY.has(item))
}

function editionToString(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

function coverageMap(payload: any): Map<string, any> {
  const entries = Array.isArray(payload?.coverages) ? payload.coverages : []
  const result = new Map<string, any>()
  for (const coverage of entries) {
    const code = normalizeText(coverage?.code || coverage?.coverageCode).toUpperCase()
    if (code) result.set(code, coverage)
  }
  return result
}

export function buildEndorsementChangeSet(
  previousPayload: any,
  nextPayload: any,
  changedPaths: string[] = []
): EndorsementChangeSet {
  const previous = coverageMap(previousPayload)
  const next = coverageMap(nextPayload)
  const addedCoverageCodes: string[] = []
  const removedCoverageCodes: string[] = []
  const modifiedCoverageCodes: string[] = []

  for (const [code, coverage] of next) {
    if (!previous.has(code)) addedCoverageCodes.push(code)
    else if (stableStringify(previous.get(code)) !== stableStringify(coverage)) modifiedCoverageCodes.push(code)
  }
  for (const code of previous.keys()) {
    if (!next.has(code)) removedCoverageCodes.push(code)
  }

  return {
    changedPaths: [...new Set(changedPaths.map(normalizeText).filter(Boolean))].sort(),
    addedCoverageCodes: addedCoverageCodes.sort(),
    removedCoverageCodes: removedCoverageCodes.sort(),
    modifiedCoverageCodes: modifiedCoverageCodes.sort(),
  }
}

function pathMatches(pattern: string, path: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+')
  return new RegExp(`^${escaped}$`).test(path)
}

export function matchesEndorsementChanges(
  criteria: EndorsementChangeCriteria | null | undefined,
  changes: EndorsementChangeSet | null | undefined
): boolean {
  if (!criteria || typeof criteria !== 'object') return false
  if (criteria.alwaysAttachOnEndorsement === true) return true
  if (!changes) return false

  const coverageCodes = (criteria.coverageCodes || []).map((code) => normalizeText(code).toUpperCase()).filter(Boolean)
  const changeTypes = (criteria.changeTypes || []).filter((type) => ['added', 'removed', 'modified'].includes(type))
  const pathPatterns = (criteria.changedPathPatterns || []).map(normalizeText).filter(Boolean)
  if (!coverageCodes.length && !changeTypes.length && !pathPatterns.length) return false

  const changedByType: Record<EndorsementChangeType, string[]> = {
    added: changes.addedCoverageCodes,
    removed: changes.removedCoverageCodes,
    modified: changes.modifiedCoverageCodes,
  }
  const changedCoverageCodes = new Set(Object.values(changedByType).flat())
  const checks: boolean[] = []
  if (coverageCodes.length && changeTypes.length) {
    checks.push(changeTypes.some((type) => coverageCodes.some((code) => changedByType[type].includes(code))))
  } else if (coverageCodes.length) {
    checks.push(coverageCodes.some((code) => changedCoverageCodes.has(code)))
  } else if (changeTypes.length) {
    checks.push(changeTypes.some((type) => changedByType[type].length > 0))
  }
  if (pathPatterns.length) checks.push(pathPatterns.some((pattern) => changes.changedPaths.some((path) => pathMatches(pattern, path))))
  return criteria.match === 'all' ? checks.every(Boolean) : checks.some(Boolean)
}

function buildPacketDocument(context: PolicyDocumentContext, forms: SelectedPolicyForm[]): GeneratedPolicyDocument[] {
  if (!forms.length) return []
  const generatedAt = context.generatedAt || `${context.effectiveDate}T00:00:00.000Z`
  const visibility = forms.every((form) => form.customerSafe) ? ['internal', 'customer'] : ['internal']
  const inputSnapshot = context.inputSnapshot ?? null
  const formSnapshot = forms.map((form) => ({
    formId: form.formId,
    sourceFormId: form.metadata.sourceFormId || null,
    code: form.code,
    title: form.title,
    edition: form.edition,
    source: form.source,
    customerSafe: form.customerSafe,
    metadata: form.metadata,
  }))
  const requiredDeliveryMethods = [...new Set([
    ...(context.requiredDeliveryMethods || []),
    ...forms.flatMap((form) => Array.isArray(form.metadata.deliveryMethods) ? form.metadata.deliveryMethods as string[] : []),
  ].map(normalizeText).filter(Boolean))].sort()
  const metadata = {
    packetSchemaVersion: 'policy-packet.v2',
    policyId: context.policyId,
    versionId: context.versionId || null,
    policyNumber: context.policyNumber || null,
    transactionId: context.transactionId,
    transactionType: context.transactionType,
    transactionNumber: context.transactionNumber || null,
    productCode: context.productCode,
    state: context.state || null,
    effectiveDate: context.effectiveDate,
    generatedAt,
    generatedBy: context.generatedBy || null,
    correlationId: context.correlationId || null,
    endorsementChanges: context.endorsementChanges || null,
    inputSnapshot,
    inputHash: sha256(inputSnapshot),
    formSetHash: sha256(formSnapshot),
    requiredFormCodes: (context.requiredFormCodes || []).map(normalizeText).filter(Boolean).sort(),
    requiredDeliveryMethods,
    deliveryEvidence: requiredDeliveryMethods.map((method) => ({ method, status: 'Pending', recordedAt: null })),
    visibility,
    customerSafe: visibility.includes('customer'),
    forms: formSnapshot,
  }
  return [
    {
      documentId: uuidv4(),
      type: 'POLICY_PACKET',
      uri: `generated://policy-packet/${context.policyId}/${context.transactionId}`,
      hash: sha256(metadata),
      metadata,
    },
  ]
}

async function attachRenderedArtifact(
  context: PolicyDocumentContext,
  forms: SelectedPolicyForm[],
  document: GeneratedPolicyDocument
): Promise<GeneratedPolicyDocument> {
  const artifact = await renderAndStoreDocument({
    tenantId: context.tenantId,
    documentId: document.documentId,
    metadata: {
      policyId: context.policyId,
      policyNumber: context.policyNumber,
      transactionId: context.transactionId,
      transactionType: context.transactionType,
      transactionNumber: context.transactionNumber,
      productCode: context.productCode,
      state: context.state,
      effectiveDate: context.effectiveDate,
      generatedAt: String((document.metadata as any).generatedAt || new Date().toISOString()),
      forms: forms.map((form) => ({
        code: form.code,
        title: form.title,
        edition: form.edition,
        source: form.source,
        customerSafe: form.customerSafe,
      })),
    },
  })
  const verified = await retrieveAndVerifyStoredDocument(artifact.storageUri, artifact.contentHash)
  if (!verified) {
    throw new BadRequestError(
      'DOCUMENT_ARTIFACT_VERIFICATION_FAILED',
      'The generated policy packet could not be verified after storage.'
    )
  }
  return {
    ...document,
    hash: artifact.contentHash,
    metadata: {
      ...document.metadata,
      artifact: {
        storageUri: artifact.storageUri,
        contentType: artifact.contentType,
        byteSize: artifact.byteSize,
        storageAdapter: artifact.storageAdapter,
        renderedAt: artifact.renderedAt,
      },
    },
  }
}

export async function selectPolicyForms(
  q: QueryFn,
  context: PolicyDocumentContext
): Promise<SelectedPolicyForm[]> {
  const productCode = normalizeText(context.productCode)
  const state = normalizeText(context.state).toUpperCase()
  const effectiveDate = context.effectiveDate

  // Forms-applicability matching here must use the same semantics as
  // `isPreviewApplicabilityMatch` in forms.service.ts: a form with ZERO rows in
  // forms_admin_applicability has no declared scoping at all, so it is treated as
  // matching every submission (see that function's comment for the full rationale).
  // Previously this used an INNER JOIN, which silently excluded every zero-row form
  // from the actual bound/issued packet even though the Wizard's live preview would
  // show it as "will attach" — a form could show up in the preview and then never
  // attach for real. The LEFT JOIN below restores that parity:
  //   - a.form_id IS NOT NULL:      an applicability row exists and matches this
  //                                 product (unchanged from before).
  //   - has_app.form_id IS NULL:    the form has NO applicability rows at all
  //                                 (for ANY product), so per the zero-rows rule it
  //                                 matches — but only once scoped against the
  //                                 form's own `line_of_business`, which in this
  //                                 schema is populated with the same value as
  //                                 `product_code` (see forms_admin seed/fixture
  //                                 data). This is the "upstream line-of-business
  //                                 filtering" previewForm's caller performs via its
  //                                 own `lineOfBusiness` request field; selectPolicyForms
  //                                 has no separate lineOfBusiness input, so it uses
  //                                 productCode as that equivalent scoping value.
  // A form that HAS applicability rows, but only for a different product, is still
  // correctly excluded (a.form_id IS NULL AND has_app.form_id IS NOT NULL).
  const adminRows = await q(
    `SELECT f.form_id, f.form_number, f.form_title, f.edition_date, f.form_type,
            a.transaction_types, a.endorsement_change_criteria, o.output_format, o.packet_placement, o.sort_order,
            d.visibility, d.delivery_methods, j.state_code, j.regulatory_status, f.metadata
       FROM forms_admin_forms f
       LEFT JOIN forms_admin_applicability a
         ON a.tenant_id = f.tenant_id AND a.form_id = f.form_id AND a.active = true
        AND lower(a.product_code) = lower($2)
       LEFT JOIN (
         SELECT DISTINCT form_id FROM forms_admin_applicability
          WHERE tenant_id = $1 AND active = true
       ) has_app
         ON has_app.form_id = f.form_id
       LEFT JOIN forms_admin_output o
         ON o.tenant_id = f.tenant_id AND o.form_id = f.form_id AND o.active = true
       LEFT JOIN forms_admin_delivery d
         ON d.tenant_id = f.tenant_id AND d.form_id = f.form_id AND d.active = true
       LEFT JOIN forms_admin_jurisdictions j
         ON j.tenant_id = f.tenant_id
        AND j.form_id = f.form_id
        AND ($3::text = '' OR upper(j.state_code) = $3)
        AND j.effective_date <= $4::date
        AND (j.sunset_date IS NULL OR j.sunset_date >= $4::date)
      WHERE f.tenant_id = $1
        AND f.active = true
        AND lower(f.workflow_status) IN ('approved', 'active', 'filed')
        AND (
          a.form_id IS NOT NULL
          OR (has_app.form_id IS NULL AND lower(f.line_of_business) = lower($2))
        )
      ORDER BY COALESCE(o.sort_order, 100), f.form_number`,
    [context.tenantId, productCode, state, effectiveDate]
  )

  const forms: SelectedPolicyForm[] = []
  const seen = new Set<string>()
  for (const row of adminRows.rows as any[]) {
    if (!matchesTransactionType(row.transaction_types, context.transactionType)) continue
    if (normalizeTransactionType(context.transactionType) === 'endorse' &&
        !matchesEndorsementChanges(row.endorsement_change_criteria, context.endorsementChanges)) continue
    if (state && row.state_code && !['approved', 'active', 'filed'].includes(String(row.regulatory_status || '').toLowerCase())) continue
    const code = normalizeText(row.form_number)
    if (!code || seen.has(`admin:${row.form_id}`)) continue
    const visibility = Array.isArray(row.visibility) && row.visibility.length ? row.visibility.map(String) : ['internal']
    seen.add(`admin:${row.form_id}`)
    forms.push({
      policyFormId: uuidv4(),
      formId: null,
      code,
      title: normalizeText(row.form_title),
      edition: editionToString(row.edition_date),
      formType: row.form_type || null,
      source: 'forms_admin',
      visibility,
      customerSafe: isCustomerSafe(visibility),
      sortOrder: Number(row.sort_order || 100),
      metadata: {
        source: 'forms_admin',
        sourceFormId: row.form_id || null,
        packetPlacement: row.packet_placement || 'End',
        outputFormat: row.output_format || 'PDF',
        deliveryMethods: Array.isArray(row.delivery_methods) ? row.delivery_methods.map(String) : [],
        formMetadata: row.metadata || {},
        endorsementChangeCriteria: row.endorsement_change_criteria || null,
      },
    })
  }

  const catalogRows = await q(
    `SELECT form_id, code, edition, name, jurisdiction, applicability, render
       FROM forms_catalog
      WHERE tenant_id = $1
        AND active = true
        AND lower(COALESCE(applicability->>'productCode', applicability->>'product', '')) = lower($2)
      ORDER BY code`,
    [context.tenantId, productCode]
  )

  for (const row of catalogRows.rows as any[]) {
    const applicability = row.applicability || {}
    if (!matchesTransactionType(applicability.transactionTypes || applicability.transactions, context.transactionType)) continue
    if (normalizeTransactionType(context.transactionType) === 'endorse' &&
        !matchesEndorsementChanges(applicability.endorsementChanges, context.endorsementChanges)) continue
    const formState = normalizeText(row.jurisdiction?.state || row.jurisdiction?.region || applicability.state).toUpperCase()
    if (state && formState && formState !== state) continue
    const code = normalizeText(row.code)
    if (!code || seen.has(`catalog:${row.form_id}`)) continue
    const visibility = Array.isArray(applicability.visibility) && applicability.visibility.length
      ? applicability.visibility.map(String)
      : ['internal']
    seen.add(`catalog:${row.form_id}`)
    forms.push({
      policyFormId: uuidv4(),
      formId: row.form_id || null,
      code,
      title: normalizeText(row.name),
      edition: editionToString(row.edition),
      formType: normalizeText(applicability.formType) || null,
      source: 'forms_catalog',
      visibility,
      customerSafe: isCustomerSafe(visibility),
      sortOrder: Number(applicability.sortOrder || 100),
      metadata: {
        source: 'forms_catalog',
        render: row.render || {},
        endorsementChangeCriteria: applicability.endorsementChanges || null,
      },
    })
  }

  return forms.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
}

// For each selected form sourced from forms_admin that has an uploaded
// .docx template asset (as opposed to the existing PDF-template path, which
// this never touches), parses the template's placeholders, confirms they are
// all recognized catalog tokens (uploads with unrecognized tokens are already
// rejected at upload time in forms-admin.routes.ts, but this is re-checked
// defensively in case a template was uploaded before that validation
// existed), resolves this specific policy's real data, substitutes the
// placeholders, and stores the filled .docx as a generated document artifact
// via the same storage adapter + sha256 hash-and-verify model the PDF packet
// above uses. A form with a PDF template, or no template at all, is
// completely unaffected: this only ever *adds* documents, never changes the
// PDF packet path. Any failure for an individual form (unparseable template,
// render error, storage/verification failure) is logged and that form is
// skipped rather than failing the whole packet.
async function buildFilledFormDocuments(
  q: QueryFn,
  context: PolicyDocumentContext,
  forms: SelectedPolicyForm[]
): Promise<GeneratedPolicyDocument[]> {
  const candidates = forms.filter((form) => form.source === 'forms_admin' && form.metadata.sourceFormId)
  if (!candidates.length) return []

  const documents: GeneratedPolicyDocument[] = []
  for (const form of candidates) {
    const sourceFormId = String(form.metadata.sourceFormId)
    try {
      const assetRes = await q(
        `SELECT mime_type, content
           FROM forms_admin_template_assets
          WHERE tenant_id = $1 AND form_id = $2
          LIMIT 1`,
        [context.tenantId, sourceFormId]
      )
      if (!assetRes.rowCount) continue
      const asset = assetRes.rows[0]
      if (String(asset.mime_type || '').toLowerCase() !== DOCX_TEMPLATE_MIME_TYPE) continue

      const templateContent: Buffer = Buffer.isBuffer(asset.content) ? asset.content : Buffer.from(asset.content)
      const tokens = extractDocxPlaceholderTokens(templateContent)
      const { unrecognized } = validateDocxPlaceholderTokens(tokens)
      if (unrecognized.length) {
        logger.warn(
          { formId: sourceFormId, unrecognized },
          'Skipping form template with unrecognized placeholder token(s) at document-generation time'
        )
        continue
      }

      const variables = await resolveDocumentTemplateVariables(q, {
        tenantId: context.tenantId,
        policyId: context.policyId,
        versionId: context.versionId,
        policyNumber: context.policyNumber,
        productCode: context.productCode,
        state: context.state,
        effectiveDate: context.effectiveDate,
        transactionType: context.transactionType,
        transactionNumber: context.transactionNumber,
        payload: context.inputSnapshot,
      })
      const filled = renderDocxTemplate(templateContent, variables)
      const documentId = uuidv4()
      const renderedAt = new Date().toISOString()
      const { storageUri } = await getDocumentStorageAdapter().store({
        tenantId: context.tenantId,
        documentId,
        fileName: `${documentId}.docx`,
        contentType: DOCX_TEMPLATE_MIME_TYPE,
        content: filled,
      })
      const contentHash = sha256Bytes(filled)
      const verified = await retrieveAndVerifyStoredDocument(storageUri, contentHash)
      if (!verified) {
        logger.warn(
          { formId: sourceFormId, policyId: context.policyId },
          'Filled form document failed verification after storage; skipping'
        )
        continue
      }

      documents.push({
        documentId,
        type: 'POLICY_FORM_DOCUMENT',
        uri: storageUri,
        hash: contentHash,
        metadata: {
          policyId: context.policyId,
          versionId: context.versionId || null,
          transactionId: context.transactionId,
          transactionType: context.transactionType,
          formId: sourceFormId,
          code: form.code,
          title: form.title,
          edition: form.edition,
          recognizedTokens: tokens,
          artifact: {
            storageUri,
            contentType: DOCX_TEMPLATE_MIME_TYPE,
            byteSize: filled.length,
            storageAdapter: getDocumentStorageAdapter().name,
            renderedAt,
          },
        },
      })
    } catch (err) {
      logger.warn({ err, formId: sourceFormId }, 'Failed to render filled form document from docx template; skipping')
    }
  }
  return documents
}

export async function buildPolicyDocumentPacket(
  q: QueryFn,
  context: PolicyDocumentContext
): Promise<PolicyDocumentPacket> {
  const forms = await selectPolicyForms(q, context)
  const selectedCodes = new Set(forms.map((form) => form.code.toUpperCase()))
  const missingRequiredForms = (context.requiredFormCodes || [])
    .map(normalizeText).filter(Boolean)
    .filter((code) => !selectedCodes.has(code.toUpperCase()))
  if (missingRequiredForms.length) {
    throw new BadRequestError(
      'DOCUMENT_PACKET_INCOMPLETE',
      `Missing required forms: ${missingRequiredForms.join(', ')}`
    )
  }
  const documents = await Promise.all(
    buildPacketDocument(context, forms).map((document) => attachRenderedArtifact(context, forms, document))
  )
  const formDocuments = await buildFilledFormDocuments(q, context, forms)
  return { forms, documents: [...documents, ...formDocuments] }
}

export async function persistPolicyDocumentPacket(
  db: DrizzleDB,
  context: PolicyDocumentContext,
  packet: PolicyDocumentPacket
): Promise<void> {
  if (!packet.forms.length && !packet.documents.length) return
  const q = toRawQuery(db)

  for (const form of packet.forms) {
    const formSnapshot = {
      title: form.title,
      edition: form.edition,
      formType: form.formType,
      visibility: form.visibility,
      customerSafe: form.customerSafe,
      metadata: form.metadata,
    }
    await q(
      `INSERT INTO policy_forms
        (policy_form_id, tenant_id, policy_id, transaction_id, form_id, code, edition, snapshot_hash, data, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)`,
      [
        form.policyFormId,
        context.tenantId,
        context.policyId,
        context.transactionId,
        form.formId,
        form.code,
        form.edition,
        sha256(formSnapshot),
        JSON.stringify(formSnapshot),
        JSON.stringify(form.metadata),
      ]
    )
  }

  for (const doc of packet.documents) {
    await q(
      `INSERT INTO documents
        (document_id, tenant_id, policy_id, transaction_id, version_id, type, uri, hash,
         input_hash, form_set_hash, integrity_status, delivery_evidence, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'VERIFIED', $11::jsonb, $12::jsonb, $13)`,
      [
        doc.documentId,
        context.tenantId,
        context.policyId,
        context.transactionId,
        (doc.metadata as any).versionId || context.versionId || null,
        doc.type,
        doc.uri,
        doc.hash,
        (doc.metadata as any).inputHash || null,
        (doc.metadata as any).formSetHash || null,
        JSON.stringify((doc.metadata as any).deliveryEvidence || []),
        JSON.stringify(doc.metadata),
        context.generatedBy || null,
      ]
    )
  }
}
