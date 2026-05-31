import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Admin - Users
// ---------------------------------------------------------------------------

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users.list(),
    queryFn: () => adminApi.listUsers(),
  })
}

export function useCreateUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { username: string; password: string; roles: string[]; customerRef?: string }) =>
      adminApi.createUser(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() })
    },
  })
}

export function useUpdateUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => adminApi.updateUser(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() })
    },
  })
}

export function useDeleteUserMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin - Security
// ---------------------------------------------------------------------------

export function useSecurityPermissions() {
  return useQuery({
    queryKey: queryKeys.security.permissions(),
    queryFn: () => adminApi.listSecurityPermissions(),
  })
}

export function useSecurityRoles() {
  return useQuery({
    queryKey: queryKeys.security.roles(),
    queryFn: () => adminApi.listSecurityRoles(),
  })
}

export function useSecurityRelationships() {
  return useQuery({
    queryKey: queryKeys.security.relationships(),
    queryFn: () => adminApi.listSecurityRelationships(),
  })
}

export function useCreateSecurityRoleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { roleCode: string; roleName: string; description?: string; active?: boolean; permissionCodes?: string[] }) =>
      adminApi.createSecurityRole(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.security.roles() })
    },
  })
}

export function useUpdateSecurityRoleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ roleCode, payload }: { roleCode: string; payload: any }) =>
      adminApi.updateSecurityRole(roleCode, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.security.roles() })
    },
  })
}

export function useDeleteSecurityRoleMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (roleCode: string) => adminApi.deleteSecurityRole(roleCode),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.security.roles() })
    },
  })
}

export function useUpdateSecurityUserRolesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, roleCodes }: { userId: string; roleCodes: string[] }) =>
      adminApi.updateSecurityUserRoles(userId, roleCodes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.users.all() })
      void qc.invalidateQueries({ queryKey: queryKeys.security.roles() })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin - Tenant
// ---------------------------------------------------------------------------

export function useTenant() {
  return useQuery({
    queryKey: queryKeys.adminTenant.detail(),
    queryFn: () => adminApi.getTenant(),
  })
}

export function useUpdateTenantMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.updateTenant(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.adminTenant.detail() })
    },
  })
}

export function useSeedMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => adminApi.seed(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.all() })
      void qc.invalidateQueries({ queryKey: queryKeys.quotes.all() })
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin - UW Companies
// ---------------------------------------------------------------------------

export function useAdminUnderwritingCompanies(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.adminUwCompanies.list(opts),
    queryFn: () => adminApi.listUnderwritingCompanies(opts),
  })
}

export function useCreateUnderwritingCompanyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { name: string; productCode: string; country: string; state: string; active?: boolean }) =>
      adminApi.createUnderwritingCompany(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-uw-companies'] })
    },
  })
}

export function useUpdateUnderwritingCompanyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateUnderwritingCompany(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-uw-companies'] })
    },
  })
}

export function useDeleteUnderwritingCompanyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteUnderwritingCompany(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-uw-companies'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin - Customers
// ---------------------------------------------------------------------------

export function useCustomerSettings() {
  return useQuery({
    queryKey: ['customers', 'settings'],
    queryFn: () => adminApi.getCustomerSettings(),
  })
}

export function useCustomers(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.customers.search(opts),
    queryFn: () => adminApi.searchCustomers(opts),
    enabled: Object.keys(opts).length > 0,
  })
}

export function useCustomer(idOrKey: string) {
  return useQuery({
    queryKey: queryKeys.customers.detail(idOrKey),
    queryFn: () => adminApi.getCustomer(idOrKey),
    enabled: !!idOrKey,
  })
}

export function useCustomerPolicies(idOrKey: string, limit = 100) {
  return useQuery({
    queryKey: queryKeys.customers.policies(idOrKey),
    queryFn: () => adminApi.getCustomerPolicies(idOrKey, limit),
    enabled: !!idOrKey,
  })
}

