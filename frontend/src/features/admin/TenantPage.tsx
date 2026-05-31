import { useEffect, useMemo, useState } from 'react'
import {
  DATE_FORMAT_OPTIONS,
  applyTenantDatePreferences,
  normalizeTenantDatePreferences,
  type DateFormatValue
} from '../../shared/dateDisplay'
import { COUNTRIES } from '../../shared/usStates'
import { useTenant, useUpdateTenantMutation, useSeedMutation } from '../../api/hooks'

type DateFormatRow = {
  id: string
  country: string
  format: DateFormatValue
}

type PolicyNumberFormatRow = {
  id: string
  productCode: string
  pattern: string
}

type AiMlConfigState = {
  enabled: boolean
  shadowMode: boolean
  provider: string
  modelVersionByProduct: Record<string, string>
  features: {
    riskScoring: boolean
    fraudDetection: boolean
    premiumOptimization: boolean
    coverageRecommendations: boolean
  }
  thresholds: {
    riskReferral: number
    fraudReview: number
    premiumVariance: number
  }
}

function createDateFormatRow(country: string, format: DateFormatValue): DateFormatRow {
  return {
    id: `${country}-${format}-${Math.random().toString(36).slice(2, 8)}`,
    country,
    format
  }
}

function createPolicyNumberFormatRow(productCode: string, pattern: string): PolicyNumberFormatRow {
  return {
    id: `${productCode}-${Math.random().toString(36).slice(2, 8)}`,
    productCode,
    pattern
  }
}

function defaultAiMlConfigState(): AiMlConfigState {
  return {
    enabled: false,
    shadowMode: true,
    provider: 'internal-baseline',
    modelVersionByProduct: {
      'personal-auto': 'pa-risk-v1',
      'commercial-auto': 'ca-risk-v1',
      homeowners: 'ho-risk-v1',
      cyber: 'cyber-risk-v1',
      'professional-liability': 'pl-risk-v1'
    },
    features: {
      riskScoring: true,
      fraudDetection: true,
      premiumOptimization: true,
      coverageRecommendations: true
    },
    thresholds: {
      riskReferral: 0.72,
      fraudReview: 0.65,
      premiumVariance: 0.2
    }
  }
}

function normalizeAiMlConfigState(input: any): AiMlConfigState {
  const fallback = defaultAiMlConfigState()
  const source = input && typeof input === 'object' ? input : {}
  const features = source.features && typeof source.features === 'object' ? source.features : {}
  const thresholds = source.thresholds && typeof source.thresholds === 'object' ? source.thresholds : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    shadowMode: typeof source.shadowMode === 'boolean' ? source.shadowMode : fallback.shadowMode,
    provider: String(source.provider || fallback.provider || 'internal-baseline'),
    modelVersionByProduct: {
      ...fallback.modelVersionByProduct,
      ...(source.modelVersionByProduct && typeof source.modelVersionByProduct === 'object'
        ? source.modelVersionByProduct
        : {})
    },
    features: {
      riskScoring: typeof features.riskScoring === 'boolean' ? features.riskScoring : fallback.features.riskScoring,
      fraudDetection: typeof features.fraudDetection === 'boolean' ? features.fraudDetection : fallback.features.fraudDetection,
      premiumOptimization: typeof features.premiumOptimization === 'boolean' ? features.premiumOptimization : fallback.features.premiumOptimization,
      coverageRecommendations:
        typeof features.coverageRecommendations === 'boolean'
          ? features.coverageRecommendations
          : fallback.features.coverageRecommendations
    },
    thresholds: {
      riskReferral: Number.isFinite(Number(thresholds.riskReferral)) ? Number(thresholds.riskReferral) : fallback.thresholds.riskReferral,
      fraudReview: Number.isFinite(Number(thresholds.fraudReview)) ? Number(thresholds.fraudReview) : fallback.thresholds.fraudReview,
      premiumVariance: Number.isFinite(Number(thresholds.premiumVariance)) ? Number(thresholds.premiumVariance) : fallback.thresholds.premiumVariance
    }
  }
}

