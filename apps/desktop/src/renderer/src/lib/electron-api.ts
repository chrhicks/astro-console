import type { ConnectRequest } from '../../../shared/api'
import type { DesktopStatus, SeestarDesktopApiV2 } from '../../../shared/api-v2'

function getApi(): SeestarDesktopApiV2 {
  if (!window.seestarV2) {
    throw new Error('seestarV2 preload API is not available')
  }
  return window.seestarV2
}

export const electronApi = {
  getStatus: () => getApi().getStatus(),
  connect: (input: ConnectRequest) => getApi().connect(input),
  disconnect: () => getApi().disconnect(),
  onStatus: (listener: (status: DesktopStatus) => void) =>
    getApi().onStatus(listener),
}
