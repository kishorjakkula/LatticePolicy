import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiPlacements } from '../client'
import { queryKeys } from '../queryKeys'

export function usePlacements(page: number, pageSize: number, status?: string) {
  return useQuery({
    queryKey: queryKeys.placements.list(page, pageSize, status),
    queryFn: () => apiPlacements.listPlacements(page, pageSize, status),
  })
}

export function usePlacement(placementId: string | null) {
  return useQuery({
    queryKey: queryKeys.placements.detail(placementId || ''),
    queryFn: () => apiPlacements.getPlacement(placementId as string),
    enabled: !!placementId,
  })
}

export function useCreatePlacementMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: { insuredName: string; productCode?: string; effectiveDate?: string; facilityReference?: string }) =>
      apiPlacements.createPlacement(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.placements.all() })
    },
  })
}

export function useTransitionPlacementStatusMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ placementId, toStatus, reason }: { placementId: string; toStatus: string; reason?: string }) =>
      apiPlacements.transitionStatus(placementId, toStatus, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.placements.all() })
    },
  })
}