export function useCustomerQuotes(idOrKey: string, limit = 100) {
  return useQuery({
    queryKey: queryKeys.customers.quotes(idOrKey),
    queryFn: () => adminApi.getCustomerQuotes(idOrKey, limit),
    enabled: !!idOrKey,
  })
}

export function useCustomerAiInsights(idOrKey: string) {
  return useQuery({
    queryKey: ['customers', idOrKey, 'ai-insights'],
    queryFn: () => adminApi.getCustomerAiInsights(idOrKey),
    enabled: !!idOrKey,
  })
}

export function useUpdateCustomerSettingsMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.updateCustomerSettings(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['customers', 'settings'] })
    },
  })
}

export function useCreateCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.createCustomer(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useUpdateCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload: any }) =>
      adminApi.updateCustomer(idOrKey, payload),
    onSuccess: (_data, { idOrKey }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.detail(idOrKey) })
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useValidateCustomerMutation() {
  return useMutation({
    mutationFn: (payload: any) => adminApi.validateCustomer(payload),
  })
}

export function useSubmitCustomerForApprovalMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload?: any }) =>
      adminApi.submitCustomerForApproval(idOrKey, payload),
    onSuccess: (_data, { idOrKey }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.detail(idOrKey) })
    },
  })
}

export function useApproveCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload?: any }) =>
      adminApi.approveCustomer(idOrKey, payload),
    onSuccess: (_data, { idOrKey }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.detail(idOrKey) })
    },
  })
}

export function useDeactivateCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload: { reason: string; effectiveDate?: string } }) =>
      adminApi.deactivateCustomer(idOrKey, payload),
    onSuccess: (_data, { idOrKey }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.detail(idOrKey) })
    },
  })
}

export function useReactivateCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload?: any }) =>
      adminApi.reactivateCustomer(idOrKey, payload),
    onSuccess: (_data, { idOrKey }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.detail(idOrKey) })
    },
  })
}

export function useMergeCustomersMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { sourceCustomerId: string; targetCustomerId: string; reason?: string; resolution?: Record<string, any> }) =>
      adminApi.mergeCustomers(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useDeleteCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload?: any }) =>
      adminApi.deleteCustomer(idOrKey, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useExportCustomerMutation() {
  return useMutation({
    mutationFn: (idOrKey: string) => adminApi.exportCustomer(idOrKey),
  })
}

export function useImportCustomerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { payload: any; mode?: string; reason?: string }) => adminApi.importCustomer(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useSeedCustomerSamplesMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => adminApi.seedCustomerSamples(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
    },
  })
}

export function useRevealCustomerFieldMutation() {
  return useMutation({
    mutationFn: ({ idOrKey, payload }: { idOrKey: string; payload: { field: 'ssn' | 'fein' | 'dob'; reason: string } }) =>
      adminApi.revealCustomerField(idOrKey, payload),
  })
}

export function useAssignPolicyCustomerLinkMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { policyId: string; customerId?: string; customerKey?: string; relationshipType?: any; roleCode?: any; isPrimary?: boolean; source?: string }) =>
      adminApi.assignPolicyCustomerLink(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customers.all() })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.all() })
    },
  })
}

// ---------------------------------------------------------------------------
// Admin - Agency onboarding
// ---------------------------------------------------------------------------

export function useOnboardingAgencies(opts: Record<string, any> = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.onboarding.agencies(opts),
    queryFn: () => adminApi.searchOnboardingAgencies(opts),
    enabled,
  })
}

export function useOnboardingSettings() {
  return useQuery({
    queryKey: queryKeys.onboarding.settings(),
    queryFn: () => adminApi.getOnboardingSettings(),
  })
}

export function useCreateOnboardingAgencyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.createOnboardingAgency(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.onboarding.agencies({}) })
    },
  })
}

export function useUpdateOnboardingAgencyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ agencyId, payload }: { agencyId: string; payload: any }) =>
      adminApi.updateOnboardingAgency(agencyId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.onboarding.agencies({}) })
    },
  })
}

