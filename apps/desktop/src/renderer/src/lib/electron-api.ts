import type {
  CatalogQuery,
  ConnectRequestV2,
  ConfigureExternalSequenceRequest,
  DesktopLogEntryV2,
  DesktopStatus,
  PointToTargetRequest,
  SeestarDesktopApiV2,
  SetExposureDurationRequest,
  MoveFocuserRequest,
  SetFilterPositionRequest,
  SetObserverLocationRequest,
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
  browseTargets: (query?: CatalogQuery) => getApi().browseTargets(query),
  getTargetById: (targetId: string) => getApi().getTargetById(targetId),
  pointToTarget: (input: PointToTargetRequest) => getApi().pointToTarget(input),
  startPreview: () => getApi().startPreview(),
  stopPreview: () => getApi().stopPreview(),
  startCapture: () => getApi().startCapture(),
  stopCapture: () => getApi().stopCapture(),
  parkMount: () => getApi().parkMount(),
  unparkMount: () => getApi().unparkMount(),
  abortSlew: () => getApi().abortSlew(),
  moveFocuser: (input: MoveFocuserRequest) => getApi().moveFocuser(input),
  setFilterPosition: (input: SetFilterPositionRequest) => getApi().setFilterPosition(input),
  setObserverLocation: (input: SetObserverLocationRequest) => getApi().setObserverLocation(input),
  setExposureDuration: (input: SetExposureDurationRequest) =>
    getApi().setExposureDuration(input),
  configureExternalSequence: (input: ConfigureExternalSequenceRequest) =>
    getApi().configureExternalSequence(input),
  startExternalSequence: () => getApi().startExternalSequence(),
  continueExternalSequence: () => getApi().continueExternalSequence(),
  finishExternalSequence: () => getApi().finishExternalSequence(),
  openSavedAsset: (filePath: string) => getApi().openSavedAsset(filePath),
  revealSavedAsset: (filePath: string) => getApi().revealSavedAsset(filePath),
  getSavedAssetPreview: (filePath: string) =>
    getApi().getSavedAssetPreview(filePath),
  onLog: (listener: (entry: DesktopLogEntryV2) => void) =>
    getApi().onLog(listener),
  onStatus: (listener: (status: DesktopStatus) => void) =>
    getApi().onStatus(listener),
}
