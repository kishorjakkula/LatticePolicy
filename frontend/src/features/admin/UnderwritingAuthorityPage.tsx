import { FormEvent, useMemo, useState } from 'react'
import {
  useUwAuthorityGrants,
  useCreateUwAuthorityGrantMutation,
  useUpdateUwAuthorityGrantMutation,
} from '../../api/hooks'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { productLabel } from '../../shared/displayLabels'

type AuthorityGrantRow = {
  grant_id: string
  subject_type: 'USER' | 'ROLE' | 'PRODUCER'
  subject_id: string
  product_code: string | null
  state_code: string | null
  transaction_types: string[]
  max_premium: string | number | null
  max_limit: string | number | null
  may_override: boolean
  effective_date: string
  expiration_date: string | null
  active: boolean
}

const SUBJECT_TYPES: Array<AuthorityGrantRow['subject_type']> = ['USER', 'ROLE', 'PRODUCER']
const TRANSACTION_TYPES = ['NewBusiness', 'Endorse', 'Renew', 'Rewrite', '*']

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Mirrors the backend's resolveAuthorityDecision matching rules: a grant
// applies to a scope when it is active, currently in its effective window,
// and its product/state are either unset (wildcard) or match the scope.
function grantAppliesToScope(grant: AuthorityGrantRow, productCode: string, stateCode: string, asOf: string): boolean {
  if (!grant.active) return false
  if (grant.effective_date > asOf) return false
  if (grant.expiration_date && grant.expiration_date < asOf) return false
  const productMatches = !grant.product_code || (!!productCode && grant.product_code.toLowerCase() === productCode.toLowerCase())
  const stateMatches = !grant.state_code || (!!stateCode && grant.state_code.toUpperCase() === stateCode.toUpperCase())
  return productMatches && stateMatches
}

