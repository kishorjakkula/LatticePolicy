import { z } from 'zod'
import {
  VALIDATION_LEVELS,
  VALIDATION_SCREENS,
  VALIDATION_TRANSACTIONS,
  evaluateValidationRules,
  levelRequiresAcknowledgement,
  unacknowledgedWarnings,
  validationRuleProblems,
  type ValidationExtras,
  type ValidationLevel,
  type ValidationOutcome,
  type ValidationRule,
  type ValidationTransaction,
} from '@lattice-policy/rules'
import { withTenantTx, toRawQuery } from '../db.js'
import { buildRiskFields, loadProductConfig } from '../lib/products.js'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors/domain.errors.js'

/**
 * Carrier-configured validation rules (migration 066). The rule language and
 * evaluation live in @lattice-policy/rules so the wizard shows exactly what
 * the API enforces. This service stores rules, records every change, serves
 * the rules for a screen, and enforces them at rate, bind and issue for every
 * transaction.
 */
type Q = (sql: string, params?: any[]) => Promise<any>

const ruleInput = z
  .object({
    ruleCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,59}$/, 'Use 2-60 letters, digits, - or _')),
    name: z.string().trim().min(1).max(200),
    kind: z.enum(['required', 'condition']),
    fieldPath: z.string().trim().max(300).nullish(),
    condition: z.string().trim().max(2000).nullish(),
    appliesWhen: z.string().trim().max(2000).nullish(),
    levels: z.array(z.enum(VALIDATION_LEVELS)).min(1),
    transactionTypes: z.array(z.enum(['common', 'new_business', 'endorsement', 'cancellation', 'reinstatement', 'renewal', 'rewrite', 'non_renewal'])).min(1),
    productCode: z.string().trim().max(80).nullish(),
    stateCode: z
      .string()
      .trim()
      .transform((value) => value.toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}$/))
      .nullish()
      .or(z.literal('')),
    screen: z.enum(VALIDATION_SCREENS).nullish(),
    severity: z.enum(['error', 'warning']),
    message: z.string().trim().min(1).max(500),
    effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    expirationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    active: z.boolean().default(true),
  })
  .strict()
export type ValidationRuleInput = z.infer<typeof ruleInput>

const blankToNull = (value: string | null | undefined) => (value && String(value).trim() ? String(value).trim() : null)
const dateOnly = (value: unknown) => (value ? new Date(value as any).toISOString().slice(0, 10) : null)

export function mapRule(row: any): ValidationRule & { ruleId: string; version: number; updatedBy: string | null; updatedAt: string } {
  return {
    ruleId: row.rule_id,
    ruleCode: row.rule_code,
    name: row.name,
    kind: row.kind,
    fieldPath: row.field_path,
    condition: row.condition,
    appliesWhen: row.applies_when,
    levels: row.levels,
    transactionTypes: row.transaction_types,
    productCode: row.product_code,
    stateCode: row.state_code ? String(row.state_code).trim() : null,
    screen: row.screen,
    severity: row.severity,
    message: row.message,
    effectiveDate: dateOnly(row.effective_date),
    expirationDate: dateOnly(row.expiration_date),
    active: row.active,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }
}

function parseRule(body: unknown): ValidationRuleInput {
  const parsed = ruleInput.safeParse(body)
  if (!parsed.success) throw new ValidationError('INVALID_VALIDATION_RULE', parsed.error.flatten())
  const input = {
    ...parsed.data,
    fieldPath: blankToNull(parsed.data.fieldPath),
    condition: blankToNull(parsed.data.condition),
    appliesWhen: blankToNull(parsed.data.appliesWhen),
    productCode: blankToNull(parsed.data.productCode),
    stateCode: blankToNull(parsed.data.stateCode || null),
    screen: parsed.data.levels.includes('screen') ? parsed.data.screen || null : null,
    levels: [...new Set(parsed.data.levels)],
    transactionTypes: [...new Set(parsed.data.transactionTypes)],
  }
  const problems = validationRuleProblems(input as Partial<ValidationRule>)
  if (problems.length) throw new ValidationError('INVALID_VALIDATION_RULE', { problems })
  return input
}

