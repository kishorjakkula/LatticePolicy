import { FormEvent, useEffect, useMemo, useState } from 'react'
import { apiAdmin as api } from '../../api/client'
import { useForms, useForm } from '../../api/hooks'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { formatDisplayDate } from '../../shared/dateDisplay'

type SectionKey = 'catalog' | 'jurisdictions' | 'applicability' | 'output' | 'security' | 'audit' | 'preview'
type EditorPopupMode = 'new' | 'view' | 'edit' | null

type FormSummary = {
  formId: string
  formNumber: string
  formTitle: string
  editionDate: string
  workflowStatus: string
  active: boolean
  jurisdictionCount: number
  createdAt?: string
  updatedAt?: string
}

type FormSortKey =
  | 'formNumber'
  | 'formTitle'
  | 'editionDate'
  | 'workflowStatus'
  | 'active'
  | 'jurisdictionCount'
  | 'createdAt'
  | 'updatedAt'

type FormDetail = {
  form: any
  jurisdictions: any[]
  applicability: any[]
  output: any | null
  templateAsset?: any | null
  delivery: any | null
  security: any | null
}

const WORKFLOW_STATUSES = ['Draft', 'Reviewed', 'Approved']
const REGULATORY_STATUSES = ['Approved', 'Filed', 'Pending', 'Withdrawn']
const RISK_ASSOCIATIONS = ['Policy', 'Vehicle', 'Driver', 'Location', 'Dwelling']
const TX_OPTIONS = ['Quote', 'Bind', 'Issue', 'Endorsement', 'Renewal', 'Cancellation', 'Reinstatement', 'Rewrite']

const EMPTY_FORM_DRAFT = {
  carrierCode: '',
  authority: 'ISO',
  formNumber: '',
  formTitle: '',
  editionDate: '',
  formType: 'Policy',
  lineOfBusiness: 'personal-auto',
  changeReason: '',
  editLock: true,
  requireApprovedJurisdiction: true
}

