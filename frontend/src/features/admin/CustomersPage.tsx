import { FormEvent, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { adminApi as api } from '../../api/client'
import { useCustomerSettings, useUpdateCustomerSettingsMutation } from '../../api/hooks'
import { hasPermission } from '../../auth/permissions'
import { useAuth } from '../../auth/AuthContext'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { formatDisplayDate, formatDisplayDateTime } from '../../shared/dateDisplay'

type EntityType = 'INDIVIDUAL' | 'COMPANY' | 'BOTH'
type CustomerStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'MERGED' | 'PENDING_APPROVAL' | 'ARCHIVED'
type SectionKey = 'identity' | 'contact' | 'relationships' | 'policies' | 'identifiers' | 'notes' | 'audit'
type CustomerPageMode = 'create' | 'view' | 'edit' | null

const SECTION_OPTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: 'identity', label: 'Identity' },
  { key: 'contact', label: 'Contact & Address' },
  { key: 'relationships', label: 'Relationships' },
  { key: 'policies', label: 'Policies' },
  { key: 'identifiers', label: 'Identifiers & Compliance' },
  { key: 'notes', label: 'Notes & Attachments' },
  { key: 'audit', label: 'Audit & Versions' }
]

const ENTITY_OPTIONS: EntityType[] = ['INDIVIDUAL', 'COMPANY', 'BOTH']
const STATUS_OPTIONS: CustomerStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE', 'MERGED', 'PENDING_APPROVAL', 'ARCHIVED']
const CUSTOMER_NEW_ROUTE = /\/admin\/customers\/new\/?$/
const CUSTOMER_DETAIL_ROUTE = /\/admin\/customers\/(view|edit)\/([^/]+)\/?$/

function getCustomerRouteMode(pathname: string): CustomerPageMode {
  if (CUSTOMER_NEW_ROUTE.test(pathname)) return 'create'
  const detailMatch = pathname.match(CUSTOMER_DETAIL_ROUTE)
  if (!detailMatch) return null
  return detailMatch[1] as 'view' | 'edit'
}

function getCustomerRouteId(pathname: string): string {
  const detailMatch = pathname.match(CUSTOMER_DETAIL_ROUTE)
  if (!detailMatch) return ''
  return decodeURIComponent(detailMatch[2] || '')
}