function applyTenantToState(t: any, setters: {
  setTenant: (v: any) => void
  setName: (v: string) => void
  setDefaultCountry: (v: string) => void
  setMfaRequired: (v: boolean) => void
  setAiMlConfig: (v: AiMlConfigState) => void
  setDateFormatRows: (v: DateFormatRow[]) => void
  setPolicyNumberRows: (v: PolicyNumberFormatRow[]) => void
}) {
  setters.setTenant(t)
  setters.setName(t.name || '')
  const normalized = normalizeTenantDatePreferences({
    defaultCountry: t.defaultCountry,
    dateFormatsByCountry: t.dateFormatsByCountry
  })
  setters.setDefaultCountry(normalized.defaultCountry)
  setters.setMfaRequired(Boolean(t.mfaRequired))
  setters.setAiMlConfig(normalizeAiMlConfigState(t.aiMlConfig))
  setters.setDateFormatRows(
    Object.entries(normalized.dateFormatsByCountry)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([country, format]) => createDateFormatRow(country, format))
  )
  const policyFormats = t.policyNumberFormatsByProduct && typeof t.policyNumberFormatsByProduct === 'object'
    ? t.policyNumberFormatsByProduct
    : { 'personal-auto': 'PC-{ID8}', 'commercial-auto': 'CA-{ID8}', homeowners: 'HO-{ID8}', cyber: 'CY-{ID8}', 'professional-liability': 'PL-{ID8}' }
  setters.setPolicyNumberRows(
    Object.entries(policyFormats)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([productCode, pattern]) => createPolicyNumberFormatRow(productCode, String(pattern || '').trim()))
  )
  applyTenantDatePreferences(normalized)
}

