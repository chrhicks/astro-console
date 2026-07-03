import type {
  CatalogQuery,
  ConnectRequestV2,
  DesktopLogEntryV2,
  DesktopStatus,
  PointToTargetRequest,
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
  browseTargets: (query: CatalogQuery) => getApi().browseTargets(query),
  getTargetById: (targetId: string) => getApi().getTargetById(targetId),
  pointToTarget: (input: PointToTargetRequest) => getApi().pointToTarget(input),
  onLog: (listener: (entry: DesktopLogEntryV2) => void) =>
    getApi().onLog(listener),
  onStatus: (listener: (status: DesktopStatus) => void) =>
    getApi().onStatus(listener),
}