export function useCreateOnboardingAgencyContactMutation() {
  return useMutation({
    mutationFn: ({ agencyId, payload }: { agencyId: string; payload: any }) =>
      adminApi.createOnboardingAgencyContact(agencyId, payload),
  })
}

export function useUpdateOnboardingAgencyContactMutation() {
  return useMutation({
    mutationFn: ({ agencyId, contactId, payload }: { agencyId: string; contactId: string; payload: any }) =>
      adminApi.updateOnboardingAgencyContact(agencyId, contactId, payload),
  })
}

export function useDeleteOnboardingAgencyContactMutation() {
  return useMutation({
    mutationFn: ({ agencyId, contactId }: { agencyId: string; contactId: string }) =>
      adminApi.deleteOnboardingAgencyContact(agencyId, contactId),
  })
}

// ---------------------------------------------------------------------------
// Admin - Forms management
// ---------------------------------------------------------------------------

export function useForms(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.forms.list(opts),
    queryFn: () => adminApi.listForms(opts),
  })
}

export function useForm(id: string) {
  return useQuery({
    queryKey: queryKeys.forms.detail(id),
    queryFn: () => adminApi.getForm(id),
    enabled: !!id,
  })
}

export function useFormTemplates() {
  return useQuery({
    queryKey: queryKeys.forms.templates(),
    queryFn: () => adminApi.listFormTemplates(),
  })
}

export function useCreateFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.createForm(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all() })
    },
  })
}

export function useUpdateFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateForm(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all() })
    },
  })
}

export function useCloneFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.cloneForm(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all() })
    },
  })
}

export function useSubmitFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.submitForm(id, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useApproveFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.approveForm(id, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useActivateFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.activateForm(id, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeactivateFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminApi.deactivateForm(id, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeleteFormMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.deleteForm(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.all() })
    },
  })
}

export function useAddFormJurisdictionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.addFormJurisdiction(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormJurisdictionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, jurisdictionId, payload }: { id: string; jurisdictionId: string; payload: any }) =>
      adminApi.updateFormJurisdiction(id, jurisdictionId, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeleteFormJurisdictionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, jurisdictionId }: { id: string; jurisdictionId: string }) =>
      adminApi.deleteFormJurisdiction(id, jurisdictionId),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useAddFormApplicabilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.addFormApplicability(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormApplicabilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, applicabilityId, payload }: { id: string; applicabilityId: string; payload: any }) =>
      adminApi.updateFormApplicability(id, applicabilityId, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeleteFormApplicabilityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, applicabilityId }: { id: string; applicabilityId: string }) =>
      adminApi.deleteFormApplicability(id, applicabilityId),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useAddFormTriggerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.addFormTrigger(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormTriggerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, triggerId, payload }: { id: string; triggerId: string; payload: any }) =>
      adminApi.updateFormTrigger(id, triggerId, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeleteFormTriggerMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, triggerId }: { id: string; triggerId: string }) =>
      adminApi.deleteFormTrigger(id, triggerId),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormOutputMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateFormOutput(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormDeliveryMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateFormDelivery(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUpdateFormSecurityMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateFormSecurity(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useUploadFormTemplateAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file, reason }: { id: string; file: File; reason?: string }) =>
      adminApi.uploadFormTemplateAsset(id, file, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function useDeleteFormTemplateAssetMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      adminApi.deleteFormTemplateAsset(id, reason),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.detail(id) })
    },
  })
}

export function usePreviewAdminFormsMutation() {
  return useMutation({
    mutationFn: (payload: any) => adminApi.previewAdminForms(payload),
  })
}

export function useTestFormExpressionMutation() {
  return useMutation({
    mutationFn: (payload: { expression: string; scenario?: any }) => adminApi.testFormExpression(payload),
  })
}

export function useCreateFormTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => adminApi.createFormTemplate(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.templates() })
    },
  })
}

export function useUpdateFormTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => adminApi.updateFormTemplate(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.templates() })
    },
  })
}

export function useDeleteFormTemplateMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => adminApi.deleteFormTemplate(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.forms.templates() })
    },
  })
}
