import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiSubmissions, type NewSubmission, type SubmissionDetail } from '../submissions.api'
import { queryKeys } from '../queryKeys'

export function useIntakeSettings() {
  return useQuery({ queryKey: queryKeys.submissions.settings(), queryFn: () => apiSubmissions.settings(), staleTime: 5 * 60 * 1000 })
}

export function useSubmissions(status?: string) {
  return useQuery({
    queryKey: queryKeys.submissions.list(status),
    queryFn: () => apiSubmissions.list(status),
    // Keep the inbox current while documents are being read.
    refetchInterval: (query) => ((query.state.data?.items || []).some((item) => item.status === 'READING') ? 3000 : 30000),
  })
}

export function useSubmission(id: string) {
  return useQuery({
    queryKey: queryKeys.submissions.detail(id),
    queryFn: () => apiSubmissions.get(id),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === 'READING' ? 2000 : false),
  })
}

export function useSubmissionChecks(id: string, enabled: boolean, version: string) {
  return useQuery({
    queryKey: [...queryKeys.submissions.checks(id), version],
    queryFn: () => apiSubmissions.checks(id),
    enabled: !!id && enabled,
    placeholderData: (previous) => previous,
  })
}

export function useCreateSubmission() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: NewSubmission) => apiSubmissions.create(payload),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.submissions.all() }) },
  })
}

/** Runs a submission action and refreshes the detail it changed. */
export function useSubmissionAction<TArgs>(id: string, action: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: action,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKeys.submissions.detail(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.submissions.lists() })
    },
  })
}

export function setSubmissionField(qc: ReturnType<typeof useQueryClient>, id: string, field: SubmissionDetail['fields'][number]) {
  qc.setQueryData<SubmissionDetail>(queryKeys.submissions.detail(id), (current) =>
    current ? { ...current, fields: current.fields.map((item) => (item.key === field.key ? field : item)) } : current
  )
}