export function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canRead = hasPermission(user, 'admin.customers.read')
  const canManage = hasPermission(user, 'admin.customers.manage')
  const canContactManage = hasPermission(user, 'admin.customers.contact.manage')
  const canApprove = hasPermission(user, 'admin.customers.approve')
  const canMerge = hasPermission(user, 'admin.customers.merge')
  const canDeactivate = hasPermission(user, 'admin.customers.deactivate')
  const canImport = hasPermission(user, 'admin.customers.import')
  const canExport = hasPermission(user, 'admin.customers.export')
  const canReveal = hasPermission(user, 'admin.customers.pii_reveal')

  const [section, setSection] = useState<SectionKey>('identity')
  const [settingsDraft, setSettingsDraft] = useState<any>(null)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [record, setRecord] = useState<any>(() => emptyCustomerRecord())
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [validationWarnings, setValidationWarnings] = useState<string[]>([])
  const [potentialMatches, setPotentialMatches] = useState<any[]>([])
  const [auditRows, setAuditRows] = useState<any[]>([])
  const [customerPolicies, setCustomerPolicies] = useState<any[]>([])
  const [unlinkedPolicies, setUnlinkedPolicies] = useState<any[]>([])
  const [unlinkedPolicyFilters, setUnlinkedPolicyFilters] = useState({
    q: '',
    productCode: '',
    status: ''
  })
  const [linkingPolicyId, setLinkingPolicyId] = useState('')
  const [searchRows, setSearchRows] = useState<any[]>([])
  const [searchFilters, setSearchFilters] = useState({
    q: '',
    status: '',
    entityType: ''
  })
  const [showImportModal, setShowImportModal] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [importMode, setImportMode] = useState<'upsert' | 'create-only'>('upsert')
  const [importReason, setImportReason] = useState('IMPORT')
  const [importText, setImportText] = useState('')
  const [exportText, setExportText] = useState('')
  const [mergeSourceId, setMergeSourceId] = useState('')
  const [mergeReason, setMergeReason] = useState('MERGE')
  const [mergeSourceRecord, setMergeSourceRecord] = useState<any>(null)
  const [mergeWinner, setMergeWinner] = useState({
    person: 'target',
    company: 'target',
    contacts: 'target',
    addresses: 'target',
    external: 'target'
  })
  const [conflictState, setConflictState] = useState<any>(null)
  const pageMode = getCustomerRouteMode(location.pathname)
  const routeCustomerId = getCustomerRouteId(location.pathname)
  const isDetailPage = pageMode !== null
  const isViewMode = pageMode === 'view'
  const canMutateInMode = !isViewMode

  const { data: settings } = useCustomerSettings()
  const updateSettingsMutation = useUpdateCustomerSettingsMutation()

  const searchPagination = useClientPagination(searchRows, 10)
  const auditPagination = useClientPagination(auditRows, 10)
  const policyPagination = useClientPagination(customerPolicies, 10)
  const unlinkedPolicyPagination = useClientPagination(unlinkedPolicies, 10)
  const canEditIdentity = canManage && canMutateInMode
  const canEditContact = (canManage || canContactManage) && canMutateInMode
  const canCreateOrUpdate = (canManage || canContactManage) && canMutateInMode
  const canManageInMode = canManage && canMutateInMode
  const canDeactivateInMode = canDeactivate && canMutateInMode
  const canMergeInMode = canMerge && canMutateInMode

  useEffect(() => {
    if (!canRead) return
    void searchCustomers()
  }, [canRead])

  useEffect(() => {
    if (settings && !settingsDraft) {
      setSettingsDraft(clone(settings))
      setSettingsDirty(false)
    }
  }, [settings])

  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])

  async function saveSettings() {
    if (!canManage || !settingsDraft) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = await updateSettingsMutation.mutateAsync(settingsDraft)
      setSettingsDraft(clone(payload))
      setSettingsDirty(false)
      setSuccess('Customer settings updated.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function searchCustomers(e?: FormEvent) {
    if (e) e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const rows = await api.searchCustomers({
        q: searchFilters.q || undefined,
        status: searchFilters.status || undefined,
        entityType: searchFilters.entityType || undefined,
        limit: 200
      })
      setSearchRows(rows || [])
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  function openCustomerInPage(customerIdOrKey: string, mode: 'view' | 'edit') {
    if (!customerIdOrKey) return
    if (dirty && !window.confirm('You have unsaved changes. Continue and discard?')) return
    navigate(`/admin/customers/${mode}/${encodeURIComponent(customerIdOrKey)}`)
  }

  function openNewCustomerInPage() {
    if (dirty && !window.confirm('You have unsaved changes. Continue and discard?')) return
    navigate('/admin/customers/new')
  }

  function closeCustomerInPage() {
    if (saving) return
    if (dirty && !window.confirm('You have unsaved changes. Continue and discard?')) return
    navigate('/admin/customers')
  }

  function markRecord(next: any) {
    setRecord(next)
    setDirty(true)
  }

  function resetRecord() {
    setRecord(emptyCustomerRecord())
    setDirty(false)
    setValidationErrors([])
    setValidationWarnings([])
    setPotentialMatches([])
    setAuditRows([])
    setCustomerPolicies([])
    setUnlinkedPolicies([])
    setLinkingPolicyId('')
    setError(null)
    setSuccess(null)
    setSection('identity')
  }

  async function loadRecord(idOrKey: string, options: { skipDirtyCheck?: boolean } = {}) {
    const { skipDirtyCheck = false } = options
    if (!skipDirtyCheck && dirty && !window.confirm('You have unsaved changes. Continue and discard?')) return
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = await api.getCustomer(idOrKey)
      const normalized = normalizeCustomerRecord(payload)
      setRecord(normalized)
      setDirty(false)
      setPotentialMatches([])
      setValidationErrors([])
      setValidationWarnings([])
      await refreshCustomerPolicies(normalized.customerId || normalized.customerKey)
      if (section === 'policies') {
        await refreshUnlinkedPolicies()
      }
      if (section === 'audit') {
        await refreshAudit(normalized.customerId || normalized.customerKey)
      }
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const lookup = String(searchParams.get('load') || '').trim()
    if (!lookup || !canRead) return
    navigate(`/admin/customers/edit/${encodeURIComponent(lookup)}`, { replace: true })
    const next = new URLSearchParams(searchParams)
    next.delete('load')
    setSearchParams(next, { replace: true })
  }, [canRead, searchParams, navigate, setSearchParams])

  useEffect(() => {
    if (!canRead) return
    if (pageMode === 'create') {
      resetRecord()
      return
    }
    if ((pageMode === 'view' || pageMode === 'edit') && routeCustomerId) {
      void loadRecord(routeCustomerId, { skipDirtyCheck: true })
      return
    }
    resetRecord()
  }, [canRead, pageMode, routeCustomerId])

  function buildPayload(statusOverride?: CustomerStatus) {
    const payload = clone(record)
    payload.status = statusOverride || record.status || 'DRAFT'
    delete payload.customerId
    delete payload.customerKey
    delete payload.version
    delete payload.displayName
    delete payload.pendingApproval
    delete payload.createdAt
    delete payload.createdBy
    delete payload.updatedAt
    delete payload.updatedBy
    delete payload.survivorCustomerId
    delete payload.mergedRedirectCustomerId
    return payload
  }

  async function validateRecord() {
    setLoading(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await api.validateCustomer({
        ...buildPayload(),
        excludeCustomerId: record.customerId || undefined
      })
      setValidationErrors(response?.errors || [])
      setValidationWarnings(response?.warnings || [])
      setPotentialMatches(response?.potentialMatches || [])
      if ((response?.errors || []).length === 0) {
        setSuccess('Validation completed.')
      }
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  async function saveRecord(statusOverride?: CustomerStatus, reason?: string, createAnyway = false) {
    if (!canCreateOrUpdate) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const payload = buildPayload(statusOverride)
      let response: any
      if (record.customerId) {
        response = await api.updateCustomer(record.customerId, {
          ...payload,
          expectedVersion: record.version,
          reason: reason || 'UPDATE'
        })
      } else {
        response = await api.createCustomer({
          ...payload,
          reason: reason || 'CREATE',
          createAnyway
        })
      }
      const normalized = normalizeCustomerRecord(response)
      setRecord(normalized)
      setDirty(false)
      setPotentialMatches([])
      const savedCustomerId = normalized.customerId || normalized.customerKey
      if (savedCustomerId) {
        navigate(`/admin/customers/edit/${encodeURIComponent(savedCustomerId)}`)
      }
      await refreshCustomerPolicies(normalized.customerId || normalized.customerKey)
      await searchCustomers()
      setSuccess(record.customerId ? 'Customer updated.' : 'Customer created.')
    } catch (e: any) {
      const parsed = extractErrorObject(e)
      if (parsed?.code === 'POTENTIAL_DUPLICATE' && Array.isArray(parsed.potentialMatches)) {
        setPotentialMatches(parsed.potentialMatches)
        setError('Potential duplicate customers found.')
      } else if (parsed?.code === 'VERSION_MISMATCH' && record.customerId) {
        const latest = await api.getCustomer(record.customerId)
        setConflictState({
          latest: normalizeCustomerRecord(latest),
          pendingPayload: buildPayload(statusOverride),
          pendingReason: reason || 'UPDATE'
        })
        setShowConflictModal(true)
      } else {
        setError(extractErrorMessage(e))
      }
    } finally {
      setSaving(false)
    }
  }

  async function submitForApproval() {
    if (!record.customerId || !canManage) return
    const reason = window.prompt('Approval reason', 'REQUIRES_REVIEW') || 'REQUIRES_REVIEW'
    setSaving(true)
    setError(null)
    try {
      await api.submitCustomerForApproval(record.customerId, { reason })
      await loadRecord(record.customerId)
      await searchCustomers()
      setSuccess('Submitted for approval.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function activateRecord() {
    if (record.status === 'PENDING_APPROVAL' && canApprove && record.customerId) {
      const reason = window.prompt('Approval reason', 'APPROVE') || 'APPROVE'
      setSaving(true)
      setError(null)
      try {
        await api.approveCustomer(record.customerId, { reason })
        await loadRecord(record.customerId)
        await searchCustomers()
        setSuccess('Customer approved and activated.')
      } catch (e: any) {
        setError(extractErrorMessage(e))
      } finally {
        setSaving(false)
      }
      return
    }
    await saveRecord('ACTIVE', 'ACTIVATE')
  }

  async function deactivateRecord() {
    if (!record.customerId || !canDeactivate) return
    const reason = window.prompt('Deactivation reason', 'CUSTOMER_REQUEST') || ''
    if (!reason.trim()) return
    const effectiveDate = window.prompt('Effective date (YYYY-MM-DD)', todayDateString()) || ''
    setSaving(true)
    setError(null)
    try {
      const response = await api.deactivateCustomer(record.customerId, {
        reason: reason.trim(),
        effectiveDate: normalizeDateInput(effectiveDate)
      })
      const maybeCustomer = response?.customer || response
      if (maybeCustomer?.customerId) {
        setRecord(normalizeCustomerRecord(maybeCustomer))
        setDirty(false)
      } else {
        await loadRecord(record.customerId)
      }
      await searchCustomers()
      setSuccess(response?.submittedForApproval ? 'Deactivation submitted for approval.' : 'Customer deactivated.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function reactivateRecord() {
    if (!record.customerId || !canDeactivate) return
    const reason = window.prompt('Reactivation reason', 'REOPEN') || 'REOPEN'
    setSaving(true)
    setError(null)
    try {
      await api.reactivateCustomer(record.customerId, { reason })
      await loadRecord(record.customerId)
      await searchCustomers()
      setSuccess('Customer reactivated.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function deleteRecord() {
    if (!record.customerId || !canManage) return
    if (!window.confirm(`Delete ${record.customerKey || record.customerId}?`)) return
    setSaving(true)
    setError(null)
    try {
      await api.deleteCustomer(record.customerId, { reason: 'DELETE' })
      resetRecord()
      await searchCustomers()
      setSuccess('Customer deleted.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function refreshAudit(idOrKey?: string) {
    const lookup = idOrKey || record.customerId || record.customerKey
    if (!lookup || !canRead) return
    try {
      const rows = await api.getCustomerAudit(lookup, 250)
      setAuditRows(rows || [])
    } catch (e: any) {
      setError(extractErrorMessage(e))
    }
  }

  async function refreshCustomerPolicies(idOrKey?: string) {
    const lookup = idOrKey || record.customerId || record.customerKey
    if (!lookup || !canRead) {
      setCustomerPolicies([])
      return
    }
    try {
      const rows = await api.getCustomerPolicies(lookup, 250)
      setCustomerPolicies(Array.isArray(rows) ? rows : [])
    } catch (e: any) {
      setError(extractErrorMessage(e))
    }
  }

  async function refreshUnlinkedPolicies() {
    if (!canRead) {
      setUnlinkedPolicies([])
      return
    }
    try {
      const rows = await api.listUnlinkedPolicyCustomerLinks({
        q: unlinkedPolicyFilters.q || undefined,
        productCode: unlinkedPolicyFilters.productCode || undefined,
        status: unlinkedPolicyFilters.status || undefined,
        limit: 250
      })
      setUnlinkedPolicies(Array.isArray(rows) ? rows : [])
    } catch (e: any) {
      setError(extractErrorMessage(e))
    }
  }

  async function assignPolicyToCurrentCustomer(policyId: string) {
    if (!record.customerId || !policyId || !canManage) return
    setLinkingPolicyId(policyId)
    setError(null)
    setSuccess(null)
    try {
      const response = await api.assignPolicyCustomerLink({
        policyId,
        customerId: record.customerId,
        relationshipType: 'PRIMARY_NAMED_INSURED',
        isPrimary: true,
        source: 'admin_manual'
      })
      await refreshCustomerPolicies(record.customerId || record.customerKey)
      await refreshUnlinkedPolicies()
      await searchCustomers()
      setSuccess(`Linked ${response?.policyNumber || policyId} to ${record.customerKey || record.customerId}.`)
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setLinkingPolicyId('')
    }
  }

  async function openExport() {
    if (!record.customerId || !canExport) return
    setLoading(true)
    setError(null)
    try {
      const payload = await api.exportCustomer(record.customerId)
      setExportText(JSON.stringify(payload, null, 2))
      setShowExportModal(true)
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  async function importCustomer() {
    if (!canImport) return
    setSaving(true)
    setError(null)
    try {
      const payload = JSON.parse(importText)
      const response = await api.importCustomer({ payload, mode: importMode, reason: importReason || 'IMPORT' })
      setShowImportModal(false)
      if (response?.customer?.customerId) {
        await loadRecord(response.customer.customerId)
      }
      await searchCustomers()
      setSuccess(`Import completed (${response?.mode || 'updated'}).`)
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function seedSampleCustomers() {
    if (!canManage) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await api.seedCustomerSamples()
      await searchCustomers()
      setSuccess(
        `Sample customers ready. Created: ${Number(result?.createdCount || 0)}, existing: ${Number(
          result?.existingCount || 0
        )}, relationships: ${Number(result?.relationshipsCreated || 0)}.`
      )
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function revealField(field: 'ssn' | 'fein' | 'dob') {
    if (!record.customerId || !canReveal) return
    const reason = window.prompt(`Reason for ${field.toUpperCase()} reveal`, 'CUSTOMER_SERVICE') || ''
    if (!reason.trim()) return
    try {
      const response = await api.revealCustomerField(record.customerId, { field, reason })
      if (field === 'ssn') {
        markRecord({
          ...record,
          identity: {
            ...record.identity,
            person: { ...record.identity.person, ssn: response?.value || '' }
          }
        })
      } else if (field === 'dob') {
        markRecord({
          ...record,
          identity: {
            ...record.identity,
            person: { ...record.identity.person, dob: normalizeDateInput(response?.value || '') }
          }
        })
      } else {
        markRecord({
          ...record,
          identity: {
            ...record.identity,
            company: { ...record.identity.company, fein: response?.value || '' }
          }
        })
      }
      setSuccess('PII reveal successful and audited.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    }
  }

  async function loadMergeSource() {
    if (!mergeSourceId) return
    try {
      const payload = await api.getCustomer(mergeSourceId)
      const source = normalizeCustomerRecord(payload)
      if (!source.customerId || source.customerId === record.customerId) {
        setError('Source must be a different customer.')
        return
      }
      setMergeSourceRecord(source)
      setMergeSourceId(source.customerId)
    } catch (e: any) {
      setError(extractErrorMessage(e))
    }
  }

  function buildMergeResolution() {
    if (!mergeSourceRecord) return {}
    const resolution: any = {}
    if (mergeWinner.person === 'source') resolution.identity = { ...(resolution.identity || {}), person: mergeSourceRecord.identity.person }
    if (mergeWinner.company === 'source') resolution.identity = { ...(resolution.identity || {}), company: mergeSourceRecord.identity.company }
    if (mergeWinner.contacts === 'source') resolution.contactPoints = mergeSourceRecord.contactPoints
    if (mergeWinner.addresses === 'source') resolution.addresses = mergeSourceRecord.addresses
    if (mergeWinner.external === 'source') resolution.externalIdentifiers = mergeSourceRecord.externalIdentifiers
    return resolution
  }

  async function mergeRecords() {
    if (!record.customerId || !mergeSourceId || !canMerge) return
    setSaving(true)
    setError(null)
    try {
      const response = await api.mergeCustomers({
        sourceCustomerId: mergeSourceId,
        targetCustomerId: record.customerId,
        reason: mergeReason || 'MERGE',
        resolution: buildMergeResolution()
      })
      setShowMergeModal(false)
      if (response?.customer?.customerId) await loadRecord(response.customer.customerId)
      await searchCustomers()
      setSuccess(response?.submittedForApproval ? 'Merge submitted for approval.' : 'Merge completed.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  async function resolveConflict(action: 'reload' | 'overwrite') {
    if (!conflictState) return
    if (action === 'reload') {
      setRecord(conflictState.latest)
      setDirty(false)
      setShowConflictModal(false)
      setConflictState(null)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = await api.updateCustomer(conflictState.latest.customerId, {
        ...conflictState.pendingPayload,
        expectedVersion: conflictState.latest.version,
        reason: `${conflictState.pendingReason}_OVERWRITE`
      })
      setRecord(normalizeCustomerRecord(payload))
      setDirty(false)
      setShowConflictModal(false)
      setConflictState(null)
      await searchCustomers()
      setSuccess('Conflict resolved by overwrite.')
    } catch (e: any) {
      setError(extractErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div>
          <h2 className="ps-page-title">Customers</h2>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>Tenant: {user?.tenantId || '-'}</p>
        </div>
        <div className="ps-page-header-actions">
          {!isDetailPage ? (
            <>
              <button className="btn-secondary" onClick={() => void searchCustomers()} disabled={loading}>Refresh</button>
              <button onClick={openNewCustomerInPage} disabled={!canCreateOrUpdate || saving}>New Customer</button>
            </>
          ) : (
            <>
              <span className={`badge ${statusBadgeColor(record.status)}`}>{record.status}</span>
              <button type="button" className="btn-secondary" onClick={closeCustomerInPage} disabled={saving}>Back</button>
            </>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="muted">{success}</p>}

      {!isDetailPage && (
        <>
          <div className="ps-filter-panel">
            <form className="ps-filter-grid" onSubmit={searchCustomers} role="search">
              <div className="ps-filter-col ps-filter-col--wide">
                <label className="ps-filter-label" htmlFor="cust-filter-q">Search</label>
                <input id="cust-filter-q" className="ps-filter-input" value={searchFilters.q} onChange={(e) => setSearchFilters((prev) => ({ ...prev, q: e.target.value }))} placeholder="Customer key, name, phone, email, tax id, external id" />
              </div>
              <div className="ps-filter-col">
                <label className="ps-filter-label" htmlFor="cust-filter-status">Status</label>
                <select id="cust-filter-status" className="ps-filter-select" value={searchFilters.status} onChange={(e) => setSearchFilters((prev) => ({ ...prev, status: e.target.value }))}>
                  <option value="">All</option>
                  {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="ps-filter-col">
                <label className="ps-filter-label" htmlFor="cust-filter-type">Entity Type</label>
                <select id="cust-filter-type" className="ps-filter-select" value={searchFilters.entityType} onChange={(e) => setSearchFilters((prev) => ({ ...prev, entityType: e.target.value }))}>
                  <option value="">All</option>
                  {ENTITY_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </div>
              <div className="ps-filter-actions">
                <button type="submit" className="ps-filter-btn-search" disabled={loading}>Search</button>
                <button type="button" className="btn-secondary" onClick={() => { setSearchFilters({ q: '', status: '', entityType: '' }); void searchCustomers() }}>Clear</button>
              </div>
            </form>
          </div>

          <div className="ps-table-card" style={{ marginTop: 16 }}>
            <table className="table table-sticky-header">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Type</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Policies</th>
                  <th>Updated</th>
                  <th>Match</th>
                  <th>Flags</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loading && searchRows.length === 0 && (
                  <tr><td colSpan={9} className="muted">No customers found.</td></tr>
                )}
                {searchPagination.rows.map((row: any) => (
                  <tr key={row.customerId}>
                    <td>{row.customerKey}</td>
                    <td>{row.entityType}</td>
                    <td>{row.name}</td>
                    <td><span className={`badge ${statusBadgeColor(row.status)}`}>{row.status}</span></td>
                    <td>{Number(row.policyCount || 0)}</td>
                    <td>{formatDisplayDateTime(row.lastUpdated)}</td>
                    <td>{row.matchScore}</td>
                    <td>{(row.flags || []).join(', ') || '-'}</td>
                    <td>
                      <div className="table-actions table-actions--icons">
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`View customer ${row.customerKey || row.customerId}`}
                          title="View"
                          onClick={() => openCustomerInPage(row.customerId, 'view')}
                          disabled={loading || saving}
                        >
                          {'\u{1F441}'}
                        </button>
                        <button
                          type="button"
                          className="icon-action-btn"
                          aria-label={`Edit customer ${row.customerKey || row.customerId}`}
                          title="Edit"
                          onClick={() => openCustomerInPage(row.customerId, 'edit')}
                          disabled={loading || saving || !(canManage || canContactManage)}
                        >
                          {'\u270E'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {searchRows.length > 0 && (
            <TablePagination
              page={searchPagination.page}
              pageSize={searchPagination.pageSize}
              totalItems={searchPagination.totalItems}
              onPageChange={searchPagination.setPage}
              onPageSizeChange={searchPagination.setPageSize}
            />
          )}
        </>
      )}

      {isDetailPage && (
        <>
      <div className="toolbar-actions row-spaced">
        <button type="button" onClick={openNewCustomerInPage} disabled={!(canManage || canContactManage) || saving}>New</button>
        <button type="button" onClick={() => saveRecord('DRAFT', 'SAVE_DRAFT')} disabled={!canCreateOrUpdate || saving}>Save Draft</button>
        <button type="button" className="btn-secondary" onClick={validateRecord} disabled={!canRead || saving}>Validate</button>
        <button type="button" className="btn-secondary" onClick={submitForApproval} disabled={!record.customerId || !canManageInMode}>Submit for Approval</button>
        <button type="button" onClick={activateRecord} disabled={!canManageInMode}>Activate</button>
        <button type="button" className="btn-secondary" onClick={deactivateRecord} disabled={!record.customerId || !canDeactivateInMode}>Deactivate</button>
        <button type="button" className="btn-secondary" onClick={reactivateRecord} disabled={!record.customerId || !canDeactivateInMode}>Reactivate</button>
        <button type="button" className="btn-secondary" onClick={() => setShowMergeModal(true)} disabled={!record.customerId || !canMergeInMode}>Merge</button>
        <button type="button" className="btn-secondary" onClick={deleteRecord} disabled={!record.customerId || !canManageInMode}>Delete</button>
        <button type="button" className="btn-secondary" onClick={openExport} disabled={!record.customerId || !canExport}>Export JSON</button>
        <button type="button" className="btn-secondary" onClick={() => setShowImportModal(true)} disabled={!canImport || !canMutateInMode}>Import JSON</button>
        <button type="button" className="btn-secondary" onClick={seedSampleCustomers} disabled={!canManageInMode || saving}>Seed Samples</button>
      </div>

      {validationErrors.length > 0 && (
        <div className="issue-status-box">
          <strong>Validation Errors</strong>
          <ul>{validationErrors.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className="issue-status-box">
          <strong>Validation Warnings</strong>
          <ul>{validationWarnings.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}

      {potentialMatches.length > 0 && (
        <div className="card stack-card">
          <div className="panel-header">
            <h3>Potential Matches</h3>
            <button type="button" className="btn-secondary" onClick={() => saveRecord(undefined, 'CREATE_ANYWAY', true)} disabled={!canManageInMode}>
              Create Anyway
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Customer Key</th>
                <th>Name</th>
                <th>Status</th>
                <th>Type</th>
                <th>Score</th>
                <th>Reasons</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {potentialMatches.map((row: any) => (
                <tr key={row.customerId}>
                  <td>{row.customerKey}</td>
                  <td>{row.displayName}</td>
                  <td>{row.status}</td>
                  <td>{row.entityType}</td>
                  <td>{row.matchScore}</td>
                  <td>{(row.reasons || []).join(', ')}</td>
                  <td><button type="button" className="btn-secondary" onClick={() => openCustomerInPage(row.customerId, 'edit')} disabled={saving}>Use Existing</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="admin-section-layout">
        <aside className="admin-section-menu">
          {SECTION_OPTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`admin-section-link${section === item.key ? ' active' : ''}`}
              onClick={() => {
                setSection(item.key)
                if (item.key === 'audit') void refreshAudit()
                if (item.key === 'policies') {
                  void refreshCustomerPolicies()
                  void refreshUnlinkedPolicies()
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </aside>
        <section className="admin-section-content card">
          <div className="row">
            <div className="col"><label>Customer Key</label><input value={record.customerKey || 'Will be generated'} readOnly /></div>
            <div className="col"><label>Version</label><input value={String(record.version || 1)} readOnly /></div>
            <div className="col">
              <label>Entity Type</label>
              <select value={record.entityType} onChange={(e) => markRecord({ ...record, entityType: e.target.value as EntityType })} disabled={!canEditIdentity}>
                {ENTITY_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
            <div className="col">
              <label>Status</label>
              <select value={record.status} onChange={(e) => markRecord({ ...record, status: e.target.value as CustomerStatus })} disabled={!canManageInMode}>
                {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </div>
          </div>

          {section === 'identity' && renderIdentitySection(record, markRecord, canEditIdentity, canReveal, revealField)}
          {section === 'contact' && renderContactSection(record, markRecord, canEditContact)}
          {section === 'relationships' && renderRelationshipsSection(record, markRecord, canManageInMode)}
          {section === 'policies' && (
            <>
              {renderPoliciesSection(record, customerPolicies, policyPagination)}
              {canManageInMode && (
                <div className="stack-card">
                  <div className="panel-header">
                    <h3>Manual Policy Mapping</h3>
                    <span className="muted">Select a customer, then link unassigned policies.</span>
                  </div>
                  <form
                    className="row row-spaced-sm"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void refreshUnlinkedPolicies()
                    }}
                  >
                    <div className="col">
                      <label>Search</label>
                      <input
                        value={unlinkedPolicyFilters.q}
                        onChange={(e) => setUnlinkedPolicyFilters((prev) => ({ ...prev, q: e.target.value }))}
                        placeholder="Policy #, product, insured name, email"
                      />
                    </div>
                    <div className="col">
                      <label>Product</label>
                      <input
                        value={unlinkedPolicyFilters.productCode}
                        onChange={(e) => setUnlinkedPolicyFilters((prev) => ({ ...prev, productCode: e.target.value }))}
                        placeholder="personal-auto"
                      />
                    </div>
                    <div className="col">
                      <label>Status</label>
                      <input
                        value={unlinkedPolicyFilters.status}
                        onChange={(e) => setUnlinkedPolicyFilters((prev) => ({ ...prev, status: e.target.value }))}
                        placeholder="Issued"
                      />
                    </div>
                    <div className="col" style={{ alignSelf: 'end', display: 'flex', gap: 8 }}>
                      <button type="submit" className="btn-secondary">Search</button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          setUnlinkedPolicyFilters({ q: '', productCode: '', status: '' })
                          void refreshUnlinkedPolicies()
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </form>
                  <table className="table table-sticky-header">
                    <thead>
                      <tr>
                        <th>Policy #</th>
                        <th>Product</th>
                        <th>Status</th>
                        <th>Effective</th>
                        <th>Expiration</th>
                        <th>Suggested Insured</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unlinkedPolicies.length === 0 && (
                        <tr><td colSpan={7} className="muted">No unlinked policies found.</td></tr>
                      )}
                      {unlinkedPolicyPagination.rows.map((row: any) => (
                        <tr key={row.policyId}>
                          <td>
                            <Link to={`/policies/${encodeURIComponent(row.policyId)}`}>
                              {row.policyNumber || row.policyId}
                            </Link>
                          </td>
                          <td>{row.productCode || '-'}</td>
                          <td><span className={`badge ${statusBadgeColor(row.status)}`}>{row.status}</span></td>
                          <td>{formatDisplayDate(row.effectiveDate)}</td>
                          <td>{formatDisplayDate(row.expirationDate)}</td>
                          <td>{formatSuggestedInsured(row)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => assignPolicyToCurrentCustomer(row.policyId)}
                              disabled={!record.customerId || linkingPolicyId === row.policyId || !canManageInMode}
                            >
                              {linkingPolicyId === row.policyId ? 'Linking...' : 'Link to Current Customer'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {unlinkedPolicies.length > 0 && (
                    <TablePagination
                      page={unlinkedPolicyPagination.page}
                      pageSize={unlinkedPolicyPagination.pageSize}
                      totalItems={unlinkedPolicyPagination.totalItems}
                      onPageChange={unlinkedPolicyPagination.setPage}
                      onPageSizeChange={unlinkedPolicyPagination.setPageSize}
                    />
                  )}
                </div>
              )}
            </>
          )}
          {section === 'identifiers' && renderIdentifiersSection(record, markRecord, canManageInMode)}
          {section === 'notes' && renderNotesSection(record, markRecord, canManageInMode)}
          {section === 'audit' && (
            <>
              {renderAuditSection(record, settings, settingsDraft, setSettingsDraft, settingsDirty, setSettingsDirty, canManageInMode, saveSettings)}
              <h3 className="section-title">Audit Events</h3>
              <table className="table table-sticky-header">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Event</th>
                    <th>Actor</th>
                    <th>Reason</th>
                    <th>Correlation</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.length === 0 && <tr><td colSpan={5} className="muted">No audit rows.</td></tr>}
                  {auditPagination.rows.map((row: any) => (
                    <tr key={row.eventId}>
                      <td>{formatDisplayDateTime(row.createdAt)}</td>
                      <td>{row.eventType}</td>
                      <td>{row.actor || '-'}</td>
                      <td>{row.reason || '-'}</td>
                      <td>{row.correlationId || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {auditRows.length > 0 && (
                <TablePagination
                  page={auditPagination.page}
                  pageSize={auditPagination.pageSize}
                  totalItems={auditPagination.totalItems}
                  onPageChange={auditPagination.setPage}
                  onPageSizeChange={auditPagination.setPageSize}
                />
              )}
            </>
          )}
        </section>
      </div>
        </>
      )}

      {showImportModal && renderImportModal(setShowImportModal, importMode, setImportMode, importReason, setImportReason, importText, setImportText, importCustomer, saving)}
      {showExportModal && renderExportModal(setShowExportModal, exportText, record.customerKey || 'customer')}
      {showMergeModal && renderMergeModal(
        setShowMergeModal,
        mergeSourceId,
        setMergeSourceId,
        mergeReason,
        setMergeReason,
        mergeSourceRecord,
        mergeWinner,
        setMergeWinner,
        loadMergeSource,
        mergeRecords,
        saving
      )}
      {showConflictModal && renderConflictModal(resolveConflict, setShowConflictModal)}
    </div>
  )
}

function emptyCustomerRecord() {
  return {
    customerId: '',
    customerKey: '',
    entityType: 'INDIVIDUAL',
    status: 'DRAFT',
    version: 1,
    displayName: '',
    pendingApproval: false,
    metadata: {},
    identity: {
      person: {
        firstName: '',
        middleName: '',
        lastName: '',
        suffix: '',
        preferredName: '',
        dob: '',
        dobMasked: '',
        gender: '',
        maritalStatus: '',
        ssn: '',
        ssnLast4: '',
        ssnMasked: '',
        driverLicenseNo: '',
        driverLicenseState: '',
        driverLicenseExpiry: '',
        nationality: '',
        residency: ''
      },
      company: {
        legalName: '',
        dbaName: '',
        fein: '',
        feinLast4: '',
        feinMasked: '',
        entityLegalType: '',
        incorporationState: '',
        incorporationCountry: 'US',
        incorporationDate: '',
        naics: '',
        sic: '',
        website: ''
      }
    },
    contactPoints: [],
    addresses: [],
    relationships: [],
    externalIdentifiers: [],
    compliance: {
      kycStatus: '',
      kycVerificationDate: '',
      kycMethod: '',
      sanctionsStatus: '',
      sanctionsLastCheckedAt: '',
      doNotContact: false,
      dataRetentionHold: false,
      rightToBeForgottenRequested: false,
      privacyRegion: '',
      metadata: {}
    },
    notes: [],
    attachments: []
  }
}

function normalizeCustomerRecord(input: any) {
  const base = emptyCustomerRecord()
  return {
    ...base,
    ...input,
    identity: {
      person: {
        ...base.identity.person,
        ...(input?.identity?.person || {}),
        dob: normalizeDateInput(input?.identity?.person?.dob),
        driverLicenseExpiry: normalizeDateInput(input?.identity?.person?.driverLicenseExpiry)
      },
      company: {
        ...base.identity.company,
        ...(input?.identity?.company || {}),
        incorporationDate: normalizeDateInput(input?.identity?.company?.incorporationDate)
      }
    },
    contactPoints: Array.isArray(input?.contactPoints) ? input.contactPoints.map((item: any) => ({
      ...item,
      effectiveFrom: normalizeDateInput(item?.effectiveFrom),
      effectiveTo: normalizeDateInput(item?.effectiveTo)
    })) : [],
    addresses: Array.isArray(input?.addresses) ? input.addresses.map((item: any) => ({
      ...item,
      effectiveFrom: normalizeDateInput(item?.effectiveFrom),
      effectiveTo: normalizeDateInput(item?.effectiveTo)
    })) : [],
    relationships: Array.isArray(input?.relationships) ? input.relationships.map((item: any) => ({
      ...item,
      startDate: normalizeDateInput(item?.startDate),
      endDate: normalizeDateInput(item?.endDate)
    })) : [],
    externalIdentifiers: Array.isArray(input?.externalIdentifiers) ? input.externalIdentifiers : [],
    notes: Array.isArray(input?.notes) ? input.notes : [],
    attachments: Array.isArray(input?.attachments) ? input.attachments : []
  }
}

function formatPolicyRelationshipTypes(relationshipTypes: any): string {
  if (!Array.isArray(relationshipTypes) || relationshipTypes.length === 0) return '-'
  return relationshipTypes
    .map((value: any) =>
      String(value || '')
        .trim()
        .toLowerCase()
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    )
    .filter(Boolean)
    .join(', ')
}

function formatSuggestedInsured(row: any): string {
  const suggested = row?.suggestedPrimaryInsured || {}
  const displayName = String(suggested.displayName || '').trim()
  const firstName = String(suggested.firstName || '').trim()
  const lastName = String(suggested.lastName || '').trim()
  const name = displayName || [firstName, lastName].filter(Boolean).join(' ').trim()
  const email = String(suggested.email || '').trim()
  if (name && email) return `${name} (${email})`
  if (name) return name
  if (email) return email
  return '-'
}

function statusBadgeColor(status: string): string {
  const value = String(status || '').toUpperCase()
  if (value === 'INFORCED' || value === 'ACTIVE') return 'green'
  if (value === 'ISSUED' || value === 'BIND' || value === 'BOUND' || value === 'MERGED') return 'blue'
  if (value === 'PENDING_APPROVAL') return 'yellow'
  if (value === 'INACTIVE' || value === 'ARCHIVED' || value === 'CANCELLED' || value === 'EXPIRED') return 'red'
  if (value === 'DRAFT' || value === 'RATED') return 'gray'
  return 'gray'
}

function extractErrorMessage(error: any): string {
  const parsed = extractErrorObject(error)
  if (parsed?.message) return String(parsed.message)
  return String(error?.message || error || 'Unknown error')
}

function extractErrorObject(error: any): any | null {
  const message = String(error?.message || '')
  const objectMatch = /API\s+\w+\s+.+failed\s+\d+:\s+(.+)$/i.exec(message)
  const jsonText = objectMatch?.[1] || message
  const idx = jsonText.indexOf('{')
  if (idx < 0) return null
  try {
    return JSON.parse(jsonText.slice(idx))
  } catch {
    return null
  }
}

function normalizeDateInput(value: any): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text)
  if (match) return match[1]
  const asDate = new Date(text)
  if (Number.isNaN(asDate.getTime())) return ''
  return asDate.toISOString().slice(0, 10)
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

function setInRecord(record: any, path: string[], value: any) {
  const next = clone(record)
  let node = next
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    node[key] = node[key] || {}
    node = node[key]
  }
  node[path[path.length - 1]] = value
  return next
}

function updateArrayItem(record: any, key: string, index: number, patch: Record<string, any>) {
  const next = clone(record)
  const list = Array.isArray(next[key]) ? next[key] : []
  next[key] = list.map((item: any, idx: number) => idx === index ? { ...item, ...patch } : item)
  return next
}

function removeArrayItem(record: any, key: string, index: number) {
  const next = clone(record)
  const list = Array.isArray(next[key]) ? next[key] : []
  next[key] = list.filter((_: any, idx: number) => idx !== index)
  return next
}

function renderIdentitySection(record: any, markRecord: (next: any) => void, canEditIdentity: boolean, canReveal: boolean, revealField: (field: 'ssn' | 'fein' | 'dob') => Promise<void>) {
  return (
    <div className="stack-card">
      {(record.entityType === 'INDIVIDUAL' || record.entityType === 'BOTH') && (
        <>
          <h3>Individual</h3>
          <div className="row">
            <div className="col"><label>First Name</label><input value={record.identity.person.firstName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'firstName'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Middle Name</label><input value={record.identity.person.middleName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'middleName'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Last Name</label><input value={record.identity.person.lastName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'lastName'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Preferred Name</label><input value={record.identity.person.preferredName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'preferredName'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          <div className="row">
            <div className="col"><label>DOB</label><input type="date" value={record.identity.person.dob || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'dob'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Gender</label><input value={record.identity.person.gender || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'gender'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Marital Status</label><input value={record.identity.person.maritalStatus || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'maritalStatus'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>SSN Last4</label><input value={record.identity.person.ssnLast4 || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'ssnLast4'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          <div className="row">
            <div className="col"><label>SSN (masked)</label><input value={record.identity.person.ssn || record.identity.person.ssnMasked || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'ssn'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Driver License #</label><input value={record.identity.person.driverLicenseNo || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'driverLicenseNo'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Driver License State</label><input value={record.identity.person.driverLicenseState || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'driverLicenseState'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>DL Expiry</label><input type="date" value={record.identity.person.driverLicenseExpiry || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'person', 'driverLicenseExpiry'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          {canReveal && (
            <div className="toolbar-actions row-spaced-sm">
              <button type="button" className="btn-secondary" onClick={() => revealField('dob')}>Reveal DOB</button>
              <button type="button" className="btn-secondary" onClick={() => revealField('ssn')}>Reveal SSN</button>
            </div>
          )}
        </>
      )}

      {(record.entityType === 'COMPANY' || record.entityType === 'BOTH') && (
        <>
          <h3 className="section-title">Company</h3>
          <div className="row">
            <div className="col"><label>Legal Name</label><input value={record.identity.company.legalName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'legalName'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>DBA / Trade Name</label><input value={record.identity.company.dbaName || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'dbaName'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>FEIN Last4</label><input value={record.identity.company.feinLast4 || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'feinLast4'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>FEIN (masked)</label><input value={record.identity.company.fein || record.identity.company.feinMasked || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'fein'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          <div className="row">
            <div className="col"><label>Entity Legal Type</label><input value={record.identity.company.entityLegalType || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'entityLegalType'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Incorporation State</label><input value={record.identity.company.incorporationState || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'incorporationState'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Incorporation Country</label><input value={record.identity.company.incorporationCountry || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'incorporationCountry'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Incorporation Date</label><input type="date" value={record.identity.company.incorporationDate || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'incorporationDate'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          <div className="row">
            <div className="col"><label>NAICS</label><input value={record.identity.company.naics || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'naics'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>SIC</label><input value={record.identity.company.sic || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'sic'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Website</label><input value={record.identity.company.website || ''} onChange={(e) => markRecord(setInRecord(record, ['identity', 'company', 'website'], e.target.value))} disabled={!canEditIdentity} /></div>
            <div className="col"><label>Primary Contact Customer ID</label><input value={record.metadata?.primaryContactCustomerId || ''} onChange={(e) => markRecord(setInRecord(record, ['metadata', 'primaryContactCustomerId'], e.target.value))} disabled={!canEditIdentity} /></div>
          </div>
          {canReveal && (
            <div className="toolbar-actions row-spaced-sm">
              <button type="button" className="btn-secondary" onClick={() => revealField('fein')}>Reveal FEIN</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function renderContactSection(record: any, markRecord: (next: any) => void, canEdit: boolean) {
  const addContact = () => markRecord({ ...record, contactPoints: [...(record.contactPoints || []), { contactType: 'PHONE', subType: 'mobile', value: '', preferred: false, verified: false, effectiveFrom: '', effectiveTo: '', metadata: {} }] })
  const addAddress = () => markRecord({ ...record, addresses: [...(record.addresses || []), { addressType: 'mailing', line1: '', city: '', state: '', postalCode: '', country: 'US', primary: false, effectiveFrom: '', effectiveTo: '', validationStatus: 'unvalidated', metadata: {} }] })
  return (
    <div className="stack-card">
      <h3>Contact Points</h3>
      <table className="table">
        <thead><tr><th>Type</th><th>Sub Type</th><th>Value</th><th>Preferred</th><th>Verified</th><th>Effective From</th><th>Effective To</th><th>Action</th></tr></thead>
        <tbody>
          {(record.contactPoints || []).length === 0 && <tr><td colSpan={8} className="muted">No contact points.</td></tr>}
          {(record.contactPoints || []).map((item: any, index: number) => (
            <tr key={`${item.contactPointId || 'new'}-${index}`}>
              <td><select value={item.contactType || 'PHONE'} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { contactType: e.target.value }))} disabled={!canEdit}><option value="PHONE">PHONE</option><option value="EMAIL">EMAIL</option></select></td>
              <td><input value={item.subType || ''} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { subType: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.value || ''} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { value: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="checkbox" checked={item.preferred === true} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { preferred: e.target.checked }))} disabled={!canEdit} /></td>
              <td><input type="checkbox" checked={item.verified === true} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { verified: e.target.checked }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.effectiveFrom || ''} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { effectiveFrom: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.effectiveTo || ''} onChange={(e) => markRecord(updateArrayItem(record, 'contactPoints', index, { effectiveTo: e.target.value }))} disabled={!canEdit} /></td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'contactPoints', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addContact} disabled={!canEdit}>Add Contact</button>

      <h3 className="section-title">Addresses</h3>
      <table className="table">
        <thead><tr><th>Type</th><th>Line1</th><th>City</th><th>State</th><th>Postal</th><th>Country</th><th>Primary</th><th>Effective From</th><th>Effective To</th><th>Action</th></tr></thead>
        <tbody>
          {(record.addresses || []).length === 0 && <tr><td colSpan={10} className="muted">No addresses.</td></tr>}
          {(record.addresses || []).map((item: any, index: number) => (
            <tr key={`${item.addressId || 'new'}-${index}`}>
              <td><input value={item.addressType || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { addressType: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.line1 || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { line1: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.city || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { city: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.state || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { state: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.postalCode || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { postalCode: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.country || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { country: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="checkbox" checked={item.primary === true} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { primary: e.target.checked }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.effectiveFrom || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { effectiveFrom: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.effectiveTo || ''} onChange={(e) => markRecord(updateArrayItem(record, 'addresses', index, { effectiveTo: e.target.value }))} disabled={!canEdit} /></td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'addresses', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addAddress} disabled={!canEdit}>Add Address</button>
    </div>
  )
}

function renderRelationshipsSection(record: any, markRecord: (next: any) => void, canEdit: boolean) {
  const addItem = () => markRecord({ ...record, relationships: [...(record.relationships || []), { relatedCustomerId: '', relationshipType: '', startDate: '', endDate: '', percentOwnership: null, notes: '', metadata: {} }] })
  return (
    <div className="stack-card">
      <h3>Relationships</h3>
      <table className="table">
        <thead><tr><th>Related Customer ID</th><th>Relationship Type</th><th>Start Date</th><th>End Date</th><th>% Ownership</th><th>Notes</th><th>Action</th></tr></thead>
        <tbody>
          {(record.relationships || []).length === 0 && <tr><td colSpan={7} className="muted">No relationships.</td></tr>}
          {(record.relationships || []).map((item: any, index: number) => (
            <tr key={`${item.relationshipId || 'new'}-${index}`}>
              <td><input value={item.relatedCustomerId || ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { relatedCustomerId: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.relationshipType || ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { relationshipType: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.startDate || ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { startDate: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="date" value={item.endDate || ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { endDate: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.percentOwnership ?? ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { percentOwnership: e.target.value === '' ? null : Number(e.target.value) }))} disabled={!canEdit} /></td>
              <td><input value={item.notes || ''} onChange={(e) => markRecord(updateArrayItem(record, 'relationships', index, { notes: e.target.value }))} disabled={!canEdit} /></td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'relationships', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addItem} disabled={!canEdit}>Add Relationship</button>
    </div>
  )
}

function renderPoliciesSection(record: any, policies: any[], pagination: any) {
  if (!record.customerId) {
    return (
      <div className="stack-card">
        <p className="muted">Create or load a customer to view linked policies.</p>
      </div>
    )
  }

  return (
    <div className="stack-card">
      <h3>Linked Policies</h3>
      <table className="table table-sticky-header">
        <thead>
          <tr>
            <th>Policy #</th>
            <th>Product</th>
            <th>Status</th>
            <th>Effective</th>
            <th>Expiration</th>
            <th>Latest Transaction</th>
            <th>Relationship Types</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {policies.length === 0 && (
            <tr><td colSpan={8} className="muted">No linked policies found.</td></tr>
          )}
          {pagination.rows.map((row: any) => (
            <tr key={`${row.policyId}-${row.latestTransactionNumber || ''}`}>
              <td>
                <Link to={`/policies/${encodeURIComponent(row.policyId)}`}>
                  {row.policyNumber || row.policyId}
                </Link>
              </td>
              <td>{row.productCode || '-'}</td>
              <td><span className={`badge ${statusBadgeColor(row.status)}`}>{row.status}</span></td>
              <td>{formatDisplayDate(row.effectiveDate)}</td>
              <td>{formatDisplayDate(row.expirationDate)}</td>
              <td>{row.latestTransactionNumber || '-'}</td>
              <td>{formatPolicyRelationshipTypes(row.relationshipTypes || row.roles)}</td>
              <td>{formatDisplayDateTime(row.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {policies.length > 0 && (
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

function renderIdentifiersSection(record: any, markRecord: (next: any) => void, canEdit: boolean) {
  const addExternal = () => markRecord({ ...record, externalIdentifiers: [...(record.externalIdentifiers || []), { sourceSystem: '', externalId: '', idType: '', active: true, lastSyncAt: '', metadata: {} }] })
  return (
    <div className="stack-card">
      <h3>External IDs</h3>
      <table className="table">
        <thead><tr><th>Source System</th><th>External ID</th><th>ID Type</th><th>Active</th><th>Last Sync</th><th>Action</th></tr></thead>
        <tbody>
          {(record.externalIdentifiers || []).length === 0 && <tr><td colSpan={6} className="muted">No external IDs.</td></tr>}
          {(record.externalIdentifiers || []).map((item: any, index: number) => (
            <tr key={`${item.externalIdentifierId || 'new'}-${index}`}>
              <td><input value={item.sourceSystem || ''} onChange={(e) => markRecord(updateArrayItem(record, 'externalIdentifiers', index, { sourceSystem: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.externalId || ''} onChange={(e) => markRecord(updateArrayItem(record, 'externalIdentifiers', index, { externalId: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.idType || ''} onChange={(e) => markRecord(updateArrayItem(record, 'externalIdentifiers', index, { idType: e.target.value }))} disabled={!canEdit} /></td>
              <td><input type="checkbox" checked={item.active !== false} onChange={(e) => markRecord(updateArrayItem(record, 'externalIdentifiers', index, { active: e.target.checked }))} disabled={!canEdit} /></td>
              <td><input value={item.lastSyncAt || ''} onChange={(e) => markRecord(updateArrayItem(record, 'externalIdentifiers', index, { lastSyncAt: e.target.value }))} disabled={!canEdit} /></td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'externalIdentifiers', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addExternal} disabled={!canEdit}>Add External ID</button>

      <h3 className="section-title">Compliance</h3>
      <div className="row">
        <div className="col"><label>KYC Status</label><input value={record.compliance?.kycStatus || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'kycStatus'], e.target.value))} disabled={!canEdit} /></div>
        <div className="col"><label>KYC Verification Date</label><input type="date" value={record.compliance?.kycVerificationDate || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'kycVerificationDate'], e.target.value))} disabled={!canEdit} /></div>
        <div className="col"><label>KYC Method</label><input value={record.compliance?.kycMethod || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'kycMethod'], e.target.value))} disabled={!canEdit} /></div>
        <div className="col"><label>Sanctions Status</label><input value={record.compliance?.sanctionsStatus || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'sanctionsStatus'], e.target.value))} disabled={!canEdit} /></div>
      </div>
      <div className="row">
        <div className="col"><label>Sanctions Last Checked</label><input value={record.compliance?.sanctionsLastCheckedAt || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'sanctionsLastCheckedAt'], e.target.value))} disabled={!canEdit} /></div>
        <div className="col"><label>Privacy Region</label><input value={record.compliance?.privacyRegion || ''} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'privacyRegion'], e.target.value))} disabled={!canEdit} /></div>
        <div className="col"><label>Do Not Contact</label><input type="checkbox" checked={record.compliance?.doNotContact === true} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'doNotContact'], e.target.checked))} disabled={!canEdit} /></div>
        <div className="col"><label>Data Retention Hold</label><input type="checkbox" checked={record.compliance?.dataRetentionHold === true} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'dataRetentionHold'], e.target.checked))} disabled={!canEdit} /></div>
      </div>
      <div className="row">
        <div className="col"><label>Right To Be Forgotten Requested</label><input type="checkbox" checked={record.compliance?.rightToBeForgottenRequested === true} onChange={(e) => markRecord(setInRecord(record, ['compliance', 'rightToBeForgottenRequested'], e.target.checked))} disabled={!canEdit} /></div>
      </div>
    </div>
  )
}

function renderNotesSection(record: any, markRecord: (next: any) => void, canEdit: boolean) {
  const addNote = () => markRecord({ ...record, notes: [...(record.notes || []), { category: 'service', noteText: '', metadata: {} }] })
  const addAttachment = () => markRecord({ ...record, attachments: [...(record.attachments || []), { documentId: '', fileName: '', fileType: '', metadata: {} }] })
  return (
    <div className="stack-card">
      <h3>Notes</h3>
      <table className="table">
        <thead><tr><th>Category</th><th>Note</th><th>Created By</th><th>Created At</th><th>Action</th></tr></thead>
        <tbody>
          {(record.notes || []).length === 0 && <tr><td colSpan={5} className="muted">No notes.</td></tr>}
          {(record.notes || []).map((item: any, index: number) => (
            <tr key={`${item.noteId || 'new'}-${index}`}>
              <td><input value={item.category || ''} onChange={(e) => markRecord(updateArrayItem(record, 'notes', index, { category: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.noteText || ''} onChange={(e) => markRecord(updateArrayItem(record, 'notes', index, { noteText: e.target.value }))} disabled={!canEdit} /></td>
              <td>{item.createdBy || '-'}</td>
              <td>{item.createdAt ? formatDisplayDateTime(item.createdAt) : '-'}</td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'notes', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addNote} disabled={!canEdit}>Add Note</button>

      <h3 className="section-title">Attachments (metadata)</h3>
      <table className="table">
        <thead><tr><th>Document ID</th><th>File Name</th><th>Type</th><th>Created By</th><th>Created At</th><th>Action</th></tr></thead>
        <tbody>
          {(record.attachments || []).length === 0 && <tr><td colSpan={6} className="muted">No attachments.</td></tr>}
          {(record.attachments || []).map((item: any, index: number) => (
            <tr key={`${item.attachmentId || 'new'}-${index}`}>
              <td><input value={item.documentId || ''} onChange={(e) => markRecord(updateArrayItem(record, 'attachments', index, { documentId: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.fileName || ''} onChange={(e) => markRecord(updateArrayItem(record, 'attachments', index, { fileName: e.target.value }))} disabled={!canEdit} /></td>
              <td><input value={item.fileType || ''} onChange={(e) => markRecord(updateArrayItem(record, 'attachments', index, { fileType: e.target.value }))} disabled={!canEdit} /></td>
              <td>{item.createdBy || '-'}</td>
              <td>{item.createdAt ? formatDisplayDateTime(item.createdAt) : '-'}</td>
              <td><button type="button" className="btn-secondary" onClick={() => markRecord(removeArrayItem(record, 'attachments', index))} disabled={!canEdit}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn-secondary" onClick={addAttachment} disabled={!canEdit}>Add Attachment</button>
    </div>
  )
}

function renderAuditSection(
  record: any,
  settings: any,
  settingsDraft: any,
  setSettingsDraft: (value: any) => void,
  settingsDirty: boolean,
  setSettingsDirty: (value: boolean) => void,
  canManage: boolean,
  saveSettings: () => Promise<void>
) {
  return (
    <div className="stack-card">
      <h3>Record</h3>
      <div className="row">
        <div className="col"><label>Display Name</label><input value={record.displayName || ''} readOnly /></div>
        <div className="col"><label>Created At</label><input value={record.createdAt ? formatDisplayDateTime(record.createdAt) : '-'} readOnly /></div>
        <div className="col"><label>Updated At</label><input value={record.updatedAt ? formatDisplayDateTime(record.updatedAt) : '-'} readOnly /></div>
        <div className="col"><label>Updated By</label><input value={record.updatedBy || '-'} readOnly /></div>
      </div>

      <h3 className="section-title">Tenant Configuration</h3>
      <div className="row">
        <div className="col"><label>Customer Key Pattern</label><input value={settingsDraft?.keyPattern || settings?.keyPattern || ''} onChange={(e) => { setSettingsDraft({ ...(settingsDraft || {}), keyPattern: e.target.value }); setSettingsDirty(true) }} disabled={!canManage} /></div>
      </div>
      <div className="row">
        <div className="col"><label>Require Contact or Address</label><input type="checkbox" checked={Boolean(settingsDraft?.validation?.requireContactOrAddress)} onChange={(e) => { setSettingsDraft({ ...(settingsDraft || {}), validation: { ...(settingsDraft?.validation || {}), requireContactOrAddress: e.target.checked } }); setSettingsDirty(true) }} disabled={!canManage} /></div>
        <div className="col"><label>Update Existing on External ID</label><input type="checkbox" checked={Boolean(settingsDraft?.validation?.updateExistingOnExternalId)} onChange={(e) => { setSettingsDraft({ ...(settingsDraft || {}), validation: { ...(settingsDraft?.validation || {}), updateExistingOnExternalId: e.target.checked } }); setSettingsDirty(true) }} disabled={!canManage} /></div>
        <div className="col"><label>Approval on Sensitive Change</label><input type="checkbox" checked={Boolean(settingsDraft?.workflow?.requireApprovalOnSensitiveChange)} onChange={(e) => { setSettingsDraft({ ...(settingsDraft || {}), workflow: { ...(settingsDraft?.workflow || {}), requireApprovalOnSensitiveChange: e.target.checked } }); setSettingsDirty(true) }} disabled={!canManage} /></div>
        <div className="col"><label>Approval on Merge</label><input type="checkbox" checked={Boolean(settingsDraft?.workflow?.requireApprovalOnMerge)} onChange={(e) => { setSettingsDraft({ ...(settingsDraft || {}), workflow: { ...(settingsDraft?.workflow || {}), requireApprovalOnMerge: e.target.checked } }); setSettingsDirty(true) }} disabled={!canManage} /></div>
      </div>
      <div className="toolbar-actions row-spaced-sm">
        <button type="button" onClick={saveSettings} disabled={!settingsDirty || !canManage}>Save Settings</button>
      </div>
    </div>
  )
}

function renderImportModal(
  setShowImportModal: (value: boolean) => void,
  importMode: 'upsert' | 'create-only',
  setImportMode: (value: 'upsert' | 'create-only') => void,
  importReason: string,
  setImportReason: (value: string) => void,
  importText: string,
  setImportText: (value: string) => void,
  importCustomer: () => Promise<void>,
  saving: boolean
) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel modal-panel-lg">
        <div className="modal-header">
          <h3>Import JSON</h3>
          <button type="button" className="btn-secondary" onClick={() => setShowImportModal(false)}>Close</button>
        </div>
        <div className="row">
          <div className="col">
            <label>Mode</label>
            <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'upsert' | 'create-only')}>
              <option value="upsert">upsert</option>
              <option value="create-only">create-only</option>
            </select>
          </div>
          <div className="col">
            <label>Reason</label>
            <input value={importReason} onChange={(e) => setImportReason(e.target.value)} />
          </div>
        </div>
        <label>Payload</label>
        <textarea rows={16} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste customer JSON payload" />
        <div className="toolbar-actions row-spaced-sm">
          <button type="button" onClick={importCustomer} disabled={saving}>Import</button>
        </div>
      </div>
    </div>
  )
}

function renderExportModal(setShowExportModal: (value: boolean) => void, exportText: string, fileStem: string) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel modal-panel-lg">
        <div className="modal-header">
          <h3>Export JSON</h3>
          <button type="button" className="btn-secondary" onClick={() => setShowExportModal(false)}>Close</button>
        </div>
        <textarea rows={16} value={exportText} readOnly />
        <div className="toolbar-actions row-spaced-sm">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const blob = new Blob([exportText], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `${fileStem || 'customer'}.json`
              anchor.click()
              URL.revokeObjectURL(url)
            }}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  )
}

function renderMergeModal(
  setShowMergeModal: (value: boolean) => void,
  mergeSourceId: string,
  setMergeSourceId: (value: string) => void,
  mergeReason: string,
  setMergeReason: (value: string) => void,
  mergeSourceRecord: any,
  mergeWinner: any,
  setMergeWinner: (value: any) => void,
  loadMergeSource: () => Promise<void>,
  mergeRecords: () => Promise<void>,
  saving: boolean
) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel modal-panel-lg">
        <div className="modal-header">
          <h3>Merge Customers</h3>
          <button type="button" className="btn-secondary" onClick={() => setShowMergeModal(false)}>Close</button>
        </div>
        <div className="row">
          <div className="col">
            <label>Source Customer ID or Key</label>
            <input value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)} />
          </div>
          <div className="col" style={{ maxWidth: 180, alignSelf: 'end' }}>
            <button type="button" className="btn-secondary" onClick={loadMergeSource}>Load Source</button>
          </div>
        </div>
        {mergeSourceRecord && (
          <>
            <p className="muted">Source loaded: {mergeSourceRecord.customerKey} - {mergeSourceRecord.displayName || '-'}</p>
            <div className="row">
              <div className="col"><label>Person winner</label><select value={mergeWinner.person} onChange={(e) => setMergeWinner({ ...mergeWinner, person: e.target.value })}><option value="target">Target</option><option value="source">Source</option></select></div>
              <div className="col"><label>Company winner</label><select value={mergeWinner.company} onChange={(e) => setMergeWinner({ ...mergeWinner, company: e.target.value })}><option value="target">Target</option><option value="source">Source</option></select></div>
              <div className="col"><label>Contacts winner</label><select value={mergeWinner.contacts} onChange={(e) => setMergeWinner({ ...mergeWinner, contacts: e.target.value })}><option value="target">Target</option><option value="source">Source</option></select></div>
              <div className="col"><label>Addresses winner</label><select value={mergeWinner.addresses} onChange={(e) => setMergeWinner({ ...mergeWinner, addresses: e.target.value })}><option value="target">Target</option><option value="source">Source</option></select></div>
              <div className="col"><label>External winner</label><select value={mergeWinner.external} onChange={(e) => setMergeWinner({ ...mergeWinner, external: e.target.value })}><option value="target">Target</option><option value="source">Source</option></select></div>
            </div>
          </>
        )}
        <div className="row">
          <div className="col">
            <label>Reason</label>
            <input value={mergeReason} onChange={(e) => setMergeReason(e.target.value)} />
          </div>
        </div>
        <div className="toolbar-actions row-spaced-sm">
          <button type="button" onClick={mergeRecords} disabled={!mergeSourceId || saving}>Merge</button>
        </div>
      </div>
    </div>
  )
}

function renderConflictModal(resolveConflict: (action: 'reload' | 'overwrite') => Promise<void>, setShowConflictModal: (value: boolean) => void) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-panel">
        <div className="modal-header">
          <h3>Version Conflict</h3>
          <button type="button" className="btn-secondary" onClick={() => setShowConflictModal(false)}>Close</button>
        </div>
        <p className="muted">Another user saved this customer while you were editing.</p>
        <div className="toolbar-actions">
          <button type="button" className="btn-secondary" onClick={() => void resolveConflict('reload')}>Reload Latest</button>
          <button type="button" onClick={() => void resolveConflict('overwrite')}>Overwrite with My Changes</button>
        </div>
      </div>
    </div>
  )
}
