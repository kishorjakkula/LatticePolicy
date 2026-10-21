import { FormEvent, useEffect, useMemo, useState } from 'react'
import { apiAdmin as api } from '../../api/client'
import { useForms, useForm, useFormTemplateVariables } from '../../api/hooks'
import { TablePagination } from '../../components/TablePagination'
import { useClientPagination } from '../../hooks/useClientPagination'
import { formatDisplayDate } from '../../shared/dateDisplay'
import { CollapsibleSection } from '../../components/CollapsibleSection'
import { RadioGroup } from '../../components/RadioGroup'
import { ReasonDialog, useConfirmDialog, useReasonDialog } from '../../components/Dialog'
import { FormAttachmentEditor } from './forms/FormAttachmentEditor'
import { FormScenarioTest } from './forms/FormScenarioTest'
import { formMatchesScopeFilter, formScopeLabels, useFormsScopeCatalog, type FormScopeSummary } from './forms/useFormsScopeCatalog'
import { useAuth } from '../../auth/AuthContext'
import { hasPermission } from '../../auth/permissions'
import './forms/forms-management.css'

type SectionKey = 'catalog' | 'jurisdictions' | 'applicability' | 'output' | 'security' | 'audit' | 'preview'
type EditorPopupMode = 'new' | 'view' | 'edit' | null

