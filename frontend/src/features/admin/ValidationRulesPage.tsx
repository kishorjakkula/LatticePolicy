import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  VALIDATION_LEVELS,
  VALIDATION_SCREENS,
  VALIDATION_TRANSACTIONS,
  validationRuleProblems,
  type ValidationLevel,
  type ValidationScreen,
  type ValidationTransaction,
} from '@lattice-policy/rules'
import { validationRulesApi, type StoredValidationRule, type ValidationRuleDraft } from '../../api/validation-rules.api'
import { listProducts } from '../../api/references.api'
import { tenantId } from '../../api/request'
import { RadioGroup } from '../../components/RadioGroup'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { Checkbox } from '../../components/Checkbox'
import { useAuthStore } from '../../store/auth.store'
import { hasPermission } from '../../auth/permissions'
import './validation-rules.css'

export const LEVEL_LABELS: Record<ValidationLevel, string> = {
  screen: 'Screen',
  rate: 'Rate / preview',
  bind: 'Bind',
  issue: 'Issue / process',
}
export const TRANSACTION_LABELS: Record<ValidationTransaction | 'common', string> = {
  common: 'Common (all transactions)',
  new_business: 'New business',
  endorsement: 'Endorsement',
  cancellation: 'Cancellation',
  reinstatement: 'Reinstatement',
  renewal: 'Renewal',
  rewrite: 'Rewrite',
  non_renewal: 'Non-renewal',
}
export const SCREEN_LABELS: Record<ValidationScreen, string> = {
  product: 'Product',
  qualification: 'Qualification questions',
  insureds: 'Insureds',
  risk: 'Risk',
  coverages: 'Coverages',
  rating: 'Rating',
  premium: 'Premium',
  forms: 'Forms & documents',
}
const today = () => new Date().toISOString().slice(0, 10)
const EMPTY: ValidationRuleDraft = {
  ruleCode: '',
  name: '',
  kind: 'required',
  fieldPath: '',
  condition: '',
  appliesWhen: '',
  levels: ['screen', 'rate', 'bind'],
  transactionTypes: ['new_business'],
  productCode: null,
  stateCode: null,
  screen: 'insureds',
  severity: 'error',
  message: '',
  effectiveDate: today(),
  expirationDate: null,
  active: true,
}
const draftOf = (rule: StoredValidationRule): ValidationRuleDraft => ({
  ruleCode: rule.ruleCode,
  name: rule.name,
  kind: rule.kind,
  fieldPath: rule.fieldPath || '',
  condition: rule.condition || '',
  appliesWhen: rule.appliesWhen || '',
  levels: rule.levels,
  transactionTypes: rule.transactionTypes,
  productCode: rule.productCode || null,
  stateCode: rule.stateCode || null,
  screen: rule.screen || 'insureds',
  severity: rule.severity,
  message: rule.message,
  effectiveDate: rule.effectiveDate || today(),
  expirationDate: rule.expirationDate || null,
  active: rule.active !== false,
})
const covers = (rule: StoredValidationRule, transaction: ValidationTransaction) =>
  rule.transactionTypes.includes('common') || rule.transactionTypes.includes(transaction)

