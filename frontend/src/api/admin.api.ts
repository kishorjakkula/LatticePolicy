import { request, requestBlob, fileToBase64 } from './request'

export const adminApi = {
  listUsers: () => request<any[]>('GET', '/v1/admin/users'),
  createUser: (payload: { username: string; password: string; roles: string[]; customerRef?: string }) => request<any>('POST', '/v1/admin/users', payload),
  updateUser: (id: string, patch: any) => request<any>('PATCH', `/v1/admin/users/${id}`, patch),
  deleteUser: (id: string) => request<any>('DELETE', `/v1/admin/users/${id}`),
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
  deleteFormTemplate: (id: string) => request<any>('DELETE', `/v1/admin/form-templates/${id}`)
}
