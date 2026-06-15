import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function useDisconnectMutation() {
  return useMutation({
    mutationKey: ['session', 'disconnect'],
    mutationFn: () => electronApi.disconnect(),
  })
}
