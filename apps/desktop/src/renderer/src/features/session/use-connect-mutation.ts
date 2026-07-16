import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function useConnectMutation() {
  return useMutation({
    mutationKey: ['session', 'connect'],
    mutationFn: electronApi.connect,
  })
}
