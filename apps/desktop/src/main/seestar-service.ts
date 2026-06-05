import { app, WebContents } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
  type LogEvent,
  type Logger,
} from '../../../../sdk/dist/index.js'
import type {
  AddManualCatalogTargetRequest,
  ArchiveSiteProfileRequest,
  CreateQueueFromDraftsRequest,
  DesktopDeviceTime,
  DesktopCommandRequest,
  ConnectRequest,
  CreateSiteProfileRequest,
  DesktopDiscoveredDevice,
  DuplicateSiteProfileRequest,
  DesktopLogEntry,
  DesktopPlannerDiscoveryState,
  DesktopPlannerHealth,
  DesktopPreviewFrame,
  DesktopPreviewState,
  DesktopQueueRunnerState,
  DesktopReconnectState,
  ReplaceQueueRequest,
  SearchCatalogTargetsRequest,
  StartQueueRunRequest,
  DesktopStatus,
  SetActiveSiteRequest,
  UpdateSiteProfileRequest,
} from '../shared/api'
import type { PlanningSnapshot, SiteProfile } from '../shared/planning'
import { evaluateSiteDiagnostics } from '../shared/site-diagnostics'
import type { CatalogSearchResult } from '../shared/starter-catalog'
import { PlanningContextService } from './planning-context'
import { PlanningStore } from './planning-store'
import { QueueRunner, createDefaultQueueRunnerState } from './queue-runner'
import { SeestarSessionRecorder } from './session-recorder'

const LOG_LIMIT = 250
const PREVIEW_MODE = 'rtsp-mjpeg' as const
const PREVIEW_FRAME_RATE = 5
const PREVIEW_JPEG_QUALITY = 3
const MAX_PREVIEW_BUFFER_BYTES = 2 * 1024 * 1024
const JPEG_SOI = Buffer.from([0xff, 0xd8])
const JPEG_EOI = Buffer.from([0xff, 0xd9])
const DEFAULT_ACTION_WAIT = {
  waitForCompletion: true,
  timeoutMs: 120000,
  pollIntervalMs: 500,
} as const
const AUTOFOCUS_ACTION_WAIT = {
  waitForCompletion: true,
  timeoutMs: 180000,
  pollIntervalMs: 500,
} as const
const AUTO_RECONNECT_DELAY_MS = 3000
const AUTO_RECONNECT_MAX_ATTEMPTS = 3
const DISCOVERY_RETRY_ATTEMPTS = 3
const DISCOVERY_RETRY_DELAY_MS = 1000

export class SeestarDesktopService {
  private device: SeestarDevice | null = null
  private logs: DesktopLogEntry[] = []
  private planningStore = new PlanningStore({
    getUserDataDir: () => app.getPath('userData'),
  })
  private planningContext = new PlanningContextService({
    getPlanningSnapshot: () => this.planningStore.getSnapshot(),
  })
  private recorder = new SeestarSessionRecorder({
    getRootDir: () =>
      path.join(
        resolveWorkspaceRoot(__dirname) ?? resolveDesktopAppRoot(__dirname),
        'recordings',
      ),
    getAppVersion: () =>
      resolveDesktopAppVersion(__dirname) ?? app.getVersion(),
  })
  private status: DesktopStatus = {
    connected: false,
    authenticated: false,
    deviceState: null,
    viewState: null,
    preview: createDefaultPreviewState(),
    recording: createDefaultRecordingState(),
    reconnect: createDefaultReconnectState(),
    planner: createDefaultPlannerHealth(),
    runner: createDefaultQueueRunnerState(),
  }
  private subscribers = new Set<WebContents>()
  private previewProcess: ChildProcessByStdio<null, Readable, Readable> | null =
    null
  private previewBuffer = Buffer.alloc(0)
  private previewStopRequested = false
  private previewLastStderr: string | undefined
  private previewExitExpected = false
  private recordingFinalizing = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private reconnectInFlight = false
  private manualDisconnectRequested = false
  private restorePreviewAfterReconnect = false
  private logger: Logger = {
    log: (event) => {
      this.recorder.recordSdkLog(event)
      this.applyLogSideEffects(event)
      const entry = toDesktopLogEntry(event)
      this.logs = [...this.logs.slice(-(LOG_LIMIT - 1)), entry]
      for (const subscriber of this.subscribers) {
        if (!subscriber.isDestroyed()) {
          subscriber.send('seestar:log', entry)
        }
      }
    },
  }
  private queueRunner = new QueueRunner({
    logger: this.logger,
    getPlanningSnapshot: () => this.planningStore.getSnapshot(),
    getStatus: () => this.getStatus(),
    refreshStatus: () => this.refreshState(),
    requireConnectedDevice: () => this.requireConnectedDevice(),
    detachPreviewForAutomation: (reason) =>
      this.detachPreviewForAutomation(reason),
    onStateChange: (state, reason) => this.applyQueueRunnerState(state, reason),
  })

  attachRenderer(webContents: WebContents): void {
    this.subscribers.add(webContents)
    webContents.once('destroyed', () => {
      this.subscribers.delete(webContents)
    })
  }

  async discover(): Promise<DesktopDiscoveredDevice[]> {
    const devices = await discoverSeestars({
      timeoutMs: 2500,
      logger: this.logger,
    })
    return devices.map((device) => ({
      host: device.host,
      port: device.port,
      productModel: asString(device.result.product_model),
      serialNumber: asString(device.result.sn),
      ssid: asString(device.result.ssid),
    }))
  }

  async connect(input: ConnectRequest): Promise<DesktopStatus> {
    const host = input.host?.trim()

    this.manualDisconnectRequested = false
    this.clearReconnectState()

    return this.connectWithPlannerSync({
      requestedHost: host,
      trigger: 'connect',
      action: 'connect',
      startNewSession: true,
      allowDiscoveryFallback: true,
    })
  }

  async disconnect(): Promise<DesktopStatus> {
    this.manualDisconnectRequested = true
    this.restorePreviewAfterReconnect = false
    this.clearReconnectState()
    this.queueRunner.handleConnectionLost(
      'Operator disconnected during queue execution',
    )

    await this.recordCommand('disconnect', undefined, async () => {
      this.disconnectDevice()
      this.status = {
        connected: false,
        authenticated: false,
        deviceState: null,
        viewState: null,
        preview: createDefaultPreviewState(),
        recording: this.recorder.getState(),
        reconnect: createDefaultReconnectState(),
        planner: createDefaultPlannerHealth(),
        runner: { ...this.status.runner },
        lastUpdatedAt: new Date().toISOString(),
      }
      this.emitStatus('disconnect.completed')
    })

    await this.finishRecording('disconnect.completed')
    return this.getStatus()
  }

