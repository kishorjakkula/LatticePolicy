import { buildFormAttachmentContext, evaluateFormTriggers, FormAttachmentContextError, validateFormTriggerDefinition } from '@lattice-policy/rules'
import { AppError, BadRequestError } from '../errors/domain.errors.js'
import { loadFieldMeta, loadProductConfig } from '../lib/products.js'
import { listProductPackDirs } from '../lib/product-registry.js'
import { validationFieldCatalog } from './validation-rules.service.js'

export type AttachmentField = {
  path: string
  expressionPath: string
  label: string
  type: string
  group: string
  values?: unknown[]
}

const EXTRA_FIELDS: AttachmentField[] = [
  { path: 'transaction.type', expressionPath: 'transaction.type', label: 'Transaction type', type: 'string', group: 'Transaction' },
  { path: 'transaction.stage', expressionPath: 'transaction.stage', label: 'New-business stage (not set on endorsements, cancellations and other servicing transactions)', type: 'string', group: 'Transaction', values: ['Bind', 'Issue'] },
  { path: 'policy.policyNumber', expressionPath: 'policy.policyNumber', label: 'Policy number', type: 'string', group: 'Policy' },
  { path: 'policy.status', expressionPath: 'policy.status', label: 'Policy status', type: 'string', group: 'Policy' },
  { path: 'premium.total', expressionPath: 'premium.total', label: 'Transaction premium', type: 'number', group: 'Premium' },
  { path: 'payload.customFields', expressionPath: 'payload.customFields', label: 'Carrier custom fields', type: 'object', group: 'Carrier fields' },
]

/** Metadata only: never query policy/customer records to populate the picker. */
export function formAttachmentFields(tenantId: string, productCode?: string) {
  const fields: AttachmentField[] = validationFieldCatalog(tenantId, productCode).map(field => ({
    path: field.path,
    expressionPath: field.path.startsWith('transaction.') ? field.path : `payload.${field.path.replace(/\[\*\]/g, '.0')}`,
    label: field.label,
    type: 'unknown',
    group: field.area,
  }))
  fields.push(...EXTRA_FIELDS)
  const installed = listProductPackDirs().find(entry => entry.code === String(productCode || '').toLowerCase())
  if (installed) {
    for (const field of loadFieldMeta(installed.code, tenantId)) {
      if (typeof field?.path !== 'string' || /(?:^|\.)(?:__proto__|constructor|prototype|password|secret|token)(?:\.|$)/i.test(field.path)) continue
      fields.push({ path: field.path, expressionPath: `payload.${field.path.replace(/\[\*\]/g, '.0')}`, label: field.label || field.path, type: field.type || 'unknown', group: field.ui?.group || 'Product fields', ...(Array.isArray(field.enum) ? { values: field.enum } : {}) })
    }
    const config = loadProductConfig(installed.code)
    for (const coverage of Array.isArray(config?.coverages) ? config.coverages : []) {
      const code = String(coverage?.code || '')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(code)) continue
      for (const [name, type] of [['selected', 'boolean'], ['limit', 'number'], ['deductible', 'number']]) {
        fields.push({ path: `coverages.${code}.${name}`, expressionPath: `coverages.${code}.${name}`, label: `${coverage.name || code}: ${name}`, type, group: 'Coverage' })
      }
    }
  }
  return {
    fields: [...new Map(fields.filter(field => {
      try { validateFormTriggerDefinition({ triggerType: 'Expression', conditionExpression: `isSet(${field.expressionPath})` }); return true } catch { return false }
    }).map(field => [field.expressionPath, field])).values()],
    contextRoots: ['payload', 'quote', 'risk', 'risks', 'coverages', 'coverageCodes', 'applicant', 'insureds', 'additionalInterests', 'uwAnswers', 'qualificationAnswers', 'transaction', 'policy', 'premium', 'attributes', 'uw'],
  }
}

type FormAttachmentInput = Parameters<typeof buildFormAttachmentContext>[0]
type FormAttachmentContextSource = FormAttachmentInput | (() => Record<string, unknown>)

/**
 * Builds the transaction's rule context at most once, on first use, however many
 * forms are evaluated. Failures name the policy data, not the form configuration.
 */
export function lazyFormAttachmentContext(input: FormAttachmentInput): () => Record<string, unknown> {
  let context: Record<string, unknown> | undefined
  return () => {
    if (context) return context
    try {
      context = buildFormAttachmentContext(input)
    } catch (error) {
      if (error instanceof FormAttachmentContextError && error.reason === 'limits') {
        throw new AppError(422, 'FORM_ATTACHMENT_CONTEXT_TOO_LARGE', 'This policy has more data than form attachment rules can safely evaluate, so its documents were not generated. Contact support.')
      }
      throw new AppError(422, 'FORM_ATTACHMENT_CONTEXT_INVALID', 'The policy data for this transaction could not be prepared for form attachment rules.')
    }
    return context
  }
}

/** Legacy, previously disabled rows stay inert until explicitly re-authored. */
export function evaluateConfiguredFormAttachment(metadata: unknown, rows: unknown[], source: FormAttachmentContextSource) {
  if (!metadata || typeof metadata !== 'object' || (metadata as Record<string, unknown>).attachmentRulesVersion !== 1) {
    return { attach: true, reason: 'Explicit applicability matched', matchedRuleIds: [] as string[] }
  }
  if (!rows.some(row => row && typeof row === 'object' && (row as Record<string, unknown>).active !== false)) {
    return { attach: false, reason: 'No active attachment rules', matchedRuleIds: [] as string[] }
  }
  const context = (typeof source === 'function' ? source : lazyFormAttachmentContext(source))()
  try {
    return evaluateFormTriggers(rows as Parameters<typeof evaluateFormTriggers>[0], context)
  } catch {
    throw new BadRequestError('FORM_ATTACHMENT_RULE_INVALID', 'A configured form attachment rule could not be evaluated. Correct the form configuration before generating documents.')
  }
}
