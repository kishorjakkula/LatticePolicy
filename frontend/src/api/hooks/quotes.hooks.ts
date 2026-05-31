import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Quotes — Query hooks
// ---------------------------------------------------------------------------

export function useQuote(id: string) {
  return useQuery({
    queryKey: queryKeys.quotes.detail(id),
    queryFn: () => api.getQuote(id),
    enabled: !!id,
  })
}

export function useSearchQuotes(q: string, opts?: Record<string, any>) {
  return useQuery({
    queryKey: queryKeys.quotes.list({ q, ...opts }),
    queryFn: () => api.searchQuotes(q, opts),
    enabled: true,
  })
}

// ---------------------------------------------------------------------------
// Quotes — Mutation hooks
// ---------------------------------------------------------------------------

export function useCreateQuoteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: any) => api.createQuote(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.quotes.lists() })
    },
  })
}

export function useBindQuoteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload?: any }) => api.bindQuote(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.quotes.lists() })
      void qc.invalidateQueries({ queryKey: queryKeys.policies.lists() })
    },
  })
}

export function useCopyQuoteMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.copyQuote(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.quotes.lists() })
    },
  })
}

export function useCreateQuoteDraftMutation() {
  return useMutation({
    mutationFn: ({ payload, opts }: { payload: any; opts?: { status?: string; progressStep?: number } }) =>
      api.createQuoteDraft(payload, opts),
  })
}

export function useUpdateQuoteDraftMutation() {
  return useMutation({
    mutationFn: ({ id, payload, opts }: { id: string; payload: any; opts?: { status?: string; progressStep?: number } }) =>
      api.updateQuoteDraft(id, payload, opts),
  })
}

export function useInferQuoteAiInsightsMutation() {
  return useMutation({
    mutationFn: (payload: { payload: any; premium?: any; underwriting?: any }) =>
      api.inferQuoteAiInsights(payload),
  })
}

export function usePreviewFormsMutation() {
  return useMutation({
    mutationFn: (payload: any) => api.previewForms(payload),
  })
}

export function useExportQuotesCsvMutation() {
  return useMutation({
    mutationFn: (params: Record<string, string | number | undefined>) => api.exportQuotesCsv(params),
  })
}
