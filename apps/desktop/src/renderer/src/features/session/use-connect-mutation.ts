import { useMutation } from "@tanstack/react-query";
import { electronApi } from "../../lib/electron-api";
import type { ConnectRequest } from "../../../../shared/api";

export function useConnectMutation() {
  return useMutation({
    mutationKey: ['session', 'connect'],
    mutationFn: (input: ConnectRequest) => electronApi.connect(input),
  })
}