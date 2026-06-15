import { useMutation } from '@tanstack/react-query'
import { electronApi } from '../../lib/electron-api'

export function useDiscoverMutation() {
  return useMutation({
    mutationKey: ['session', 'discover'],
    mutationFn: () => electronApi.discover(),
  })
}
