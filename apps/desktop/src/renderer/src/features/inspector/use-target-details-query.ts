import { useQuery } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function useTargetDetailsQuery(targetId: string | null) {
  return useQuery({
    queryKey: ['catalog', 'target', targetId],
    queryFn: () => electronApi.getTargetById(targetId as string),
    enabled: targetId !== null,
    staleTime: 300_000,
  })
}