type FormSummary = FormScopeSummary & {
  formId: string
  formNumber: string
  formTitle: string
  editionDate: string
  workflowStatus: string
  active: boolean
  jurisdictionCount: number
  productCodes: string[]
  stateCodes: string[]
  transactionTypes: string[]
  templateSource: string | null
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

type TemplateVariable = { token: string; label: string; description: string; group: string }

type TemplateUploadResult =
  | { kind: 'success'; fileName: string; recognizedTokens: string[] }
  | { kind: 'rejected'; fileName: string; message: string; badTokens: string[] }

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
  const [filterProduct, setFilterProduct] = useState('')
  const [filterState, setFilterState] = useState('')
  const [scopeFilter, setScopeFilter] = useState({ product: '', state: '' })
  const scopeCatalog = useFormsScopeCatalog()
  const [testRevision, setTestRevision] = useState(0)
  const [selectedFormId, setSelectedFormId] = useState<string>('')
  const [section, setSection] = useState<SectionKey>('catalog')
  const [auditItems, setAuditItems] = useState<any[]>([])
  const [templateAsset, setTemplateAsset] = useState<any | null>(null)
  const [templateFile, setTemplateFile] = useState<File | null>(null)
  const [templateUploadResult, setTemplateUploadResult] = useState<TemplateUploadResult | null>(null)

  const [formDraft, setFormDraft] = useState({ ...EMPTY_FORM_DRAFT })
  const [jurisdictionDraft, setJurisdictionDraft] = useState({ stateCode: '', regulatoryStatus: 'Pending', approvalTrackingId: '', effectiveDate: '', sunsetDate: '', hasStateExceptions: false, notes: '' })
  const [applicabilityDraft, setApplicabilityDraft] = useState({ lineOfBusiness: 'personal-auto', productCode: '', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
  const [outputDraft, setOutputDraft] = useState({ templateSource: 'Static PDF', templateUri: '', outputFormat: 'PDF', mergeScope: 'policy', packetPlacement: 'End', sortOrder: 100, active: true })
  const [deliveryDraft, setDeliveryDraft] = useState({ deliveryMethodsText: 'Portal', visibilityText: 'Insured, Agent, Internal', acknowledgementRequired: false, esignRequired: false, active: true })
  const [securityDraft, setSecurityDraft] = useState({ allowedRolesText: 'forms_admin, compliance_admin, read_only', editRolesText: 'forms_admin, compliance_admin', viewRolesText: 'forms_admin, compliance_admin, read_only, admin' })

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
  const { dialog: reasonDialog, askReason } = useReasonDialog()
  const { dialog: confirmDialog, askConfirm } = useConfirmDialog()
  const [editionDateRequest, setEditionDateRequest] = useState<{ resolve: (value: string | null) => void } | null>(null)
  const askEditionDate = () => new Promise<string | null>((resolve) => setEditionDateRequest({ resolve }))
  const selectedFormLabel = () => (detail?.form?.formNumber ? `form ${detail.form.formNumber}` : 'this form')

  const { data: templateVariablesData, isLoading: templateVariablesLoading } = useFormTemplateVariables()
  const templateVariables: TemplateVariable[] = (templateVariablesData as any)?.variables ?? []
  const templateVariableGroups = useMemo(() => groupTemplateVariables(templateVariables), [templateVariables])

  const selectedSummary = useMemo(() => items.find((item) => item.formId === selectedFormId) || null, [items, selectedFormId])
  const sortedItems = useMemo(() => {
    // Same scope fallbacks as generation: unscoped and 'ALL' forms stay in a filtered catalog.
    const next = items.filter((item) => formMatchesScopeFilter(item, scopeFilter))
    next.sort((a, b) => {
      const av = toSortValue(a, formsSort.key)
      const bv = toSortValue(b, formsSort.key)
      if (av < bv) return formsSort.dir === 'asc' ? -1 : 1
      if (av > bv) return formsSort.dir === 'asc' ? 1 : -1
      return 0
    })
    return next
  }, [items, formsSort, scopeFilter])
  const formsPagination = useClientPagination(sortedItems, 10)
  const jurisdictionsPagination = useClientPagination(detail?.jurisdictions || [], 10)
  const applicabilityPagination = useClientPagination(detail?.applicability || [], 10)
  const auditPagination = useClientPagination(auditItems, 10)

  const loadForms = async () => {
    const active = filterActive === '' ? undefined : filterActive === 'true'
    setFilterOpts({ q: filterQ || undefined, status: filterStatus || undefined, active })
    setScopeFilter({ product: filterProduct, state: filterState })
  }

  const refreshForms = async () => {
    setError(null)
    try {
      await refetchForms()
      if (selectedFormId) {
        await refetchDetail()
        await loadFormSideData(selectedFormId)
      }
      setTestRevision((value) => value + 1)
    } catch (e: any) {
      setError(e.message || String(e))
    }
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
    setTemplateUploadResult(null)
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
    setTemplateAsset(null)
    setTemplateFile(null)
    setTemplateUploadResult(null)
    setFormDraft({ ...EMPTY_FORM_DRAFT })
    setJurisdictionDraft({ stateCode: '', regulatoryStatus: 'Pending', approvalTrackingId: '', effectiveDate: '', sunsetDate: '', hasStateExceptions: false, notes: '' })
    setApplicabilityDraft({ lineOfBusiness: 'personal-auto', productCode: '', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
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

  const canModify = !selectedFormId || Boolean(detail?.form && (detail.form.workflowStatus !== 'Approved' || !detail.form.editLock))
  const isViewPopup = editorPopupMode === 'view'
  const canEdit = canModify && !isViewPopup
  // Review and activation follow workflow state and compliance authority, not
  // content editability: an approved, edit-locked edition must still be activatable.
  const { user } = useAuth()
  const isComplianceAdmin = hasPermission(user, 'admin.forms.approve') || (user?.roles || []).includes('compliance_admin')
  const lifecycleForm = detail?.form
  const lifecycleEnabled: Record<'approve' | 'activate' | 'deactivate' | 'delete', boolean> = {
    approve: Boolean(lifecycleForm && lifecycleForm.workflowStatus === 'Reviewed'),
    activate: Boolean(lifecycleForm && lifecycleForm.workflowStatus === 'Approved' && !lifecycleForm.active),
    deactivate: Boolean(lifecycleForm?.active),
    delete: Boolean(lifecycleForm && !lifecycleForm.active && lifecycleForm.workflowStatus !== 'Approved'),
  }
  const scopeProduct = detail?.applicability?.[0]?.productCode || applicabilityDraft.productCode
  const products = mergeCatalogOptions(scopeCatalog.products, (detail?.applicability || []).map((row) => row.productCode))
  const states = mergeCatalogOptions(scopeCatalog.states, (detail?.jurisdictions || []).map((row) => row.stateCode))
  const primarySection = section === 'jurisdictions' ? 'catalog' : section === 'applicability' ? 'attachment' : section

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
      setTestRevision((value) => value + 1)
      return true
    } catch (e: any) {
      setError(e.message || String(e))
      return false
    }
  }

  const runWorkflowAction = async (action: 'submit' | 'approve' | 'activate' | 'deactivate' | 'clone' | 'delete') => {
    if (!selectedFormId) return
    try {
      if (action === 'submit') {
        await api.submitForm(selectedFormId, formDraft.changeReason || undefined)
      } else if (action === 'approve') {
        const reason = (await askReason({ title: `Approve ${selectedFormLabel()}`, confirmLabel: 'Approve' })) || ''
        if (!reason.trim()) return
        await api.approveForm(selectedFormId, reason.trim())
      } else if (action === 'activate') {
        const reason = (await askReason({ title: `Activate ${selectedFormLabel()}`, confirmLabel: 'Activate' })) || ''
        if (!reason.trim()) return
        await api.activateForm(selectedFormId, reason.trim())
      } else if (action === 'deactivate') {
        const reason = (await askReason({ title: `Deactivate ${selectedFormLabel()}`, confirmLabel: 'Deactivate', danger: true })) || ''
        if (!reason.trim()) return
        await api.deactivateForm(selectedFormId, reason.trim())
      } else if (action === 'clone') {
        const editionDate = (await askEditionDate()) || ''
        if (!editionDate.trim()) return
        const cloned = await api.cloneForm(selectedFormId, { editionDate })
        const cloneId = cloned?.form?.formId
        void refetchForms()
        if (cloneId) setSelectedFormId(cloneId)
      } else if (action === 'delete') {
        if (!(await askConfirm({ title: `Delete ${selectedFormLabel()}`, confirmLabel: 'Delete', danger: true }))) return
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
      setTestRevision((value) => value + 1)
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
      setApplicabilityDraft({ lineOfBusiness: 'personal-auto', productCode: '', riskUnitAssociation: 'Policy', transactionTypesText: 'Quote, Issue', active: true })
      setEditingApplicabilityId('')
      setTestRevision((value) => value + 1)
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
      setTestRevision((value) => value + 1)
      void refetchDetail()
      return true
    } catch (e: any) {
      setError(e.message || String(e))
      return false
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

  const uploadTemplateFile = async () => {
    if (!selectedFormId || !templateFile) return
    const fileName = templateFile.name
    const lowerName = fileName.toLowerCase()
    const isDocx = lowerName.endsWith('.docx')
    if (!lowerName.endsWith('.pdf') && !isDocx) {
      setError('Only PDF or Word (.docx) files are supported.')
      return
    }
    try {
      setError(null)
      setTemplateUploadResult(null)
      let reason = ''
      if (detail?.form?.workflowStatus === 'Approved' && detail?.form?.editLock) {
        reason = ((await askReason({ title: `Replace template for ${selectedFormLabel()}`, help: 'This form is approved; the change is recorded with this reason.', confirmLabel: 'Replace template' })) || '').trim()
        if (!reason) return
      }
      const response = await api.uploadFormTemplateAsset(selectedFormId, templateFile, reason || undefined)
      setTestRevision((value) => value + 1)
      setTemplateFile(null)
      if (isDocx) {
        const recognizedTokens = Array.isArray((response as any)?.recognizedTokens)
          ? (response as any).recognizedTokens.map((t: any) => String(t))
          : []
        setTemplateUploadResult({ kind: 'success', fileName, recognizedTokens })
      }
      void refetchDetail()
      void loadFormSideData(selectedFormId)
    } catch (e: any) {
      if (isDocx) {
        const parsed = parseTemplateValidationError(e)
        setTemplateUploadResult({ kind: 'rejected', fileName, message: parsed.message, badTokens: parsed.badTokens })
      } else {
        setError(e.message || String(e))
      }
    }
  }

  const removeTemplatePdf = async () => {
    if (!selectedFormId || !templateAsset) return
    try {
      let reason = ''
      if (detail?.form?.workflowStatus === 'Approved' && detail?.form?.editLock) {
        reason = ((await askReason({ title: `Remove template from ${selectedFormLabel()}`, help: 'This form is approved; the removal is recorded with this reason.', confirmLabel: 'Remove template', danger: true })) || '').trim()
        if (!reason) return
      }
      await api.deleteFormTemplateAsset(selectedFormId, reason || undefined)
      setTemplateAsset(null)
      setTemplateFile(null)
      setTemplateUploadResult(null)
      setTestRevision((value) => value + 1)
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
    <div className="ps-admin-page forms-management">
      {reasonDialog}
      {confirmDialog}
      {editionDateRequest && (
        <ReasonDialog
          title={`Create new edition of ${selectedFormLabel()}`}
          label="Edition date"
          help="MM/YYYY"
          confirmLabel="Create edition"
          onConfirm={(value) => {
            if (!EDITION_DATE_PATTERN.test(value)) throw new Error('Enter the edition date as MM/YYYY, for example 04/2026.')
            editionDateRequest.resolve(value)
            setEditionDateRequest(null)
          }}
          onCancel={() => {
            editionDateRequest.resolve(null)
            setEditionDateRequest(null)
          }}
        />
      )}
      <div className="ps-page-header">
        <div><h2 className="ps-page-title">Forms Administration</h2></div>
        <div className="ps-page-header-actions">
          <button className="btn-secondary" type="button" onClick={openNewFormPopup}>New Form</button>
          <button className="btn-secondary" type="button" onClick={() => void refreshForms()} disabled={loading}>Refresh</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {scopeCatalog.error && <p className="error" role="alert">Scope catalog unavailable: {scopeCatalog.error}</p>}

      <CollapsibleSection title="Filters" className="ps-filter-panel">
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
            <label className="ps-filter-label" htmlFor="fm-filter-product">Product</label>
            <select id="fm-filter-product" value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)}><option value="">All products</option>{scopeCatalog.products.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>
          </div>
          <div className="ps-filter-col">
            <label className="ps-filter-label" htmlFor="fm-filter-state">State</label>
            <select id="fm-filter-state" value={filterState} onChange={(e) => setFilterState(e.target.value)}><option value="">All states</option>{scopeCatalog.states.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>
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
      </CollapsibleSection>

      <CollapsibleSection title="Form List" className="ps-table-card">
        <div className="forms-table-scroll"><table className="table table-no-sticky-head">
        <thead>
          <tr>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('formNumber')}>{sortLabel('formNumber', 'Form #')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('formTitle')}>{sortLabel('formTitle', 'Title')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('editionDate')}>{sortLabel('editionDate', 'Edition')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('workflowStatus')}>{sortLabel('workflowStatus', 'Status')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('active')}>{sortLabel('active', 'Active')}</button></th>
            <th><button type="button" className="table-sort-button" onClick={() => toggleFormsSort('jurisdictionCount')}>{sortLabel('jurisdictionCount', 'Jurisdictions')}</button></th>
            <th>Product / states</th>
            <th>Printing / attachment</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!loading && sortedItems.length === 0 && <tr><td colSpan={9} className="muted">No matching forms.</td></tr>}
          {formsPagination.rows.map((item) => (
            <tr key={item.formId} style={{ background: selectedFormId === item.formId ? 'var(--panel-soft)' : undefined }}>
              <td className="forms-list-nowrap">{item.formNumber}</td>
              <td>{item.formTitle}</td>
              <td>{formatEditionDate(item.editionDate)}</td>
              <td>{item.workflowStatus}</td>
              <td>{item.active ? 'Yes' : 'No'}</td>
              <td>{item.jurisdictionCount}</td>
              <td>{formScopeLabels(item).products}<br />{formScopeLabels(item).states}</td>
              <td>{item.templateSource || '-'}<br />{toCsv(item.transactionTypes) || '-'}</td>
              <td>
                <div className="table-actions table-actions--icons">
                  <button
                    type="button"
                    className="icon-action-btn forms-list-action"
                    aria-label={`View ${item.formNumber || item.formId}`}
                    title="View"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFormPopup(item.formId, 'view')
                    }}
                  >
                    <span aria-hidden="true">{'\u{1F441}'}</span> View
                  </button>
                  <button
                    type="button"
                    className="icon-action-btn forms-list-action"
                    aria-label={`Edit ${item.formNumber || item.formId}`}
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation()
                      openFormPopup(item.formId, 'edit')
                    }}
                  >
                    <span aria-hidden="true">{'\u270E'}</span> Edit
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      </CollapsibleSection>
      {!loading && items.length > 0 && (
        <TablePagination
          page={formsPagination.page}
          pageSize={formsPagination.pageSize}
          totalItems={formsPagination.totalItems}
          onPageChange={formsPagination.setPage}
          onPageSizeChange={formsPagination.setPageSize}
        />
      )}

      {isEditorPopupOpen && <section aria-label="Form editor">
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
          <nav className="forms-primary-tabs" role="tablist" aria-label="Forms sections">
            {(['catalog', 'output', 'applicability', 'preview'] as SectionKey[]).map((key, index, keys) => (
              <button key={key} id={`forms-tab-${key}`} role="tab" aria-selected={(key === 'applicability' ? 'attachment' : key) === primarySection} aria-controls="forms-editor-panel" tabIndex={(key === 'applicability' ? 'attachment' : key) === primarySection ? 0 : -1} type="button" onClick={() => setSection(key)} onKeyDown={(event) => {
                const nextIndex = event.key === 'ArrowRight' ? (index + 1) % keys.length : event.key === 'ArrowLeft' ? (index + keys.length - 1) % keys.length : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : -1
                if (nextIndex < 0) return
                event.preventDefault(); setSection(keys[nextIndex]); document.getElementById(`forms-tab-${keys[nextIndex]}`)?.focus()
              }}>{labelForSection(key)}</button>
            ))}
          </nav>
          <details><summary>History, security & legacy settings</summary><div className="toolbar-actions">{(['output', 'security', 'audit'] as SectionKey[]).map((key) => <button type="button" className="btn-secondary" key={key} onClick={() => setSection(key)}>{key === 'output' ? 'Output + Delivery' : labelForSection(key)}</button>)}</div></details>
          <div className="admin-section-content" id="forms-editor-panel" role="tabpanel" aria-labelledby={`forms-tab-${section === 'jurisdictions' ? 'catalog' : section === 'security' || section === 'audit' ? 'preview' : section}`}>
        {primarySection === 'catalog' && <form onSubmit={handleSaveCatalog}>
          <fieldset disabled={!canEdit}><legend>Details & scope</legend>
          <div className="row"><div className="col"><label htmlFor="fm-carrier">Carrier Code</label><input id="fm-carrier" value={formDraft.carrierCode} onChange={(e) => setFormDraft((prev) => ({ ...prev, carrierCode: e.target.value }))} /></div><div className="col"><label htmlFor="fm-authority">Authority</label><input id="fm-authority" value={formDraft.authority} onChange={(e) => setFormDraft((prev) => ({ ...prev, authority: e.target.value }))} /></div><div className="col"><label htmlFor="fm-number">Form Number</label><input id="fm-number" value={formDraft.formNumber} onChange={(e) => setFormDraft((prev) => ({ ...prev, formNumber: e.target.value }))} /></div><div className="col"><label htmlFor="fm-edition">Edition Date (MM/YYYY)</label><input id="fm-edition" value={formDraft.editionDate} onChange={(e) => setFormDraft((prev) => ({ ...prev, editionDate: e.target.value }))} /></div></div>
          <div className="row"><div className="col"><label htmlFor="fm-title">Form Title</label><input id="fm-title" value={formDraft.formTitle} onChange={(e) => setFormDraft((prev) => ({ ...prev, formTitle: e.target.value }))} /></div><div className="col"><label htmlFor="fm-type">Form Type</label><input id="fm-type" value={formDraft.formType} onChange={(e) => setFormDraft((prev) => ({ ...prev, formType: e.target.value }))} /></div><div className="col"><label htmlFor="fm-lob">Line Of Business</label><input id="fm-lob" value={formDraft.lineOfBusiness} onChange={(e) => setFormDraft((prev) => ({ ...prev, lineOfBusiness: e.target.value }))} /></div></div>
          <div className="row"><div className="col"><label htmlFor="fm-reason">Change Reason</label><input id="fm-reason" value={formDraft.changeReason} onChange={(e) => setFormDraft((prev) => ({ ...prev, changeReason: e.target.value }))} /></div><div className="col"><label className="forms-check"><input type="checkbox" checked={formDraft.editLock} onChange={(e) => setFormDraft({ ...formDraft, editLock: e.target.checked })} />Edit Lock</label></div><div className="col"><label className="forms-check"><input type="checkbox" checked={formDraft.requireApprovedJurisdiction} onChange={(e) => setFormDraft({ ...formDraft, requireApprovedJurisdiction: e.target.checked })} />Require Approved Jurisdiction</label></div></div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}>
            <button type="submit" disabled={!canSaveCatalog}>{selectedFormId ? 'Save Form' : 'Create Form'}</button>
            <button type="button" disabled={!canSaveCatalog} onClick={async () => { if (await handleSaveCatalog({ preventDefault() {} } as FormEvent)) setSection('output') }}>Save & continue</button>
            {!selectedFormId && editorPopupMode !== 'new' && <span className="muted">Use New Form to create a form record.</span>}
          </div>
          </fieldset>
        </form>}

        {primarySection === 'catalog' && <>
          <h4>Applicable states & effective window</h4>
          {!detail?.jurisdictions?.length && <p className="muted">No state scope saved. This is not worldwide approval.</p>}
          <form onSubmit={saveJurisdiction} className="row">
            <div className="col"><label htmlFor="fm-scope-state">State/Province</label><select id="fm-scope-state" disabled={!canEdit} value={jurisdictionDraft.stateCode} onChange={(e) => setJurisdictionDraft((prev) => ({ ...prev, stateCode: e.target.value }))}><option value="">Select state</option>{states.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></div>
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

        {(primarySection === 'catalog' || primarySection === 'attachment') && <>
          <details open={primarySection === 'catalog'}><summary>Product & transaction scope</summary>
          {!detail?.applicability?.length && <p className="muted">No product scope saved.</p>}
          <form onSubmit={saveApplicability} className="row">
            <div className="col"><label>LOB</label><input value={applicabilityDraft.lineOfBusiness} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, lineOfBusiness: e.target.value }))} /></div>
            <div className="col"><label htmlFor="fm-scope-product">Product scope</label><select id="fm-scope-product" disabled={!canEdit} value={applicabilityDraft.productCode} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, productCode: e.target.value }))}><option value="">Select product</option>{products.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></div>
            <div className="col"><label>Risk Unit</label><select value={applicabilityDraft.riskUnitAssociation} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, riskUnitAssociation: e.target.value }))}>{RISK_ASSOCIATIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            <fieldset className="forms-transactions" disabled={!canEdit}><legend>Transactions</legend>{TX_OPTIONS.map((transaction) => <label className="forms-check" key={transaction}><input type="checkbox" checked={fromCsv(applicabilityDraft.transactionTypesText).includes(transaction)} onChange={(e) => setApplicabilityDraft((prev) => ({ ...prev, transactionTypesText: toCsv(e.target.checked ? [...fromCsv(prev.transactionTypesText), transaction] : fromCsv(prev.transactionTypesText).filter((value) => value !== transaction)) }))} />{transaction}</label>)}</fieldset>
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
          </details>
        </>}

        {primarySection === 'attachment' && <>
          <FormAttachmentEditor key={selectedFormId} formId={selectedFormId} productCode={scopeProduct} canEdit={canEdit && detail?.form?.workflowStatus === 'Draft'} onChange={() => { setTestRevision((value) => value + 1); void refetchDetail() }} />
          {detail?.form && detail.form.workflowStatus !== 'Draft' && <p className="muted">Attachment rules can only be changed on a Draft edition.</p>}
          <fieldset disabled={!canEdit}><legend>Packet placement</legend>
            <label>Placement<select value={outputDraft.packetPlacement} onChange={(e) => setOutputDraft({ ...outputDraft, packetPlacement: e.target.value })}>{['Beginning', 'End', outputDraft.packetPlacement].filter((value, index, all) => all.indexOf(value) === index).map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Packet order<input type="number" value={outputDraft.sortOrder} onChange={(e) => setOutputDraft({ ...outputDraft, sortOrder: Number(e.target.value) })} /></label>
            <label>Copy scope<select value={outputDraft.mergeScope} onChange={(e) => setOutputDraft({ ...outputDraft, mergeScope: e.target.value })}>{['policy', 'risk', outputDraft.mergeScope].filter((value, index, all) => all.indexOf(value) === index).map((value) => <option key={value}>{value}</option>)}</select></label>
            <button type="button" disabled={!selectedFormId || !canEdit} onClick={() => void saveOutputAndDelivery()}>Save attachment output</button>
            <button type="button" disabled={!selectedFormId || !canEdit} onClick={async () => { if (await saveOutputAndDelivery()) setSection('preview') }}>Save & continue</button>
          </fieldset>
          <p className="muted">Saved scope: {toCsv((detail?.applicability || []).map((row) => `${row.productCode}: ${toCsv(row.transactionTypes)}`)) || 'Incomplete'}; states: {toCsv((detail?.jurisdictions || []).map((row) => row.stateCode)) || 'Incomplete'}. New-business stage conditions use transaction.stage (Bind or Issue); servicing transactions use transaction.type. No separate required-output setting is exposed by this API.</p>
        </>}

        {section === 'output' && <>
          <RadioGroup name="form-printing" ariaLabel="Printing" disabled={!canEdit} options={[{ value: 'Static PDF', label: 'Static file (PDF)' }, { value: 'Uploaded DOCX', label: 'Policy data (DOCX)' }]} value={outputDraft.templateSource === 'Uploaded DOCX' ? 'Uploaded DOCX' : 'Static PDF'} onChange={(templateSource) => setOutputDraft({ ...outputDraft, templateSource, outputFormat: 'PDF' })} />
          <p className="muted">Supported uploads: PDF and Word (.docx). XLSX and policy-filled PDF are not supported. DOCX variables are checked by the upload service.</p>
          <details><summary>Existing output metadata</summary><div className="row"><div className="col"><label>Template Source</label><input value={outputDraft.templateSource} onChange={(e) => setOutputDraft((prev) => ({ ...prev, templateSource: e.target.value }))} /></div><div className="col"><label>Template URI</label><input readOnly value={outputDraft.templateUri} /></div><div className="col"><label>Output Format</label><input value={outputDraft.outputFormat} onChange={(e) => setOutputDraft((prev) => ({ ...prev, outputFormat: e.target.value }))} /></div></div></details>
          <div className="row"><div className="col"><label htmlFor="fm-template-upload">Upload Template (PDF or Word .docx)</label><input id="fm-template-upload" type="file" disabled={!canEdit} accept=".pdf,application/pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const file = e.target.files?.[0] || null; setTemplateFile(file); setTemplateUploadResult(null); if (file) setOutputDraft((prev) => ({ ...prev, templateSource: file.name.toLowerCase().endsWith('.docx') ? 'Uploaded DOCX' : 'Static PDF' })) }} /></div><div className="col"><label>Current Template File</label><div className="muted" style={{ marginTop: 10 }}>{templateAsset ? `${templateAsset.fileName} (${formatBytes(templateAsset.sizeBytes)})` : 'No uploaded file'}</div></div></div>
          {templateUploadResult?.kind === 'success' && (
            <p className="success" role="status">
              Template "{templateUploadResult.fileName}" uploaded.{' '}
              {templateUploadResult.recognizedTokens.length > 0
                ? `Recognized variables: ${templateUploadResult.recognizedTokens.map((t) => `{{${t}}}`).join(', ')}`
                : 'No {{variable}} placeholders were found in this template.'}
            </p>
          )}
          {templateUploadResult?.kind === 'rejected' && (
            <p className="error" role="alert">
              Template "{templateUploadResult.fileName}" was rejected: {templateUploadResult.message}
              {templateUploadResult.badTokens.length > 0 && (
                <> Unrecognized placeholder(s): {templateUploadResult.badTokens.map((t) => `{{${t}}}`).join(', ')}.</>
              )}
            </p>
          )}
          <details className="policy-collapsible" style={{ marginTop: 8 }}>
            <summary className="policy-collapsible-summary">Template Variable Reference ({templateVariables.length})</summary>
            <div className="policy-collapsible-body">
              <p className="muted" style={{ marginTop: 0 }}>
                Use these <code>{'{{token}}'}</code> placeholders in a Word (.docx) template. Each will be replaced with the policy's actual data when the document is generated.
              </p>
              {templateVariablesLoading && <p className="muted">Loading variable catalog...</p>}
              {!templateVariablesLoading && templateVariables.length === 0 && <p className="muted">No template variables available.</p>}
              {templateVariableGroups.map((group) => (
                <div key={group.group} style={{ marginTop: 12 }}>
                  <div className="muted" style={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.74rem', letterSpacing: '0.05em', marginBottom: 6 }}>{group.group}</div>
                  <table className="table">
                    <thead><tr><th>Token</th><th>Label</th><th>Description</th></tr></thead>
                    <tbody>
                      {group.items.map((item) => (
                        <tr key={item.token}>
                          <td><code>{`{{${item.token}}}`}</code></td>
                          <td>{item.label}</td>
                          <td>{item.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </details>
          <div className="row"><div className="col"><label>Delivery Methods (CSV)</label><input value={deliveryDraft.deliveryMethodsText} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, deliveryMethodsText: e.target.value }))} /></div><div className="col"><label>Visibility (CSV)</label><input value={deliveryDraft.visibilityText} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, visibilityText: e.target.value }))} /></div><div className="col"><label>Ack Required</label><select value={deliveryDraft.acknowledgementRequired ? 'true' : 'false'} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, acknowledgementRequired: e.target.value === 'true' }))}><option value="false">No</option><option value="true">Yes</option></select></div><div className="col"><label>E-sign Required</label><select value={deliveryDraft.esignRequired ? 'true' : 'false'} onChange={(e) => setDeliveryDraft((prev) => ({ ...prev, esignRequired: e.target.value === 'true' }))}><option value="false">No</option><option value="true">Yes</option></select></div></div>
          <div className="toolbar-actions" style={{ marginTop: 12 }}><button type="button" onClick={saveOutputAndDelivery} disabled={!selectedFormId || !canEdit}>Save Output + Delivery</button><button type="button" className="btn-secondary" onClick={uploadTemplateFile} disabled={!selectedFormId || !templateFile || !canEdit}>Upload Template</button><button type="button" className="btn-secondary" onClick={removeTemplatePdf} disabled={!selectedFormId || !templateAsset || !canEdit}>Remove Template</button><button type="button" className="btn-secondary" onClick={viewDocument} disabled={!selectedFormId}>View Document</button></div>
          <div className="toolbar-actions"><button type="button" disabled={!selectedFormId || !canEdit || Boolean(templateFile)} onClick={async () => { if (await saveOutputAndDelivery()) setSection('applicability') }}>Save & continue</button></div>
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
          <FormScenarioTest key={selectedFormId} formId={selectedFormId} lineOfBusiness={formDraft.lineOfBusiness} products={products} states={states} initialProduct={scopeProduct} initialState={detail?.jurisdictions?.[0]?.stateCode || ''} revision={JSON.stringify([detail, formDraft, outputDraft, deliveryDraft, testRevision])} />
          <div className="toolbar-actions">
            <button type="button" disabled={!selectedFormId} onClick={() => void viewDocument()}>View Document</button>
            <button type="button" disabled={!canSaveCatalog} onClick={async () => { if (await handleSaveCatalog({ preventDefault() {} } as FormEvent)) await saveOutputAndDelivery() }}>Save draft</button>
            <button type="button" disabled={!selectedFormId || !canEdit} onClick={() => void runWorkflowAction('submit')}>Submit for review</button>
            <button type="button" className="btn-secondary" disabled={!selectedFormId || isViewPopup} onClick={() => void runWorkflowAction('clone')}>Create new edition</button>
          </div>
          <details><summary>Review, activation & lifecycle</summary><div className="toolbar-actions">
            {(['approve', 'activate', 'deactivate', 'delete'] as const).map((action) => <button type="button" className="btn-secondary" key={action} onClick={() => void runWorkflowAction(action)} disabled={!selectedFormId || isViewPopup || !isComplianceAdmin || !lifecycleEnabled[action]}>{action[0].toUpperCase() + action.slice(1)}</button>)}
          </div></details>
        </>}
          </div>
        </div>
      </section>}
    </div>
  )
}

