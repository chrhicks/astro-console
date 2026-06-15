import { useMutation } from '@tanstack/react-query'
import type { ConnectRequestV2 } from '../../../../shared/api-v2'
import { electronApi } from '../../lib/electron-api'

export function useConnectMutation() {
  return useMutation({
    mutationKey: ['session', 'connect'],
    mutationFn: (input: ConnectRequestV2) => electronApi.connect(input),
  })
}
