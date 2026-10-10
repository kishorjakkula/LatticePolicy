import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { ProductCapabilityDescriptor } from '@lattice-policy/types'
import { api } from '../../api/client'
import {
  useAdminUnderwritingRuleFields,
  useAdminUnderwritingRules,
  useCreateAdminUnderwritingRuleMutation,
  useUpdateAdminUnderwritingRuleMutation,
  useSeedAdminUnderwritingRulesMutation,
} from '../../api/hooks'
import type {
  UnderwritingRule,
  UnderwritingRuleComparisonValue,
  UnderwritingRuleField,
  UnderwritingRuleOperator,
  UnderwritingRuleOutcome,
} from '../../api/admin.api'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { productLabel, humanizeCode } from '../../shared/displayLabels'

// Same five products the Quote Wizard rates today — kept as a fallback only; the real source
// of truth is GET /v1/products, fetched below.
const FALLBACK_PRODUCTS: ProductCapabilityDescriptor[] = [
  ['personal-auto', 'Personal Auto'],
  ['commercial-auto', 'Commercial Auto'],
  ['homeowners', 'Homeowners'],
  ['cyber', 'Cyber'],
  ['professional-liability', 'Professional Liability'],
].map(([code, label]) => ({
  code,
  label,
  version: '1.0.0',
  riskLabel: 'Risk',
  ratingAdapter: code,
  formsMode: 'catalog',
  supportedTransactions: [],
  riskKinds: {},
  defaultRisk: {},
  ui: {},
})) as ProductCapabilityDescriptor[]

const LIST_OPERATORS: UnderwritingRuleOperator[] = ['in', 'not_in']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isListOperator(operator: string): boolean {
  return LIST_OPERATORS.includes(operator as UnderwritingRuleOperator)
}

function formatComparisonValue(value: UnderwritingRuleComparisonValue): string {
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

function buildComparisonValue(
  field: UnderwritingRuleField | undefined,
  operator: string,
  text: string,
  bool: boolean
): UnderwritingRuleComparisonValue {
  if (field?.dataType === 'boolean') return bool
  if (isListOperator(operator)) {
    const parts = text.split(',').map((part) => part.trim()).filter(Boolean)
    return field?.dataType === 'number' ? parts.map(Number) : parts
  }
  return field?.dataType === 'number' ? Number(text) : text
}

// The backend wraps a rejected field/operator in the response body of a 400; request() folds
// that body into Error.message as "...failed 400: <body>". Pull the specific reason back out
// so the admin sees exactly which field or operator was rejected, not a generic failure.
function extractErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  const separatorIndex = raw.indexOf(': ')
  const tail = separatorIndex >= 0 ? raw.slice(separatorIndex + 2) : raw
  try {
    const parsed = JSON.parse(tail)
    const message = parsed?.error || parsed?.message || parsed?.details
    if (typeof message === 'string' && message.trim()) return message
  } catch {
    // Body wasn't JSON — fall through to the raw message below.
  }
  return raw
}

function summarizeSeedResult(result: any): string {
  if (!result) return 'Seed completed.'
  if (Array.isArray(result.created)) {
    return result.created.length > 0
      ? `Seeded underwriting rules: ${result.created.length} new rule(s) created. Already-present rules were left untouched.`
      : 'Underwriting rules already seeded — nothing new to create.'
  }
  if (typeof result.createdCount === 'number' || typeof result.created === 'number') {
    const created = result.createdCount ?? result.created
    return created > 0
      ? `Seeded underwriting rules: ${created} new rule(s) created. Already-present rules were left untouched.`
      : 'Underwriting rules already seeded — nothing new to create.'
  }
  // Real shape from POST /admin/seed-underwriting-rules: { ok: true, summary: { created: string[], skipped: string[] } }.
  // Count only `created` here -- summing every key in `summary` (as an earlier
  // version of this did) would add `skipped`'s length too, so a fully-seeded
  // tenant re-running this would be told rules were "created" when none were.
  if (result.summary && typeof result.summary === 'object' && Array.isArray(result.summary.created)) {
    const created = result.summary.created.length
    return created > 0
      ? `Seeded underwriting rules: ${created} new rule(s) created. Already-present rules were left untouched.`
      : 'Underwriting rules already seeded — nothing new to create.'
  }
  return 'Seed completed.'
}