/** New edition dates are entered as MM/YYYY (month 01-12), matching the server's parser. */
const EDITION_DATE_PATTERN = /^(0[1-9]|1[0-2])\/\d{4}$/

function labelForSection(key: SectionKey): string {
  if (key === 'catalog') return 'Details & scope'
  if (key === 'jurisdictions') return 'Jurisdictions'
  if (key === 'applicability') return 'Attachment'
  if (key === 'output') return 'Template'
  if (key === 'security') return 'Security'
  if (key === 'audit') return 'Audit'
  return 'Test & publish'
}

function mergeCatalogOptions(options: Array<{ code: string; label: string }>, saved: string[]) {
  const merged = new Map(options.map((option) => [option.code, option]))
  for (const code of saved) if (code && !merged.has(code)) merged.set(code, { code, label: `${code} (saved scope)` })
  return [...merged.values()]
}

function groupTemplateVariables(variables: TemplateVariable[]): Array<{ group: string; items: TemplateVariable[] }> {
  const order: string[] = []
  const byGroup = new Map<string, TemplateVariable[]>()
  for (const variable of variables) {
    const groupName = variable.group || 'Other'
    if (!byGroup.has(groupName)) {
      byGroup.set(groupName, [])
      order.push(groupName)
    }
    byGroup.get(groupName)!.push(variable)
  }
  return order.map((groupName) => ({ group: groupName, items: byGroup.get(groupName) || [] }))
}

