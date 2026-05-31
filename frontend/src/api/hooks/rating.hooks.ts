import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../client'
import { queryKeys } from '../queryKeys'

// ---------------------------------------------------------------------------
// Rating models — Query hooks
// ---------------------------------------------------------------------------

export function useRatingModels() {
  return useQuery({
    queryKey: queryKeys.ratingModels.list(),
    queryFn: () => api.listRatingModels(),
  })
}

export function useRatingModelVersion(modelId: string, versionId: string) {
  return useQuery({
    queryKey: queryKeys.ratingModels.detail(modelId, versionId),
    queryFn: () => api.getRatingModelVersion(modelId, versionId),
    enabled: !!modelId && !!versionId,
  })
}

export function usePublishedRatingModel(opts: { productCode?: string; stateCode?: string; modelCode?: string; versionLabel?: string }) {
  return useQuery({
    queryKey: queryKeys.ratingModels.published(opts),
    queryFn: () => api.getPublishedRatingModel(opts),
    enabled: Object.values(opts).some(Boolean),
  })
}

// ---------------------------------------------------------------------------
// Rating models — Mutation hooks
// ---------------------------------------------------------------------------

export function useImportRatingWorkbookMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ file, opts }: { file: File; opts?: { modelCode?: string; productCode?: string; stateCode?: string; programName?: string } }) =>
      api.importRatingWorkbook(file, opts),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.ratingModels.list() })
    },
  })
}

export function usePublishRatingModelVersionMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ modelId, versionId }: { modelId: string; versionId: string }) =>
      api.publishRatingModelVersion(modelId, versionId),
    onSuccess: (_data, { modelId, versionId }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.ratingModels.detail(modelId, versionId) })
      void qc.invalidateQueries({ queryKey: queryKeys.ratingModels.list() })
    },
  })
}