  async refreshState(): Promise<DesktopStatus> {
    return this.recordCommand('refresh-state', undefined, async () => {
      if (!this.device || !this.device.isConnected()) {
        this.stopPreviewProcess()
        this.status = {
          ...this.status,
          connected: false,
          authenticated: false,
          deviceState: null,
          viewState: null,
          preview: createDefaultPreviewState(),
          recording: this.recorder.getState(),
          planner: createDefaultPlannerHealth(),
          runner: { ...this.status.runner },
          lastUpdatedAt: new Date().toISOString(),
        }
        this.emitStatus('refresh-state.disconnected')
        await this.finishRecording('refresh-state.disconnected')
        return this.getStatus()
      }

      try {
        const telemetry = await this.collectPlannerTelemetry(this.device)
        const activeSite = await this.getActiveSite()
        const planner = buildPlannerHealth({
          discovery: {
            ...this.status.planner.discovery,
            attempted:
              this.status.planner.discovery.attempted ||
              Boolean(this.status.host),
            resolvedHost: this.status.host,
            lastAttemptAt: new Date().toISOString(),
          },
          activeSite,
          telemetry,
          clockAttempted: this.status.planner.clock.attempted,
          clockSynced: this.status.planner.clock.synced,
          clockSyncedAt: this.status.planner.clock.lastSyncedAt,
          clockHostTime: this.status.planner.clock.hostTime,
          clockError: this.status.planner.clock.lastError,
          clockStaleBeforeSync: this.status.planner.clock.staleBeforeSync,
          locationAttempted: this.status.planner.location.attempted,
          locationSynced: this.status.planner.location.synced,
          locationSyncedAt: this.status.planner.location.lastSyncedAt,
          locationError: this.status.planner.location.lastError,
        })

        this.status = {
          ...this.status,
          connected: this.device.isConnected(),
          authenticated: true,
          deviceState: telemetry.deviceState,
          viewState: telemetry.viewState,
          recording: this.recorder.getState(),
          planner,
          lastError: undefined,
          lastUpdatedAt: new Date().toISOString(),
        }
        this.emitStatus('refresh-state.completed')
        return this.getStatus()
      } catch (error) {
        this.disconnectDevice()
        this.status = {
          ...this.status,
          connected: false,
          authenticated: false,
          deviceState: null,
          viewState: null,
          preview: createDefaultPreviewState(),
          recording: this.recorder.getState(),
          planner: createDefaultPlannerHealth(),
          runner: { ...this.status.runner },
          lastError: toErrorMessage(error),
          lastUpdatedAt: new Date().toISOString(),
        }
        this.emitStatus('refresh-state.failed')
        await this.finishRecording('refresh-state.failed')
        throw error
      }
    })
  }