export function ValidationRulesPage() {
  const user = useAuthStore((state) => state.user)
  const canManage = hasPermission(user, 'admin.validation_rules.manage')
  const rules = useQuery({ queryKey: ['validation-rules', tenantId()], queryFn: () => validationRulesApi.list() })
  const products = useQuery({ queryKey: ['products', tenantId()], queryFn: () => listProducts() })
  const [filter, setFilter] = useState({ level: '', transaction: '', severity: '', product: '', status: 'active', search: '' })
  const [editing, setEditing] = useState<{ ruleId: string | null; draft: ValidationRuleDraft } | null>(null)
  const [historyFor, setHistoryFor] = useState<StoredValidationRule | null>(null)
  const items = rules.data?.items || []
  const productLabel = (code?: string | null) =>
    !code ? 'All products' : products.data?.items.find((product) => product.code === code)?.label || code

  const visible = items.filter((rule) => {
    if (filter.level && !rule.levels.includes(filter.level as ValidationLevel)) return false
    if (filter.transaction === 'common' && !rule.transactionTypes.includes('common')) return false
    if (filter.transaction && filter.transaction !== 'common' && !covers(rule, filter.transaction as ValidationTransaction)) return false
    if (filter.severity && rule.severity !== filter.severity) return false
    if (filter.product && (rule.productCode || '') !== (filter.product === '*' ? '' : filter.product)) return false
    if (filter.status === 'active' && rule.active === false) return false
    if (filter.status === 'inactive' && rule.active !== false) return false
    const search = filter.search.trim().toLowerCase()
    if (search && ![rule.ruleCode, rule.name, rule.message, rule.fieldPath || ''].some((value) => value.toLowerCase().includes(search))) return false
    return true
  })
  const active = items.filter((rule) => rule.active !== false)

  return (
    <div className="ps-admin-page validation-rules">
      <div className="ps-page-header">
        <h2 className="ps-page-title">Validation Rules</h2>
        {canManage && (
          <button type="button" onClick={() => setEditing({ ruleId: null, draft: { ...EMPTY, effectiveDate: today() } })}>
            New Rule
          </button>
        )}
      </div>
      <p className="validation-rules__lede">
        Required fields and checks for every level of every transaction. An <strong>error</strong> stops the step; a{' '}
        <strong>warning</strong> is shown on screens and at rating, and must be acknowledged at bind and issue. Choose{' '}
        <strong>Common</strong> to apply a rule to all transactions. The quote and policy screens show the same results the
        server enforces.
      </p>
      {rules.error && <p role="alert">{String(rules.error)}</p>}

      <CollapsibleSection title="Coverage" className="card">
        <p className="validation-rules__hint">Active rules by transaction and level. Select a cell to filter the list.</p>
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-no-sticky-head validation-rules__matrix">
            <thead>
              <tr>
                <th>Transaction</th>
                {VALIDATION_LEVELS.map((level) => (
                  <th key={level}>{LEVEL_LABELS[level]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {VALIDATION_TRANSACTIONS.map((transaction) => (
                <tr key={transaction}>
                  <th scope="row">{TRANSACTION_LABELS[transaction]}</th>
                  {VALIDATION_LEVELS.map((level) => {
                    const count = active.filter((rule) => rule.levels.includes(level) && covers(rule, transaction)).length
                    return (
                      <td key={level}>
                        <button
                          type="button"
                          className="validation-rules__cell"
                          aria-label={`${TRANSACTION_LABELS[transaction]}, ${LEVEL_LABELS[level]}: ${count} rules`}
                          onClick={() => setFilter({ ...filter, level, transaction, status: 'active' })}
                        >
                          {count}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Rules" className="card" style={{ marginTop: 16 }}>
        <div className="validation-rules__filters">
          <label>
            Level
            <select aria-label="Filter by level" value={filter.level} onChange={(event) => setFilter({ ...filter, level: event.target.value })}>
              <option value="">All levels</option>
              {VALIDATION_LEVELS.map((level) => (
                <option key={level} value={level}>{LEVEL_LABELS[level]}</option>
              ))}
            </select>
          </label>
          <label>
            Transaction
            <select aria-label="Filter by transaction" value={filter.transaction} onChange={(event) => setFilter({ ...filter, transaction: event.target.value })}>
              <option value="">All transactions</option>
              <option value="common">Common rules only</option>
              {VALIDATION_TRANSACTIONS.map((transaction) => (
                <option key={transaction} value={transaction}>{TRANSACTION_LABELS[transaction]}</option>
              ))}
            </select>
          </label>
          <label>
            Severity
            <select aria-label="Filter by severity" value={filter.severity} onChange={(event) => setFilter({ ...filter, severity: event.target.value })}>
              <option value="">Errors and warnings</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
            </select>
          </label>
          <label>
            Product
            <select aria-label="Filter by product" value={filter.product} onChange={(event) => setFilter({ ...filter, product: event.target.value })}>
              <option value="">Any</option>
              <option value="*">All-product rules</option>
              {products.data?.items.map((product) => (
                <option key={product.code} value={product.code}>{product.label}</option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select aria-label="Filter by status" value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </label>
          <label>
            Search
            <input aria-label="Search rules" value={filter.search} maxLength={80} onChange={(event) => setFilter({ ...filter, search: event.target.value })} />
          </label>
        </div>
        {rules.isPending && <p role="status">Loading rules…</p>}
        {rules.data && !visible.length && <p>No rules match these filters.</p>}
        {visible.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="table table-no-sticky-head">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>Levels</th>
                  <th>Transactions</th>
                  <th>Scope</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((rule) => (
                  <tr key={rule.ruleId}>
                    <td>
                      <strong>{rule.ruleCode}</strong>
                      <div className="validation-rules__muted">{rule.name}</div>
                    </td>
                    <td>{rule.levels.map((level) => (level === 'screen' && rule.screen ? `Screen (${SCREEN_LABELS[rule.screen]})` : LEVEL_LABELS[level])).join(', ')}</td>
                    <td>{rule.transactionTypes.map((type) => (type === 'common' ? 'Common' : TRANSACTION_LABELS[type])).join(', ')}</td>
                    <td>
                      {productLabel(rule.productCode)} · {rule.stateCode || 'All states'}
                    </td>
                    <td>
                      <span className={`validation-rules__severity validation-rules__severity--${rule.severity}`}>
                        {rule.severity === 'error' ? 'Error' : 'Warning'}
                      </span>
                    </td>
                    <td>
                      {rule.active === false ? 'Inactive' : 'Active'} · v{rule.version}
                    </td>
                    <td className="validation-rules__actions">
                      {canManage && (
                        <button type="button" className="btn-secondary" onClick={() => setEditing({ ruleId: rule.ruleId, draft: draftOf(rule) })}>
                          Edit
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => setHistoryFor(rule)}>
                        History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleSection>

      {editing && canManage && (
        <RuleEditor
          key={editing.ruleId || 'new'}
          ruleId={editing.ruleId}
          initial={editing.draft}
          products={products.data?.items || []}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await rules.refetch()
          }}
        />
      )}
      {historyFor && <RuleHistory rule={historyFor} onClose={() => setHistoryFor(null)} />}
    </div>
  )
}

function RuleEditor({
  ruleId,
  initial,
  products,
  onClose,
  onSaved,
}: {
  ruleId: string | null
  initial: ValidationRuleDraft
  products: Array<{ code: string; label: string }>
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [draft, setDraft] = useState<ValidationRuleDraft>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [touched, setTouched] = useState(false)
  const catalog = useQuery({
    queryKey: ['validation-catalog', tenantId(), draft.productCode || ''],
    queryFn: () => validationRulesApi.catalog(draft.productCode),
  })
  const problems = useMemo(() => {
    const found = validationRuleProblems(draft)
    if (draft.ruleCode.trim().length < 2) found.unshift('Enter a rule code of at least 2 characters')
    if (!draft.name.trim()) found.unshift('Enter a name')
    return found
  }, [draft])
  const common = draft.transactionTypes.includes('common')
  const set = (patch: Partial<ValidationRuleDraft>) => setDraft((current) => ({ ...current, ...patch }))
  const toggleLevel = (level: ValidationLevel, on: boolean) =>
    set({ levels: on ? [...new Set([...draft.levels, level])] : draft.levels.filter((item) => item !== level) })
  const toggleTransaction = (transaction: ValidationTransaction, on: boolean) => {
    const current = draft.transactionTypes.filter((item) => item !== 'common') as ValidationTransaction[]
    set({ transactionTypes: on ? [...new Set([...current, transaction])] : current.filter((item) => item !== transaction) })
  }

  async function save() {
    setTouched(true)
    if (problems.length) return
    setSaving(true)
    setError('')
    try {
      const body: ValidationRuleDraft = {
        ...draft,
        ruleCode: draft.ruleCode.trim().toUpperCase(),
        stateCode: draft.stateCode ? draft.stateCode.toUpperCase() : null,
        screen: draft.levels.includes('screen') ? draft.screen : null,
        fieldPath: draft.fieldPath || null,
        condition: draft.kind === 'condition' ? draft.condition || null : null,
        appliesWhen: draft.appliesWhen || null,
        expirationDate: draft.expirationDate || null,
      }
      if (ruleId) await validationRulesApi.update(ruleId, body)
      else await validationRulesApi.create(body)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!ruleId) return
    setSaving(true)
    try {
      await validationRulesApi.remove(ruleId)
      await onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <CollapsibleSection title={ruleId ? `Edit ${initial.ruleCode}` : 'New Rule'} className="card" style={{ marginTop: 16 }}>
      <form
        className="validation-rules__editor"
        // The rule's own checks (below) explain every problem at once.
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className="validation-rules__grid">
          <label>
            Rule code
            <input
              aria-label="Rule code"
              required
              disabled={!!ruleId}
              maxLength={60}
              placeholder="CANCEL_REASON_REQUIRED"
              value={draft.ruleCode}
              onChange={(event) => set({ ruleCode: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_') })}
            />
          </label>
          <label>
            Name
            <input aria-label="Name" required maxLength={200} value={draft.name} onChange={(event) => set({ name: event.target.value })} />
          </label>
        </div>

        <fieldset className="validation-rules__fieldset">
          <legend>Check</legend>
          <RadioGroup
            name="validation-kind"
            ariaLabel="Check type"
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={[
              { value: 'required', label: 'Required field' },
              { value: 'condition', label: 'Condition must be true' },
            ] as const}
          />
          <label>
            Field {draft.kind === 'condition' && <span className="validation-rules__muted">(optional; the message is shown against it)</span>}
            <input
              aria-label="Field path"
              list="validation-field-catalog"
              maxLength={300}
              placeholder="applicant.email, risks[*].vin, transaction.reasonCode"
              value={draft.fieldPath || ''}
              onChange={(event) => set({ fieldPath: event.target.value })}
            />
            <datalist id="validation-field-catalog">
              {catalog.data?.fields.map((field) => (
                <option key={field.path} value={field.path}>{`${field.area}: ${field.label}`}</option>
              ))}
            </datalist>
          </label>
          <span className="validation-rules__muted">Use [*] to check every item, for example risks[*].vin.</span>
          {draft.kind === 'condition' && (
            <label>
              Condition that must be true
              <textarea
                aria-label="Condition"
                rows={3}
                maxLength={2000}
                placeholder="daysBetween(transaction.effectiveDate, today()) <= 30"
                value={draft.condition || ''}
                onChange={(event) => set({ condition: event.target.value })}
              />
            </label>
          )}
          <label>
            Only check when <span className="validation-rules__muted">(optional)</span>
            <input
              aria-label="Applies when"
              maxLength={2000}
              placeholder="coverages.COLL.selected == true"
              value={draft.appliesWhen || ''}
              onChange={(event) => set({ appliesWhen: event.target.value })}
            />
          </label>
          <details className="validation-rules__help">
            <summary>Names and functions for conditions</summary>
            <p>
              <code>risk</code> (first risk), <code>risks</code>, <code>quote.state</code>, <code>quote.effectiveDate</code>,{' '}
              <code>quote.productCode</code>, <code>applicant</code>, <code>insureds</code>, <code>coverages.CODE.limit</code>,{' '}
              <code>uwAnswers</code>, <code>payload</code>, <code>transaction.type</code>, <code>transaction.effectiveDate</code>,{' '}
              <code>transaction.reasonCode</code>, <code>policy.status</code>, <code>policy.termExpirationDate</code>,{' '}
              <code>premium.total</code> (at bind and issue).
            </p>
            <p>
              Functions: <code>isSet isEmpty len count sum min max abs round lower upper contains startsWith number today
              daysBetween lookup</code>. Operators: <code>== != &lt; &lt;= &gt; &gt;= in, not in, &amp;&amp; || !</code>.
            </p>
          </details>
        </fieldset>

        <fieldset className="validation-rules__fieldset">
          <legend>Where it applies</legend>
          <div className="validation-rules__checks" role="group" aria-label="Levels">
            <span className="validation-rules__group-label">Levels</span>
            {VALIDATION_LEVELS.map((level) => (
              <Checkbox key={level} label={LEVEL_LABELS[level]} checked={draft.levels.includes(level)} onChange={(on) => toggleLevel(level, on)} />
            ))}
          </div>
          {draft.levels.includes('screen') && (
            <label>
              Screen
              <select aria-label="Screen" value={draft.screen || ''} onChange={(event) => set({ screen: event.target.value as ValidationScreen })}>
                {VALIDATION_SCREENS.map((screen) => (
                  <option key={screen} value={screen}>{SCREEN_LABELS[screen]}</option>
                ))}
              </select>
            </label>
          )}
          <div className="validation-rules__checks" role="group" aria-label="Transactions">
            <span className="validation-rules__group-label">Transactions</span>
            <Checkbox
              label={TRANSACTION_LABELS.common}
              checked={common}
              onChange={(on) => set({ transactionTypes: on ? ['common'] : ['new_business'] })}
            />
            {VALIDATION_TRANSACTIONS.map((transaction) => (
              <Checkbox
                key={transaction}
                label={TRANSACTION_LABELS[transaction]}
                disabled={common}
                checked={common || draft.transactionTypes.includes(transaction)}
                onChange={(on) => toggleTransaction(transaction, on)}
              />
            ))}
          </div>
          <div className="validation-rules__grid">
            <label>
              Product
              <select aria-label="Product" value={draft.productCode || ''} onChange={(event) => set({ productCode: event.target.value || null })}>
                <option value="">All products</option>
                {products.map((product) => (
                  <option key={product.code} value={product.code}>{product.label}</option>
                ))}
              </select>
            </label>
            <label>
              State
              <input
                aria-label="State"
                maxLength={2}
                placeholder="All states"
                value={draft.stateCode || ''}
                onChange={(event) => set({ stateCode: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') || null })}
              />
            </label>
            <label>
              Effective
              <input aria-label="Effective date" type="date" required value={draft.effectiveDate || ''} onChange={(event) => set({ effectiveDate: event.target.value })} />
            </label>
            <label>
              Expires <span className="validation-rules__muted">(optional)</span>
              <input aria-label="Expiration date" type="date" value={draft.expirationDate || ''} onChange={(event) => set({ expirationDate: event.target.value || null })} />
            </label>
          </div>
        </fieldset>

        <fieldset className="validation-rules__fieldset">
          <legend>Result</legend>
          <RadioGroup
            name="validation-severity"
            ariaLabel="Severity"
            value={draft.severity}
            onChange={(severity) => set({ severity })}
            options={[
              { value: 'error', label: 'Error: stop the step' },
              { value: 'warning', label: 'Warning: acknowledge at bind and issue' },
            ] as const}
          />
          <label>
            Message people see
            <input aria-label="Message" required maxLength={500} value={draft.message} onChange={(event) => set({ message: event.target.value })} />
          </label>
          <Checkbox label="Active" checked={draft.active} onChange={(on) => set({ active: on })} />
        </fieldset>

        {touched && problems.length > 0 && (
          <ul role="alert" className="validation-rules__problems">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="validation-rules__buttons">
          <button type="submit" disabled={saving}>
            {ruleId ? 'Save Rule' : 'Create Rule'}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          {ruleId && (
            <button type="button" className="btn-secondary validation-rules__delete" onClick={() => void remove()} disabled={saving}>
              Delete Rule
            </button>
          )}
        </div>
      </form>
    </CollapsibleSection>
  )
}

function RuleHistory({ rule, onClose }: { rule: StoredValidationRule; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['validation-rule-history', tenantId(), rule.ruleId],
    queryFn: () => validationRulesApi.history(rule.ruleId),
  })
  return (
    <CollapsibleSection title={`History: ${rule.ruleCode}`} className="card" style={{ marginTop: 16 }}>
      {history.isPending && <p role="status">Loading history…</p>}
      <ol className="validation-rules__history">
        {history.data?.items.map((entry, index) => (
          <li key={index}>
            <strong>{entry.action.toLowerCase()}</strong> by {entry.actor} · {new Date(entry.createdAt).toLocaleString()}
            {entry.action === 'UPDATED' && <ChangeSummary before={entry.before} after={entry.after} />}
          </li>
        ))}
      </ol>
      <button type="button" className="btn-secondary" onClick={onClose}>
        Close
      </button>
    </CollapsibleSection>
  )
}

function ChangeSummary({ before, after }: { before: unknown; after: unknown }) {
  const a = (before || {}) as Record<string, unknown>
  const b = (after || {}) as Record<string, unknown>
  const changed = Object.keys(b).filter(
    (key) => !['version', 'updatedAt', 'updatedBy'].includes(key) && JSON.stringify(a[key]) !== JSON.stringify(b[key]),
  )
  if (!changed.length) return null
  return (
    <ul className="validation-rules__changes">
      {changed.map((key) => (
        <li key={key}>
          {key}: <code>{JSON.stringify(a[key])}</code> → <code>{JSON.stringify(b[key])}</code>
        </li>
      ))}
    </ul>
  )
}
