import { request, requestBlob, fileToBase64 } from './request'

export const adminApi = {
  listUsers: () => request<any[]>('GET', '/v1/admin/users'),
  createUser: (payload: { username: string; password: string; roles: string[]; customerRef?: string }) => request<any>('POST', '/v1/admin/users', payload),
  updateUser: (id: string, patch: any) => request<any>('PATCH', `/v1/admin/users/${id}`, patch),
  deleteUser: (id: string) => request<any>('DELETE', `/v1/admin/users/${id}`),
  // Compliance administration
  listEligibility: (opts?: { productCode?: string; stateCode?: string; status?: string }) => {
    const params = new URLSearchParams()
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.stateCode) params.set('stateCode', opts.stateCode)
    if (opts?.status) params.set('status', opts.status)
    const qs = params.toString()
    return request<{ items: any[] }>('GET', `/v1/admin/compliance/eligibility${qs ? `?${qs}` : ''}`)
  },
  createEligibility: (payload: any) => request<any>('POST', '/v1/admin/compliance/eligibility', payload),
  updateEligibility: (id: string, patch: any) => request<any>('PATCH', `/v1/admin/compliance/eligibility/${id}`, patch),
  importOfacSdnList: (entries: any[]) => request<{ imported: number }>('POST', '/v1/admin/compliance/ofac/sdn-list/import', { entries }),
  listOfacScreens: (disposition?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/compliance/ofac/screens${disposition ? `?disposition=${disposition}` : ''}`),
  dispositionOfacScreen: (screenId: string, payload: { disposition: string; reason: string }) =>
    request<any>('PATCH', `/v1/admin/compliance/ofac/screens/${screenId}`, payload),
  // Reinsurance administration
  listTreaties: (status?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/reinsurance/treaties${status ? `?status=${status}` : ''}`),
  createTreaty: (payload: any) => request<any>('POST', '/v1/admin/reinsurance/treaties', payload),
  updateTreaty: (id: string, patch: any) => request<any>('PATCH', `/v1/admin/reinsurance/treaties/${id}`, patch),
  listFacultative: (policyId?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/reinsurance/facultative${policyId ? `?policyId=${policyId}` : ''}`),
  createFacultative: (payload: any) => request<any>('POST', '/v1/admin/reinsurance/facultative', payload),
  computePlacement: (policyId: string, transactionId: string) =>
    request<{ items: any[] }>('POST', `/v1/admin/reinsurance/policies/${policyId}/transactions/${transactionId}/compute`),
  listPolicyPlacements: (policyId: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/reinsurance/policies/${policyId}/placements`),
  // Bordereaux administration
  listBordereauxBatches: (bordereauType?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/bordereaux/batches${bordereauType ? `?bordereauType=${bordereauType}` : ''}`),
  getBordereauxBatch: (batchId: string) => request<any>('GET', `/v1/admin/bordereaux/batches/${batchId}`),
  generateBordereauxBatch: (payload: any) => request<any>('POST', '/v1/admin/bordereaux/batches', payload),
  listBordereauxRows: (batchId: string) => request<{ items: any[] }>('GET', `/v1/admin/bordereaux/batches/${batchId}/rows`),
  // Data import administration
  listImportBatches: () => request<any[]>('GET', '/v1/admin/import/batches'),
  getImportBatch: (batchId: string) => request<any>('GET', `/v1/admin/import/batches/${batchId}`),
  listImportRows: (batchId: string, status?: string) =>
    request<any[]>('GET', `/v1/admin/import/batches/${batchId}/rows${status ? `?status=${status}` : ''}`),
  stageImportBatch: (payload: { entityType: string; sourceSystem: string; rows: any[]; notes?: string }) =>
    request<any>('POST', '/v1/admin/import/batches', payload),
  validateImportBatch: (batchId: string) => request<any>('POST', `/v1/admin/import/batches/${batchId}/validate`, {}),
  commitImportBatch: (batchId: string) => request<any>('POST', `/v1/admin/import/batches/${batchId}/commit`, {}),
  retryImportRow: (batchId: string, rowId: string) =>
    request<any>('POST', `/v1/admin/import/batches/${batchId}/rows/${rowId}/retry`, {}),
  // Operations dashboard
  getDashboardSummary: () => request<any>('GET', '/v1/admin/dashboard/summary'),
  listDashboardOutbox: (status?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/dashboard/outbox${status ? `?status=${status}` : ''}`),
  listDashboardNotifications: (status?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/dashboard/notifications${status ? `?status=${status}` : ''}`),
  listPolicyIntegrityExceptions: (status?: string) =>
    request<{ items: any[] }>('GET', `/v1/admin/dashboard/policy-integrity${status ? `?status=${status}` : ''}`),
  updatePolicyIntegrityException: (id: string, status: 'Acknowledged' | 'Resolved', note?: string) =>
    request<any>('PATCH', `/v1/admin/dashboard/policy-integrity/${id}`, { status, note }),
  retryPolicyIntegrityException: (id: string) =>
    request<any>('POST', `/v1/admin/dashboard/policy-integrity/${id}/retry`, {}),
  exportPolicyIntegrityExceptions: () => requestBlob('/v1/admin/dashboard/policy-integrity?format=csv'),
  // Job queue administration
  listJobDefinitions: () => request<{ items: any[] }>('GET', '/v1/admin/jobs/definitions'),
  listJobRuns: (opts?: { jobCode?: string; status?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.jobCode) params.set('jobCode', opts.jobCode)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.limit) params.set('limit', String(opts.limit))
    const qs = params.toString()
    return request<{ items: any[] }>('GET', `/v1/admin/jobs/runs${qs ? `?${qs}` : ''}`)
  },
  getJobRun: (runId: string) => request<{ run: any; events: any[] }>('GET', `/v1/admin/jobs/runs/${runId}`),
  retryJobRun: (runId: string) => request<{ run: any }>('POST', `/v1/admin/jobs/runs/${runId}/retry`, {}),
  // Exposure management
  getExposureSummary: (opts?: { productCode?: string; state?: string; asOf?: string }) => {
    const params = new URLSearchParams()
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.state) params.set('state', opts.state)
    if (opts?.asOf) params.set('asOf', opts.asOf)
    const qs = params.toString()
    return request<any>('GET', `/v1/admin/exposure/summary${qs ? `?${qs}` : ''}`)
  },
  listSecurityPermissions: () => request<any[]>('GET', '/v1/admin/security/permissions'),
  listSecurityRoles: () => request<any[]>('GET', '/v1/admin/security/roles'),
  listSecurityRelationships: () => request<any>('GET', '/v1/admin/security/relationships'),
  createSecurityRole: (payload: {
    roleCode: string
    roleName: string
    description?: string
    active?: boolean
    permissionCodes?: string[]
  }) => request<any>('POST', '/v1/admin/security/roles', payload),
  updateSecurityRole: (roleCode: string, payload: {
    roleName?: string
    description?: string
    active?: boolean
    permissionCodes?: string[]
  }) => request<any>('PATCH', `/v1/admin/security/roles/${encodeURIComponent(roleCode)}`, payload),
  deleteSecurityRole: (roleCode: string) => request<any>('DELETE', `/v1/admin/security/roles/${encodeURIComponent(roleCode)}`),
  updateSecurityUserRoles: (userId: string, roleCodes: string[]) =>
    request<any>('PATCH', `/v1/admin/security/users/${encodeURIComponent(userId)}/roles`, { roleCodes }),
  // Customer administration
  getCustomerSettings: () => request<any>('GET', '/v1/admin/customers/settings'),
  updateCustomerSettings: (payload: {
    keyPattern?: string
    validation?: Record<string, any>
    workflow?: Record<string, any>
  }) => request<any>('PATCH', '/v1/admin/customers/settings', payload),
  searchCustomers: (opts?: {
    q?: string
    customerKey?: string
    name?: string
    phone?: string
    email?: string
    taxId?: string
    externalId?: string
    address?: string
    status?: string
    entityType?: string
    limit?: number
  }) => {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.customerKey) params.set('customerKey', opts.customerKey)
    if (opts?.name) params.set('name', opts.name)
    if (opts?.phone) params.set('phone', opts.phone)
    if (opts?.email) params.set('email', opts.email)
    if (opts?.taxId) params.set('taxId', opts.taxId)
    if (opts?.externalId) params.set('externalId', opts.externalId)
    if (opts?.address) params.set('address', opts.address)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.entityType) params.set('entityType', opts.entityType)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/customers/search${query ? `?${query}` : ''}`)
  },
  validateCustomer: (payload: any) => request<any>('POST', '/v1/admin/customers/validate', payload),
  seedCustomerSamples: () => request<any>('POST', '/v1/admin/customers/seed-samples', {}),
  createCustomer: (payload: any) => request<any>('POST', '/v1/admin/customers', payload),
  getCustomer: (idOrKey: string) => request<any>('GET', `/v1/admin/customers/${encodeURIComponent(idOrKey)}`),
  getCustomerPolicies: (idOrKey: string, limit = 100) =>
    request<any[]>(
      'GET',
      `/v1/admin/customers/${encodeURIComponent(idOrKey)}/policies?limit=${Math.max(1, Math.min(500, Number(limit) || 100))}`
    ),
  getCustomerQuotes: (idOrKey: string, limit = 100) =>
    request<any[]>(
      'GET',
      `/v1/admin/customers/${encodeURIComponent(idOrKey)}/quotes?limit=${Math.max(1, Math.min(500, Number(limit) || 100))}`
    ),
  getCustomerAiInsights: (idOrKey: string) =>
    request<any>('GET', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/ai-insights`),
  listUnlinkedPolicyCustomerLinks: (opts?: {
    q?: string
    productCode?: string
    status?: string
    limit?: number
  }) => {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    return request<any[]>(
      'GET',
      `/v1/admin/customers/policy-links/unlinked${query ? `?${query}` : ''}`
    )
  },
  assignPolicyCustomerLink: (payload: {
    policyId: string
    customerId?: string
    customerKey?: string
    relationshipType?: 'PRIMARY_NAMED_INSURED' | 'SECONDARY_NAMED_INSURED' | 'ADDITIONAL_NAMED_INSURED'
    roleCode?: 'PRIMARY_NAMED_INSURED' | 'SECONDARY_NAMED_INSURED' | 'ADDITIONAL_NAMED_INSURED'
    isPrimary?: boolean
    source?: string
  }) => request<any>('POST', '/v1/admin/customers/policy-links/assign', payload),
  updateCustomer: (idOrKey: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/customers/${encodeURIComponent(idOrKey)}`, payload),
  submitCustomerForApproval: (idOrKey: string, payload?: { reason?: string }) =>
    request<any>('POST', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/submit-approval`, payload || {}),
  approveCustomer: (idOrKey: string, payload?: { reason?: string }) =>
    request<any>('POST', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/approve`, payload || {}),
  deactivateCustomer: (idOrKey: string, payload: { reason: string; effectiveDate?: string }) =>
    request<any>('POST', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/deactivate`, payload),
  reactivateCustomer: (idOrKey: string, payload?: { reason?: string }) =>
    request<any>('POST', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/reactivate`, payload || {}),
  mergeCustomers: (payload: {
    sourceCustomerId: string
    targetCustomerId: string
    reason?: string
    resolution?: Record<string, any>
  }) => request<any>('POST', '/v1/admin/customers/merge', payload),
  deleteCustomer: (idOrKey: string, payload?: { reason?: string }) =>
    request<any>('DELETE', `/v1/admin/customers/${encodeURIComponent(idOrKey)}`, payload || {}),
  exportCustomer: (idOrKey: string) =>
    request<any>('GET', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/export`),
  importCustomer: (payload: { payload: any; mode?: string; reason?: string }) =>
    request<any>('POST', '/v1/admin/customers/import', payload),
  getCustomerAudit: (idOrKey: string, limit = 100) =>
    request<any[]>('GET', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/audit?limit=${limit}`),
  revealCustomerField: (idOrKey: string, payload: { field: 'ssn' | 'fein' | 'dob'; reason: string }) =>
    request<any>('POST', `/v1/admin/customers/${encodeURIComponent(idOrKey)}/reveal`, payload),
  // Agency and broker onboarding
  getOnboardingSettings: () => request<any>('GET', '/v1/admin/onboarding/settings'),
  updateOnboardingSettings: (payload: any) => request<any>('PATCH', '/v1/admin/onboarding/settings', payload),
  getOnboardingTemplate: async (format: 'csv' | 'xlsx' | 'json' = 'csv') => {
    if (format === 'json') return request<any>('GET', '/v1/admin/onboarding/template?format=json')
    return requestBlob(`/v1/admin/onboarding/template?format=${encodeURIComponent(format)}`)
  },
  searchOnboardingAgencies: (opts?: { q?: string; status?: string; limit?: number; parentAgencyId?: string }) => {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    if (opts?.parentAgencyId) params.set('parentAgencyId', opts.parentAgencyId)
    const query = params.toString()
    return request<any[]>(`GET`, `/v1/admin/onboarding/agencies/search${query ? `?${query}` : ''}`)
  },
  getOnboardingAgency: (agencyId: string) =>
    request<any>(`GET`, `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}`),
  createOnboardingAgency: (payload: any) =>
    request<any>('POST', '/v1/admin/onboarding/agencies', payload),
  updateOnboardingAgency: (agencyId: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}`, payload),
  listOnboardingAgencyContacts: (agencyId: string) =>
    request<any[]>(`GET`, `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}/contacts`),
  createOnboardingAgencyContact: (agencyId: string, payload: any) =>
    request<any>('POST', `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}/contacts`, payload),
  updateOnboardingAgencyContact: (agencyId: string, contactId: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}/contacts/${encodeURIComponent(contactId)}`, payload),
  deleteOnboardingAgencyContact: (agencyId: string, contactId: string) =>
    request<any>('DELETE', `/v1/admin/onboarding/agencies/${encodeURIComponent(agencyId)}/contacts/${encodeURIComponent(contactId)}`),
  createOnboardingJob: (payload: {
    mode: 'UPLOAD' | 'SERVICE_HIT' | 'MANUAL'
    sourceSystem?: string
    sourceType?: string
    sourceName?: string
    idempotencyStrategy?: 'EXTERNAL_ID_WINS' | 'KEY_WINS' | 'ALWAYS_CREATE'
    conflictBehavior?: 'SKIP' | 'OVERWRITE_ALLOWED' | 'REQUIRE_APPROVAL'
    requestPayload?: Record<string, any>
  }) => request<any>('POST', '/v1/admin/onboarding/jobs', payload),
  uploadOnboardingJob: async (jobId: string, file: File) => {
    const dataBase64 = await fileToBase64(file)
    return request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/upload`, {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      dataBase64
    })
  },
  runOnboardingService: (jobId: string, payload: { serviceName: string; inputs?: Record<string, any> }) =>
    request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/service-run`, payload),
  normalizeOnboardingJob: (jobId: string, payload?: { fieldMap?: Record<string, string> }) =>
    request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/normalize`, payload || {}),
  validateOnboardingJob: (jobId: string) =>
    request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/validate`, {}),
  commitOnboardingJob: (jobId: string) =>
    request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/commit`, {}),
  retryOnboardingFailedRows: (jobId: string) =>
    request<any>('POST', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/retry-failed`, {}),
  getOnboardingJob: (jobId: string) =>
    request<any>('GET', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}`),
  updateOnboardingJobRow: (jobId: string, rowId: string, payload: { canonicalPayload?: Record<string, any>; actionType?: 'CREATE' | 'UPDATE' | 'SKIP' }) =>
    request<any>('PATCH', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/rows/${encodeURIComponent(rowId)}`, payload),
  getOnboardingJobResults: (jobId: string) =>
    request<any>('GET', `/v1/admin/onboarding/jobs/${encodeURIComponent(jobId)}/results`),
  listOnboardingHistory: (opts?: { status?: string; mode?: string; fromDate?: string; toDate?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.status) params.set('status', opts.status)
    if (opts?.mode) params.set('mode', opts.mode)
    if (opts?.fromDate) params.set('fromDate', opts.fromDate)
    if (opts?.toDate) params.set('toDate', opts.toDate)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/onboarding/history${query ? `?${query}` : ''}`)
  },
  listOnboardingAudit: (opts?: { entityType?: string; entityId?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (opts?.entityType) params.set('entityType', opts.entityType)
    if (opts?.entityId) params.set('entityId', opts.entityId)
    if (opts?.limit != null) params.set('limit', String(opts.limit))
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/onboarding/audit${query ? `?${query}` : ''}`)
  },
  getTenant: () => request<any>('GET', '/v1/admin/tenant'),
  updateTenant: (payload: {
    name?: string
    defaultCountry?: string
    dateFormatsByCountry?: Record<string, string>
    policyNumberFormatsByProduct?: Record<string, string>
    mfaRequired?: boolean
    aiMlConfig?: Record<string, any>
  }) =>
    request<any>('PATCH', '/v1/admin/tenant', payload),
  seed: () => request<any>('POST', '/v1/admin/seed'),
  seedReferenceData: () => request<any>('POST', '/v1/admin/seed-reference-data'),
  listUnderwritingCompanies: (opts?: { productCode?: string; country?: string; state?: string; includeInactive?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.country) params.set('country', opts.country)
    if (opts?.state) params.set('state', opts.state)
    if (opts?.includeInactive) params.set('includeInactive', 'true')
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/underwriting-companies${query ? `?${query}` : ''}`)
  },
  createUnderwritingCompany: (payload: { name: string; productCode: string; country: string; state: string; active?: boolean }) =>
    request<any>('POST', '/v1/admin/underwriting-companies', payload),
  updateUnderwritingCompany: (id: string, payload: Partial<{ name: string; productCode: string; country: string; state: string; active: boolean }>) =>
    request<any>('PATCH', `/v1/admin/underwriting-companies/${id}`, payload),
  deleteUnderwritingCompany: (id: string) => request<any>('DELETE', `/v1/admin/underwriting-companies/${id}`),
  // Notification templates
  listNotificationTemplates: (opts?: { eventType?: string; channel?: string; productCode?: string; transactionType?: string; active?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.eventType) params.set('eventType', opts.eventType)
    if (opts?.channel) params.set('channel', opts.channel)
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.transactionType) params.set('transactionType', opts.transactionType)
    if (opts?.active != null) params.set('active', String(opts.active))
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/notification-templates${query ? `?${query}` : ''}`)
  },
  getNotificationTemplate: (id: string) => request<any>('GET', `/v1/admin/notification-templates/${id}`),
  createNotificationTemplate: (payload: {
    templateCode: string
    eventType: string
    channel?: string
    productCode?: string | null
    transactionType?: string | null
    locale?: string
    subjectTemplate: string
    bodyTemplate: string
    visibility?: string[]
    effectiveDate?: string | null
    expirationDate?: string | null
    active?: boolean
    metadata?: Record<string, unknown>
  }) => request<any>('POST', '/v1/admin/notification-templates', payload),
  updateNotificationTemplate: (id: string, payload: Partial<{
    templateCode: string
    eventType: string
    channel: string
    productCode: string | null
    transactionType: string | null
    locale: string
    subjectTemplate: string
    bodyTemplate: string
    visibility: string[]
    effectiveDate: string | null
    expirationDate: string | null
    metadata: Record<string, unknown>
  }>) => request<any>('PATCH', `/v1/admin/notification-templates/${id}`, payload),
  cloneNotificationTemplate: (id: string) =>
    request<any>('POST', `/v1/admin/notification-templates/${encodeURIComponent(id)}/clone`),
  activateNotificationTemplate: (id: string) => request<any>('POST', `/v1/admin/notification-templates/${id}/activate`),
  deactivateNotificationTemplate: (id: string) => request<any>('POST', `/v1/admin/notification-templates/${id}/deactivate`),
  previewNotificationTemplate: (payload: { subjectTemplate: string; bodyTemplate: string; sampleFields?: Record<string, unknown> }) =>
    request<{ subject: string; body: string }>('POST', '/v1/admin/notification-templates/preview', payload),
  // Forms administration
  listForms: (opts?: {
    q?: string
    status?: string
    active?: boolean
    authority?: string
    lineOfBusiness?: string
    carrierCode?: string
  }) => {
    const params = new URLSearchParams()
    if (opts?.q) params.set('q', opts.q)
    if (opts?.status) params.set('status', opts.status)
    if (opts?.active != null) params.set('active', String(opts.active))
    if (opts?.authority) params.set('authority', opts.authority)
    if (opts?.lineOfBusiness) params.set('lineOfBusiness', opts.lineOfBusiness)
    if (opts?.carrierCode) params.set('carrierCode', opts.carrierCode)
    const query = params.toString()
    return request<any[]>('GET', `/v1/admin/forms${query ? `?${query}` : ''}`)
  },
  createForm: (payload: any) => request<any>('POST', '/v1/admin/forms', payload),
  getForm: (id: string) => request<any>('GET', `/v1/admin/forms/${id}`),
  updateForm: (id: string, payload: any) => request<any>('PATCH', `/v1/admin/forms/${id}`, payload),
  cloneForm: (id: string, payload: any) => request<any>('POST', `/v1/admin/forms/${id}/clone`, payload),
  submitForm: (id: string, reason?: string) => request<any>('POST', `/v1/admin/forms/${id}/submit`, { reason }),
  approveForm: (id: string, reason: string) => request<any>('POST', `/v1/admin/forms/${id}/approve`, { reason }),
  activateForm: (id: string, reason: string) => request<any>('POST', `/v1/admin/forms/${id}/activate`, { reason }),
  deactivateForm: (id: string, reason: string) => request<any>('POST', `/v1/admin/forms/${id}/deactivate`, { reason }),
  deleteForm: (id: string, reason?: string) => request<any>('DELETE', `/v1/admin/forms/${id}`, { reason }),
  listFormJurisdictions: (id: string) => request<any[]>('GET', `/v1/admin/forms/${id}/jurisdictions`),
  addFormJurisdiction: (id: string, payload: any) => request<any>('POST', `/v1/admin/forms/${id}/jurisdictions`, payload),
  updateFormJurisdiction: (id: string, jurisdictionId: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/forms/${id}/jurisdictions/${jurisdictionId}`, payload),
  deleteFormJurisdiction: (id: string, jurisdictionId: string) =>
    request<any>('DELETE', `/v1/admin/forms/${id}/jurisdictions/${jurisdictionId}`),
  listFormApplicability: (id: string) => request<any[]>('GET', `/v1/admin/forms/${id}/applicability`),
  addFormApplicability: (id: string, payload: any) => request<any>('POST', `/v1/admin/forms/${id}/applicability`, payload),
  updateFormApplicability: (id: string, applicabilityId: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/forms/${id}/applicability/${applicabilityId}`, payload),
  deleteFormApplicability: (id: string, applicabilityId: string) =>
    request<any>('DELETE', `/v1/admin/forms/${id}/applicability/${applicabilityId}`),
  listFormTriggers: (id: string) => request<any[]>('GET', `/v1/admin/forms/${id}/triggers`),
  addFormTrigger: (id: string, payload: any) => request<any>('POST', `/v1/admin/forms/${id}/triggers`, payload),
  updateFormTrigger: (id: string, triggerId: string, payload: any) =>
    request<any>('PATCH', `/v1/admin/forms/${id}/triggers/${triggerId}`, payload),
  deleteFormTrigger: (id: string, triggerId: string) =>
    request<any>('DELETE', `/v1/admin/forms/${id}/triggers/${triggerId}`),
  getFormOutput: (id: string) => request<any>('GET', `/v1/admin/forms/${id}/output`),
  getAdminFormDocument: (id: string) => requestBlob(`/v1/admin/forms/${id}/document`),
  getFormTemplateAsset: (id: string) => request<any>('GET', `/v1/admin/forms/${id}/output/template`),
  uploadFormTemplateAsset: async (id: string, file: File, reason?: string) => {
    const dataBase64 = await fileToBase64(file)
    return request<any>('POST', `/v1/admin/forms/${id}/output/template`, {
      fileName: file.name,
      mimeType: file.type || 'application/pdf',
      dataBase64,
      reason
    })
  },
  deleteFormTemplateAsset: (id: string, reason?: string) =>
    request<any>('DELETE', `/v1/admin/forms/${id}/output/template`, { reason }),
  getFormTemplateVariables: () =>
    request<{ variables: Array<{ token: string; label: string; description: string; group: string }> }>(
      'GET',
      '/v1/admin/forms/template-variables'
    ),
  updateFormOutput: (id: string, payload: any) => request<any>('PUT', `/v1/admin/forms/${id}/output`, payload),
  getFormDelivery: (id: string) => request<any>('GET', `/v1/admin/forms/${id}/delivery`),
  updateFormDelivery: (id: string, payload: any) => request<any>('PUT', `/v1/admin/forms/${id}/delivery`, payload),
  getFormSecurity: (id: string) => request<any>('GET', `/v1/admin/forms/${id}/security`),
  updateFormSecurity: (id: string, payload: any) => request<any>('PUT', `/v1/admin/forms/${id}/security`, payload),
  getFormAudit: (id: string, limit = 100) => request<any[]>('GET', `/v1/admin/forms/${id}/audit?limit=${limit}`),
  previewAdminForms: (payload: any) => request<any[]>('POST', '/v1/admin/forms/preview', payload),
  testFormExpression: (payload: { expression: string; scenario?: any }) =>
    request<{ result: boolean; error?: string }>('POST', '/v1/admin/forms/test-expression', payload),
  // Form templates (managed in admin)
  listFormTemplates: () => request<any[]>('GET', '/v1/admin/form-templates'),
  createFormTemplate: (payload: any) => request<any>('POST', '/v1/admin/form-templates', payload),
  updateFormTemplate: (id: string, payload: any) => request<any>('PATCH', `/v1/admin/form-templates/${id}`, payload),
  deleteFormTemplate: (id: string) => request<any>('DELETE', `/v1/admin/form-templates/${id}`),
  // Underwriting rules (admin-authored rules engine)
  listUnderwritingRuleFields: (productCode: string) =>
    request<{ fields: UnderwritingRuleField[] }>(
      'GET',
      `/v1/admin/underwriting-rules/fields?productCode=${encodeURIComponent(productCode)}`
    ),
  listUnderwritingRules: (opts?: { productCode?: string; stateCode?: string; active?: boolean }) => {
    const params = new URLSearchParams()
    if (opts?.productCode) params.set('productCode', opts.productCode)
    if (opts?.stateCode) params.set('stateCode', opts.stateCode)
    if (opts?.active != null) params.set('active', String(opts.active))
    const qs = params.toString()
    return request<{ items: UnderwritingRule[] }>('GET', `/v1/admin/underwriting-rules${qs ? `?${qs}` : ''}`)
  },
  createUnderwritingRule: (payload: {
    productCode: string
    stateCode?: string | null
    fieldPath: string
    operator: UnderwritingRuleOperator
    comparisonValue: UnderwritingRuleComparisonValue
    outcome: UnderwritingRuleOutcome
    reasonCode: string
    reasonDescription: string
    active?: boolean
    effectiveDate: string
    expirationDate?: string | null
  }) => request<UnderwritingRule>('POST', '/v1/admin/underwriting-rules', payload),
  updateUnderwritingRule: (
    ruleId: string,
    patch: Partial<{
      stateCode: string | null
      fieldPath: string
      operator: UnderwritingRuleOperator
      comparisonValue: UnderwritingRuleComparisonValue
      outcome: UnderwritingRuleOutcome
      reasonCode: string
      reasonDescription: string
      active: boolean
      effectiveDate: string
      expirationDate: string | null
    }>
  ) => request<UnderwritingRule>('PATCH', `/v1/admin/underwriting-rules/${encodeURIComponent(ruleId)}`, patch),
  seedUnderwritingRules: () => request<any>('POST', '/v1/admin/seed-underwriting-rules', {})
}