  async startPreview(): Promise<DesktopStatus> {
    return this.recordCommand('start-preview', undefined, async () => {
      this.ensureRunnerIdle('start live preview')
      if (!this.device || !this.device.isConnected()) {
        throw new Error(
          'Connect to a Seestar device before starting live preview',
        )
      }

      const host = this.status.host?.trim()
      if (!host) {
        throw new Error('No Seestar host is available for RTSP preview')
      }

      const viewMode = this.readViewMode()
      if (viewMode !== 'scenery') {
        throw new Error('Start Scenery view before starting live preview')
      }

      this.stopPreviewProcess()

      const rtspUrl = buildRtspUrl(host)
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-rtsp_transport',
        'tcp',
        '-fflags',
        'nobuffer',
        '-flags',
        'low_delay',
        '-i',
        rtspUrl,
        '-an',
        '-vf',
        `fps=${PREVIEW_FRAME_RATE}`,
        '-q:v',
        String(PREVIEW_JPEG_QUALITY),
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1',
      ]

      const previewProcess = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      this.previewProcess = previewProcess
      this.previewBuffer = Buffer.alloc(0)
      this.previewStopRequested = false
      this.previewLastStderr = undefined
      this.previewExitExpected = false
      this.status = {
        ...this.status,
        preview: {
          active: true,
          mode: PREVIEW_MODE,
          rtspUrl,
        },
        recording: this.recorder.getState(),
        lastUpdatedAt: new Date().toISOString(),
      }
      this.restorePreviewAfterReconnect = true
      this.emitStatus('preview.started')

      previewProcess.stdout.on('data', (chunk: Buffer) => {
        if (this.previewProcess !== previewProcess) return
        this.consumePreviewChunk(chunk)
      })
      previewProcess.stderr.setEncoding('utf8')
      previewProcess.stderr.on('data', (chunk: string) => {
        if (this.previewProcess !== previewProcess) return
        this.consumePreviewStderr(chunk)
      })
      previewProcess.once('error', (error) => {
        if (this.previewProcess !== previewProcess) return
        this.handlePreviewFailure(toErrorMessage(error))
      })
      previewProcess.once('exit', (code, signal) => {
        if (this.previewProcess !== previewProcess) return
        if (this.previewStopRequested) return
        this.handlePreviewFailure(
          describePreviewExit(code, signal, this.previewLastStderr),
        )
      })

      return this.getStatus()
    })
  }

  async stopPreview(): Promise<DesktopStatus> {
    return this.recordCommand('stop-preview', undefined, async () => {
      this.ensureRunnerIdle('stop live preview')
      this.stopPreviewProcess()
      this.restorePreviewAfterReconnect = false
      this.status = {
        ...this.status,
        preview: createDefaultPreviewState(),
        recording: this.recorder.getState(),
        lastUpdatedAt: new Date().toISOString(),
      }
      this.emitStatus('preview.stopped')
      return this.getStatus()
    })
  }

  getStatus(): DesktopStatus {
    return {
      ...this.status,
      preview: { ...this.status.preview },
      recording: { ...this.status.recording },
      reconnect: { ...this.status.reconnect },
      planner: clonePlannerHealth(this.status.planner),
      runner: { ...this.status.runner },
    }
  }

  async getPlanningSnapshot(): Promise<PlanningSnapshot> {
    return this.planningContext.getSnapshot()
  }

  async createSiteProfile(
    input: CreateSiteProfileRequest,
  ): Promise<PlanningSnapshot> {
    return this.planningStore.createSiteProfile(input)
  }

  async updateSiteProfile(
    input: UpdateSiteProfileRequest,
  ): Promise<PlanningSnapshot> {
    return this.planningStore.updateSiteProfile(input)
  }

  async duplicateSiteProfile(
    input: DuplicateSiteProfileRequest,
  ): Promise<PlanningSnapshot> {
    return this.planningStore.duplicateSiteProfile(input)
  }

  async archiveSiteProfile(
    input: ArchiveSiteProfileRequest,
  ): Promise<PlanningSnapshot> {
    return this.planningStore.archiveSiteProfile(input)
  }

  async setActiveSite(input: SetActiveSiteRequest): Promise<PlanningSnapshot> {
    this.ensureRunnerIdle('change the active site')
    return this.planningStore.setActiveSite(input)
  }

  async searchCatalogTargets(
    input: SearchCatalogTargetsRequest,
  ): Promise<CatalogSearchResult[]> {
    return this.planningStore.searchCatalog(input)
  }

  async addManualCatalogTarget(
    input: AddManualCatalogTargetRequest,
  ): Promise<PlanningSnapshot> {
    return this.planningStore.addManualCatalogTarget(input)
  }

  async replaceQueue(input: ReplaceQueueRequest): Promise<PlanningSnapshot> {
    this.ensureRunnerIdle('edit the queue')
    return this.planningStore.replaceQueue(input)
  }

  async createQueueFromDrafts(
    input: CreateQueueFromDraftsRequest,
  ): Promise<PlanningSnapshot> {
    this.ensureRunnerIdle('create a queue draft')
    return this.planningStore.createQueueFromDrafts(input)
  }

  async startQueueRun(input: StartQueueRunRequest): Promise<DesktopStatus> {
    await this.queueRunner.start({ dryRun: input.dryRun })
    return this.getStatus()
  }

  async stopQueueRun(): Promise<DesktopStatus> {
    await this.queueRunner.requestStop()
    return this.getStatus()
  }

  getLogs(): DesktopLogEntry[] {
    return [...this.logs]
  }

  dispose(): void {
    this.disconnectDevice()
    void this.finishRecording('service.disposed')
  }

  async runCommand(input: DesktopCommandRequest): Promise<DesktopStatus> {
    return this.recordCommand(input.action, input, async () => {
      this.ensureRunnerIdle(`run ${input.action}`)
      const device = this.requireConnectedDevice()
      let stopPreview = false

      switch (input.action) {
        case 'open-arm':
          await this.expectAccepted(
            device.moveToHorizon(DEFAULT_ACTION_WAIT),
            'Device rejected move-to-horizon request',
          )
          break
        case 'park': {
          let nextViewState = await device.getViewState()

          if (isStackActive(nextViewState)) {
            await this.expectAccepted(
              device.stopStack(DEFAULT_ACTION_WAIT),
              'Device rejected stop-stack request before parking',
            )
            nextViewState = await device.getViewState()
          }

          if (isViewActive(nextViewState)) {
            this.expectPreviewExit()
            await this.expectAccepted(
              device.stopView(undefined, DEFAULT_ACTION_WAIT),
              'Device rejected stop-view request before parking',
            )
          }

          await this.expectAccepted(
            device.park(DEFAULT_ACTION_WAIT),
            'Device rejected park request',
          )
          stopPreview = true
          break
        }
        case 'start-view': {
          const mode = input.mode
          if (!mode) {
            throw new Error('View mode is required to start a view')
          }
          if (mode !== 'scenery') {
            this.expectPreviewExit()
          }
          await this.expectAccepted(
            device.startView(mode, undefined, DEFAULT_ACTION_WAIT),
            `Device rejected ${mode} view request`,
          )
          stopPreview = mode !== 'scenery'
          break
        }
        case 'stop-view':
          this.expectPreviewExit()
          await this.expectAccepted(
            device.stopView(undefined, DEFAULT_ACTION_WAIT),
            'Device rejected stop-view request',
          )
          stopPreview = true
          break
        case 'start-stack':
          await this.expectAccepted(
            device.startStack(true, DEFAULT_ACTION_WAIT),
            'Device rejected start-stack request',
          )
          break
        case 'stop-stack':
          await this.expectAccepted(
            device.stopStack(DEFAULT_ACTION_WAIT),
            'Device rejected stop-stack request',
          )
          break
        case 'autofocus':
          await this.expectAccepted(
            device.startAutoFocus(AUTOFOCUS_ACTION_WAIT),
            'Device rejected autofocus request',
          )
          break
        default:
          throw new Error(`Unsupported device command: ${String(input.action)}`)
      }

      if (stopPreview) {
        this.stopPreviewProcess()
        this.status = {
          ...this.status,
          preview: createDefaultPreviewState(),
          recording: this.recorder.getState(),
        }
      }

      return this.refreshState()
    })
  }

  private disconnectDevice(): void {
    this.stopPreviewProcess()
    if (!this.device) return
    this.device.disconnect()
    this.device = null
  }

  private ensureRunnerIdle(action: string): void {
    if (this.queueRunner.getState().active) {
      throw new Error(`Cannot ${action} while the queue runner is active`)
    }
  }

  private requireConnectedDevice(): SeestarDevice {
    if (!this.device || !this.device.isConnected()) {
      throw new Error('Connect to a Seestar device before sending commands')
    }
    return this.device
  }

  private async expectAccepted(
    work: Promise<boolean>,
    message: string,
  ): Promise<void> {
    const ok = await work
    if (!ok) {
      throw new Error(message)
    }
  }

  private resolvePemPath(): string {
    return resolveSeestarPemPath({
      fallbackCandidates: [
        path.resolve(app.getAppPath(), 'seestar_3.1.2_fw_7.32_interop.pem'),
      ],
    })
  }

  private emitStatus(reason = 'status.updated'): void {
    const status = this.getStatus()
    this.recorder.recordStatus(status, reason)
    for (const subscriber of this.subscribers) {
      if (!subscriber.isDestroyed()) {
        subscriber.send('seestar:status', status)
      }
    }
  }

  private async applyQueueRunnerState(
    state: DesktopQueueRunnerState,
    reason: string,
  ): Promise<void> {
    this.status = {
      ...this.status,
      runner: { ...state },
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus(reason)
  }

  private detachPreviewForAutomation(reason: string): void {
    if (!this.previewProcess && !this.status.preview.active) {
      return
    }
    this.stopPreviewProcess()
    this.restorePreviewAfterReconnect = false
    this.status = {
      ...this.status,
      preview: createDefaultPreviewState(),
      recording: this.recorder.getState(),
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus(reason)
  }

  private applyLogSideEffects(event: LogEvent): void {
    if (
      event.event !== 'connection.tcp.closed' &&
      event.event !== 'connection.tcp.error'
    ) {
      return
    }

    if (!this.device && !this.status.connected) {
      return
    }

    this.stopPreviewProcess()
    this.device = null
    this.queueRunner.handleConnectionLost(
      event.error ?? event.summary ?? 'Device connection closed',
    )
    this.status = {
      ...this.status,
      connected: false,
      authenticated: false,
      deviceState: null,
      viewState: null,
      preview: createDefaultPreviewState(),
      recording: this.recorder.getState(),
      planner: createDefaultPlannerHealth(),
      runner: { ...this.status.runner },
      lastError:
        event.event === 'connection.tcp.error'
          ? (event.error ?? event.summary)
          : undefined,
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus(event.event)

    if (!this.manualDisconnectRequested) {
      void this.handleUnexpectedDisconnect(event)
      return
    }

    void this.finishRecording(event.event)
  }

  private readViewMode(): string | undefined {
    const viewState = asRecord(this.status.viewState)
    const view = asRecord(viewState?.View)
    return asString(view?.mode)
  }

  private stopPreviewProcess(): void {
    if (!this.previewProcess) return

    const previewProcess = this.previewProcess
    this.previewProcess = null
    this.previewStopRequested = true
    this.previewBuffer = Buffer.alloc(0)
    this.previewLastStderr = undefined
    this.previewExitExpected = false
    previewProcess.removeAllListeners()
    previewProcess.stdout.removeAllListeners()
    previewProcess.stderr.removeAllListeners()
    previewProcess.kill('SIGTERM')
  }

  private consumePreviewStderr(chunk: string): void {
    const lines = chunk
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length > 0) {
      this.previewLastStderr = lines[lines.length - 1]
    }
  }

  private consumePreviewChunk(chunk: Buffer): void {
    this.previewBuffer = Buffer.concat([this.previewBuffer, chunk])

    if (this.previewBuffer.length > MAX_PREVIEW_BUFFER_BYTES) {
      const start = this.previewBuffer.lastIndexOf(JPEG_SOI)
      this.previewBuffer =
        start >= 0 ? this.previewBuffer.subarray(start) : Buffer.alloc(0)
    }

    while (true) {
      const start = this.previewBuffer.indexOf(JPEG_SOI)
      if (start === -1) {
        this.previewBuffer = Buffer.alloc(0)
        return
      }

      if (start > 0) {
        this.previewBuffer = this.previewBuffer.subarray(start)
      }

      const end = this.previewBuffer.indexOf(JPEG_EOI, JPEG_SOI.length)
      if (end === -1) {
        return
      }

      const frame = this.previewBuffer.subarray(0, end + JPEG_EOI.length)
      this.previewBuffer = this.previewBuffer.subarray(end + JPEG_EOI.length)
      this.emitPreviewFrame(frame)
    }
  }

  private emitPreviewFrame(frame: Buffer): void {
    const ts = new Date().toISOString()
    this.previewExitExpected = false
    this.status = {
      ...this.status,
      preview: {
        ...this.status.preview,
        active: true,
        mode: PREVIEW_MODE,
        lastFrameAt: ts,
        lastError: undefined,
      },
    }

    const payload: DesktopPreviewFrame = {
      ts,
      dataUrl: `data:image/jpeg;base64,${frame.toString('base64')}`,
    }

    for (const subscriber of this.subscribers) {
      if (!subscriber.isDestroyed()) {
        subscriber.send('seestar:preview-frame', payload)
      }
    }
  }

  private handlePreviewFailure(message: string): void {
    const expectedExit =
      this.previewExitExpected && message === 'RTSP preview exited with code 0'
    this.previewProcess = null
    this.previewStopRequested = false
    this.previewBuffer = Buffer.alloc(0)
    this.previewLastStderr = undefined
    this.previewExitExpected = false

    if (expectedExit) {
      this.status = {
        ...this.status,
        preview: createDefaultPreviewState(),
        recording: this.recorder.getState(),
        lastUpdatedAt: new Date().toISOString(),
      }
      this.emitStatus('preview.stopped.expected')
      return
    }

    this.restorePreviewAfterReconnect = false
    this.status = {
      ...this.status,
      preview: {
        ...createDefaultPreviewState(),
        lastError: message,
      },
      recording: this.recorder.getState(),
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus('preview.failed')
  }

  private syncRecordingState(): void {
    this.status = {
      ...this.status,
      recording: this.recorder.getState(),
    }
  }

  private expectPreviewExit(): void {
    if (this.previewProcess || this.status.preview.active) {
      this.previewExitExpected = true
    }
  }

  private async finishRecording(reason: string): Promise<void> {
    const wasActive = this.recorder.getState().active
    if (!wasActive || this.recordingFinalizing) return

    this.recordingFinalizing = true

    try {
      await this.recorder.finalize(reason, this.getStatus())
      this.syncRecordingState()
      this.emitStatus('recording.finalized')
    } finally {
      this.recordingFinalizing = false
    }
  }

  private async recordCommand<T>(
    action: string,
    params: unknown,
    work: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now()

    try {
      const result = await work()
      this.recorder.recordCommand({ action, params, startedAt, ok: true })
      return result
    } catch (error) {
      this.recorder.recordCommand({
        action,
        params,
        startedAt,
        ok: false,
        error: toErrorMessage(error),
      })
      throw error
    }
  }

  private async connectWithPlannerSync(options: {
    requestedHost?: string
    trigger: 'connect' | 'auto-reconnect'
    action: string
    startNewSession: boolean
    allowDiscoveryFallback: boolean
  }): Promise<DesktopStatus> {
    const requestedHost = options.requestedHost?.trim() || undefined

    if (options.startNewSession || !this.recorder.getState().active) {
      await this.recorder.startSession({
        requestedHost: requestedHost ?? 'discovery',
        trigger: options.trigger,
      })
    }
    this.syncRecordingState()

    const activeSite = await this.getActiveSite()

    return this.recordCommand(
      options.action,
      { host: requestedHost, activeSiteId: activeSite?.id },
      async () => {
        this.disconnectDevice()

        let discovery = createPlannerDiscoveryState({
          requestedHost,
          mode: requestedHost ? 'direct' : 'discovered',
        })

        try {
          if (!requestedHost) {
            const resolved = await this.resolveDiscoveredHost(
              undefined,
              'discovered',
            )
            discovery = resolved.discovery
            return await this.connectResolvedHost(
              resolved.host,
              options.trigger,
              activeSite,
              discovery,
            )
          }

          return await this.connectResolvedHost(
            requestedHost,
            options.trigger,
            activeSite,
            discovery,
          )
        } catch (error) {
          const primaryError = toErrorMessage(error)

          if (requestedHost && options.allowDiscoveryFallback) {
            try {
              const fallback = await this.resolveDiscoveredHost(
                requestedHost,
                'fallback',
                primaryError,
              )
              return await this.connectResolvedHost(
                fallback.host,
                options.trigger,
                activeSite,
                fallback.discovery,
              )
            } catch (fallbackError) {
              return await this.handleConnectFailure({
                error: fallbackError,
                host: requestedHost,
                activeSite,
                trigger: options.trigger,
                startNewSession: options.startNewSession,
                discovery: createPlannerDiscoveryState({
                  requestedHost,
                  mode: 'fallback',
                  lastError: `${primaryError}; ${toErrorMessage(fallbackError)}`,
                }),
              })
            }
          }

          return await this.handleConnectFailure({
            error,
            host: requestedHost,
            activeSite,
            trigger: options.trigger,
            startNewSession: options.startNewSession,
            discovery,
          })
        }
      },
    )
  }

  private async connectResolvedHost(
    host: string,
    trigger: 'connect' | 'auto-reconnect',
    activeSite: SiteProfile | undefined,
    discovery: DesktopPlannerDiscoveryState,
  ): Promise<DesktopStatus> {
    const device = this.createDevice(host)

    await device.connect()
    const authenticated = await device.authenticate()
    if (!authenticated) {
      device.disconnect()
      throw new Error(
        'Authentication failed. Verify the PEM key and device firmware.',
      )
    }

    this.device = device
    this.reconnectInFlight = false
    this.reconnectAttempt = 0

    const beforeSync = await this.collectPlannerTelemetry(device)
    const syncAttempt = await this.syncPlannerState(
      device,
      activeSite,
      beforeSync,
    )
    const afterSync = await this.collectPlannerTelemetry(device)
    const planner = buildPlannerHealth({
      discovery: {
        ...discovery,
        resolvedHost: host,
        lastAttemptAt: new Date().toISOString(),
      },
      activeSite,
      telemetry: afterSync,
      clockAttempted: syncAttempt.clockAttempted,
      clockSynced: syncAttempt.clockSynced,
      clockSyncedAt: syncAttempt.clockSyncedAt,
      clockHostTime: syncAttempt.clockHostTime,
      clockError: syncAttempt.clockError,
      clockStaleBeforeSync: beforeSync.deviceTimeLooksStale,
      locationAttempted: syncAttempt.locationAttempted,
      locationSynced: syncAttempt.locationSynced,
      locationSyncedAt: syncAttempt.locationSyncedAt,
      locationError: syncAttempt.locationError,
    })

    this.status = {
      connected: true,
      authenticated: true,
      host,
      deviceState: afterSync.deviceState,
      viewState: afterSync.viewState,
      preview: createDefaultPreviewState(),
      recording: this.recorder.getState(),
      reconnect: createDefaultReconnectState(),
      planner,
      runner: { ...this.status.runner },
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus(
      trigger === 'auto-reconnect'
        ? 'reconnect.completed'
        : 'connect.completed',
    )
    return this.getStatus()
  }

  private async handleConnectFailure(input: {
    error: unknown
    host: string | undefined
    activeSite: SiteProfile | undefined
    trigger: 'connect' | 'auto-reconnect'
    startNewSession: boolean
    discovery: DesktopPlannerDiscoveryState
  }): Promise<DesktopStatus> {
    this.reconnectInFlight = false
    this.status = {
      connected: false,
      authenticated: false,
      host: input.host,
      deviceState: null,
      viewState: null,
      preview: createDefaultPreviewState(),
      recording: this.recorder.getState(),
      reconnect: this.status.reconnect.active
        ? {
            ...this.status.reconnect,
            host: input.host,
            lastError: toErrorMessage(input.error),
          }
        : createDefaultReconnectState(),
      planner: buildPlannerFailureHealth(
        input.activeSite,
        input.discovery,
        input.error,
      ),
      runner: { ...this.status.runner },
      lastError: toErrorMessage(input.error),
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus(
      input.trigger === 'auto-reconnect'
        ? 'reconnect.failed'
        : 'connect.failed',
    )
    if (input.startNewSession) {
      await this.finishRecording(
        input.trigger === 'auto-reconnect'
          ? 'reconnect.failed'
          : 'connect.failed',
      )
    }
    throw input.error
  }

  private async resolveDiscoveredHost(
    requestedHost: string | undefined,
    mode: DesktopPlannerDiscoveryState['mode'],
    lastError?: string,
  ): Promise<{ host: string; discovery: DesktopPlannerDiscoveryState }> {
    let discovered: DesktopDiscoveredDevice[] = []

    for (let attempt = 1; attempt <= DISCOVERY_RETRY_ATTEMPTS; attempt += 1) {
      discovered = await this.discover()
      if (discovered.length > 0) {
        break
      }
      if (attempt < DISCOVERY_RETRY_ATTEMPTS) {
        await delay(DISCOVERY_RETRY_DELAY_MS)
      }
    }

    if (discovered.length === 0) {
      throw new Error(
        requestedHost
          ? `Could not discover a Seestar after ${requestedHost} failed`
          : 'No Seestar devices were discovered on the network',
      )
    }

    const selected =
      discovered.find((device) => device.host === requestedHost) ??
      discovered[0]
    return {
      host: selected.host,
      discovery: createPlannerDiscoveryState({
        attempted: true,
        mode,
        requestedHost,
        resolvedHost: selected.host,
        candidateCount: discovered.length,
        lastAttemptAt: new Date().toISOString(),
        lastError,
      }),
    }
  }

  private async getActiveSite(): Promise<SiteProfile | undefined> {
    return this.planningContext.getActiveSite()
  }

  private async collectPlannerTelemetry(
    device: SeestarDevice,
  ): Promise<PlannerTelemetry> {
    const [deviceState, viewState, rawTime] = await Promise.all([
      device.getDeviceState(),
      device.getViewState(),
      device.getTime(),
    ])

    const nextDeviceState = (deviceState ?? null) as Record<
      string,
      unknown
    > | null
    return {
      deviceState: nextDeviceState,
      viewState: (viewState ?? null) as Record<string, unknown> | null,
      deviceTime: readDeviceTime(rawTime),
      deviceTimeLooksStale: isDeviceTimeStale(readDeviceTime(rawTime)),
      deviceLocation: readDeviceLocation(nextDeviceState?.location_lon_lat),
    }
  }

  private async syncPlannerState(
    device: SeestarDevice,
    activeSite: SiteProfile | undefined,
    beforeSync: PlannerTelemetry,
  ): Promise<PlannerSyncAttempt> {
    const now = new Date()
    const timeZone = activeSite?.timezone ?? resolveHostTimeZone()
    const hostTime = toDesktopDeviceTime(now, timeZone)
    const syncAttempt: PlannerSyncAttempt = {
      clockAttempted: true,
      clockSynced: false,
      clockHostTime: hostTime,
      clockStaleBeforeSync: beforeSync.deviceTimeLooksStale,
      locationAttempted: Boolean(activeSite),
      locationSynced: false,
    }

    try {
      const ok = await device.setTime(now, timeZone)
      if (!ok) {
        syncAttempt.clockError = 'Device rejected time sync'
      } else {
        syncAttempt.clockSynced = true
        syncAttempt.clockSyncedAt = new Date().toISOString()
      }
    } catch (error) {
      syncAttempt.clockError = toErrorMessage(error)
    }

    if (!activeSite) {
      syncAttempt.locationError = 'No active site selected for planner sync'
      return syncAttempt
    }

    try {
      const ok = await device.setUserLocation(activeSite.lat, activeSite.lon)
      if (!ok) {
        syncAttempt.locationError = 'Device rejected location update'
      } else {
        syncAttempt.locationSynced = true
        syncAttempt.locationSyncedAt = new Date().toISOString()
      }
    } catch (error) {
      syncAttempt.locationError = toErrorMessage(error)
    }

    return syncAttempt
  }

  private createDevice(host: string): SeestarDevice {
    return new SeestarDevice({
      host,
      pemPath: this.resolvePemPath(),
      timeoutMs: 10000,
      discoveryTimeoutMs: 2500,
      traceProtocol: false,
      logger: this.logger,
    })
  }

  private async handleUnexpectedDisconnect(event: LogEvent): Promise<void> {
    const host = this.status.host?.trim()

    if (!host || this.manualDisconnectRequested) {
      await this.finishRecording(event.event)
      return
    }

    this.scheduleAutoReconnect(host, event.error ?? event.summary)
  }

  private scheduleAutoReconnect(host: string, lastError?: string): void {
    if (
      this.reconnectTimer ||
      this.reconnectInFlight ||
      this.manualDisconnectRequested
    ) {
      return
    }

    if (this.reconnectAttempt >= AUTO_RECONNECT_MAX_ATTEMPTS) {
      this.status = {
        ...this.status,
        reconnect: {
          active: false,
          attempt: this.reconnectAttempt,
          host,
          lastError: lastError ?? this.status.lastError,
        },
      }
      this.emitStatus('reconnect.exhausted')
      void this.finishRecording('reconnect.exhausted')
      return
    }

    this.reconnectAttempt += 1
    const nextRetryAt = new Date(
      Date.now() + AUTO_RECONNECT_DELAY_MS,
    ).toISOString()
    this.status = {
      ...this.status,
      reconnect: {
        active: true,
        attempt: this.reconnectAttempt,
        host,
        nextRetryAt,
        lastError: lastError ?? this.status.lastError,
      },
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus('reconnect.scheduled')

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.runAutoReconnect(host)
    }, AUTO_RECONNECT_DELAY_MS)
  }

  private async runAutoReconnect(host: string): Promise<void> {
    if (this.manualDisconnectRequested) {
      this.clearReconnectState()
      return
    }

    this.reconnectInFlight = true
    this.status = {
      ...this.status,
      reconnect: {
        ...this.status.reconnect,
        active: true,
        attempt: this.reconnectAttempt,
        host,
        nextRetryAt: undefined,
      },
      lastUpdatedAt: new Date().toISOString(),
    }
    this.emitStatus('reconnect.started')

    try {
      await this.connectWithPlannerSync({
        requestedHost: host,
        trigger: 'auto-reconnect',
        action: 'auto-reconnect',
        startNewSession: false,
        allowDiscoveryFallback: true,
      })

      if (
        this.restorePreviewAfterReconnect &&
        this.readViewMode() === 'scenery' &&
        !this.status.preview.active
      ) {
        try {
          await this.startPreview()
        } catch (error) {
          this.status = {
            ...this.status,
            lastError: `Reconnected, but could not restore preview: ${toErrorMessage(error)}`,
            lastUpdatedAt: new Date().toISOString(),
          }
          this.emitStatus('reconnect.preview-restore.failed')
        }
      }
    } catch (error) {
      this.reconnectInFlight = false
      this.scheduleAutoReconnect(host, toErrorMessage(error))
    } finally {
      this.reconnectInFlight = false
    }
  }

  private clearReconnectState(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.reconnectAttempt = 0
    this.reconnectInFlight = false
    this.status = {
      ...this.status,
      reconnect: createDefaultReconnectState(),
    }
  }
}

interface PlannerTelemetry {
  deviceState: Record<string, unknown> | null
  viewState: Record<string, unknown> | null
  deviceTime?: DesktopDeviceTime
  deviceTimeLooksStale: boolean
  deviceLocation?: { lat: number; lon: number }
}

interface PlannerSyncAttempt {
  clockAttempted: boolean
  clockSynced: boolean
  clockHostTime?: DesktopDeviceTime
  clockSyncedAt?: string
  clockError?: string
  clockStaleBeforeSync: boolean
  locationAttempted: boolean
  locationSynced: boolean
  locationSyncedAt?: string
  locationError?: string
}

function createDefaultPreviewState(): DesktopPreviewState {
  return {
    active: false,
    mode: PREVIEW_MODE,
  }
}

function createDefaultRecordingState() {
  return {
    active: false,
  }
}

function createDefaultReconnectState(): DesktopReconnectState {
  return {
    active: false,
    attempt: 0,
  }
}

function createDefaultPlannerHealth(): DesktopPlannerHealth {
  return {
    ready: false,
    discovery: createPlannerDiscoveryState({ mode: 'direct' }),
    clock: {
      attempted: false,
      synced: false,
      staleBeforeSync: false,
    },
    location: {
      attempted: false,
      synced: false,
      matchesActiveSite: false,
    },
    issues: [],
  }
}

function createPlannerDiscoveryState(input: {
  attempted?: boolean
  mode: DesktopPlannerDiscoveryState['mode']
  requestedHost?: string
  resolvedHost?: string
  candidateCount?: number
  lastAttemptAt?: string
  lastError?: string
}): DesktopPlannerDiscoveryState {
  return {
    attempted:
      input.attempted ??
      (Boolean(input.requestedHost) || input.mode !== 'direct'),
    mode: input.mode,
    requestedHost: input.requestedHost,
    resolvedHost: input.resolvedHost,
    candidateCount: input.candidateCount,
    lastAttemptAt: input.lastAttemptAt,
    lastError: input.lastError,
  }
}

function clonePlannerHealth(
  planner: DesktopPlannerHealth,
): DesktopPlannerHealth {
  return {
    ...planner,
    activeSite: planner.activeSite ? { ...planner.activeSite } : undefined,
    discovery: { ...planner.discovery },
    clock: {
      ...planner.clock,
      deviceTime: planner.clock.deviceTime
        ? { ...planner.clock.deviceTime }
        : undefined,
      hostTime: planner.clock.hostTime
        ? { ...planner.clock.hostTime }
        : undefined,
    },
    location: {
      ...planner.location,
      deviceLocation: planner.location.deviceLocation
        ? { ...planner.location.deviceLocation }
        : undefined,
      targetLocation: planner.location.targetLocation
        ? { ...planner.location.targetLocation }
        : undefined,
    },
    issues: [...planner.issues],
  }
}

function buildRtspUrl(host: string): string {
  return `rtsp://${host}:4554/stream`
}

function describePreviewExit(
  code: number | null,
  signal: NodeJS.Signals | null,
  stderr: string | undefined,
): string {
  if (stderr) return stderr
  if (signal) return `RTSP preview stopped (${signal})`
  if (typeof code === 'number') return `RTSP preview exited with code ${code}`
  return 'RTSP preview ended unexpectedly'
}

function toDesktopLogEntry(event: LogEvent): DesktopLogEntry {
  return {
    ts: event.ts,
    level: event.level,
    event: event.event,
    component: event.component,
    summary: formatLogSummary(event),
    details: formatLogDetails(event),
    error: event.error,
    host: event.host,
    data: event.data,
  }
}

function formatLogSummary(event: LogEvent): string | undefined {
  const data = asRecord(event.data)
  const pushEventName = asString(data?.eventName)

  switch (event.event) {
    case 'rpc.request.sent':
      return describeRpcSummary('Sent', event.method, event.rpcId, 'request')
    case 'rpc.response.received':
      return describeRpcSummary(
        'Received',
        event.method,
        event.rpcId,
        'response',
      )
    case 'rpc.request.timeout':
      return describeRpcTimeout(event.method, event.rpcId)
    case 'rpc.request.disconnected':
      return describeRpcDisconnect(event.method, event.rpcId)
    case 'rpc.push.received':
      return pushEventName
        ? `Received ${pushEventName} device event`
        : event.summary
    case 'rpc.push.wait.started':
      return pushEventName
        ? `Waiting for ${pushEventName} device event`
        : event.summary
    case 'rpc.push.wait.matched':
      return pushEventName
        ? `Matched ${pushEventName} device event`
        : event.summary
    case 'rpc.push.wait.timeout':
      return pushEventName
        ? `Timed out waiting for ${pushEventName} device event`
        : event.summary
    case 'auth.challenge.received': {
      const challengeLength = asNumber(data?.challengeLength)
      return challengeLength === undefined
        ? event.summary
        : `Received authentication challenge (${challengeLength} chars)`
    }
    default:
      return event.summary
  }
}

function formatLogDetails(event: LogEvent): string | undefined {
  const data = asRecord(event.data)
  const details: string[] = []
  const code = asNumber(data?.code)

  if (event.method) {
    details.push(`method ${event.method}`)
  }
  if (typeof event.rpcId === 'number') {
    details.push(`rpc #${event.rpcId}`)
  }
  if (code !== undefined) {
    details.push(`code ${code}`)
  }
  if (typeof event.durationMs === 'number') {
    details.push(`${event.durationMs} ms`)
  }

  const pushEventName = asString(data?.eventName)
  if (pushEventName) {
    details.push(`event ${pushEventName}`)
  }

  const pushState = asString(data?.state)
  if (pushState) {
    details.push(`state ${pushState}`)
  }

  const pushError = asString(data?.error)
  if (pushError) {
    details.push(`error ${pushError}`)
  }

  const challengeLength = asNumber(data?.challengeLength)
  if (
    challengeLength !== undefined &&
    event.event !== 'auth.challenge.received'
  ) {
    details.push(`challenge ${challengeLength} chars`)
  }

  return details.length > 0 ? details.join(' • ') : undefined
}

function describeRpcSummary(
  verb: 'Sent' | 'Received',
  method: string | undefined,
  rpcId: number | undefined,
  noun: 'request' | 'response',
): string {
  const name = method ? `${method} ${noun}` : `RPC ${noun}`
  return typeof rpcId === 'number'
    ? `${verb} ${name} (#${rpcId})`
    : `${verb} ${name}`
}

function describeRpcTimeout(
  method: string | undefined,
  rpcId: number | undefined,
): string {
  const name = method ? `${method} RPC response` : 'RPC response'
  return typeof rpcId === 'number'
    ? `Timed out waiting for ${name} (#${rpcId})`
    : `Timed out waiting for ${name}`
}

function describeRpcDisconnect(
  method: string | undefined,
  rpcId: number | undefined,
): string {
  const name = method ? `${method} RPC response` : 'RPC response'
  return typeof rpcId === 'number'
    ? `Connection closed while waiting for ${name} (#${rpcId})`
    : `Connection closed while waiting for ${name}`
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isViewActive(viewState: unknown): boolean {
  const view = asRecord(asRecord(viewState)?.View)
  const mode = asString(view?.mode)
  return Boolean(mode && mode !== 'none' && asString(view?.state) !== 'cancel')
}

function isStackActive(viewState: unknown): boolean {
  const view = asRecord(asRecord(viewState)?.View)
  return asString(view?.stage) === 'Stack' && asString(view?.state) !== 'cancel'
}

function buildPlannerHealth(input: {
  discovery: DesktopPlannerDiscoveryState
  activeSite: SiteProfile | undefined
  telemetry: PlannerTelemetry
  clockAttempted: boolean
  clockSynced: boolean
  clockSyncedAt?: string
  clockHostTime?: DesktopDeviceTime
  clockError?: string
  clockStaleBeforeSync: boolean
  locationAttempted: boolean
  locationSynced: boolean
  locationSyncedAt?: string
  locationError?: string
}): DesktopPlannerHealth {
  const activeSite = input.activeSite
    ? toPlannerSiteContext(input.activeSite)
    : undefined
  const locationMatchesActiveSite = Boolean(
    input.activeSite &&
    input.telemetry.deviceLocation &&
    locationsMatch(input.telemetry.deviceLocation, input.activeSite),
  )
  const issues = input.activeSite
    ? evaluateSiteDiagnostics(input.activeSite).map(
        (diagnostic) => `${diagnostic.summary} ${diagnostic.repairHint}`,
      )
    : []

  if (!input.activeSite) {
    issues.push('No active site selected for planner sync')
  }
  if (!input.telemetry.deviceTime) {
    issues.push('Device time is unavailable after connect')
  } else if (input.telemetry.deviceTimeLooksStale) {
    issues.push(
      `Device clock remains stale at ${formatDesktopDeviceTime(input.telemetry.deviceTime)}`,
    )
  }
  if (input.clockError && input.telemetry.deviceTimeLooksStale) {
    issues.push(`Clock sync failed: ${input.clockError}`)
  }
  if (input.activeSite && !input.telemetry.deviceLocation) {
    issues.push('Device location is unavailable after connect')
  }
  if (
    input.activeSite &&
    input.telemetry.deviceLocation &&
    !locationMatchesActiveSite
  ) {
    issues.push(
      `Device location does not match active site ${input.activeSite.name}`,
    )
  }
  if (input.locationError && input.activeSite && !locationMatchesActiveSite) {
    issues.push(`Location sync failed: ${input.locationError}`)
  }

  return {
    ready: issues.length === 0,
    activeSite,
    discovery: { ...input.discovery },
    clock: {
      attempted: input.clockAttempted,
      synced:
        !input.telemetry.deviceTimeLooksStale &&
        (input.clockSynced || !input.clockStaleBeforeSync),
      staleBeforeSync: input.clockStaleBeforeSync,
      deviceTime: input.telemetry.deviceTime,
      hostTime: input.clockHostTime,
      lastSyncedAt: input.clockSyncedAt,
      lastError: input.clockError,
    },
    location: {
      attempted: input.locationAttempted,
      synced:
        Boolean(input.activeSite) &&
        locationMatchesActiveSite &&
        (input.locationSynced || !input.locationAttempted),
      matchesActiveSite: locationMatchesActiveSite,
      targetLocation: input.activeSite
        ? { lat: input.activeSite.lat, lon: input.activeSite.lon }
        : undefined,
      deviceLocation: input.telemetry.deviceLocation,
      lastSyncedAt: input.locationSyncedAt,
      lastError: input.locationError,
    },
    issues,
    lastCheckedAt: new Date().toISOString(),
  }
}

function buildPlannerFailureHealth(
  activeSite: SiteProfile | undefined,
  discovery: DesktopPlannerDiscoveryState,
  error: unknown,
): DesktopPlannerHealth {
  const siteIssues = activeSite
    ? evaluateSiteDiagnostics(activeSite).map(
        (diagnostic) => `${diagnostic.summary} ${diagnostic.repairHint}`,
      )
    : []

  return {
    ...createDefaultPlannerHealth(),
    activeSite: activeSite ? toPlannerSiteContext(activeSite) : undefined,
    discovery: {
      ...discovery,
      lastError: toErrorMessage(error),
      lastAttemptAt: new Date().toISOString(),
    },
    issues: [...siteIssues, toErrorMessage(error)],
    lastCheckedAt: new Date().toISOString(),
  }
}

function toPlannerSiteContext(
  site: SiteProfile,
): DesktopPlannerHealth['activeSite'] {
  return {
    id: site.id,
    name: site.name,
    lat: site.lat,
    lon: site.lon,
    timezone: site.timezone,
  }
}

function readDeviceTime(value: unknown): DesktopDeviceTime | undefined {
  const record = asRecord(value)
  const year = asNumber(record?.year)
  const mon = asNumber(record?.mon)
  const day = asNumber(record?.day)
  const hour = asNumber(record?.hour)
  const min = asNumber(record?.min)
  const sec = asNumber(record?.sec)
  if (
    typeof year !== 'number' ||
    typeof mon !== 'number' ||
    typeof day !== 'number' ||
    typeof hour !== 'number' ||
    typeof min !== 'number' ||
    typeof sec !== 'number'
  ) {
    return undefined
  }

  return {
    year,
    mon,
    day,
    hour,
    min,
    sec,
    timeZone: asString(record?.time_zone),
  }
}

function isDeviceTimeStale(time: DesktopDeviceTime | undefined): boolean {
  if (!time) return false
  return time.year < new Date().getFullYear() - 1
}

function formatDesktopDeviceTime(time: DesktopDeviceTime): string {
  return (
    [
      String(time.year).padStart(4, '0'),
      String(time.mon).padStart(2, '0'),
      String(time.day).padStart(2, '0'),
    ].join('-') +
    ` ${[time.hour, time.min, time.sec].map((part) => String(part).padStart(2, '0')).join(':')}${time.timeZone ? ` ${time.timeZone}` : ''}`
  )
}

function readDeviceLocation(
  value: unknown,
): { lat: number; lon: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const lon = asNumber(value[0])
  const lat = asNumber(value[1])
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined
  return { lat, lon }
}

function locationsMatch(
  left: { lat: number; lon: number },
  right: { lat: number; lon: number },
): boolean {
  return (
    Math.abs(left.lat - right.lat) <= 0.001 &&
    Math.abs(left.lon - right.lon) <= 0.001
  )
}

function toDesktopDeviceTime(date: Date, timeZone: string): DesktopDeviceTime {
  return {
    year: date.getFullYear(),
    mon: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    min: date.getMinutes(),
    sec: date.getSeconds(),
    timeZone,
  }
}

function resolveHostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveWorkspaceRoot(startDir: string): string | undefined {
  return walkUpDirectories(startDir, (dir) => {
    return (
      existsSync(path.join(dir, 'apps/desktop/package.json')) &&
      existsSync(path.join(dir, 'sdk/package.json'))
    )
  })
}

function resolveDesktopAppRoot(startDir: string): string {
  return (
    walkUpDirectories(startDir, (dir) => {
      const packageJsonPath = path.join(dir, 'package.json')
      if (!existsSync(packageJsonPath)) return false

      const packageName = readPackageName(packageJsonPath)
      return packageName === 'seestar-desktop'
    }) ?? startDir
  )
}

function resolveDesktopAppVersion(startDir: string): string | undefined {
  const desktopRoot = resolveDesktopAppRoot(startDir)
  const packageJsonPath = path.join(desktopRoot, 'package.json')
  if (!existsSync(packageJsonPath)) return undefined

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      version?: unknown
    }
    return typeof parsed.version === 'string' && parsed.version.length > 0
      ? parsed.version
      : undefined
  } catch {
    return undefined
  }
}

function readPackageName(packageJsonPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown
    }
    return typeof parsed.name === 'string' && parsed.name.length > 0
      ? parsed.name
      : undefined
  } catch {
    return undefined
  }
}

function walkUpDirectories(
  startDir: string,
  predicate: (dir: string) => boolean,
): string | undefined {
  let currentDir = path.resolve(startDir)

  while (true) {
    if (predicate(currentDir)) {
      return currentDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return undefined
    }

    currentDir = parentDir
  }
}
