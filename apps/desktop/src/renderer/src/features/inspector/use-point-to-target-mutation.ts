import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function usePointToTargetMutation() {
  return useMutation({
    mutationKey: ['pointing', 'point-to-target'],
    mutationFn: (targetId: string) =>
      electronApi.pointToTarget({ targetId }),
  })
}
