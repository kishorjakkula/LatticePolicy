import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiUw } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// UW referrals
// ---------------------------------------------------------------------------

export function useUwReferrals(page: number, pageSize: number, status?: string) {
  return useQuery({
    queryKey: queryKeys.uwReferrals.list(page, pageSize, status),
    queryFn: () => apiUw.listReferrals(page, pageSize, status),
  })
}

export function useUwReferral(referralId: string | null) {
  return useQuery({
    queryKey: queryKeys.uwReferrals.detail(referralId || ''),
    queryFn: () => apiUw.getReferral(referralId as string),
    enabled: !!referralId,
  })
}

export function useAssignReferralMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ referralId, assignedTo }: { referralId: string; assignedTo: string }) =>
      apiUw.assignReferral(referralId, assignedTo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwReferrals.all() })
    },
  })
}

export function useAddReferralCommentMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ referralId, text }: { referralId: string; text: string }) =>
      apiUw.addReferralComment(referralId, text),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwReferrals.all() })
    },
  })
}

export function useDecideReferralMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      referralId,
      decision,
      reason,
    }: {
      referralId: string
      decision: 'Approved' | 'Declined' | 'InfoRequested'
      reason?: string
    }) => apiUw.decideReferral(referralId, decision, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwReferrals.all() })
    },
  })
}
