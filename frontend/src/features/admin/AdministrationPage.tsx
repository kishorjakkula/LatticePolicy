import { FormEvent, useMemo, useState } from 'react'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import {
  defaultRegionForCountry,
  normalizeCountryCode,
  normalizeRegionCode,
  regionsForCountry,
  type CountryCode
} from '../../shared/usStates'
import {
  useAdminUnderwritingCompanies,
  useCreateUnderwritingCompanyMutation,
  useUpdateUnderwritingCompanyMutation,
  useDeleteUnderwritingCompanyMutation,
} from '../../api/hooks'

type ProductCode = 'personal-auto' | 'commercial-auto' | 'homeowners' | 'cyber' | 'professional-liability'

type UnderwritingCompany = {
  companyId: string
  name: string
  productCode: ProductCode
  country: CountryCode
  state: string
  active: boolean
}

type CompanyDraft = {
  name: string
  productCode: ProductCode
  country: CountryCode
  state: string
  active: boolean
}

const EMPTY_DRAFT: CompanyDraft = {
  name: '',
  productCode: 'personal-auto',
  country: 'US',
  state: defaultRegionForCountry('US'),
  active: true
}

const ALL_REGION_OPTION = { code: 'ALL', name: 'All States/Provinces' }
const DUPLICATE_UW_COMPANY_MESSAGE =
  'Duplicate combination not allowed for this company, product, country, and state/province.'

function statesOverlap(a: string, b: string) {
  return a === b || a === 'ALL' || b === 'ALL'
}

export function AdministrationPage() {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CompanyDraft>(EMPTY_DRAFT)
  const [formError, setFormError] = useState<string | null>(null)
  const regionOptions = useMemo(() => [ALL_REGION_OPTION, ...regionsForCountry(draft.country)], [draft.country])

  const { data: rawItems, isLoading, error: loadError } = useAdminUnderwritingCompanies({ includeInactive: true })
  const items: UnderwritingCompany[] = rawItems ?? []
  const pagination = useClientPagination(items, 10)

  const createMutation = useCreateUnderwritingCompanyMutation()
  const updateMutation = useUpdateUnderwritingCompanyMutation()
  const deleteMutation = useDeleteUnderwritingCompanyMutation()

  const error = formError || (loadError ? String(loadError) : null)

  const resetForm = () => {
    setEditingId(null)
    setDraft(EMPTY_DRAFT)
    setFormError(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim() || !draft.productCode || !draft.country || !draft.state) return
    const normalizedDraftName = draft.name.trim().toLowerCase()
    const hasConflict = items.some((item) => {
      if (editingId && item.companyId === editingId) return false
      return (
        item.name.trim().toLowerCase() === normalizedDraftName &&
        item.productCode === draft.productCode &&
        normalizeCountryCode(item.country) === draft.country &&
        statesOverlap(normalizeRegionCode(item.state), draft.state)
      )
    })
    if (hasConflict) {
      setFormError(DUPLICATE_UW_COMPANY_MESSAGE)
      return
    }
    setFormError(null)
    try {
      if (editingId) {
        await updateMutation.mutateAsync({
          id: editingId,
          payload: {
            name: draft.name.trim(),
            productCode: draft.productCode,
            country: draft.country,
            state: draft.state,
            active: draft.active
          }
        })
      } else {
        await createMutation.mutateAsync({
          name: draft.name.trim(),
          productCode: draft.productCode,
          country: draft.country,
          state: draft.state,
          active: draft.active
        })
      }
      resetForm()
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const onEdit = (item: UnderwritingCompany) => {
    setEditingId(item.companyId)
    setDraft({
      name: item.name,
      productCode: item.productCode,
      country: normalizeCountryCode(item.country),
      state: normalizeRegionCode(item.state),
      active: item.active
    })
  }

  const onToggleActive = async (item: UnderwritingCompany) => {
    setFormError(null)
    try {
      await updateMutation.mutateAsync({ id: item.companyId, payload: { active: !item.active } })
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const onDelete = async (item: UnderwritingCompany) => {
    if (!confirm(`Delete underwriting company "${item.name}"?`)) return
    setFormError(null)
    try {
      await deleteMutation.mutateAsync(item.companyId)
      if (editingId === item.companyId) {
        resetForm()
      }
    } catch (e: any) {
      setFormError(e.message || String(e))
    }
  }

  const submitting = createMutation.isPending || updateMutation.isPending

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">UW Company</h2></div>
      </div>
      <h3>Underwriting Companies</h3>
      {error && <p className="error">{error}</p>}
      <form onSubmit={onSubmit} className="row" style={{ marginBottom: 12 }}>
        <div className="col">
          <label>Company Name</label>
          <input value={draft.name} onChange={(e) => setDraft(prev => ({ ...prev, name: e.target.value }))} />
        </div>
        <div className="col">
          <label>Product</label>
          <select value={draft.productCode} onChange={(e) => setDraft(prev => ({ ...prev, productCode: e.target.value as ProductCode }))}>
            <option value="personal-auto">Personal Auto</option>
            <option value="commercial-auto">Commercial Auto</option>
            <option value="homeowners">Homeowners</option>
            <option value="cyber">Cyber</option>
            <option value="professional-liability">Professional Liability</option>
          </select>
        </div>
        <div className="col">
          <label>Country</label>
          <select
            value={draft.country}
            onChange={(e) => {
              const nextCountry = normalizeCountryCode(e.target.value)
              setDraft(prev => ({
                ...prev,
                country: nextCountry,
                state: defaultRegionForCountry(nextCountry)
              }))
            }}
          >
            <option value="US">USA</option>
            <option value="CA">Canada</option>
          </select>
        </div>
        <div className="col">
          <label>State/Province</label>
          <select value={draft.state} onChange={(e) => setDraft(prev => ({ ...prev, state: normalizeRegionCode(e.target.value) }))}>
            {regionOptions.map((region) => (
              <option key={region.code} value={region.code}>{region.code} - {region.name}</option>
            ))}
          </select>
        </div>
        <div className="col">
          <label>Active</label>
          <select value={draft.active ? 'true' : 'false'} onChange={(e) => setDraft(prev => ({ ...prev, active: e.target.value === 'true' }))}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        <div className="col" style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
          <button type="submit" disabled={submitting || !draft.name.trim()}>
            {editingId ? 'Update' : 'Add'}
          </button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={resetForm} disabled={submitting}>
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="ps-table-card" style={{ marginTop: 16 }}>
        <table className="table">
        <thead>
          <tr>
            <th>Company Name</th>
            <th>Product</th>
            <th>Country</th>
            <th>State/Province</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
          {!isLoading && items.length === 0 && <tr><td colSpan={6} className="muted">No underwriting companies configured.</td></tr>}
          {!isLoading && pagination.rows.map((item) => (
            <tr key={item.companyId}>
              <td>{item.name}</td>
              <td>{item.productCode}</td>
              <td>{item.country}</td>
              <td>{item.state}</td>
              <td>{item.active ? 'Active' : 'Inactive'}</td>
              <td style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => onEdit(item)}>Edit</button>
                <button className="btn-secondary" onClick={() => onToggleActive(item)}>
                  {item.active ? 'Disable' : 'Enable'}
                </button>
                <button className="btn-secondary" onClick={() => onDelete(item)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      {!isLoading && items.length > 0 && (
        <TablePagination
          page={pagination.page}
          pageSize={pagination.pageSize}
          totalItems={pagination.totalItems}
          onPageChange={pagination.setPage}
          onPageSizeChange={pagination.setPageSize}
        />
      )}
    </div>
  )
}
