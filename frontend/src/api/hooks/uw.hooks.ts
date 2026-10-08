import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiUw } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// UW authority grants
// ---------------------------------------------------------------------------

export function useUwAuthorityGrants() {
  return useQuery({
    queryKey: queryKeys.uwAuthorityGrants.list(),
    queryFn: () => apiUw.listAuthorityGrants(),
  })
}

export function useCreateUwAuthorityGrantMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      subjectType: 'USER' | 'ROLE' | 'PRODUCER'
      subjectId: string
      productCode?: string | null
      stateCode?: string | null
      transactionTypes: string[]
      maxPremium?: number | null
      maxLimit?: number | null
      mayOverride?: boolean
      effectiveDate: string
      expirationDate?: string | null
    }) => apiUw.createAuthorityGrant(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwAuthorityGrants.all() })
    },
  })
}

export function useUpdateUwAuthorityGrantMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ grantId, patch }: { grantId: string; patch: { active?: boolean; expirationDate?: string | null } }) =>
      apiUw.updateAuthorityGrant(grantId, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.uwAuthorityGrants.all() })
    },
  })
}

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