const TEMPLATE_BAD_TOKEN_KEYS = [
  'badTokens',
  'unrecognizedTokens',
  'unrecognizedPlaceholders',
  'unknownTokens',
  'invalidTokens',
  'invalidPlaceholders',
  'unsupportedTokens'
]

function parseTemplateValidationError(e: any): { message: string; badTokens: string[] } {
  const raw = String(e?.message || e || 'Template upload failed.')
  let message = raw
  let badTokens: string[] = []

  const jsonStart = raw.indexOf('{')
  const jsonEnd = raw.lastIndexOf('}')
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const jsonText = raw.slice(jsonStart, jsonEnd + 1)
    try {
      const parsed = JSON.parse(jsonText)
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          message = parsed.message
        }
        for (const key of TEMPLATE_BAD_TOKEN_KEYS) {
          const value = (parsed as any)[key]
          if (Array.isArray(value) && value.length > 0) {
            badTokens = value.map((item: any) => String(item))
            break
          }
        }
        if (badTokens.length === 0 && Array.isArray((parsed as any).tokens) && (parsed as any).tokens.every((item: any) => typeof item === 'string')) {
          badTokens = (parsed as any).tokens.map((item: any) => String(item))
        }
      }
    } catch {
      // Response body wasn't JSON (or wasn't fully captured in the error text) - fall back to the raw message.
    }
  }

  return { message, badTokens }
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
