import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiDetails } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Policies — Query hooks
// ---------------------------------------------------------------------------

export function usePolicy(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.detail(id),
    queryFn: () => api.getPolicy(id),
    enabled: !!id,
  })
}

export function usePolicyVersions(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.versions(id),
    queryFn: () => api.getPolicyVersions(id),
    enabled: !!id,
  })
}

export function useFullPolicy(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.full(id),
    queryFn: () => api.getFullPolicy(id),
    enabled: !!id,
  })
}

export function usePolicyTimeline(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.timeline(id),
    queryFn: () => api.getPolicyTimeline(id),
    enabled: !!id,
  })
}

export function usePolicyAiInsights(id: string) {
  return useQuery({
    queryKey: queryKeys.policies.aiInsights(id),
    queryFn: () => api.getPolicyAiInsights(id),
    enabled: !!id,
  })
}

export function useAdditionalInterests(policyId: string) {
  return useQuery({
    queryKey: queryKeys.policies.interests(policyId),
    queryFn: () => api.getAdditionalInterests(policyId),
    enabled: !!policyId,
  })
}

export function useSearchPolicies(q: string, opts?: Record<string, any>) {
  return useQuery({
    queryKey: queryKeys.policies.list({ q, ...opts }),
    queryFn: () => api.searchPolicies(q, opts),
    enabled: true,
  })
}

// ---------------------------------------------------------------------------
// Policies — Mutation hooks
// ---------------------------------------------------------------------------

export function useIssuePolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.issuePolicy(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.lists() })
    },
  })
}

export function useEndorsePolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.endorsePolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.versions(id) })
    },
  })
}

export function useEndorsePreviewMutation() {
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.endorsePreview(id, payload),
  })
}

export function useCancelPolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.cancelPolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.versions(id) })
    },
  })
}

export function useReinstatePolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.reinstatePolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.versions(id) })
    },
  })
}

export function useRewritePolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.rewritePolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
    },
  })
}

export function useRenewPolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: any }) => api.renewPolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
    },
  })
}

export function useNonRenewPolicyMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.nonRenewPolicy(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.detail(id) })
    },
  })
}

export function useReserveEndorsementNumberMutation() {
  return useMutation({
    mutationFn: (id: string) => api.reserveEndorsementNumber(id),
  })
}

export function useReserveTransactionNumberMutation() {
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'endorse' | 'cancel' | 'reinstate' | 'rewrite' | 'renew' }) =>
      api.reserveTransactionNumber(id, mode),
  })
}

export function useCreateAdditionalInterestMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ policyId, data }: { policyId: string; data: any }) =>
      api.createAdditionalInterest(policyId, data),
    onSuccess: (_data, { policyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.interests(policyId) })
    },
  })
}

export function useUpdateAdditionalInterestMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ policyId, aiId, data }: { policyId: string; aiId: string; data: any }) =>
      api.updateAdditionalInterest(policyId, aiId, data),
    onSuccess: (_data, { policyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.interests(policyId) })
    },
  })
}

export function useDeleteAdditionalInterestMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ policyId, aiId }: { policyId: string; aiId: string }) =>
      api.deleteAdditionalInterest(policyId, aiId),
    onSuccess: (_data, { policyId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.policies.interests(policyId) })
    },
  })
}

export function useExportPoliciesCsvMutation() {
  return useMutation({
    mutationFn: (params: Record<string, string | number | undefined>) => api.exportPoliciesCsv(params),
  })
}

// ---------------------------------------------------------------------------
// Version details & rating worksheet (apiDetails)
// ---------------------------------------------------------------------------

export function useVersionDetails(policyId: string, versionId: string) {
  return useQuery({
    queryKey: ['policies', policyId, 'versions', versionId, 'details'],
    queryFn: () => apiDetails.getVersionDetails(policyId, versionId),
    enabled: !!policyId && !!versionId,
  })
}

export function useVersionRatingWorksheet(policyId: string, versionId: string) {
  return useQuery({
    queryKey: ['policies', policyId, 'versions', versionId, 'rating-worksheet'],
    queryFn: () => apiDetails.getVersionRatingWorksheet(policyId, versionId),
    enabled: !!policyId && !!versionId,
  })
}

// ---------------------------------------------------------------------------
// Cancellation reason codes
// ---------------------------------------------------------------------------

export function useCancellationReasonCodes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.reference.cancellationCodes(),
    queryFn: () => api.getCancellationReasonCodes(),
    enabled,
  })
}
