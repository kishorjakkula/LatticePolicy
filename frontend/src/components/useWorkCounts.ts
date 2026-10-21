import { useQuery } from '@tanstack/react-query'
import { apiUw } from '../api/client'
import { apiSubmissions } from '../api/submissions.api'
import { useAuthStore } from '../store/auth.store'
import { tenantId } from '../api/request'

/** How often the header counts refresh while the tab is visible. */
export const WORK_COUNT_POLL_MS = 60_000

/** Referral status counted as open work in the header. */
export const OPEN_REFERRAL_STATUS = 'Open'
/** Submission status counted as waiting for a person to review. */
export const REVIEW_SUBMISSION_STATUS = 'READY_FOR_REVIEW'

export type WorkCounts = {
  /** Open referrals, or undefined while loading, on error or without permission. */
  referrals?: number
  /** Submissions ready for review, or undefined while loading, on error or without permission. */
  submissions?: number
}

function readTotal(payload: unknown): number | undefined {
  const total = (payload as { total?: unknown } | null | undefined)?.total
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : undefined
}

/**
 * Header work counts (REQ-5). Each count asks the existing list endpoint for
 * one row and reads `total`. A count is only requested when the caller has
 * permission for its page; polling stops while the tab is hidden; a failed
 * request leaves the count undefined so the badge is hidden and the link stays.
 */
export function useWorkCounts({ referrals, submissions }: { referrals: boolean; submissions: boolean }): WorkCounts {
  const user = useAuthStore(state => state.user)
  const scope = [user?.tenantId || tenantId(), user?.id || user?.username || null]
  const authenticated = Boolean(user)
  const referralQuery = useQuery({
    queryKey: ['uw-referrals', ...scope, 'count', OPEN_REFERRAL_STATUS],
    queryFn: () => apiUw.listReferrals(1, 1, OPEN_REFERRAL_STATUS),
    enabled: authenticated && referrals,
    refetchInterval: WORK_COUNT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  const submissionQuery = useQuery({
    queryKey: ['submissions', ...scope, 'count', REVIEW_SUBMISSION_STATUS],
    queryFn: () => apiSubmissions.list(REVIEW_SUBMISSION_STATUS, 1, 1),
    enabled: authenticated && submissions,
    refetchInterval: WORK_COUNT_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  })
  return {
    referrals: authenticated && referrals && !referralQuery.isError ? readTotal(referralQuery.data) : undefined,
    submissions: authenticated && submissions && !submissionQuery.isError ? readTotal(submissionQuery.data) : undefined,
  }
}