async function audit(q: Q, tenantId: string, rule: { rule_id: string; rule_code: string }, action: string, actor: string, before: unknown, after: unknown) {
  await q(
    `INSERT INTO validation_rule_audit(tenant_id,rule_id,rule_code,action,actor,before,after) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [tenantId, rule.rule_id, rule.rule_code, action, actor, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null],
  )
}

export async function listValidationRules(tenantId: string) {
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q('SELECT * FROM validation_rules WHERE tenant_id=$1 ORDER BY rule_code', [tenantId])
    return result.rows.map(mapRule)
  })
}

export async function getValidationRuleHistory(tenantId: string, ruleId: string) {
  if (!z.string().uuid().safeParse(ruleId).success) throw new NotFoundError('VALIDATION_RULE_NOT_FOUND')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const result = await q(
      'SELECT action, actor, before, after, created_at FROM validation_rule_audit WHERE tenant_id=$1 AND rule_id=$2 ORDER BY created_at DESC',
      [tenantId, ruleId],
    )
    return result.rows.map((row: any) => ({ action: row.action, actor: row.actor, before: row.before, after: row.after, createdAt: row.created_at }))
  })
}

const COLUMNS = `rule_code,name,kind,field_path,condition,applies_when,levels,transaction_types,product_code,state_code,screen,severity,message,effective_date,expiration_date,active`
function values(input: ValidationRuleInput) {
  return [
    input.ruleCode,
    input.name,
    input.kind,
    input.fieldPath,
    input.condition,
    input.appliesWhen,
    input.levels,
    input.transactionTypes,
    input.productCode,
    input.stateCode,
    input.screen,
    input.severity,
    input.message,
    input.effectiveDate || new Date().toISOString().slice(0, 10),
    input.expirationDate || null,
    input.active,
  ]
}

export async function createValidationRule(tenantId: string, actor: string, body: unknown) {
  const input = parseRule(body)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    try {
      const result = await q(
        `INSERT INTO validation_rules(tenant_id,${COLUMNS},created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`,
        [tenantId, ...values(input), actor],
      )
      const rule = mapRule(result.rows[0])
      await audit(q, tenantId, result.rows[0], 'CREATED', actor, null, rule)
      return rule
    } catch (error: any) {
      if (error?.code === '23505') throw new ConflictError('VALIDATION_RULE_EXISTS', `Rule code ${input.ruleCode} already exists`)
      throw error
    }
  })
}

export async function updateValidationRule(tenantId: string, actor: string, ruleId: string, body: unknown) {
  if (!z.string().uuid().safeParse(ruleId).success) throw new NotFoundError('VALIDATION_RULE_NOT_FOUND')
  const input = parseRule(body)
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const current = await q('SELECT * FROM validation_rules WHERE tenant_id=$1 AND rule_id=$2 FOR UPDATE', [tenantId, ruleId])
    if (!current.rows[0]) throw new NotFoundError('VALIDATION_RULE_NOT_FOUND')
    if (current.rows[0].rule_code !== input.ruleCode)
      throw new ConflictError('VALIDATION_RULE_CODE_IMMUTABLE', 'A rule code cannot change; create a new rule instead')
    const result = await q(
      `UPDATE validation_rules SET (${COLUMNS}) = ($3,$4,$5,$6,$7,$8,$9::text[],$10::text[],$11,$12,$13,$14,$15,$16,$17,$18),
         version=version+1, updated_by=$19, updated_at=now()
       WHERE tenant_id=$1 AND rule_id=$2 RETURNING *`,
      [tenantId, ruleId, ...values(input), actor],
    )
    const rule = mapRule(result.rows[0])
    await audit(q, tenantId, result.rows[0], 'UPDATED', actor, mapRule(current.rows[0]), rule)
    return rule
  })
}

export async function deleteValidationRule(tenantId: string, actor: string, ruleId: string) {
  if (!z.string().uuid().safeParse(ruleId).success) throw new NotFoundError('VALIDATION_RULE_NOT_FOUND')
  return withTenantTx(tenantId, async (db) => {
    const q = toRawQuery(db)
    const current = await q('DELETE FROM validation_rules WHERE tenant_id=$1 AND rule_id=$2 RETURNING *', [tenantId, ruleId])
    if (!current.rows[0]) throw new NotFoundError('VALIDATION_RULE_NOT_FOUND')
    await audit(q, tenantId, current.rows[0], 'DELETED', actor, mapRule(current.rows[0]), null)
    return { deleted: true }
  })
}

/** Active rules that can apply to a product and state (level/transaction filtering happens at evaluation). */
export async function loadActiveRules(q: Q, tenantId: string, productCode?: string | null, stateCode?: string | null): Promise<Array<ReturnType<typeof mapRule>>> {
  const result = await q(
    `SELECT * FROM validation_rules
      WHERE tenant_id=$1 AND active=true
        AND (product_code IS NULL OR product_code=$2)
        AND (state_code IS NULL OR state_code=$3)
      ORDER BY rule_code`,
    [tenantId, productCode || '', String(stateCode || '').toUpperCase()],
  )
  return result.rows.map(mapRule)
}

/** Rules for the wizard to evaluate as the user types. */
export async function applicableValidationRules(tenantId: string, query: { productCode?: string; state?: string; transaction?: string }) {
  return withTenantTx(tenantId, async (db) => loadActiveRules(toRawQuery(db), tenantId, query.productCode, query.state))
}

export type EnforcementInput = {
  level: ValidationLevel
  transactionType: ValidationTransaction
  payload: any
  extras?: ValidationExtras
  acknowledged?: unknown
  entity?: { type: 'quote' | 'policy'; id: string } | null
  actor: string
  asOf?: string | null
}

export function acknowledgedCodes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((code): code is string => typeof code === 'string' && code.length <= 60).slice(0, 200) : []
}

/**
 * Checks the rules for one level of one transaction. Errors stop the step.
 * At bind and issue every warning must be acknowledged; acknowledgements are
 * recorded in the caller's transaction, so they roll back with it.
 */
export async function enforceValidationRules(q: Q, tenantId: string, input: EnforcementInput): Promise<ValidationOutcome> {
  const payload = input.payload || {}
  const productCode = payload.productCode || null
  const stateCode = payload.state || null
  const asOf = input.asOf || (input.extras?.transaction?.effectiveDate as string | undefined) || payload.effectiveDate || null
  const rules = await loadActiveRules(q, tenantId, productCode, stateCode)
  if (!rules.length) return { errors: [], warnings: [] }
  const outcome = evaluateValidationRules(rules, payload, {
    level: input.level,
    transactionType: input.transactionType,
    productCode,
    stateCode,
    asOf: asOf ? String(asOf).slice(0, 10) : null,
  }, input.extras || {})
  const details = { level: input.level, transactionType: input.transactionType, ...outcome }
  if (outcome.errors.length) throw new AppError(422, 'VALIDATION_FAILED', outcome.errors[0].message, details)
  if (levelRequiresAcknowledgement(input.level) && outcome.warnings.length) {
    const acknowledged = acknowledgedCodes(input.acknowledged)
    const pending = unacknowledgedWarnings(outcome, acknowledged)
    if (pending.length)
      throw new AppError(409, 'VALIDATION_WARNINGS_UNACKNOWLEDGED', 'Review and acknowledge the warnings to continue', { ...details, pending })
    if (input.entity) {
      const versions = new Map(rules.map((rule) => [rule.ruleCode, rule.version]))
      for (const warning of outcome.warnings)
        await q(
          `INSERT INTO validation_acknowledgements(tenant_id,level,transaction_type,entity_type,entity_id,rule_code,rule_version,message,field_path,acknowledged_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [tenantId, input.level, input.transactionType, input.entity.type, input.entity.id, warning.ruleCode, versions.get(warning.ruleCode) ?? null, warning.message, warning.fieldPath, input.actor],
        )
    }
  }
  return outcome
}