export function UnderwritingRulesPage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'admin.underwriting_rules.manage')

  const [products, setProducts] = useState<ProductCapabilityDescriptor[]>(FALLBACK_PRODUCTS)
  const [selectedProduct, setSelectedProduct] = useState<string>(FALLBACK_PRODUCTS[0].code)

  useEffect(() => {
    api.listProducts()
      .then((response) => {
        const items = response.items || []
        if (!items.length) return
        setProducts(items)
        setSelectedProduct((prev) => (items.some((p) => p.code === prev) ? prev : items[0].code))
      })
      .catch(() => {})
  }, [])

  const [formError, setFormError] = useState<string | null>(null)
  const [seedMessage, setSeedMessage] = useState<string | null>(null)

  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [fieldPath, setFieldPath] = useState('')
  const [operator, setOperator] = useState<UnderwritingRuleOperator | ''>('')
  const [comparisonValueText, setComparisonValueText] = useState('')
  const [comparisonValueBool, setComparisonValueBool] = useState(false)
  const [outcome, setOutcome] = useState<UnderwritingRuleOutcome>('Refer')
  const [reasonCode, setReasonCode] = useState('')
  const [reasonDescription, setReasonDescription] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [expirationDate, setExpirationDate] = useState('')

  const fieldsQuery = useAdminUnderwritingRuleFields(selectedProduct)
  const fields: UnderwritingRuleField[] = fieldsQuery.data?.fields ?? []
  const selectedField = fields.find((f) => f.fieldPath === fieldPath)

  const rulesQuery = useAdminUnderwritingRules({ productCode: selectedProduct })
  // Defensive client-side filter in case the backend doesn't actually filter server-side.
  const rows: UnderwritingRule[] = (rulesQuery.data?.items ?? []).filter(
    (rule) => !selectedProduct || rule.product_code === selectedProduct
  )

  const createMutation = useCreateAdminUnderwritingRuleMutation()
  const updateMutation = useUpdateAdminUnderwritingRuleMutation()
  const seedMutation = useSeedAdminUnderwritingRulesMutation()

  const configuredRuleCount = rows.length
  const asOf = todayIso()
  const activeRuleCount = useMemo(
    () => rows.filter((rule) =>
      rule.active &&
      rule.effective_date.slice(0, 10) <= asOf &&
      (!rule.expiration_date || rule.expiration_date.slice(0, 10) >= asOf)
    ).length,
    [rows, asOf]
  )
  const rulesEngineActive = activeRuleCount > 0

  const resetForm = () => {
    setEditingRuleId(null)
    setFieldPath('')
    setOperator('')
    setComparisonValueText('')
    setComparisonValueBool(false)
    setOutcome('Refer')
    setReasonCode('')
    setReasonDescription('')
    setStateCode('')
    setEffectiveDate(todayIso())
    setExpirationDate('')
  }

  const onProductChange = (code: string) => {
    setSelectedProduct(code)
    resetForm()
    setFormError(null)
  }

  const onFieldChange = (newFieldPath: string) => {
    setFieldPath(newFieldPath)
    const field = fields.find((f) => f.fieldPath === newFieldPath)
    setOperator((field?.allowedOperators?.[0] as UnderwritingRuleOperator) ?? '')
    setComparisonValueText('')
    setComparisonValueBool(false)
  }

  const startEdit = (rule: UnderwritingRule) => {
    setFormError(null)
    setEditingRuleId(rule.rule_id)
    setFieldPath(rule.field_path)
    setOperator(rule.operator)
    const field = fields.find((f) => f.fieldPath === rule.field_path)
    if (field?.dataType === 'boolean') {
      setComparisonValueBool(rule.comparison_value === true)
      setComparisonValueText('')
    } else if (Array.isArray(rule.comparison_value)) {
      setComparisonValueText(rule.comparison_value.join(', '))
    } else {
      setComparisonValueText(String(rule.comparison_value))
    }
    setOutcome(rule.outcome)
    setReasonCode(rule.reason_code)
    setReasonDescription(rule.reason_description)
    setStateCode(rule.state_code || '')
    setEffectiveDate(rule.effective_date ? rule.effective_date.slice(0, 10) : todayIso())
    setExpirationDate(rule.expiration_date ? rule.expiration_date.slice(0, 10) : '')
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    const comparisonValue = buildComparisonValue(selectedField, operator, comparisonValueText, comparisonValueBool)
    const payload = {
      productCode: selectedProduct,
      stateCode: stateCode.trim() ? stateCode.trim().toUpperCase() : null,
      fieldPath,
      operator: operator as UnderwritingRuleOperator,
      comparisonValue,
      outcome,
      reasonCode: reasonCode.trim(),
      reasonDescription: reasonDescription.trim(),
      effectiveDate,
      expirationDate: expirationDate || null,
    }
    try {
      if (editingRuleId) {
        await updateMutation.mutateAsync({ ruleId: editingRuleId, patch: payload })
      } else {
        await createMutation.mutateAsync(payload)
      }
      resetForm()
    } catch (err) {
      setFormError(extractErrorMessage(err))
    }
  }

  const onToggleActive = async (rule: UnderwritingRule) => {
    setFormError(null)
    try {
      await updateMutation.mutateAsync({ ruleId: rule.rule_id, patch: { active: !rule.active } })
    } catch (err) {
      setFormError(extractErrorMessage(err))
    }
  }

  const onSeed = async () => {
    setSeedMessage(null)
    setFormError(null)
    try {
      const result = await seedMutation.mutateAsync()
      setSeedMessage(summarizeSeedResult(result))
    } catch (err) {
      setFormError(extractErrorMessage(err))
    }
  }

  const loading =
    rulesQuery.isLoading || fieldsQuery.isLoading || createMutation.isPending || updateMutation.isPending
  const seeding = seedMutation.isPending
  const errorMessage = formError || (rulesQuery.error ? String(rulesQuery.error) : null)

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Underwriting Rules</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            Admin-authored Refer/Decline rules per product. Once any rule exists for a product, these rules replace
            the built-in underwriting logic for that product.
          </p>
        </div>
        {canManage && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <button type="button" onClick={onSeed} disabled={seeding} className="btn-secondary">
              Seed Default Rules
            </button>
          </div>
        )}
      </div>

      <div className="ps-content-card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="col">
            <label>Product</label>
            <select aria-label="Product" value={selectedProduct} onChange={(e) => onProductChange(e.target.value)}>
              {products.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label || productLabel(p.code)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {seedMessage && <p className="muted" data-testid="seed-result-message">{seedMessage}</p>}
      {errorMessage && <p className="error" role="alert">{errorMessage}</p>}

      <div className="ps-content-card">
        <div className="ps-content-card-title">Rule engine status for {productLabel(selectedProduct)}</div>
        {rulesEngineActive ? (
          <div
            className="card policy-bound-alert"
            style={{ borderLeftColor: 'var(--success)' }}
            data-testid="rules-engine-on-notice"
          >
            <div className="policy-bound-alert-row">
              <div>
                <strong>Admin-authored rules are ACTIVE for {productLabel(selectedProduct)}.</strong>
                <div className="muted">
                  {configuredRuleCount} rule(s) configured ({activeRuleCount} currently active). Matching rules
                  replace the built-in logic for their state and effective-date scope.
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div
            className="card policy-bound-alert"
            style={{ borderLeftColor: 'var(--danger)' }}
            role="alert"
            data-testid="rules-engine-off-banner"
          >
            <div className="policy-bound-alert-row">
              <div>
                <strong>No admin-authored rules are currently active for {productLabel(selectedProduct)}.</strong>
                <div className="muted">
                  Underwriting decisions use the built-in default logic where no active rule matches. Add a rule
                  below, or seed supported defaults, to activate the rules engine for a matching scope.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {canManage && (
        <form onSubmit={onSubmit} className="ps-content-card">
          <div className="ps-content-card-title">{editingRuleId ? 'Edit rule' : 'New rule'} — {productLabel(selectedProduct)}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="col">
              <label>Field</label>
              <select aria-label="Field" value={fieldPath} onChange={(e) => onFieldChange(e.target.value)}>
                <option value="">Select field…</option>
                {fields.map((f) => (
                  <option key={f.fieldPath} value={f.fieldPath}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>Operator</label>
              <select
                aria-label="Operator"
                value={operator}
                onChange={(e) => setOperator(e.target.value as UnderwritingRuleOperator)}
                disabled={!selectedField}
              >
                <option value="">Select operator…</option>
                {(selectedField?.allowedOperators ?? []).map((op) => (
                  <option key={op} value={op}>
                    {humanizeCode(op)}
                  </option>
                ))}
              </select>
            </div>
            <div className="col">
              <label>Value</label>
              {selectedField?.dataType === 'boolean' ? (
                <select
                  aria-label="Comparison value"
                  value={comparisonValueBool ? 'true' : 'false'}
                  onChange={(e) => setComparisonValueBool(e.target.value === 'true')}
                >
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : (
                <input
                  aria-label="Comparison value"
                  type={selectedField?.dataType === 'number' && !isListOperator(operator) ? 'number' : 'text'}
                  value={comparisonValueText}
                  onChange={(e) => setComparisonValueText(e.target.value)}
                  placeholder={isListOperator(operator) ? 'comma-separated values' : 'value'}
                  disabled={!selectedField}
                />
              )}
            </div>
            <div className="col">
              <label>Outcome</label>
              <select
                aria-label="Outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as UnderwritingRuleOutcome)}
              >
                <option value="Refer">Refer</option>
                <option value="Decline">Decline</option>
              </select>
            </div>
            <div className="col">
              <label>Reason Code</label>
              <input value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} placeholder="e.g. HIGH_RISK_AGE" />
            </div>
            <div className="col">
              <label>Reason Description</label>
              <input
                value={reasonDescription}
                onChange={(e) => setReasonDescription(e.target.value)}
                placeholder="Shown to the underwriter on referral"
              />
            </div>
            <div className="col">
              <label>State</label>
              <input
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value.toUpperCase())}
                maxLength={2}
                placeholder="blank = all states"
              />
            </div>
            <div className="col">
              <label>Effective Date</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
            </div>
            <div className="col">
              <label>Expiration Date</label>
              <input type="date" value={expirationDate} onChange={(e) => setExpirationDate(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button
              type="submit"
              disabled={loading || !fieldPath || !operator || !outcome || !reasonCode.trim() || !effectiveDate}
            >
              {editingRuleId ? 'Save Changes' : 'Create Rule'}
            </button>
            {editingRuleId && (
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={loading}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      <div className="ps-table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Operator</th>
              <th>Value</th>
              <th>Outcome</th>
              <th>Reason</th>
              <th>State</th>
              <th>Effective</th>
              <th>Expiration</th>
              <th>Status</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!rulesQuery.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={canManage ? 10 : 9} className="muted">
                  No underwriting rules configured for {productLabel(selectedProduct)}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.rule_id}>
                <td>{fields.find((f) => f.fieldPath === row.field_path)?.label || row.field_path}</td>
                <td>{humanizeCode(row.operator)}</td>
                <td>{formatComparisonValue(row.comparison_value)}</td>
                <td>
                  <span className={`badge ${row.outcome === 'Decline' ? 'red' : 'yellow'}`}>{row.outcome}</span>
                </td>
                <td>
                  {row.reason_code}
                  {row.reason_description ? <div className="muted">{row.reason_description}</div> : null}
                </td>
                <td>{row.state_code || <span className="muted">All</span>}</td>
                <td>{formatDisplayDate(row.effective_date, { fallback: '-' })}</td>
                <td>{formatDisplayDate(row.expiration_date, { fallback: '-' })}</td>
                <td>
                  <span className={`badge ${row.active ? 'green' : 'gray'}`}>{row.active ? 'Active' : 'Inactive'}</span>
                </td>
                {canManage && (
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn-secondary" onClick={() => startEdit(row)} disabled={loading}>
                      Edit
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => onToggleActive(row)} disabled={loading}>
                      {row.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
