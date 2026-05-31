import { useQuery } from '@tanstack/react-query'
import { api } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Customer portal
// ---------------------------------------------------------------------------

export function useCustomerPortalSummary() {
  return useQuery({
    queryKey: queryKeys.portal.summary(),
    queryFn: () => api.getCustomerPortalSummary(),
  })
}

export function useCustomerPortalPolicy(policyId: string) {
  return useQuery({
    queryKey: queryKeys.portal.policy(policyId),
    queryFn: () => api.getCustomerPortalPolicy(policyId),
    enabled: !!policyId,
  })
}