export function UnderwritingAuthorityPage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'uw.authority.manage')

  const [formError, setFormError] = useState<string | null>(null)
  const [scopeProductCode, setScopeProductCode] = useState('')
  const [scopeStateCode, setScopeStateCode] = useState('')

  const [subjectType, setSubjectType] = useState<AuthorityGrantRow['subject_type']>('ROLE')
  const [subjectId, setSubjectId] = useState('')
  const [productCode, setProductCode] = useState('')
  const [stateCode, setStateCode] = useState('')
  const [transactionTypes, setTransactionTypes] = useState<string[]>([])
  const [maxPremium, setMaxPremium] = useState('')
  const [maxLimit, setMaxLimit] = useState('')
  const [mayOverride, setMayOverride] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [expirationDate, setExpirationDate] = useState('')

  const { data, isLoading, error } = useUwAuthorityGrants()
  const rows: AuthorityGrantRow[] = data?.items ?? []
  const createMutation = useCreateUwAuthorityGrantMutation()
  const updateMutation = useUpdateUwAuthorityGrantMutation()

  const asOf = todayIso()
  const scopeHasActiveGrant = useMemo(
    () => rows.some(row => grantAppliesToScope(row, scopeProductCode, scopeStateCode, asOf)),
    [rows, scopeProductCode, scopeStateCode, asOf]
  )

  const toggleTransactionType = (value: string) => {
    setTransactionTypes(current => current.includes(value) ? current.filter(v => v !== value) : [...current, value])
  }

  const onCreate = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await createMutation.mutateAsync({
        subjectType,
        subjectId,
        productCode: productCode || null,
        stateCode: stateCode || null,
        transactionTypes,
        maxPremium: maxPremium === '' ? null : Number(maxPremium),
        maxLimit: maxLimit === '' ? null : Number(maxLimit),
        mayOverride,
        effectiveDate,
        expirationDate: expirationDate || null,
      })
      setSubjectId(''); setProductCode(''); setStateCode(''); setTransactionTypes([])
      setMaxPremium(''); setMaxLimit(''); setMayOverride(false); setExpirationDate('')
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onDeactivate = async (row: AuthorityGrantRow) => {
    setFormError(null)
    try {
      await updateMutation.mutateAsync({ grantId: row.grant_id, patch: { active: false } })
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const onReactivate = async (row: AuthorityGrantRow) => {
    setFormError(null)
    try {
      await updateMutation.mutateAsync({ grantId: row.grant_id, patch: { active: true } })
    } catch (err: any) {
      setFormError(err.message || String(err))
    }
  }

  const loading = isLoading || createMutation.isPending || updateMutation.isPending
  const errorMessage = formError || (error ? String(error) : null)

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Underwriting Authority</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            Grants that limit which transactions a user, role, or producer may auto-authorize without referral.
          </p>
        </div>
      </div>

      <div className="ps-content-card">
        <div className="ps-content-card-title">Check gating status for a scope</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="col">
            <label>Product Code</label>
            <input
              aria-label="Scope product code"
              value={scopeProductCode}
              onChange={e => setScopeProductCode(e.target.value)}
              placeholder="personal-auto (leave blank for global)"
            />
          </div>
          <div className="col">
            <label>State</label>
            <input
              aria-label="Scope state code"
              value={scopeStateCode}
              onChange={e => setScopeStateCode(e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="CA (leave blank for global)"
            />
          </div>
        </div>
        {!isLoading && !scopeHasActiveGrant && (
          <div className="card policy-bound-alert" style={{ borderLeftColor: 'var(--danger)' }} role="alert" data-testid="authority-gating-off-banner">
            <div className="policy-bound-alert-row">
              <div>
                <strong>
                  Underwriting authority gating is OFF for {scopeProductCode ? productLabel(scopeProductCode) : 'all products'}
                  {' / '}
                  {scopeStateCode || 'all states'}.
                </strong>
                <div className="muted">
                  No active authority grant is configured for this scope, so every transaction auto-authorizes without
                  an underwriting referral. Add a grant below to turn gating on.
                </div>
              </div>
            </div>
          </div>
        )}
        {!isLoading && scopeHasActiveGrant && (
          <p className="muted" data-testid="authority-gating-on-notice" style={{ marginTop: 12, marginBottom: 0 }}>
            Gating is ON for this scope — at least one active authority grant applies.
          </p>
        )}
      </div>

      {errorMessage && <p className="error" role="alert">{errorMessage}</p>}

      {canManage && (
        <form onSubmit={onCreate} className="ps-content-card">
          <div className="ps-content-card-title">New authority grant</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="col">
              <label>Subject Type</label>
              <select value={subjectType} onChange={e => setSubjectType(e.target.value as AuthorityGrantRow['subject_type'])}>
                {SUBJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col">
              <label>Subject ID</label>
              <input value={subjectId} onChange={e => setSubjectId(e.target.value)} placeholder="role code, user id, or producer id" />
            </div>
            <div className="col">
              <label>Product Code</label>
              <input value={productCode} onChange={e => setProductCode(e.target.value)} placeholder="blank = all products" />
            </div>
            <div className="col">
              <label>State</label>
              <input value={stateCode} onChange={e => setStateCode(e.target.value.toUpperCase())} maxLength={2} placeholder="blank = all states" />
            </div>
            <div className="col">
              <label>Max Premium</label>
              <input type="number" value={maxPremium} onChange={e => setMaxPremium(e.target.value)} placeholder="unlimited" />
            </div>
            <div className="col">
              <label>Max Limit</label>
              <input type="number" value={maxLimit} onChange={e => setMaxLimit(e.target.value)} placeholder="unlimited" />
            </div>
            <div className="col">
              <label>Effective Date</label>
              <input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} />
            </div>
            <div className="col">
              <label>Expiration Date</label>
              <input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} />
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'block', marginBottom: 6 }}>Transaction Types</label>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {TRANSACTION_TYPES.map(type => (
                <label key={type} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={transactionTypes.includes(type)}
                    onChange={() => toggleTransactionType(type)}
                  />
                  {type === '*' ? 'All' : type}
                </label>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" checked={mayOverride} onChange={e => setMayOverride(e.target.checked)} />
              May override authority limits
            </label>
          </div>
          <div style={{ marginTop: 14 }}>
            <button
              type="submit"
              disabled={loading || !subjectId.trim() || !transactionTypes.length || !effectiveDate}
            >
              Save Grant
            </button>
          </div>
        </form>
      )}

      <div className="ps-table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Product</th>
              <th>State</th>
              <th>Transactions</th>
              <th>Max Premium</th>
              <th>Max Limit</th>
              <th>May Override</th>
              <th>Effective</th>
              <th>Expiration</th>
              <th>Status</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={canManage ? 11 : 10} className="muted">No authority grants configured</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.grant_id}>
                <td>{row.subject_type}: {row.subject_id}</td>
                <td>{row.product_code ? productLabel(row.product_code) : <span className="muted">All</span>}</td>
                <td>{row.state_code || <span className="muted">All</span>}</td>
                <td>{(row.transaction_types || []).map(t => t === '*' ? 'All' : t).join(', ')}</td>
                <td>{row.max_premium ?? <span className="muted">Unlimited</span>}</td>
                <td>{row.max_limit ?? <span className="muted">Unlimited</span>}</td>
                <td>{row.may_override ? 'Yes' : 'No'}</td>
                <td>{formatDisplayDate(row.effective_date, { fallback: '-' })}</td>
                <td>{formatDisplayDate(row.expiration_date, { fallback: '-' })}</td>
                <td><span className={`badge ${row.active ? 'green' : 'gray'}`}>{row.active ? 'Active' : 'Inactive'}</span></td>
                {canManage && (
                  <td>
                    {row.active ? (
                      <button type="button" className="btn-secondary" onClick={() => onDeactivate(row)} disabled={loading}>
                        Deactivate
                      </button>
                    ) : (
                      <button type="button" className="btn-secondary" onClick={() => onReactivate(row)} disabled={loading}>
                        Reactivate
                      </button>
                    )}
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