export function FormsManagementPage() {
  const [error, setError] = useState<string | null>(null)
  const [filterQ, setFilterQ] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterActive, setFilterActive] = useState('')
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [section, setSection] = useState<SectionKey>('catalog')
  const [auditItems, setAuditItems] = useState<any[]>([])
  const [previewItems, setPreviewItems] = useState<any[]>([])
  const [templateAsset, setTemplateAsset] = useState<any | null>(null)
  const [templateFile, setTemplateFile] = useState<File | null>(null)

  const [formDraft, setFormDraft] = useState({ ...EMPTY_FORM_DRAFT })
  const [jurisdictionDraft, setJurisdictionDraft] = useState({ stateCode: '', regulatoryStatus: 'Pending', approvalTrackingId: '', effectiveDate: '', sunsetDate: '', hasStateExceptions: false, notes: '' })
  const [applicabilityDraft, setApplicabilityDraft] = useState({ lineOfBusiness: 'personal-auto', productCode: 'personal-auto', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
  const [outputDraft, setOutputDraft] = useState({ templateSource: 'Static PDF', templateUri: '', outputFormat: 'PDF', mergeScope: 'policy', packetPlacement: 'End', sortOrder: 100, active: true })
  const [deliveryDraft, setDeliveryDraft] = useState({ deliveryMethodsText: 'Portal', visibilityText: 'Insured, Agent, Internal', acknowledgementRequired: false, esignRequired: false, active: true })
  const [securityDraft, setSecurityDraft] = useState({ allowedRolesText: 'forms_admin, compliance_admin, read_only', editRolesText: 'forms_admin, compliance_admin', viewRolesText: 'forms_admin, compliance_admin, read_only, admin' })
  const [previewDraft, setPreviewDraft] = useState({ lineOfBusiness: 'personal-auto', productCode: 'personal-auto', transactionType: 'Quote', state: '', effectiveDate: '' })

  const [editingJurisdictionId, setEditingJurisdictionId] = useState('')
  const [editingApplicabilityId, setEditingApplicabilityId] = useState('')
  const [editorPopupMode, setEditorPopupMode] = useState<EditorPopupMode>(null)
  const [formsSort, setFormsSort] = useState<{ key: FormSortKey; dir: 'asc' | 'desc' }>({
    key: 'updatedAt',
    dir: 'desc'
  })

  const [filterOpts, setFilterOpts] = useState<Record<string, any>>({})

  const { data: formsData, isLoading: loading, refetch: refetchForms } = useForms(filterOpts)
  const items: FormSummary[] = (formsData as FormSummary[] | undefined) ?? []

  const { data: detailRaw, refetch: refetchDetail } = useForm(selectedFormId)
  const detail: FormDetail | undefined = detailRaw as FormDetail | undefined

  const selectedSummary = useMemo(() => items.find((item) => item.formId === selectedFormId) || null, [items, selectedFormId])
  const sortedItems = useMemo(() => {
    const next = [...items]
    next.sort((a, b) => {
      const av = toSortValue(a, formsSort.key)
      const bv = toSortValue(b, formsSort.key)
      if (av < bv) return formsSort.dir === 'asc' ? -1 : 1
      if (av > bv) return formsSort.dir === 'asc' ? 1 : -1
      return 0
    })
    return next
  }, [items, formsSort])
  const formsPagination = useClientPagination(sortedItems, 10)
  const jurisdictionsPagination = useClientPagination(detail?.jurisdictions || [], 10)
  const applicabilityPagination = useClientPagination(detail?.applicability || [], 10)
  const auditPagination = useClientPagination(auditItems, 10)
  const previewPagination = useClientPagination(previewItems, 10)

  const loadForms = async () => {
    const active = filterActive === '' ? undefined : filterActive === 'true'
    setFilterOpts({ q: filterQ || undefined, status: filterStatus || undefined, active })
    await refetchForms()
  }

  const hydrateDrafts = (data: FormDetail) => {
    setFormDraft({
      carrierCode: data?.form?.carrierCode || '',
      authority: data?.form?.authority || 'ISO',
      formNumber: data?.form?.formNumber || '',
      formTitle: data?.form?.formTitle || '',
      editionDate: formatEditionDate(data?.form?.editionDate || ''),
      formType: data?.form?.formType || 'Policy',
      lineOfBusiness: data?.form?.lineOfBusiness || 'personal-auto',
      changeReason: '',
      editLock: data?.form?.editLock ?? true,
      requireApprovedJurisdiction: data?.form?.requireApprovedJurisdiction ?? true
    })
    setOutputDraft({
      templateSource: data?.output?.templateSource || 'Static PDF',
      templateUri: data?.output?.templateUri || '',
      outputFormat: data?.output?.outputFormat || 'PDF',
      mergeScope: data?.output?.mergeScope || 'policy',
      packetPlacement: data?.output?.packetPlacement || 'End',
      sortOrder: Number(data?.output?.sortOrder || 100),
      active: data?.output?.active ?? true
    })
    setDeliveryDraft({
      deliveryMethodsText: toCsv(data?.delivery?.deliveryMethods || ['Portal']),
      visibilityText: toCsv(data?.delivery?.visibility || ['Insured', 'Agent', 'Internal']),
      acknowledgementRequired: Boolean(data?.delivery?.acknowledgementRequired),
      esignRequired: Boolean(data?.delivery?.esignRequired),
      active: data?.delivery?.active ?? true
    })
    setSecurityDraft({
      allowedRolesText: toCsv(data?.security?.allowedRoles || ['forms_admin', 'compliance_admin', 'read_only']),
      editRolesText: toCsv(data?.security?.editRoles || ['forms_admin', 'compliance_admin']),
      viewRolesText: toCsv(data?.security?.viewRoles || ['forms_admin', 'compliance_admin', 'read_only', 'admin'])
    })
  }

  const loadFormSideData = async (formId: string) => {
    if (!formId) {
      setAuditItems([])
      setTemplateAsset(null)
      setTemplateFile(null)
      return
    }
    setError(null)
    try {
      const [audit, asset] = await Promise.all([
        api.getFormAudit(formId, 200),
        api.getFormTemplateAsset(formId).catch(() => null)
      ])
      setAuditItems(audit || [])
      setTemplateAsset(asset || null)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  useEffect(() => {
    void loadFormSideData(selectedFormId)
  }, [selectedFormId])

  useEffect(() => {
    if (detail && selectedFormId) {
      setTemplateAsset((prev: any) => prev ?? detail?.templateAsset ?? null)
      hydrateDrafts(detail as FormDetail)
    }
  }, [selectedFormId, detail])

  const resetNewForm = () => {
    setSelectedFormId('')
    setAuditItems([])
    setPreviewItems([])
    setTemplateAsset(null)
    setTemplateFile(null)
    setFormDraft({ ...EMPTY_FORM_DRAFT })
    setJurisdictionDraft({ stateCode: '', regulatoryStatus: 'Pending', approvalTrackingId: '', effectiveDate: '', sunsetDate: '', hasStateExceptions: false, notes: '' })
    setApplicabilityDraft({ lineOfBusiness: 'personal-auto', productCode: 'personal-auto', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
    setOutputDraft({ templateSource: 'Static PDF', templateUri: '', outputFormat: 'PDF', mergeScope: 'policy', packetPlacement: 'End', sortOrder: 100, active: true })
    setDeliveryDraft({ deliveryMethodsText: 'Portal', visibilityText: 'Insured, Agent, Internal', acknowledgementRequired: false, esignRequired: false, active: true })
    setSecurityDraft({ allowedRolesText: 'forms_admin, compliance_admin, read_only', editRolesText: 'forms_admin, compliance_admin', viewRolesText: 'forms_admin, compliance_admin, read_only, admin' })
    setEditingJurisdictionId('')
    setEditingApplicabilityId('')
    setSection('catalog')
  }

  const openNewFormPopup = () => {
    resetNewForm()
    setError(null)
    setEditorPopupMode('new')
  }

  const openFormPopup = (formId: string, mode: Exclude<EditorPopupMode, 'new' | null>) => {
    setSelectedFormId(formId)
    setSection('catalog')
    setEditorPopupMode(mode)
  }

  const closeEditorPopup = () => {
    setEditorPopupMode(null)
  }

  const canModify = !detail?.form || detail.form.workflowStatus !== 'Approved' || !detail.form.editLock
  const isViewPopup = editorPopupMode === 'view'
  const canEdit = canModify && !isViewPopup

  const handleSaveCatalog = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const payload = {
        carrierCode: formDraft.carrierCode,
        authority: formDraft.authority,
        formNumber: formDraft.formNumber,
        formTitle: formDraft.formTitle,
        editionDate: formDraft.editionDate,
        formType: formDraft.formType,
        lineOfBusiness: formDraft.lineOfBusiness,
        changeReason: formDraft.changeReason || undefined,
        editLock: formDraft.editLock,
        requireApprovedJurisdiction: formDraft.requireApprovedJurisdiction
      }
      const response = selectedFormId ? await api.updateForm(selectedFormId, payload) : await api.createForm(payload)
      const nextId = response?.form?.formId || selectedFormId
      void refetchForms()
      if (nextId) {
        setSelectedFormId(nextId)
        void refetchDetail()
        void loadFormSideData(nextId)
      }
      setFormDraft((prev) => ({ ...prev, changeReason: '' }))
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const runWorkflowAction = async (action: 'submit' | 'approve' | 'activate' | 'deactivate' | 'clone' | 'delete') => {
    if (!selectedFormId) return
    try {
      if (action === 'submit') {
        await api.submitForm(selectedFormId, formDraft.changeReason || undefined)
      } else if (action === 'approve') {
        const reason = prompt('Approval reason') || ''
        if (!reason.trim()) return
        await api.approveForm(selectedFormId, reason.trim())
      } else if (action === 'activate') {
        const reason = prompt('Activation reason') || ''
        if (!reason.trim()) return
        await api.activateForm(selectedFormId, reason.trim())
      } else if (action === 'deactivate') {
        const reason = prompt('Deactivation reason') || ''
        if (!reason.trim()) return
        await api.deactivateForm(selectedFormId, reason.trim())
      } else if (action === 'clone') {
        const editionDate = prompt('New edition date (MM/YYYY)') || ''
        if (!editionDate.trim()) return
        const cloned = await api.cloneForm(selectedFormId, { editionDate })
        const cloneId = cloned?.form?.formId
        void refetchForms()
        if (cloneId) setSelectedFormId(cloneId)
      } else if (action === 'delete') {
        if (!confirm('Delete this form record?')) return
        await api.deleteForm(selectedFormId, formDraft.changeReason || undefined)
        resetNewForm()
        void refetchForms()
        return
      }
      void refetchForms()
      void refetchDetail()
      void loadFormSideData(selectedFormId)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const saveJurisdiction = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedFormId) return
    try {
      const payload = { ...jurisdictionDraft, stateCode: jurisdictionDraft.stateCode.toUpperCase() }
      if (editingJurisdictionId) {
        await api.updateFormJurisdiction(selectedFormId, editingJurisdictionId, payload)
      } else {
        await api.addFormJurisdiction(selectedFormId, payload)
      }
      setJurisdictionDraft({ stateCode: '', regulatoryStatus: 'Pending', approvalTrackingId: '', effectiveDate: '', sunsetDate: '', hasStateExceptions: false, notes: '' })
      setEditingJurisdictionId('')
      void refetchDetail()
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const saveApplicability = async (e: FormEvent) => {
    e.preventDefault()
    if (!selectedFormId) return
    try {
      const payload = {
        lineOfBusiness: applicabilityDraft.lineOfBusiness,
        productCode: applicabilityDraft.productCode,
        riskUnitAssociation: applicabilityDraft.riskUnitAssociation,
        transactionTypes: fromCsv(applicabilityDraft.transactionTypesText),
        active: applicabilityDraft.active
      }
      if (editingApplicabilityId) {
        await api.updateFormApplicability(selectedFormId, editingApplicabilityId, payload)
      } else {
        await api.addFormApplicability(selectedFormId, payload)
      }
      setApplicabilityDraft({ lineOfBusiness: 'personal-auto', productCode: 'personal-auto', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
      setEditingApplicabilityId('')
      void refetchDetail()
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const saveOutputAndDelivery = async () => {
    if (!selectedFormId) return
    try {
      await api.updateFormOutput(selectedFormId, outputDraft)
      await api.updateFormDelivery(selectedFormId, {
        deliveryMethods: fromCsv(deliveryDraft.deliveryMethodsText),
        visibility: fromCsv(deliveryDraft.visibilityText),
        acknowledgementRequired: deliveryDraft.acknowledgementRequired,
        esignRequired: deliveryDraft.esignRequired,
        active: deliveryDraft.active
      })
      void refetchDetail()
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const viewDocument = async () => {
    if (!selectedFormId) return
    try {
      const blob = await api.getAdminFormDocument(selectedFormId)
      const url = window.URL.createObjectURL(blob)
      const popup = window.open(url, '_blank', 'noopener,noreferrer')
      if (!popup) window.location.href = url
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const uploadTemplatePdf = async () => {
    if (!selectedFormId || !templateFile) return
    if (!templateFile.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.')
      return
    }
    try {
      setError(null)
      let reason = ''
      if (detail?.form?.workflowStatus === 'Approved' && detail?.form?.editLock) {
        reason = (prompt('Reason for template change on approved form') || '').trim()
        if (!reason) return
      }
      await api.uploadFormTemplateAsset(selectedFormId, templateFile, reason || undefined)
      setTemplateFile(null)
      void refetchDetail()
      void loadFormSideData(selectedFormId)
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const removeTemplatePdf = async () => {
    if (!selectedFormId || !templateAsset) return
    try {
      let reason = ''
      if (detail?.form?.workflowStatus === 'Approved' && detail?.form?.editLock) {
        reason = (prompt('Reason for template removal on approved form') || '').trim()
        if (!reason) return
      }
      await api.deleteFormTemplateAsset(selectedFormId, reason || undefined)
      setTemplateAsset(null)
      setTemplateFile(null)
      void refetchDetail()
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const saveSecurity = async () => {
    if (!selectedFormId) return
    try {
      await api.updateFormSecurity(selectedFormId, {
        allowedRoles: fromCsv(securityDraft.allowedRolesText),
        editRoles: fromCsv(securityDraft.editRolesText),
        viewRoles: fromCsv(securityDraft.viewRolesText)
      })
      void refetchDetail()
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const runPreview = async () => {
    try {
      const result = await api.previewAdminForms({
        lineOfBusiness: previewDraft.lineOfBusiness,
        productCode: previewDraft.productCode,
        transactionType: previewDraft.transactionType,
        state: previewDraft.state,
        effectiveDate: previewDraft.effectiveDate || undefined
      })
      setPreviewItems(result || [])
    } catch (e: any) {
      setError(e.message || String(e))
    }
  }

  const canSaveCatalog = canEdit && (Boolean(selectedFormId) || editorPopupMode === 'new')
  const isEditorPopupOpen = editorPopupMode !== null
  const toggleFormsSort = (key: FormSortKey) => {
    setFormsSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      return { key, dir: 'asc' }
    })
  }
  const sortLabel = (key: FormSortKey, label: string) => {
    if (formsSort.key !== key) return label
    return `${label}${formsSort.dir === 'asc' ? ' (asc)' : ' (desc)'}`
  }

  return (
    <div className="ps-admin-page">
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Forms Administration</h2></div>
        <div className="ps-page-header-actions">
          <button className="btn-secondary" type="button" onClick={openNewFormPopup}>New Form</button>
          <button className="btn-secondary" type="button" onClick={() => void loadForms()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="ps-filter-panel">
        <form className="ps-filter-grid" onSubmit={(e) => { e.preventDefault(); void loadForms() }} role="search">
          <div className="ps-filter-col ps-filter-col--wide">
            <label className="ps-filter-label" htmlFor="fm-filter-q">Search</label>
            <input id="fm-filter-q" className="ps-filter-input" value={filterQ} onChange={(e) => setFilterQ(e.target.value)} placeholder="Form number or title" />
          </div>
          <div className="ps-filter-col">
            <label className="ps-filter-label" htmlFor="fm-filter-status">Status</label>
            <select id="fm-filter-status" className="ps-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All Statuses</option>
              {WORKFLOW_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div className="ps-filter-col">
            <label className="ps-filter-label" htmlFor="fm-filter-active">Active</label>
            <select id="fm-filter-active" className="ps-filter-select" value={filterActive} onChange={(e) => setFilterActive(e.target.value)}>
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>
          <div className="ps-filter-actions">
            <button type="submit" className="ps-filter-btn-search" disabled={loading}>Apply</button>
          </div>
        </form>
      </div>

      <div className="ps-table-card">
        <table className="table">
        <thead>
          <tr>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('formNumber')}>{sortLabel('formNumber', 'Form #')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('formTitle')}>{sortLabel('formTitle', 'Title')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('editionDate')}>{sortLabel('editionDate', 'Edition')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('workflowStatus')}>{sortLabel('workflowStatus', 'Status')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('active')}>{sortLabel('active', 'Active')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('jurisdictionCount')}>{sortLabel('jurisdictionCount', 'Jurisdictions')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('createdAt')}>{sortLabel('createdAt', 'Created Date')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('updatedAt')}>{sortLabel('updatedAt', 'Updated Date')}</button></th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!loading && items.length === 0 && <tr><td colSpan={9} className="muted">No forms configured.</td></tr>}
          {formsPagination.rows.map((item) => (
            <tr key={item.formId} onClick={() => setSelectedFormId(item.formId)} style={{ cursor: 'pointer', background: selectedFormId === item.formId ? 'var(--panel-soft)' : undefined }}>
              <td>{item.formNumber}</td>
              <td>{item.formTitle}</td>
              <td>{formatEditionDate(item.editionDate)}</td>
              <td>{item.workflowStatus}</td>
              <td>{item.active ? 'Yes' : 'No'}</td>
              <td>{item.jurisdictionCount}</td>
              <td>{formatDisplayDate(item.createdAt, { fallback: '-' })}</td>
              <td>{formatDisplayDate(item.updatedAt, { fallback: '-' })}</td>
              <td>
                <div className="table-actions table-actions--icons">
                  <button
                    type="button"
                    className="icon-action-btn"
                    aria-label={`View ${item.formNumber || item.formId}`}
                    title="View"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFormPopup(item.formId, 'view')
                    }}
                  >
                    {'\u{1F441}'}
                  </button>
                  <button
                    type="button"
                    className="icon-action-btn"
                    aria-label={`Edit ${item.formNumber || item.formId}`}
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFormPopup(item.formId, 'edit')
                    }}
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
      {!loading && items.length > 0 && (
        <TablePagination
          page={formsPagination.page}
          pageSize={formsPagination.pageSize}
          totalItems={formsPagination.totalItems}
          onPageChange={formsPagination.setPage}
          onPageSizeChange={formsPagination.setPageSize}
        />
      )}

      {isEditorPopupOpen && <div className="modal-overlay" role="presentation" onClick={closeEditorPopup} />}
      {(selectedFormId || isEditorPopupOpen) && <div className={`card stack-card${isEditorPopupOpen ? ' forms-editor-popover' : ''}`}>
        <div className="panel-header">
          <h3>
            {editorPopupMode === 'new'
              ? 'New Form'
              : editorPopupMode === 'view'
                ? `View Form ${selectedSummary?.formNumber || ''}`
                : editorPopupMode === 'edit'
                  ? `Edit Form ${selectedSummary?.formNumber || ''}`
                  : selectedFormId
                    ? `Form ${selectedSummary?.formNumber || ''}`
                    : 'Form'}
          </h3>
          <div className="toolbar-actions">
            <span className="muted">{detail?.form ? `${detail.form.workflowStatus} ${detail.form.active ? '- Active' : '- Inactive'}` : 'Draft not saved'}</span>
            {isEditorPopupOpen && <button className="btn-secondary" type="button" onClick={closeEditorPopup}>Close</button>}
          </div>
        </div>
        <div className="admin-section-layout">
          <nav className="admin-section-menu" aria-label="Forms sections">
            {(['catalog', 'jurisdictions', 'applicability', 'output', 'security', 'audit', 'preview'] as SectionKey[]).map((key) => (
              <button key={key} type="button" className={`admin-section-link${section === key ? ' active' : ''}`} onClick={() => setSection(key)}>{labelForSection(key)}</button>
            ))}
          </nav>
          <div className="admin-section-content">
        {section === 'catalog' && <form onSubmit={handleSaveCatalog}>
          <div className="row"><div className="col"><label>Carrier Code</label><input value={formDraft.carrierCode} onChange={(e) => setFormDraft((prev) => ({ ...prev, carrierCode: e.target.value }))} /></div><div className="col"><label>Authority</label><input value={formDraft.authority} onChange={(e) => setFormDraft((prev) => ({ ...prev, authority: e.target.value }))} /></div><div className="col"><label>Form Number</label><input value={formDraft.formNumber} onChange={(e) => setFormDraft((prev) => ({ ...prev, formNumber: e.target.value }))} /></div><div className="col"><label>Edition Date (MM/YYYY)</label><input value={formDraft.editionDate} onChange={(e) => setFormDraft((prev) => ({ ...prev, editionDate: e.target.value }))} /></div></div>
          <div className="row"><div className="col"><label>Form Title</label><input value={formDraft.formTitle} onChange={(e) => setFormDraft((prev) => ({ ...prev, formTitle: e.target.value }))} /></div><div className="col"><label>Form Type</label><input value={formDraft.formType} onChange={(e) => setFormDraft((prev) => ({ ...prev, formType: e.target.value }))} /></div><div className="col"><label>Line Of Business</label><input value={formDraft.lineOfBusiness} onChange={(e) => setFormDraft((prev) => ({ ...prev, lineOfBusiness: e.target.value }))} /></div></div>
          <div className="row"><div className="col"><label>Change Reason</label><input value={formDraft.changeReason} onChange={(e) => setFormDraft((prev) => ({ ...prev, changeReason: e.target.value }))} /></div><div className="col"><label>Edit Lock</label><select value={formDraft.editLock ? 'true' : 'false'} onChange={(e) => setFormDraft((prev) => ({ ...prev, editLock: e.target.value === 'true' }))}><option value="true">On</option><option value="false">Off</option></select></div><div className="col"><label>Require Approved Jurisdiction</label><select value={formDraft.requireApprovedJurisdiction ? 'true' : 'false'} onChange={(e) => setFormDraft((prev) => ({ ...prev, requireApprovedJurisdiction: e.target.value === 'true' }))}><option value="true">Yes</option><option value="false">No</option></select></div></div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}>
            <button type="submit" disabled={!canSaveCatalog}>{selectedFormId ? 'Save Form' : 'Create Form'}</button>
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('submit')} disabled={!canEdit}>Submit</button>}
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('approve')} disabled={!canEdit}>Approve</button>}
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('activate')} disabled={!canEdit}>Activate</button>}
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('deactivate')} disabled={!canEdit}>Deactivate</button>}
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('clone')} disabled={!canEdit}>Clone</button>}
            {selectedFormId && <button type="button" className="btn-secondary" onClick={() => void runWorkflowAction('delete')} disabled={!canEdit}>Delete</button>}
            {!selectedFormId && editorPopupMode !== 'new' && <span className="muted">Use New Form to create a form record.</span>}
          </div>
        </form>}

        {section === 'jurisdictions' && <>
          <form onSubmit={saveJurisdiction} className="row">
            <div className="col"><label>State/Province</label><input value={jurisdictionDraft.stateCode} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, stateCode: e.target.value }))} /></div>
            <div className="col"><label>Regulatory Status</label><select value={jurisdictionDraft.regulatoryStatus} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, regulatoryStatus: e.target.value }))}>{REGULATORY_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            <div className="col"><label>Approval ID</label><input value={jurisdictionDraft.approvalTrackingId} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, approvalTrackingId: e.target.value }))} /></div>
            <div className="col"><label>Effective Date</label><input type="date" value={jurisdictionDraft.effectiveDate} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, effectiveDate: e.target.value }))} /></div>
            <div className="col"><label>Sunset Date</label><input type="date" value={jurisdictionDraft.sunsetDate} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, sunsetDate: e.target.value }))} /></div>
            <div className="col" style={{ alignSelf: 'end' }}><button type="submit" disabled={!selectedFormId || !canEdit}>{editingJurisdictionId ? 'Update' : 'Add'}</button></div>
          </form>
          <table className="table" style={{ marginTop: 10 }}>
            <thead><tr><th>State</th><th>Status</th><th>Effective</th><th>Sunset</th><th>Approval ID</th><th>Actions</th></tr></thead>
            <tbody>
              {jurisdictionsPagination.rows.map((row) => (
                <tr key={row.jurisdictionId}>
                  <td>{row.stateCode}</td>
                  <td>{row.regulatoryStatus}</td>
                  <td>{formatDisplayDate(row.effectiveDate, { fallback: '-' })}</td>
                  <td>{formatDisplayDate(row.sunsetDate, { fallback: '-' })}</td>
                  <td>{row.approvalTrackingId || '-'}</td>
                  <td className="table-actions">
                    <button className="btn-secondary" onClick={() => { setEditingJurisdictionId(row.jurisdictionId); setJurisdictionDraft({ stateCode: row.stateCode, regulatoryStatus: row.regulatoryStatus, approvalTrackingId: row.approvalTrackingId || '', effectiveDate: row.effectiveDate || '', sunsetDate: row.sunsetDate || '', hasStateExceptions: Boolean(row.hasStateExceptions), notes: row.notes || '' }) }} disabled={!canEdit}>Edit</button>
                    <button className="btn-secondary" onClick={() => selectedFormId && api.deleteFormJurisdiction(selectedFormId, row.jurisdictionId).then(() => { void refetchDetail() }).catch((e: any) => setError(e.message || String(e)))} disabled={!canEdit}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(detail?.jurisdictions || []).length > 0 && (
            <TablePagination
              page={jurisdictionsPagination.page}
              pageSize={jurisdictionsPagination.pageSize}
              totalItems={jurisdictionsPagination.totalItems}
              onPageChange={jurisdictionsPagination.setPage}
              onPageSizeChange={jurisdictionsPagination.setPageSize}
            />
          )}
        </>}

        {section === 'applicability' && <>
          <form onSubmit={saveApplicability} className="row">
            <div className="col"><label>LOB</label><input value={applicabilityDraft.lineOfBusiness} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, lineOfBusiness: e.target.value }))} /></div>
            <div className="col"><label>Product</label><input value={applicabilityDraft.productCode} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, productCode: e.target.value }))} /></div>
            <div className="col"><label>Risk Unit</label><select value={applicabilityDraft.riskUnitAssociation} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, riskUnitAssociation: e.target.value }))}>{RISK_ASSOCIATIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            <div className="col"><label>Transactions (CSV)</label><input value={applicabilityDraft.transactionTypesText} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, transactionTypesText: e.target.value }))} /></div>
            <div className="col" style={{ alignSelf: 'end' }}><button type="submit" disabled={!selectedFormId || !canEdit}>{editingApplicabilityId ? 'Update' : 'Add'}</button></div>
          </form>
          <table className="table" style={{ marginTop: 10 }}>
            <thead><tr><th>LOB</th><th>Product</th><th>Risk Unit</th><th>Transactions</th><th>Actions</th></tr></thead>
            <tbody>
              {applicabilityPagination.rows.map((row) => (
                <tr key={row.applicabilityId}>
                  <td>{row.lineOfBusiness}</td>
                  <td>{row.productCode}</td>
                  <td>{row.riskUnitAssociation}</td>
                  <td>{toCsv(row.transactionTypes || [])}</td>
                  <td className="table-actions">
                    <button className="btn-secondary" onClick={() => { setEditingApplicabilityId(row.applicabilityId); setApplicabilityDraft({ lineOfBusiness: row.lineOfBusiness, productCode: row.productCode, riskUnitAssociation: row.riskUnitAssociation, transactionTypesText: toCsv(row.transactionTypes || []), active: Boolean(row.active) }) }} disabled={!canEdit}>Edit</button>
                    <button className="btn-secondary" onClick={() => selectedFormId && api.deleteFormApplicability(selectedFormId, row.applicabilityId).then(() => { void refetchDetail() }).catch((e: any) => setError(e.message || String(e)))} disabled={!canEdit}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(detail?.applicability || []).length > 0 && (
            <TablePagination
              page={applicabilityPagination.page}
              pageSize={applicabilityPagination.pageSize}
              totalItems={applicabilityPagination.totalItems}
              onPageChange={applicabilityPagination.setPage}
              onPageSizeChange={applicabilityPagination.setPageSize}
            />
          )}
        </>}

        {section === 'output' && <>
          <div className="row"><div className="col"><label>Template Source</label><input value={outputDraft.templateSource} onChange={(e) => setOutputDraft((prev) => ({ ...prev, templateSource: e.target.value }))} /></div><div className="col"><label>Template URI</label><input value={outputDraft.templateUri} onChange={(e) => setOutputDraft((prev) => ({ ...prev, templateUri: e.target.value }))} /></div><div className="col"><label>Output Format</label><input value={outputDraft.outputFormat} onChange={(e) => setOutputDraft((prev) => ({ ...prev, outputFormat: e.target.value }))} /></div><div className="col"><label>Packet Placement</label><input value={outputDraft.packetPlacement} onChange={(e) => setOutputDraft((prev) => ({ ...prev, packetPlacement: e.target.value }))} /></div></div>
          <div className="row"><div className="col"><label>Upload Template PDF</label><input type="file" accept=".pdf,application/pdf" onChange={(e) => setTemplateFile(e.target.files?.[0] || null)} /></div><div className="col"><label>Current Template File</label><div className="muted" style={{ marginTop: 10 }}>{templateAsset ? `${templateAsset.fileName} (${formatBytes(templateAsset.sizeBytes)})` : 'No uploaded file'}</div></div></div>
          <div className="row"><div className="col"><label>Delivery Methods (CSV)</label><input value={deliveryDraft.deliveryMethodsText} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, deliveryMethodsText: e.target.value }))} /></div><div className="col"><label>Visibility (CSV)</label><input value={deliveryDraft.visibilityText} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, visibilityText: e.target.value }))} /></div><div className="col"><label>Ack Required</label><select value={deliveryDraft.acknowledgementRequired ? 'true' : 'false'} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, acknowledgementRequired: e.target.value === 'true' }))}><option value="false">No</option><option value="true">Yes</option></select></div><div className="col"><label>E-sign Required</label><select value={deliveryDraft.esignRequired ? 'true' : 'false'} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, esignRequired: e.target.value === 'true' }))}><option value="false">No</option><option value="true">Yes</option></select></div></div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}><button type="button" onClick={saveOutputAndDelivery} disabled={!selectedFormId || !canEdit}>Save Output + Delivery</button><button type="button" className="btn-secondary" onClick={uploadTemplatePdf} disabled={!selectedFormId || !templateFile || !canEdit}>Upload PDF</button><button type="button" className="btn-secondary" onClick={removeTemplatePdf} disabled={!selectedFormId || !templateAsset || !canEdit}>Remove PDF</button><button type="button" className="btn-secondary" onClick={viewDocument} disabled={!selectedFormId}>View Document</button></div>
        </>}

        {section === 'security' && <>
          <div className="row"><div className="col"><label>Allowed Roles (CSV)</label><input value={securityDraft.allowedRolesText} onChange={(e) => setSecurityDraft((prev) => ({ ...prev, allowedRolesText: e.target.value }))} /></div><div className="col"><label>Edit Roles (CSV)</label><input value={securityDraft.editRolesText} onChange={(e) => setSecurityDraft((prev) => ({ ...prev, editRolesText: e.target.value }))} /></div><div className="col"><label>View Roles (CSV)</label><input value={securityDraft.viewRolesText} onChange={(e) => setSecurityDraft((prev) => ({ ...prev, viewRolesText: e.target.value }))} /></div></div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}><button onClick={saveSecurity} disabled={!selectedFormId || !canEdit}>Save Security</button></div>
        </>}

        {section === 'audit' && (
          <>
            <table className="table">
              <thead><tr><th>When</th><th>Event</th><th>Entity</th><th>Actor</th><th>Reason</th></tr></thead>
              <tbody>
                {auditItems.length === 0 && <tr><td colSpan={5} className="muted">No audit events.</td></tr>}
                {auditPagination.rows.map((row) => <tr key={row.auditId}><td>{formatDateTime(row.changedAt)}</td><td>{row.eventType}</td><td>{row.entityType}</td><td>{row.changedBy || '-'}</td><td>{row.reason || '-'}</td></tr>)}
              </tbody>
            </table>
            {auditItems.length > 0 && (
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

        {section === 'preview' && <>
          <div className="row"><div className="col"><label>LOB</label><input value={previewDraft.lineOfBusiness} onChange={(e) => setPreviewDraft((prev) => ({ ...prev, lineOfBusiness: e.target.value }))} /></div><div className="col"><label>Product</label><input value={previewDraft.productCode} onChange={(e) => setPreviewDraft((prev) => ({ ...prev, productCode: e.target.value }))} /></div><div className="col"><label>Transaction Type</label><select value={previewDraft.transactionType} onChange={(e) => setPreviewDraft((prev) => ({ ...prev, transactionType: e.target.value }))}>{TX_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div className="col"><label>State</label><input value={previewDraft.state} onChange={(e) => setPreviewDraft((prev) => ({ ...prev, state: e.target.value.toUpperCase() }))} /></div><div className="col"><label>Effective Date</label><input type="date" value={previewDraft.effectiveDate} onChange={(e) => setPreviewDraft((prev) => ({ ...prev, effectiveDate: e.target.value }))} /></div></div>
          <div className="muted" style={{ marginTop: 8 }}>Attachment preview uses explicit jurisdiction + applicability criteria (no inference rules).</div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}><button type="button" onClick={runPreview}>Run Packet Preview</button></div>
          <table className="table" style={{ marginTop: 10 }}>
            <thead><tr><th>Form #</th><th>Title</th><th>Edition</th><th>Placement</th><th>Reasons</th></tr></thead>
            <tbody>
              {previewItems.length === 0 && <tr><td colSpan={5} className="muted">No attached forms for this scenario.</td></tr>}
              {previewPagination.rows.map((row) => <tr key={row.formId}><td>{row.formNumber}</td><td>{row.formTitle}</td><td>{formatEditionDate(row.editionDate)}</td><td>{row.packetPlacement}</td><td>{Array.isArray(row.reasons) ? row.reasons.join(' | ') : '-'}</td></tr>)}
            </tbody>
          </table>
          {previewItems.length > 0 && (
            <TablePagination
              page={previewPagination.page}
              pageSize={previewPagination.pageSize}
              totalItems={previewPagination.totalItems}
              onPageChange={previewPagination.setPage}
              onPageSizeChange={previewPagination.setPageSize}
            />
          )}
        </>}
          </div>
        </div>
      </div>}
    </div>
  )
}

function labelForSection(key: SectionKey): string {
  if (key === 'catalog') return 'Catalog'
  if (key === 'jurisdictions') return 'Jurisdictions'
  if (key === 'applicability') return 'Applicability'
  if (key === 'output') return 'Output + Delivery'
  if (key === 'security') return 'Security'
  if (key === 'audit') return 'Audit'
  return 'Packet Preview'
}

function toCsv(values: any[]): string {
  if (!Array.isArray(values)) return ''
  return values.map((item) => String(item || '').trim()).filter(Boolean).join(', ')
}

function toSortValue(item: FormSummary, key: FormSortKey): string | number {
  switch (key) {
    case 'active':
      return item.active ? 1 : 0
    case 'jurisdictionCount':
      return Number(item.jurisdictionCount || 0)
    case 'editionDate':
      return normalizeDateSortValue(item.editionDate)
    case 'createdAt':
      return normalizeDateSortValue(item.createdAt || '')
    case 'updatedAt':
      return normalizeDateSortValue(item.updatedAt || '')
    case 'formNumber':
      return (item.formNumber || '').toLowerCase()
    case 'formTitle':
      return (item.formTitle || '').toLowerCase()
    case 'workflowStatus':
      return (item.workflowStatus || '').toLowerCase()
    default:
      return ''
  }
}

function normalizeDateSortValue(value: string): number {
  const normalized = String(value || '').trim()
  if (!normalized) return 0
  if (/^\d{2}\/\d{4}$/.test(normalized)) {
    const [mm, yyyy] = normalized.split('/').map((part) => Number(part))
    if (Number.isFinite(mm) && Number.isFinite(yyyy)) {
      return Date.UTC(yyyy, Math.max(0, mm - 1), 1)
    }
  }
  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function fromCsv(value: string): string[] {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function formatEditionDate(value: string): string {
  const raw = String(value || '')
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(raw)
  if (!match) return raw
  return `${match[2]}/${match[1]}`
}

function formatDateTime(value: string): string {
  return formatDisplayDate(value, { fallback: '-' })
}

function formatBytes(value: number): string {
  const bytes = Number(value || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}
