import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiUw } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// UW referrals
// ---------------------------------------------------------------------------

export function useUwReferrals(page: number, pageSize: number) {
  return useQuery({
    queryKey: queryKeys.uwReferrals.list(page, pageSize),
    queryFn: () => apiUw.listReferrals(page, pageSize),
  })
}

export function useApproveReferralMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, reason }: { versionId: string; reason: string }) =>
      apiUw.approveReferral(versionId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwReferrals.all() })
    },
  })
}

export function useDeclineReferralMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ versionId, reason }: { versionId: string; reason: string }) =>
      apiUw.declineReferral(versionId, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwReferrals.all() })
    },
  })
}
