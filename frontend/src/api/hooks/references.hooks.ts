import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

export function useReferenceAgencies(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.reference.agencies(opts),
    queryFn: () => api.listReferenceAgencies(opts),
  })
}

export function useAgencyContacts(agencyId: string) {
  return useQuery({
    queryKey: queryKeys.reference.agencyContacts(agencyId),
    queryFn: () => api.listAgencyContacts(agencyId),
    enabled: !!agencyId,
  })
}

export function useUnderwriters() {
  return useQuery({
    queryKey: queryKeys.reference.underwriters(),
    queryFn: () => api.listUnderwriters(),
  })
}

export function useReferenceInsuranceCarriers(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.reference.carriers(opts),
    queryFn: () => api.listReferenceInsuranceCarriers(opts),
  })
}

export function useUnderwritingCompanies(opts: Record<string, any> = {}) {
  return useQuery({
    queryKey: queryKeys.reference.uwCompanies(opts),
    queryFn: () => api.listUnderwritingCompanies(opts),
  })
}

// ---------------------------------------------------------------------------
// Tenant preferences
// ---------------------------------------------------------------------------

export function useTenantPreferences(enabled = true) {
  return useQuery({
    queryKey: queryKeys.tenant.prefs(),
    queryFn: () => api.getTenantPreferences(),
    enabled,
  })
}

// ---------------------------------------------------------------------------
// AI settings & insights
// ---------------------------------------------------------------------------

export function useAiSettings() {
  return useQuery({
    queryKey: queryKeys.ai.settings(),
    queryFn: () => api.getAiSettings(),
  })
}

export function useDashboardAiInsights() {
  return useQuery({
    queryKey: queryKeys.ai.dashboardInsights(),
    queryFn: () => api.getDashboardAiInsights(),
  })
}

// ---------------------------------------------------------------------------
// Product config & forms
// ---------------------------------------------------------------------------

export function useProductConfig(code: string) {
  return useQuery({
    queryKey: ['products', code, 'config'],
    queryFn: () => api.getProductConfig(code),
    enabled: !!code,
  })
}

export function useProductForm(code: string) {
  return useQuery({
    queryKey: ['products', code, 'form'],
    queryFn: () => api.getProductForm(code),
    enabled: !!code,
  })
}
