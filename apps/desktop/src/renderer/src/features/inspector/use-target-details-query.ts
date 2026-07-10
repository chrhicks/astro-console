import { useQuery } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function useTargetDetailsQuery(targetId: string | null) {
  return useQuery({
    queryKey: ['catalog', 'target', targetId],
    queryFn: () => {
      if (targetId === null) return null
      return electronApi.getTargetById(targetId)
    },
    enabled: targetId !== null,
    staleTime: 300_000,
  })
}