export async function listValidationAcknowledgements(tenantId: string, entityType: 'quote' | 'policy', entityId: string) {
  if (!z.string().uuid().safeParse(entityId).success) return []
  return withTenantTx(tenantId, async (db) => {
    const result = await toRawQuery(db)(
      `SELECT level, transaction_type, rule_code, rule_version, message, field_path, acknowledged_by, created_at
         FROM validation_acknowledgements WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY created_at DESC`,
      [tenantId, entityType, entityId],
    )
    return result.rows.map((row: any) => ({
      level: row.level,
      transactionType: row.transaction_type,
      ruleCode: row.rule_code,
      ruleVersion: row.rule_version,
      message: row.message,
      fieldPath: row.field_path,
      acknowledgedBy: row.acknowledged_by,
      createdAt: row.created_at,
    }))
  })
}

/** Fields an administrator can pick, by area. Paths are payload paths. */
export type CatalogField = { path: string; label: string; area: string }
const COMMON_FIELDS: CatalogField[] = [
  { path: 'productCode', label: 'Product', area: 'Policy' },
  { path: 'state', label: 'State', area: 'Policy' },
  { path: 'effectiveDate', label: 'Effective date', area: 'Policy' },
  { path: 'termMonths', label: 'Term (months)', area: 'Policy' },
  { path: 'underwritingCompany', label: 'Underwriting company', area: 'Policy' },
  { path: 'agencyId', label: 'Agency', area: 'Policy' },
  { path: 'applicant.firstName', label: 'Applicant first name', area: 'Insured' },
  { path: 'applicant.lastName', label: 'Applicant last name', area: 'Insured' },
  { path: 'applicant.email', label: 'Applicant email', area: 'Insured' },
  { path: 'insureds[*].firstName', label: 'Each insured: first name', area: 'Insured' },
  { path: 'insureds[*].lastName', label: 'Each insured: last name', area: 'Insured' },
  { path: 'insureds[*].email', label: 'Each insured: email', area: 'Insured' },
  { path: 'insureds[*].phone', label: 'Each insured: phone', area: 'Insured' },
  { path: 'mailingAddress.street', label: 'Mailing street', area: 'Common' },
  { path: 'mailingAddress.city', label: 'Mailing city', area: 'Common' },
  { path: 'mailingAddress.state', label: 'Mailing state', area: 'Common' },
  { path: 'mailingAddress.zip', label: 'Mailing ZIP', area: 'Common' },
  { path: 'priorCarrier', label: 'Prior carrier', area: 'Common' },
  { path: 'priorPolicyNumber', label: 'Prior policy number', area: 'Common' },
  { path: 'priorExpirationDate', label: 'Prior expiration date', area: 'Common' },
  { path: 'paymentPlan', label: 'Payment plan', area: 'Common' },
  { path: 'billingMethod', label: 'Billing method', area: 'Common' },
  { path: 'additionalInterests[*].name', label: 'Each additional interest: name', area: 'Common' },
  { path: 'additionalInterests[*].loanNumber', label: 'Each additional interest: loan number', area: 'Common' },
  { path: 'transaction.effectiveDate', label: 'Transaction effective date', area: 'Transaction' },
  { path: 'transaction.reason', label: 'Transaction reason / notes', area: 'Transaction' },
  { path: 'transaction.reasonCode', label: 'Reason code (cancellation, non-renewal)', area: 'Transaction' },
  { path: 'transaction.cancellationReasonCode', label: 'Cancellation reason code', area: 'Transaction' },
  { path: 'transaction.overrideReason', label: 'Override reason (rewrite, renewal, bind)', area: 'Transaction' },
]

export function validationFieldCatalog(tenantId: string, productCode?: string | null): CatalogField[] {
  const fields = [...COMMON_FIELDS]
  if (productCode) {
    try {
      for (const field of buildRiskFields(productCode as any, loadProductConfig(productCode as any), tenantId))
        if (field.path) fields.push({ path: field.path, label: field.label, area: 'Risk' })
    } catch {
      // Unknown or uninstalled product: common fields only.
    }
  }
  return fields
}

/** Vocabulary for the admin screen. */
export const VALIDATION_VOCABULARY = {
  levels: VALIDATION_LEVELS,
  transactions: VALIDATION_TRANSACTIONS,
  screens: VALIDATION_SCREENS,
}

/** Throws for an unknown rule outcome shape (guards route code). */
export function isValidationAppError(error: unknown): error is AppError {
  return error instanceof AppError && (error.code === 'VALIDATION_FAILED' || error.code === 'VALIDATION_WARNINGS_UNACKNOWLEDGED')
}
