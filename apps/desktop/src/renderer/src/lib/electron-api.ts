import type {
  ConnectRequestV2,
  DesktopLogEntryV2,
  DesktopStatus,
  SeestarDesktopApiV2,
} from '../../../shared/api-v2'

function getApi(): SeestarDesktopApiV2 {
  if (!window.seestarV2) {
    throw new Error('seestarV2 preload API is not available')
  }
  return window.seestarV2
}

export const electronApi = {
  getStatus: () => getApi().getStatus(),
  getLogs: () => getApi().getLogs(),
  discover: () => getApi().discover(),
  connect: (input: ConnectRequestV2) => getApi().connect(input),
  disconnect: () => getApi().disconnect(),
  onLog: (listener: (entry: DesktopLogEntryV2) => void) =>
    getApi().onLog(listener),
  onStatus: (listener: (status: DesktopStatus) => void) =>
    getApi().onStatus(listener),
}
