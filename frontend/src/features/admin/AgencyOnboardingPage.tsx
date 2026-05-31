import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { adminApi } from '../../api/client'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import { formatDisplayDateTime } from '../../shared/dateDisplay'
import {
  useOnboardingAgencies,
  useCreateOnboardingAgencyMutation,
  useUpdateOnboardingAgencyMutation,
  useCreateOnboardingAgencyContactMutation,
  useUpdateOnboardingAgencyContactMutation,
  useDeleteOnboardingAgencyContactMutation,
} from '../../api/hooks'

type AgencyForm = {
  agencyId: string
  agencyKey: string
  agencyCode: string
  parentAgencyId: string
  parentAgencyKey: string
  parentAgencyCode: string
  parentAgencyName: string
  legalName: string
  dbaName: string
  npn: string
  feinLast4: string
  agencyType: string
  commissionRate: string
  status: string
  effectiveFrom: string
  effectiveTo: string
}

type ContactForm = {
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  extension: string
  preferred: boolean
  verified: boolean
}

type PopupMode = 'create' | 'view' | 'edit' | null
type AgencyFieldErrorKey =
  | 'legalName'
  | 'npn'
  | 'feinLast4'
  | 'agencyType'
  | 'status'
  | 'commissionRate'
  | 'effectiveFrom'
  | 'effectiveTo'

type ContactFieldErrorKey =
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phoneNumber'
  | 'extension'

type AgencyFieldErrors = Partial<Record<AgencyFieldErrorKey, string>>
type ContactFieldErrors = Partial<Record<ContactFieldErrorKey, string>>

const STATUS_OPTIONS = [
  'PROSPECT',
  'PENDING_COMPLIANCE',
  'PENDING_CONTRACT',
  'PENDING_APPOINTMENT',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED'
]

const AGENCY_TYPE_OPTIONS = ['INDEPENDENT', 'CAPTIVE', 'MGA', 'WHOLESALER']

const EMPTY_AGENCY_FORM: AgencyForm = {
  agencyId: '',
  agencyKey: '',
  agencyCode: '',
  parentAgencyId: '',
  parentAgencyKey: '',
  parentAgencyCode: '',
  parentAgencyName: '',
  legalName: '',
  dbaName: '',
  npn: '',
  feinLast4: '',
  agencyType: 'INDEPENDENT',
  commissionRate: '',
  status: 'PROSPECT',
  effectiveFrom: '',
  effectiveTo: ''
}