export function TenantPage() {
  const [tenant, setTenant] = useState<{ tenantId: string; name: string } | null>(null)
  const [name, setName] = useState('')
  const [defaultCountry, setDefaultCountry] = useState('US')
  const [mfaRequired, setMfaRequired] = useState(false)
  const [aiMlConfig, setAiMlConfig] = useState<AiMlConfigState>(defaultAiMlConfigState())
  const [dateFormatRows, setDateFormatRows] = useState<DateFormatRow[]>([
    createDateFormatRow('US', 'MM-DD-YYYY'),
    createDateFormatRow('CA', 'MM-DD-YYYY')
  ])
  const [policyNumberRows, setPolicyNumberRows] = useState<PolicyNumberFormatRow[]>([
    createPolicyNumberFormatRow('personal-auto', 'PC-{ID8}'),
    createPolicyNumberFormatRow('commercial-auto', 'CA-{ID8}'),
    createPolicyNumberFormatRow('homeowners', 'HO-{ID8}'),
    createPolicyNumberFormatRow('cyber', 'CY-{ID8}'),
    createPolicyNumberFormatRow('professional-liability', 'PL-{ID8}')
  ])
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const { data: tenantData, isLoading, error: loadError } = useTenant()
  const updateMutation = useUpdateTenantMutation()
  const seedMutation = useSeedMutation()

  const stateSetters = { setTenant, setName, setDefaultCountry, setMfaRequired, setAiMlConfig, setDateFormatRows, setPolicyNumberRows }

  useEffect(() => {
    if (tenantData) {
      applyTenantToState(tenantData, stateSetters)
    }
  }, [tenantData])

  const onSave = async () => {
    setFormError(null)
    try {
      const dateFormatsByCountry: Record<string, string> = {}
      for (const row of dateFormatRows) {
        const country = String(row.country || '').trim().toUpperCase()
        if (!country) continue
        if (!/^[A-Z]{2,3}$/.test(country)) {
          setFormError(`Invalid country code: ${row.country}`)
          return
        }
        if (dateFormatsByCountry[country]) {
          setFormError(`Duplicate country in date formats: ${country}`)
          return
        }
        dateFormatsByCountry[country] = row.format
      }
      if (!Object.keys(dateFormatsByCountry).length) {
        dateFormatsByCountry.US = 'MM-DD-YYYY'
      }
      if (!dateFormatsByCountry[defaultCountry]) {
        dateFormatsByCountry[defaultCountry] = 'MM-DD-YYYY'
      }
      const policyNumberFormatsByProduct: Record<string, string> = {}
      for (const row of policyNumberRows) {
        const productCode = String(row.productCode || '').trim().toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9._-]/g, '')
        const pattern = String(row.pattern || '').trim()
        if (!productCode && !pattern) continue
        if (!productCode || !pattern) {
          setFormError('Policy number format rows require both product code and pattern.')
          return
        }
        if (policyNumberFormatsByProduct[productCode]) {
          setFormError(`Duplicate product in policy number formats: ${productCode}`)
          return
        }
        policyNumberFormatsByProduct[productCode] = pattern
      }
      if (!Object.keys(policyNumberFormatsByProduct).length) {
        policyNumberFormatsByProduct['personal-auto'] = 'PC-{ID8}'
        policyNumberFormatsByProduct['commercial-auto'] = 'CA-{ID8}'
        policyNumberFormatsByProduct.homeowners = 'HO-{ID8}'
        policyNumberFormatsByProduct.cyber = 'CY-{ID8}'
        policyNumberFormatsByProduct['professional-liability'] = 'PL-{ID8}'
      }
      const payload = {
        name,
        defaultCountry,
        dateFormatsByCountry,
        policyNumberFormatsByProduct,
        mfaRequired,
        aiMlConfig
      }
      const t = await updateMutation.mutateAsync(payload)
      applyTenantToState(t, stateSetters)
    } catch (e:any) {
      setFormError(e.message || String(e))
    }
  }

  const onSeed = async () => {
    setSeedMsg(null); setFormError(null)
    try { await seedMutation.mutateAsync(); setSeedMsg('Seeded demo policies for this tenant.') } catch (e:any) { setFormError(e.message || String(e)) }
  }

  const defaultCountryOptions = useMemo(() => {
    const codes = new Set<string>(COUNTRIES.map((entry) => entry.code))
    for (const row of dateFormatRows) {
      const code = String(row.country || '').trim().toUpperCase()
      if (code) codes.add(code)
    }
    codes.add(defaultCountry)
    return Array.from(codes).sort()
  }, [dateFormatRows, defaultCountry])

  const updateDateFormatRow = (rowId: string, patch: Partial<DateFormatRow>) => {
    setDateFormatRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        return { ...row, ...patch }
      })
    )
  }

  const removeDateFormatRow = (rowId: string) => {
    setDateFormatRows((prev) => prev.filter((row) => row.id !== rowId))
  }

  const updatePolicyNumberRow = (rowId: string, patch: Partial<PolicyNumberFormatRow>) => {
    setPolicyNumberRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row
        return { ...row, ...patch }
      })
    )
  }

  const removePolicyNumberRow = (rowId: string) => {
    setPolicyNumberRows((prev) => prev.filter((row) => row.id !== rowId))
  }

  const loading = isLoading || updateMutation.isPending
  const seeding = seedMutation.isPending
  const error = formError || (loadError ? String(loadError) : null)

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Tenant</h2></div>
      </div>
      {error && <p className="error">{error}</p>}
      {seedMsg && <p className="muted">{seedMsg}</p>}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom: 8 }}>
        <button onClick={onSeed} disabled={seeding}>Seed Demo Policies</button>
      </div>
      <div className="row">
        <div className="col">
          <label>Tenant ID</label>
          <input value={tenant?.tenantId || ''} readOnly />
        </div>
        <div className="col">
          <label>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} />
        </div>
        <div className="col">
          <label>Default Country</label>
          <select value={defaultCountry} onChange={(e) => setDefaultCountry(String(e.target.value || '').trim().toUpperCase())}>
            {defaultCountryOptions.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label>MFA Required</label>
          <select value={mfaRequired ? 'Yes' : 'No'} onChange={(e) => setMfaRequired(e.target.value === 'Yes')}>
            <option value="No">No (default)</option>
            <option value="Yes">Yes</option>
          </select>
        </div>
        <div className="col" style={{ alignSelf:'end' }}>
          <button onClick={onSave} disabled={loading || !name.trim()}>Save</button>
        </div>
      </div>
      <div className="card stack-card">
        <div className="panel-header">
          <h3>AI / ML Configuration</h3>
        </div>
        <div className="row">
          <div className="col">
            <label>AI Enabled</label>
            <select
              value={aiMlConfig.enabled ? 'Yes' : 'No'}
              onChange={(e) => setAiMlConfig((prev) => ({ ...prev, enabled: e.target.value === 'Yes' }))}
            >
              <option value="No">No (default)</option>
              <option value="Yes">Yes</option>
            </select>
          </div>
          <div className="col">
            <label>Shadow Mode</label>
            <select
              value={aiMlConfig.shadowMode ? 'Yes' : 'No'}
              onChange={(e) => setAiMlConfig((prev) => ({ ...prev, shadowMode: e.target.value === 'Yes' }))}
            >
              <option value="Yes">Yes (recommendation only)</option>
              <option value="No">No (influence workflow)</option>
            </select>
          </div>
          <div className="col">
            <label>Provider</label>
            <select
              value={aiMlConfig.provider}
              onChange={(e) => setAiMlConfig((prev) => ({ ...prev, provider: e.target.value }))}
            >
              <option value="internal-baseline">internal-baseline</option>
              <option value="aws-sagemaker">aws-sagemaker</option>
              <option value="azure-ml">azure-ml</option>
              <option value="custom-endpoint">custom-endpoint</option>
            </select>
          </div>
        </div>
        <div className="row">
          <div className="col">
            <label>Model Version - Personal Auto</label>
            <input
              value={String(aiMlConfig.modelVersionByProduct['personal-auto'] || '')}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  modelVersionByProduct: {
                    ...prev.modelVersionByProduct,
                    'personal-auto': String(e.target.value || '')
                  }
                }))
              }
            />
          </div>
          <div className="col">
            <label>Model Version - Commercial Auto</label>
            <input
              value={String(aiMlConfig.modelVersionByProduct['commercial-auto'] || '')}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  modelVersionByProduct: {
                    ...prev.modelVersionByProduct,
                    'commercial-auto': String(e.target.value || '')
                  }
                }))
              }
            />
          </div>
          <div className="col">
            <label>Model Version - Homeowners</label>
            <input
              value={String(aiMlConfig.modelVersionByProduct.homeowners || '')}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  modelVersionByProduct: {
                    ...prev.modelVersionByProduct,
                    homeowners: String(e.target.value || '')
                  }
                }))
              }
            />
          </div>
          <div className="col">
            <label>Model Version - Cyber</label>
            <input
              value={String(aiMlConfig.modelVersionByProduct.cyber || '')}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  modelVersionByProduct: {
                    ...prev.modelVersionByProduct,
                    cyber: String(e.target.value || '')
                  }
                }))
              }
            />
          </div>
        </div>
        <div className="row">
          <div className="col">
            <label>Risk Referral Threshold (0-1)</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={aiMlConfig.thresholds.riskReferral}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, riskReferral: Number(e.target.value || prev.thresholds.riskReferral) }
                }))
              }
            />
          </div>
          <div className="col">
            <label>Fraud Review Threshold (0-1)</label>
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={aiMlConfig.thresholds.fraudReview}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, fraudReview: Number(e.target.value || prev.thresholds.fraudReview) }
                }))
              }
            />
          </div>
          <div className="col">
            <label>Premium Variance Threshold (0-1)</label>
            <input
              type="number"
              min={0.05}
              max={1}
              step={0.01}
              value={aiMlConfig.thresholds.premiumVariance}
              onChange={(e) =>
                setAiMlConfig((prev) => ({
                  ...prev,
                  thresholds: { ...prev.thresholds, premiumVariance: Number(e.target.value || prev.thresholds.premiumVariance) }
                }))
              }
            />
          </div>
        </div>
        <div className="row">
          <div className="col">
            <label>
              <input
                type="checkbox"
                checked={aiMlConfig.features.riskScoring}
                onChange={(e) =>
                  setAiMlConfig((prev) => ({
                    ...prev,
                    features: { ...prev.features, riskScoring: e.target.checked }
                  }))
                }
              />
              Risk Scoring
            </label>
          </div>
          <div className="col">
            <label>
              <input
                type="checkbox"
                checked={aiMlConfig.features.fraudDetection}
                onChange={(e) =>
                  setAiMlConfig((prev) => ({
                    ...prev,
                    features: { ...prev.features, fraudDetection: e.target.checked }
                  }))
                }
              />
              Fraud Detection
            </label>
          </div>
          <div className="col">
            <label>
              <input
                type="checkbox"
                checked={aiMlConfig.features.premiumOptimization}
                onChange={(e) =>
                  setAiMlConfig((prev) => ({
                    ...prev,
                    features: { ...prev.features, premiumOptimization: e.target.checked }
                  }))
                }
              />
              Premium Optimization
            </label>
          </div>
          <div className="col">
            <label>
              <input
                type="checkbox"
                checked={aiMlConfig.features.coverageRecommendations}
                onChange={(e) =>
                  setAiMlConfig((prev) => ({
                    ...prev,
                    features: { ...prev.features, coverageRecommendations: e.target.checked }
                  }))
                }
              />
              Coverage Recommendations
            </label>
          </div>
        </div>
      </div>
      <div className="card stack-card">
        <div className="panel-header">
          <h3>Date Format by Country</h3>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setDateFormatRows((prev) => [...prev, createDateFormatRow('', 'MM-DD-YYYY')])}
          >
            Add Country Format
          </button>
        </div>
        <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
        <table className="table">
          <thead>
            <tr><th>Country</th><th>Date Format</th><th></th></tr>
          </thead>
          <tbody>
            {dateFormatRows.length === 0 && <tr><td colSpan={3} className="muted">No country date formats configured.</td></tr>}
            {dateFormatRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    value={row.country}
                    placeholder="US"
                    maxLength={3}
                    onChange={(e) => updateDateFormatRow(row.id, { country: String(e.target.value || '').toUpperCase() })}
                  />
                </td>
                <td>
                  <select
                    value={row.format}
                    onChange={(e) => updateDateFormatRow(row.id, { format: e.target.value as DateFormatValue })}
                  >
                    {DATE_FORMAT_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </td>
                <td className="table-actions">
                  <button className="btn-secondary" type="button" onClick={() => removeDateFormatRow(row.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      <div className="card stack-card">
        <div className="panel-header">
          <h3>Policy Number Format by Product</h3>
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setPolicyNumberRows((prev) => [...prev, createPolicyNumberFormatRow('', '')])}
          >
            Add Product Format
          </button>
        </div>
        <p className="muted">Supported tokens: `{'{PRODUCT}'}`, `{'{ID8}'}`, `{'{ID6}'}`, `{'{ID}'}`, `{'{YYYY}'}`, `{'{YY}'}`, `{'{MM}'}`, `{'{DD}'}`, `{'{RAND4}'}`, `{'{RAND6}'}`, `{'{RAND8}'}`.</p>
        <div className="ps-table-card" style={{ margin: '0 -20px -20px', borderRadius: '0 0 12px 12px', border: 'none', borderTop: '1px solid var(--border)', boxShadow: 'none' }}>
        <table className="table">
          <thead>
            <tr><th>Product Code</th><th>Pattern</th><th></th></tr>
          </thead>
          <tbody>
            {policyNumberRows.length === 0 && <tr><td colSpan={3} className="muted">No policy number formats configured.</td></tr>}
            {policyNumberRows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    value={row.productCode}
                    placeholder="personal-auto"
                    onChange={(e) =>
                      updatePolicyNumberRow(row.id, {
                        productCode: String(e.target.value || '').toLowerCase()
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    value={row.pattern}
                    placeholder="PC-{ID8}"
                    onChange={(e) => updatePolicyNumberRow(row.id, { pattern: String(e.target.value || '') })}
                  />
                </td>
                <td className="table-actions">
                  <button className="btn-secondary" type="button" onClick={() => removePolicyNumberRow(row.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