export type UnderwritingRuleDataType = 'number' | 'string' | 'boolean'

export type UnderwritingRuleOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'greater_than_or_equal'
  | 'less_than'
  | 'less_than_or_equal'
  | 'is_true'
  | 'is_false'
  | 'in'
  | 'not_in'

export type UnderwritingRuleOutcome = 'Refer' | 'Decline'

export type UnderwritingRuleComparisonValue = string | number | boolean | Array<string | number>

export type UnderwritingRuleField = {
  fieldPath: string
  label: string
  description: string
  dataType: UnderwritingRuleDataType
  allowedOperators: UnderwritingRuleOperator[]
}

// The CRUD routes behind these calls (uw.routes.ts) use raw SQL, not an ORM
// model, and return the Postgres row verbatim -- so this response shape is
// snake_case, matching the `underwriting_rules` table's real columns. This
// mirrors the established convention for this same route file's sibling
// endpoint (GET /uw/authority-grants / AuthorityGrantRow in
// UnderwritingAuthorityPage.tsx), which also returns raw rows rather than a
// camelCase projection. Request bodies for create/update are a separate,
// intentionally camelCase shape (see createUnderwritingRule/
// updateUnderwritingRule above) -- that's what the route handlers parse.
export type UnderwritingRule = {
  rule_id: string
  product_code: string
  state_code: string | null
  field_path: string
  operator: UnderwritingRuleOperator
  comparison_value: UnderwritingRuleComparisonValue
  outcome: UnderwritingRuleOutcome
  reason_code: string
  reason_description: string
  active: boolean
  effective_date: string
  expiration_date: string | null
  created_at: string
  updated_at: string
}