const EMPTY_CONTACT_FORM: ContactForm = {
  firstName: '',
  lastName: '',
  email: '',
  phoneNumber: '',
  extension: '',
  preferred: false,
  verified: false
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ONBOARDING_NEW_ROUTE = /\/admin\/onboarding\/new\/?$/
const ONBOARDING_DETAIL_ROUTE = /\/admin\/onboarding\/(view|edit)\/([^/]+)\/?$/

function normalizeDigits(value: string): string {
  return String(value || '').replace(/\D+/g, '')
}

function validateAgencyForm(form: AgencyForm): AgencyFieldErrors {
  const errors: AgencyFieldErrors = {}
  const legalName = String(form.legalName || '').trim()
  const npnDigits = normalizeDigits(form.npn)
  const feinDigits = normalizeDigits(form.feinLast4)
  const commissionRaw = String(form.commissionRate || '').trim()

  if (!legalName) {
    errors.legalName = 'Legal name is required.'
  }
  if (!String(form.agencyType || '').trim()) {
    errors.agencyType = 'Agency type is required.'
  }
  if (!String(form.status || '').trim()) {
    errors.status = 'Status is required.'
  }

  if (!npnDigits && !feinDigits) {
    errors.npn = 'Enter Agency NPN or FEIN Last4.'
    errors.feinLast4 = 'Enter Agency NPN or FEIN Last4.'
  }
  if (npnDigits && (npnDigits.length < 5 || npnDigits.length > 20)) {
    errors.npn = 'Enter a valid NPN (5-20 digits).'
  }
  if (String(form.feinLast4 || '').trim() && feinDigits.length !== 4) {
    errors.feinLast4 = 'FEIN Last4 must be exactly 4 digits.'
  }

  if (commissionRaw) {
    const commission = Number(commissionRaw)
    if (!Number.isFinite(commission)) {
      errors.commissionRate = 'Enter a valid commission rate.'
    } else if (commission < 0 || commission > 100) {
      errors.commissionRate = 'Commission rate must be between 0 and 100.'
    }
  }

  if (form.effectiveFrom && form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
    errors.effectiveTo = 'Effective To must be on or after Effective From.'
  }

  return errors
}

function validateContactForm(form: ContactForm): ContactFieldErrors {
  const errors: ContactFieldErrors = {}
  const firstName = String(form.firstName || '').trim()
  const lastName = String(form.lastName || '').trim()
  const email = String(form.email || '').trim()
  const phone = String(form.phoneNumber || '').trim()
  const phoneDigits = normalizeDigits(phone)
  const ext = String(form.extension || '').trim()

  if (!firstName) errors.firstName = 'First name is required.'
  if (!lastName) errors.lastName = 'Last name is required.'

  if (!email && !phone) {
    errors.email = 'Email or phone number is required.'
    errors.phoneNumber = 'Email or phone number is required.'
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.'
  }
  if (phone && phoneDigits.length < 7) {
    errors.phoneNumber = 'Enter a valid phone number.'
  }
  if (ext && !/^\d{1,8}$/.test(ext)) {
    errors.extension = 'Extension must be numeric (up to 8 digits).'
  }

  return errors
}

function getRouteMode(pathname: string): PopupMode {
  if (ONBOARDING_NEW_ROUTE.test(pathname)) return 'create'
  const detailMatch = pathname.match(ONBOARDING_DETAIL_ROUTE)
  if (!detailMatch) return null
  return detailMatch[1] as 'view' | 'edit'
}

function getRouteAgencyId(pathname: string): string {
  const detailMatch = pathname.match(ONBOARDING_DETAIL_ROUTE)
  if (!detailMatch) return ''
  return decodeURIComponent(detailMatch[2] || '')
}

export function AgencyOnboardingPage() {
  const { user } = useAuth()
  const canRead = hasPermission(user, 'admin.onboarding.read')
  const canManage = hasPermission(user, 'admin.onboarding.manage')
  const location = useLocation()
  const navigate = useNavigate()

  const [saving, setSaving] = useState(false)
  const [popupLoading, setPopupLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchStatus, setSearchStatus] = useState('ALL')

  const [popupMode, setPopupMode] = useState<PopupMode>(null)
  const [agencyForm, setAgencyForm] = useState<AgencyForm>(EMPTY_AGENCY_FORM)
  const [contacts, setContacts] = useState<any[]>([])
  const [contactForm, setContactForm] = useState<ContactForm>(EMPTY_CONTACT_FORM)
  const [editingContactId, setEditingContactId] = useState('')
  const [agencyFieldErrors, setAgencyFieldErrors] = useState<AgencyFieldErrors>({})
  const [contactFieldErrors, setContactFieldErrors] = useState<ContactFieldErrors>({})
  const routeMode = getRouteMode(location.pathname)
  const routeAgencyId = getRouteAgencyId(location.pathname)
  const activeMode: PopupMode = routeMode ?? popupMode
  const isEditorOpen = routeMode !== null
  const isViewPopup = activeMode === 'view'

  const {
    data: agenciesData,
    isLoading: loading,
    refetch: refetchAgencies,
  } = useOnboardingAgencies(
    {
      q: searchQuery || undefined,
      status: searchStatus !== 'ALL' ? searchStatus : undefined,
      limit: 200,
    },
    canRead
  )
  const agencies: any[] = agenciesData ?? []

  const {
    data: childAgenciesData,
    isLoading: childAgenciesLoading,
  } = useOnboardingAgencies(
    {
      parentAgencyId: agencyForm.agencyId || undefined,
      limit: 200,
    },
    canRead && isEditorOpen && Boolean(agencyForm.agencyId)
  )
  const childAgencies: any[] = (childAgenciesData ?? []).filter((row: any) => row?.agencyId !== agencyForm.agencyId)
  const isLoading = loading || popupLoading

  const createAgencyMutation = useCreateOnboardingAgencyMutation()
  const updateAgencyMutation = useUpdateOnboardingAgencyMutation()
  const createContactMutation = useCreateOnboardingAgencyContactMutation()
  const updateContactMutation = useUpdateOnboardingAgencyContactMutation()
  const deleteContactMutation = useDeleteOnboardingAgencyContactMutation()

  function openAgencyInPage(agencyId: string, mode: 'view' | 'edit') {
    if (!agencyId) return
    navigate(`/admin/onboarding/${mode}/${encodeURIComponent(agencyId)}`)
  }

  function openNewAgencyInPage() {
    navigate('/admin/onboarding/new')
  }

  function closeAgencyInPage() {
    navigate('/admin/onboarding')
  }

  async function loadAgencies() {
    await refetchAgencies()
  }

  async function loadAgencyIntoPopup(
    agencyId: string,
    options: { mode?: Exclude<PopupMode, 'create'>; silent?: boolean } = {}
  ) {
    const { mode = 'edit', silent = false } = options
    setPopupLoading(true)
    setError(null)
    try {
      const payload = await adminApi.getOnboardingAgency(agencyId)
      const agency = payload?.agency || {}
      setAgencyForm({
        agencyId: agency.agencyId || '',
        agencyKey: agency.agencyKey || '',
        agencyCode: agency.agencyCode || '',
        parentAgencyId: agency.parentAgencyId || '',
        parentAgencyKey: agency.parentAgencyKey || '',
        parentAgencyCode: agency.parentAgencyCode || '',
        parentAgencyName: agency.parentAgencyName || '',
        legalName: agency.legalName || '',
        dbaName: agency.dbaName || '',
        npn: agency.npn || '',
        feinLast4: agency.feinLast4 || '',
        agencyType: agency.agencyType || 'INDEPENDENT',
        commissionRate: agency.commissionRate === null || agency.commissionRate === undefined ? '' : String(agency.commissionRate),
        status: agency.status || 'PROSPECT',
        effectiveFrom: agency.effectiveFrom || '',
        effectiveTo: agency.effectiveTo || ''
      })
      setContacts(payload?.contacts || [])
      setContactForm(EMPTY_CONTACT_FORM)
      setEditingContactId('')
      setAgencyFieldErrors({})
      setContactFieldErrors({})
      setPopupMode(mode)
      if (!silent) {
        setSuccess(`Loaded agency ${agency.agencyCode || agency.agencyKey || agency.agencyId}`)
      }
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setPopupLoading(false)
    }
  }

  function openNewAgencyPopup() {
    setPopupMode('create')
    setAgencyForm(EMPTY_AGENCY_FORM)
    setContacts([])
    setContactForm(EMPTY_CONTACT_FORM)
    setEditingContactId('')
    setAgencyFieldErrors({})
    setContactFieldErrors({})
    setError(null)
    setSuccess(null)
  }

  function closeAgencyPopup() {
    if (saving) return
    setPopupMode(null)
    setAgencyFieldErrors({})
    setContactFieldErrors({})
  }

  useEffect(() => {
    if (routeMode === 'create') {
      openNewAgencyPopup()
      return
    }
    if ((routeMode === 'view' || routeMode === 'edit') && routeAgencyId) {
      setPopupMode(routeMode)
      void loadAgencyIntoPopup(routeAgencyId, { mode: routeMode, silent: true })
      return
    }
    if (popupMode !== null) closeAgencyPopup()
  }, [routeMode, routeAgencyId])

  async function saveAgencyFromPopup() {
    const mode = routeMode ?? popupMode
    if (mode === 'view') return
    if (!canManage) return
    const validationErrors = validateAgencyForm(agencyForm)
    setAgencyFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      setError('Please correct the required fields before saving the agency.')
      return
    }

    const payload = {
      agencyKey: agencyForm.agencyKey || undefined,
      agencyCode: agencyForm.agencyCode || undefined,
      parentAgencyId: agencyForm.parentAgencyId,
      parentAgencyKey: agencyForm.parentAgencyKey,
      parentAgencyCode: agencyForm.parentAgencyCode,
      legalName: agencyForm.legalName.trim(),
      dbaName: agencyForm.dbaName || undefined,
      npn: agencyForm.npn || undefined,
      feinLast4: agencyForm.feinLast4 || undefined,
      agencyType: agencyForm.agencyType,
      commissionRate: agencyForm.commissionRate || undefined,
      status: agencyForm.status,
      effectiveFrom: agencyForm.effectiveFrom || undefined,
      effectiveTo: agencyForm.effectiveTo || undefined
    }

    setSaving(true)
    setError(null)
    try {
      let response: any
      if (mode === 'edit' && agencyForm.agencyId) {
        response = await updateAgencyMutation.mutateAsync({ agencyId: agencyForm.agencyId, payload })
      } else {
        response = await createAgencyMutation.mutateAsync(payload)
      }
      const savedAgencyId = response?.agency?.agencyId || agencyForm.agencyId
      if (!savedAgencyId) {
        throw new Error('Agency save response is missing agency id.')
      }
      await refetchAgencies()
      navigate(`/admin/onboarding/edit/${encodeURIComponent(savedAgencyId)}`)
      setAgencyFieldErrors({})
      setSuccess(`Agency ${response?.agency?.agencyCode || response?.agency?.agencyKey || savedAgencyId} saved.`)
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function saveContact() {
    if (!canManage) return
    if (!agencyForm.agencyId) {
      setError('Save the agency first, then add contacts.')
      return
    }
    const validationErrors = validateContactForm(contactForm)
    setContactFieldErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      setError('Please correct the contact fields before saving.')
      return
    }
    const normalizedEmail = contactForm.email.trim()
    const normalizedPhone = contactForm.phoneNumber.trim()
    const contactType: 'PHONE' | 'EMAIL' = normalizedEmail ? 'EMAIL' : 'PHONE'
    const primaryValue = normalizedEmail || normalizedPhone

    const payload = {
      contactType,
      subType: 'work',
      value: primaryValue,
      extension: contactForm.extension || undefined,
      preferred: Boolean(contactForm.preferred),
      verified: Boolean(contactForm.verified),
      metadata: {
        firstName: contactForm.firstName.trim(),
        lastName: contactForm.lastName.trim(),
        email: normalizedEmail,
        phoneNumber: normalizedPhone
      }
    }

    setSaving(true)
    setError(null)
    try {
      if (editingContactId) {
        await updateContactMutation.mutateAsync({ agencyId: agencyForm.agencyId, contactId: editingContactId, payload })
      } else {
        await createContactMutation.mutateAsync({ agencyId: agencyForm.agencyId, payload })
      }
      await loadAgencyIntoPopup(agencyForm.agencyId, { mode: 'edit', silent: true })
      setContactForm(EMPTY_CONTACT_FORM)
      setEditingContactId('')
      setContactFieldErrors({})
      setSuccess('Contact saved.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteContact(contactId: string) {
    if (!canManage || !agencyForm.agencyId || !contactId) return
    setSaving(true)
    setError(null)
    try {
      await deleteContactMutation.mutateAsync({ agencyId: agencyForm.agencyId, contactId })
      await loadAgencyIntoPopup(agencyForm.agencyId, { mode: 'edit', silent: true })
      setContactForm(EMPTY_CONTACT_FORM)
      setEditingContactId('')
      setContactFieldErrors({})
      setSuccess('Contact deleted.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  function editContact(contact: any) {
    const metadata = contact?.metadata && typeof contact.metadata === 'object' ? contact.metadata : {}
    setEditingContactId(contact.contactId)
    setContactForm({
      firstName: String(metadata.firstName || ''),
      lastName: String(metadata.lastName || ''),
      email: String(metadata.email || (contact.contactType === 'EMAIL' ? contact.value || '' : '')),
      phoneNumber: String(metadata.phoneNumber || (contact.contactType === 'PHONE' ? contact.value || '' : '')),
      extension: contact.extension || '',
      preferred: Boolean(contact.preferred),
      verified: Boolean(contact.verified)
    })
    setContactFieldErrors({})
  }

  function openChildAgency(agencyId: string, mode: Exclude<PopupMode, 'create'>) {
    if (!agencyId) return
    openAgencyInPage(agencyId, mode)
  }

  if (!canRead) {
    return <div className="card"><div className="error">Permission required: admin.onboarding.read</div></div>
  }

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Agency Onboarding</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Single search and table view for all agencies. Parent agencies can own multiple child agencies, and contacts stay scoped to each agency.</p>
        </div>
        <div className="ps-page-header-actions">
          {!isEditorOpen && (
            <>
              <button className="btn-secondary" onClick={() => void loadAgencies()} disabled={isLoading}>Refresh</button>
              <button onClick={openNewAgencyInPage} disabled={!canManage || saving}>New Agency</button>
            </>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {success && <div className="muted">{success}</div>}

      {!isEditorOpen && (
        <>
          <div className="ps-filter-panel">
            <form className="ps-filter-grid" onSubmit={(e) => { e.preventDefault(); void loadAgencies() }} role="search">
              <div className="ps-filter-col ps-filter-col--wide">
                <label className="ps-filter-label" htmlFor="agency-filter-q">Query</label>
                <input id="agency-filter-q" className="ps-filter-input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Agency code, key, legal name, DBA, or NPN" />
              </div>
              <div className="ps-filter-col">
                <label className="ps-filter-label" htmlFor="agency-filter-status">Status</label>
                <select id="agency-filter-status" className="ps-filter-select" value={searchStatus} onChange={(event) => setSearchStatus(event.target.value)}>
                  <option value="ALL">All</option>
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </div>
              <div className="ps-filter-actions">
                <button type="submit" className="ps-filter-btn-search" disabled={isLoading}>Search</button>
              </div>
            </form>
          </div>

          <div className="ps-table-card" style={{ marginTop: 16 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Agency Code</th>
                  <th>Agency Key</th>
                  <th>Parent Agency</th>
                  <th>Legal Name</th>
                  <th>Type</th>
                  <th>Commission %</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {agencies.map((row) => (
                  <tr key={row.agencyId}>
                    <td>{row.agencyCode || '-'}</td>
                    <td>{row.agencyKey || '-'}</td>
                    <td>
                      {row.parentAgencyCode
                        ? `${row.parentAgencyCode}${row.parentAgencyName ? ` - ${row.parentAgencyName}` : ''}`
                        : (row.parentAgencyKey || '-')}
                    </td>
                    <td>{row.legalName || '-'}</td>
                    <td>{row.agencyType || '-'}</td>
                    <td>{row.commissionRate === null || row.commissionRate === undefined ? '-' : `${row.commissionRate}%`}</td>
                    <td>{row.status || '-'}</td>
                    <td>{formatDisplayDateTime(row.updatedAt || '')}</td>
                    <td>
                      <div className="table-actions table-actions--icons">
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`View agency ${row.agencyCode || row.agencyKey || row.agencyId}`}
                          title="View"
                          onClick={() => openAgencyInPage(row.agencyId, 'view')}
                          disabled={isLoading || saving}
                        >
                          {'\u{1F441}'}
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`Edit agency ${row.agencyCode || row.agencyKey || row.agencyId}`}
                          title="Edit"
                          onClick={() => openAgencyInPage(row.agencyId, 'edit')}
                          disabled={isLoading || saving || !canManage}
                        >
                          {'\u270E'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!agencies.length && (
                  <tr><td colSpan={9} className="muted">No agencies found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {isEditorOpen && (
        <div className="ps-table-card" style={{ marginTop: 16 }}>
          <div>
            <div className="modal-header">
              <h3>
                {activeMode === 'create'
                  ? 'New Agency'
                  : activeMode === 'view'
                    ? 'View Agency'
                    : 'Edit Agency'}
              </h3>
              <button type="button" className="btn-secondary" onClick={closeAgencyInPage} disabled={saving}>Back</button>
            </div>

            {isViewPopup && <div className="muted" style={{ marginBottom: 8 }}>View mode is read-only. Use Edit from search results to make changes.</div>}

            {agencyForm.agencyId && (
              <>
                <h4 className="section-title">Child Agencies</h4>
                <div style={{ overflowX: 'auto', marginBottom: 12 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Agency Code</th>
                        <th>Agency Key</th>
                        <th>Legal Name</th>
                        <th>Status</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {childAgenciesLoading && (
                        <tr>
                          <td colSpan={6} className="muted">Loading child agencies...</td>
                        </tr>
                      )}
                      {!childAgenciesLoading && childAgencies.map((row) => (
                        <tr key={row.agencyId}>
                          <td>{row.agencyCode || '-'}</td>
                          <td>{row.agencyKey || '-'}</td>
                          <td>{row.legalName || '-'}</td>
                          <td>{row.status || '-'}</td>
                          <td>{formatDisplayDateTime(row.updatedAt || '')}</td>
                          <td>
                            <div className="table-actions table-actions--icons">
                              <button
                                type="button"
                                className="icon-action-btn"
                                aria-label={`View child agency ${row.agencyCode || row.agencyKey || row.agencyId}`}
                                title="View"
                                onClick={() => openChildAgency(row.agencyId, 'view')}
                                disabled={popupLoading || saving}
                              >
                                {'\u{1F441}'}
                              </button>
                              <button
                                type="button"
                                className="icon-action-btn"
                                aria-label={`Edit child agency ${row.agencyCode || row.agencyKey || row.agencyId}`}
                                title="Edit"
                                onClick={() => openChildAgency(row.agencyId, 'edit')}
                                disabled={popupLoading || saving || !canManage}
                              >
                                {'\u270E'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {!childAgenciesLoading && childAgencies.length === 0 && (
                        <tr>
                          <td colSpan={6} className="muted">No child agencies linked to this parent agency.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <fieldset disabled={isViewPopup} style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0 }}>
            <div className="row row-spaced">
              <div className="col">
                <label>Agency ID</label>
                <input value={agencyForm.agencyId || 'Generated on save'} readOnly />
              </div>
              <div className="col">
                <label>Parent Agency ID</label>
                <input value={agencyForm.parentAgencyId || 'None'} readOnly />
              </div>
              <div className="col">
                <label>Agency Key</label>
                <input
                  value={agencyForm.agencyKey}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, agencyKey: event.target.value }))}
                  placeholder="Optional (auto-generated if blank)"
                />
              </div>
              <div className="col">
                <label>Agency Code</label>
                <input
                  value={agencyForm.agencyCode}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, agencyCode: event.target.value.toUpperCase() }))}
                  placeholder="Optional (auto-generated if blank)"
                />
              </div>
            </div>

            <div className="row">
              <div className="col">
                <label>Parent Agency Code</label>
                <input
                  value={agencyForm.parentAgencyCode}
                  onChange={(event) =>
                    setAgencyForm((prev) => ({
                      ...prev,
                      parentAgencyCode: event.target.value.toUpperCase(),
                      parentAgencyId: '',
                      parentAgencyName: ''
                    }))
                  }
                  placeholder="Optional (existing agency code)"
                />
              </div>
              <div className="col">
                <label>Parent Agency Key</label>
                <input
                  value={agencyForm.parentAgencyKey}
                  onChange={(event) =>
                    setAgencyForm((prev) => ({
                      ...prev,
                      parentAgencyKey: event.target.value,
                      parentAgencyId: '',
                      parentAgencyName: ''
                    }))
                  }
                  placeholder="Optional (existing agency key)"
                />
              </div>
              <div className="col">
                <label>Parent Agency Name</label>
                <input value={agencyForm.parentAgencyName || '-'} readOnly />
              </div>
            </div>

            <div className="row">
              <div className="col">
                <label>Legal Name <span className="label-required">*</span></label>
                <input
                  className={agencyFieldErrors.legalName ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.legalName ? 'true' : 'false'}
                  required
                  value={agencyForm.legalName}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, legalName: event.target.value }))}
                />
                {agencyFieldErrors.legalName && <div className="field-error-text">{agencyFieldErrors.legalName}</div>}
              </div>
              <div className="col">
                <label>DBA Name</label>
                <input value={agencyForm.dbaName} onChange={(event) => setAgencyForm((prev) => ({ ...prev, dbaName: event.target.value }))} />
              </div>
            </div>

            <div className="row">
              <div className="col">
                <label>NPN <span className="label-required">*</span></label>
                <input
                  className={agencyFieldErrors.npn ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.npn ? 'true' : 'false'}
                  value={agencyForm.npn}
                  inputMode="numeric"
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, npn: event.target.value }))}
                />
                {agencyFieldErrors.npn && <div className="field-error-text">{agencyFieldErrors.npn}</div>}
              </div>
              <div className="col">
                <label>FEIN Last4 <span className="label-required">*</span></label>
                <input
                  className={agencyFieldErrors.feinLast4 ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.feinLast4 ? 'true' : 'false'}
                  value={agencyForm.feinLast4}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) =>
                    setAgencyForm((prev) => ({ ...prev, feinLast4: event.target.value.replace(/\D+/g, '').slice(0, 4) }))
                  }
                />
                {agencyFieldErrors.feinLast4 && <div className="field-error-text">{agencyFieldErrors.feinLast4}</div>}
              </div>
              <div className="col">
                <label>Agency Type <span className="label-required">*</span></label>
                <select
                  className={agencyFieldErrors.agencyType ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.agencyType ? 'true' : 'false'}
                  value={agencyForm.agencyType}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, agencyType: event.target.value }))}
                >
                  {AGENCY_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
                {agencyFieldErrors.agencyType && <div className="field-error-text">{agencyFieldErrors.agencyType}</div>}
              </div>
              <div className="col">
                <label>Status <span className="label-required">*</span></label>
                <select
                  className={agencyFieldErrors.status ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.status ? 'true' : 'false'}
                  value={agencyForm.status}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, status: event.target.value }))}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                {agencyFieldErrors.status && <div className="field-error-text">{agencyFieldErrors.status}</div>}
              </div>
              <div className="col">
                <label>Commission %</label>
                <input
                  className={agencyFieldErrors.commissionRate ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.commissionRate ? 'true' : 'false'}
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={agencyForm.commissionRate}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, commissionRate: event.target.value }))}
                  placeholder="0.00"
                />
                {agencyFieldErrors.commissionRate && <div className="field-error-text">{agencyFieldErrors.commissionRate}</div>}
              </div>
            </div>

            <div className="row">
              <div className="col">
                <label>Effective From</label>
                <input
                  className={agencyFieldErrors.effectiveFrom ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.effectiveFrom ? 'true' : 'false'}
                  type="date"
                  value={agencyForm.effectiveFrom}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, effectiveFrom: event.target.value }))}
                />
                {agencyFieldErrors.effectiveFrom && <div className="field-error-text">{agencyFieldErrors.effectiveFrom}</div>}
              </div>
              <div className="col">
                <label>Effective To</label>
                <input
                  className={agencyFieldErrors.effectiveTo ? 'input-invalid' : ''}
                  aria-invalid={agencyFieldErrors.effectiveTo ? 'true' : 'false'}
                  type="date"
                  value={agencyForm.effectiveTo}
                  onChange={(event) => setAgencyForm((prev) => ({ ...prev, effectiveTo: event.target.value }))}
                />
                {agencyFieldErrors.effectiveTo && <div className="field-error-text">{agencyFieldErrors.effectiveTo}</div>}
              </div>
            </div>

            <div className="toolbar-actions row-spaced">
              <button type="button" onClick={() => void saveAgencyFromPopup()} disabled={!canManage || saving}>
                {activeMode === 'create' ? 'Create Agency' : 'Save Agency'}
              </button>
            </div>

            <h4 className="section-title">Agency Working Contacts</h4>
            {!agencyForm.agencyId && (
              <div className="muted">Save agency first, then add contacts.</div>
            )}

            <div className="row">
              <div className="col">
                <label>First Name <span className="label-required">*</span></label>
                <input
                  className={contactFieldErrors.firstName ? 'input-invalid' : ''}
                  aria-invalid={contactFieldErrors.firstName ? 'true' : 'false'}
                  value={contactForm.firstName}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, firstName: event.target.value }))}
                />
                {contactFieldErrors.firstName && <div className="field-error-text">{contactFieldErrors.firstName}</div>}
              </div>
              <div className="col">
                <label>Last Name <span className="label-required">*</span></label>
                <input
                  className={contactFieldErrors.lastName ? 'input-invalid' : ''}
                  aria-invalid={contactFieldErrors.lastName ? 'true' : 'false'}
                  value={contactForm.lastName}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, lastName: event.target.value }))}
                />
                {contactFieldErrors.lastName && <div className="field-error-text">{contactFieldErrors.lastName}</div>}
              </div>
              <div className="col">
                <label>Email <span className="label-required">*</span></label>
                <input
                  className={contactFieldErrors.email ? 'input-invalid' : ''}
                  aria-invalid={contactFieldErrors.email ? 'true' : 'false'}
                  value={contactForm.email}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="name@example.com"
                />
                {contactFieldErrors.email && <div className="field-error-text">{contactFieldErrors.email}</div>}
              </div>
              <div className="col">
                <label>Phone Number <span className="label-required">*</span></label>
                <input
                  className={contactFieldErrors.phoneNumber ? 'input-invalid' : ''}
                  aria-invalid={contactFieldErrors.phoneNumber ? 'true' : 'false'}
                  value={contactForm.phoneNumber}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, phoneNumber: event.target.value }))}
                  placeholder="+1 555 123 4567"
                />
                {contactFieldErrors.phoneNumber && <div className="field-error-text">{contactFieldErrors.phoneNumber}</div>}
              </div>
            </div>

            <div className="row">
              <div className="col">
                <label>Extension</label>
                <input
                  className={contactFieldErrors.extension ? 'input-invalid' : ''}
                  aria-invalid={contactFieldErrors.extension ? 'true' : 'false'}
                  value={contactForm.extension}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setContactForm((prev) => ({ ...prev, extension: event.target.value.replace(/\D+/g, '').slice(0, 8) }))}
                />
                {contactFieldErrors.extension && <div className="field-error-text">{contactFieldErrors.extension}</div>}
              </div>
              <div className="col" />
              <div className="col" />
              <div className="col" />
            </div>

            <div className="row">
              <div className="col">
                <label>
                  <input type="checkbox" checked={contactForm.preferred} onChange={(event) => setContactForm((prev) => ({ ...prev, preferred: event.target.checked }))} />
                  Preferred
                </label>
              </div>
              <div className="col">
                <label>
                  <input type="checkbox" checked={contactForm.verified} onChange={(event) => setContactForm((prev) => ({ ...prev, verified: event.target.checked }))} />
                  Verified
                </label>
              </div>
              <div className="col toolbar-actions" style={{ alignSelf: 'end', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setContactForm(EMPTY_CONTACT_FORM); setEditingContactId(''); setContactFieldErrors({}) }}
                  disabled={saving}
                >
                  Clear
                </button>
                <button type="button" onClick={() => void saveContact()} disabled={!canManage || saving || !agencyForm.agencyId}>
                  {editingContactId ? 'Update Contact' : 'Add Contact'}
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>First Name</th>
                    <th>Last Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Preferred</th>
                    <th>Verified</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((contact) => (
                    <tr key={contact.contactId}>
                      <td>{String(contact?.metadata?.firstName || '-')}</td>
                      <td>{String(contact?.metadata?.lastName || '-')}</td>
                      <td>{String(contact?.metadata?.email || (contact.contactType === 'EMAIL' ? contact.value || '-' : '-'))}</td>
                      <td>{String(contact?.metadata?.phoneNumber || (contact.contactType === 'PHONE' ? contact.value || '-' : '-'))}</td>
                      <td>{contact.preferred ? 'Yes' : 'No'}</td>
                      <td>{contact.verified ? 'Yes' : 'No'}</td>
                      <td>{formatDisplayDateTime(contact.updatedAt || '')}</td>
                      <td className="toolbar-actions">
                        <button type="button" className="btn-secondary" onClick={() => editContact(contact)} disabled={saving}>Edit</button>
                        <button type="button" className="btn-secondary" onClick={() => void deleteContact(contact.contactId)} disabled={saving || !canManage}>Delete</button>
                      </td>
                    </tr>
                  ))}
                  {!contacts.length && (
                    <tr><td colSpan={8} className="muted">No contacts available for this agency.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            </fieldset>
          </div>
        </div>
      )}
    </div>
  )
}

function extractErrorMessage(error: any): string {
  if (!error) return 'Unknown error'
  const text = String(error.message || error)
  const marker = text.indexOf('{')
  if (marker >= 0) {
    try {
      const parsed = JSON.parse(text.slice(marker))
      if (parsed?.message) return String(parsed.message)
    } catch {
      // ignore
    }
  }
  return text
}
