import { randomUUID } from 'node:crypto'
import { SeestarClient } from './client.js'
import { SeestarAuth } from './auth.js'
import { discoverSeestarHost } from './discovery.js'
import {
  parseAlbums,
  parseEquCoord,
  parseHorizCoord,
  parseDeviceState,
  parseViewState,
  buildImageUrl,
} from './commands.js'
import {
  createJsonlFileLogger,
  createNoopLogger,
  emitLog,
  type Logger,
} from './logging.js'
import { listShareDirectory } from './smb.js'
import { toSeestarLifecycleEvent } from './events.js'
import type {
  ActionWaitOptions,
  AlbumsResult,
  DevelopmentSmokeTestOptions,
  EquCoord,
  DeviceState,
  ViewStateResult,
  ClientConfig,
  ShareEntry,
  StartViewOptions,
  HorizCoord,
  ManualMoveOptions,
  PreflightSummary,
  SeestarPushEvent,
  SeestarLifecycleEvent,
  SeestarSnapshot,
  SeestarViewMode,
  StartupSequenceOptions,
  StartupSequenceReport,
  StartupStepReport,
} from './types.js'

interface SequenceStepLoggers {
  steps: StartupStepReport[]
  report: (ok: boolean) => StartupSequenceReport
  stepStarted: (step: string, summary: string) => void
  stepCompleted: (
    step: string,
    summary: string,
    changed?: boolean,
    data?: unknown,
  ) => void
  stepSkipped: (step: string, summary: string, data?: unknown) => void
  fail: (
    name: string,
    summary: string,
    error?: unknown,
  ) => StartupSequenceReport
}

/**
 * High-level SDK for the ZWO Seestar S30.
 * Manages connection, authentication, and exposes typed command helpers.
 */
export class SeestarDevice {
  private client!: SeestarClient
  private auth!: SeestarAuth
  private host?: string
  private albumPath = 'MyWorks'
  private logger: Logger
  private sessionId = buildSessionId()
  private deviceModel?: string
  private deviceSn?: string
  private startupSequenceCount = 0
  private authenticated = false
  private connectPromise?: Promise<void>
  private authPromise?: Promise<boolean>
  // Serializes state-changing commands and their waits on this instance so
  // overlapping mutations cannot reach the hardware concurrently.
  private mutationChain: Promise<void> = Promise.resolve()
  // Terminal close flag. Set by disconnect() so queued mutations and
  // ensureAuthenticated reject before send instead of silently reconnecting a
  // session the caller intended to close.
  private closed = false

  constructor(private config: ClientConfig) {
    this.host = config.host
    this.logger =
      config.logger ??
      (config.logPath
        ? createJsonlFileLogger(config.logPath, config.logLevel ?? 'debug')
        : createNoopLogger())

    this.log({
      level: 'info',
      event: 'session.started',
      component: 'session',
      phase: 'connect',
      summary: 'SDK session started',
      data: {
        hasExplicitHost: Boolean(config.host),
        timeoutMs: config.timeoutMs,
        discoveryTimeoutMs: config.discoveryTimeoutMs,
        traceProtocol: config.traceProtocol ?? false,
        logPath: config.logPath,
      },
    })

    if (this.host) this.configureClient(this.host)
  }

  async connect(): Promise<void> {
    if (this.closed) throw new Error('Seestar session is closed')
    if (this.isConnected()) return
    if (this.connectPromise) return this.connectPromise
    const promise = (async () => {
      this.authenticated = false
      if (!this.host) {
        this.host = await discoverSeestarHost({
          timeoutMs: this.config.discoveryTimeoutMs,
          logger: this.logger,
          sessionId: this.sessionId,
        })
        // Recheck closed after discovery: a disconnect during discovery must
        // not continue to configure/connect.
        if (this.closed) throw new Error('Seestar session is closed')
        this.configureClient(this.host)
      }
      await this.client.connect().catch((error) => {
        // If closed during connect, the socket destruction rejects
        // client.connect() with "Client disconnected". Recheck closed so
        // the caller sees "session is closed" instead of a transport error.
        if (this.closed) throw new Error('Seestar session is closed')
        throw error
      })
      // Recheck closed after client.connect(): a disconnect during connect
      // must disconnect the newly connected client and throw.
      if (this.closed) {
        this.client.disconnect()
        throw new Error('Seestar session is closed')
      }
    })()
    this.connectPromise = promise
    try {
      await promise
    } finally {
      if (this.connectPromise === promise) this.connectPromise = undefined
    }
  }

  async authenticate(): Promise<boolean> {
    if (this.closed) throw new Error('Seestar session is closed')
    if (this.isConnected() && this.authenticated) return true
    if (this.authPromise) return this.authPromise
    const promise = (async () => {
      if (this.closed) throw new Error('Seestar session is closed')
      const authenticated = await this.auth.authenticate()
      if (this.closed) throw new Error('Seestar session is closed')
      this.authenticated = authenticated
      return authenticated
    })()
    this.authPromise = promise
    try {
      return await promise
    } finally {
      if (this.authPromise === promise) this.authPromise = undefined
    }
  }

  async connectAndAuth(): Promise<boolean> {
    if (this.closed) throw new Error('Seestar session is closed')
    await this.connect()
    if (this.closed) throw new Error('Seestar session is closed')
    return this.authenticate()
  }

  disconnect(): void {
    this.closed = true
    this.authenticated = false
    this.connectPromise = undefined
    this.authPromise = undefined
    this.client?.disconnect()
    this.log({
      level: 'info',
      event: 'session.ended',
      component: 'session',
      summary: 'SDK session ended',
    })
  }

  isConnected(): boolean {
    return this.client ? this.client.isConnected() : false
  }

  // --- Read-only commands ---

  async testConnection(): Promise<boolean> {
    const resp = await this.client.sendSync('test_connection', '')
    return resp.code === 0
  }

  async getDeviceState(keys?: string[]): Promise<DeviceState | null> {
    const resp = await this.client.sendSync(
      'get_device_state',
      keys ? { keys } : '',
    )
    return parseDeviceState(resp)
  }

  async getEquCoord(): Promise<EquCoord | null> {
    const resp = await this.client.sendSync('scope_get_equ_coord', '')
    return parseEquCoord(resp)
  }

  async getHorizCoord(): Promise<HorizCoord | null> {
    const resp = await this.client.sendSync('scope_get_horiz_coord', '')
    return parseHorizCoord(resp)
  }

  async getViewState(): Promise<ViewStateResult | null> {
    const resp = await this.client.sendSync('get_view_state', '')
    return parseViewState(resp)
  }

  async getSnapshot(): Promise<SeestarSnapshot> {
    const [deviceState, viewState] = await Promise.all([
      this.getDeviceState(),
      this.getViewState(),
    ])
    return { deviceState, viewState }
  }

  subscribeToLifecycleEvents(
    listener: (event: SeestarLifecycleEvent) => void,
  ): () => void {
    return this.rawClient.subscribeToPushEvents((event) => {
      const lifecycleEvent = toSeestarLifecycleEvent(event)
      if (lifecycleEvent) listener(lifecycleEvent)
    })
  }

  async getSetting(): Promise<unknown> {
    const resp = await this.client.sendSync('get_setting', '')
    return resp.result
  }

  async getDiskVolume(): Promise<unknown> {
    const resp = await this.client.sendSync('get_disk_volume', '')
    return resp.result
  }

  async getPiInfo(): Promise<unknown> {
    const resp = await this.client.sendSync('pi_get_info', '')
    return resp.result
  }

  async getTime(): Promise<unknown> {
    const resp = await this.client.sendSync('pi_get_time', '')
    return resp.result
  }

  async preflightCheck(): Promise<PreflightSummary> {
    this.log({
      level: 'info',
      event: 'preflight.started',
      component: 'preflight',
      phase: 'preflight',
      summary: 'Starting preflight check',
    })
    await this.ensureAuthenticated()
    const summary = await this.collectPreflightSummary()
    this.log({
      level: 'info',
      event: 'preflight.completed',
      component: 'preflight',
      phase: 'preflight',
      summary: 'Completed preflight check',
      data: { warningCount: summary.warnings.length },
    })
    return summary
  }

  async developmentSmokeTest(
    options: DevelopmentSmokeTestOptions = {},
  ): Promise<StartupSequenceReport> {
    const dryRun = options.dryRun ?? false
    const mode = options.mode ?? 'scenery'
    const openArm = options.openArm ?? 'if_needed'
    const parkAtEnd = options.parkAtEnd ?? true
    const steps: StartupStepReport[] = []
    const warnings: string[] = []
    let preflight: PreflightSummary | undefined
    const sequenceId = `dev_smoke_${String(++this.startupSequenceCount).padStart(2, '0')}`

    const loggers = this.createSequenceStepLoggers(
      'smoke',
      'Development smoke test',
      sequenceId,
      dryRun,
      steps,
      warnings,
      () => preflight,
    )
    const { report, stepStarted, stepCompleted, stepSkipped, fail } = loggers

    this.log({
      level: 'info',
      event: 'smoke.sequence.started',
      component: 'smoke',
      phase: 'startup',
      sequenceId,
      summary: 'Starting development smoke test',
      data: { dryRun, mode, openArm, parkAtEnd },
    })

    const connectFailure = await this.runSequenceConnectStep(loggers)
    if (connectFailure) return connectFailure

    const preflightResult = await this.runSequencePreflightStep(
      loggers,
      warnings,
    )
    if (!preflightResult.ok) return preflightResult.report
    preflight = preflightResult.summary

    if (preflight && isViewActive(preflight)) {
      return fail(
        'preflight',
        `Device is already busy in ${preflight.viewMode ?? 'unknown'}/${preflight.viewStage ?? 'unknown'}`,
      )
    }

    if (openArm === 'never' && preflight?.mountClosed) {
      return fail('open_arm', 'Mount is closed and openArm is set to never')
    }

    const shouldOpenArm =
      openArm === 'always' ||
      (openArm === 'if_needed' && preflight?.mountClosed === true)

    if (shouldOpenArm) {
      if (dryRun) {
        steps.push({
          name: 'open_arm',
          ok: true,
          skipped: true,
          summary: 'Would move the arm to the horizon position',
        })
        stepSkipped('open_arm', 'Would move the arm to the horizon position')
      } else {
        try {
          stepStarted('open_arm', 'Moving the arm to the horizon position')
          const ok = await this.moveToHorizon({
            waitForCompletion: true,
            timeoutMs: 45000,
            pollIntervalMs: 500,
          })
          if (!ok)
            return fail('open_arm', 'Device rejected move-to-horizon request')
          steps.push({
            name: 'open_arm',
            ok: true,
            changed: true,
            summary: 'Moved the arm to the horizon position',
          })
          stepCompleted(
            'open_arm',
            'Moved the arm to the horizon position',
            true,
          )
        } catch (error) {
          return fail('open_arm', 'Failed to move the arm to horizon', error)
        }
      }
    } else {
      steps.push({
        name: 'open_arm',
        ok: true,
        skipped: true,
        summary: 'Arm already ready for development smoke test',
      })
      stepSkipped('open_arm', 'Arm already ready for development smoke test')
    }

    if (dryRun) {
      steps.push({
        name: 'start_view',
        ok: true,
        skipped: true,
        summary: describeStartView(mode, undefined, false),
      })
      stepSkipped('start_view', describeStartView(mode, undefined, false))
    } else {
      try {
        stepStarted('start_view', describeStartView(mode, undefined, false))
        const ok = await this.startViewDetailed(
          { mode },
          { waitForCompletion: true, timeoutMs: 30000, pollIntervalMs: 500 },
        )
        if (!ok) return fail('start_view', 'Device rejected start-view request')
        steps.push({
          name: 'start_view',
          ok: true,
          changed: true,
          summary: describeStartView(mode, undefined, false),
        })
        stepCompleted(
          'start_view',
          describeStartView(mode, undefined, false),
          true,
        )
      } catch (error) {
        return fail('start_view', 'Failed to start development view', error)
      }
    }

    if (dryRun) {
      steps.push({
        name: 'stop_view',
        ok: true,
        skipped: true,
        summary: 'Would stop development view',
      })
      stepSkipped('stop_view', 'Would stop development view')
    } else {
      try {
        stepStarted('stop_view', 'Stopping development view')
        const ok = await this.stopView(undefined, {
          waitForCompletion: true,
          timeoutMs: 30000,
          pollIntervalMs: 500,
        })
        if (!ok) return fail('stop_view', 'Device rejected stop-view request')
        steps.push({
          name: 'stop_view',
          ok: true,
          changed: true,
          summary: 'Stopped development view',
        })
        stepCompleted('stop_view', 'Stopped development view', true)
      } catch (error) {
        return fail('stop_view', 'Failed to stop development view', error)
      }
    }

    if (!parkAtEnd) {
      steps.push({
        name: 'park',
        ok: true,
        skipped: true,
        summary: 'Left mount open after development smoke test',
      })
      stepSkipped('park', 'Left mount open after development smoke test')
    } else if (dryRun) {
      steps.push({
        name: 'park',
        ok: true,
        skipped: true,
        summary: 'Would park mount after development smoke test',
      })
      stepSkipped('park', 'Would park mount after development smoke test')
    } else {
      try {
        stepStarted('park', 'Parking mount after development smoke test')
        const ok = await this.parkWithRetries({
          waitForCompletion: true,
          timeoutMs: 45000,
          pollIntervalMs: 500,
        })
        if (!ok) return fail('park', 'Device rejected park request')
        steps.push({
          name: 'park',
          ok: true,
          changed: true,
          summary: 'Parked mount after development smoke test',
        })
        stepCompleted('park', 'Parked mount after development smoke test', true)
      } catch (error) {
        return fail(
          'park',
          'Failed to park after development smoke test',
          error,
        )
      }
    }

    this.log({
      level: 'info',
      event: 'smoke.sequence.completed',
      component: 'smoke',
      phase: 'startup',
      sequenceId,
      ok: true,
      summary: 'Development smoke test completed',
      data: { warningCount: warnings.length, dryRun, mode, parkAtEnd },
    })

    return report(true)
  }

  async startupSequence(
    options: StartupSequenceOptions = {},
  ): Promise<StartupSequenceReport> {
    const dryRun = options.dryRun ?? false
    const syncTime = options.syncTime ?? true
    const mode = options.mode ?? 'star'
    const openArm = options.openArm ?? 'if_needed'
    const autofocus = options.autofocus ?? 'off'
    const observation = options.observation ?? {}
    const observationKind = observation.kind ?? 'preview'
    const steps: StartupStepReport[] = []
    const warnings: string[] = []
    let preflight: PreflightSummary | undefined
    const sequenceId = `startup_${String(++this.startupSequenceCount).padStart(2, '0')}`

    const loggers = this.createSequenceStepLoggers(
      'startup',
      'Startup sequence',
      sequenceId,
      dryRun,
      steps,
      warnings,
      () => preflight,
    )
    const { report, stepStarted, stepCompleted, stepSkipped, fail } = loggers

    this.log({
      level: 'info',
      event: 'startup.sequence.started',
      component: 'startup',
      phase: 'startup',
      sequenceId,
      summary: 'Starting startup sequence',
      data: {
        dryRun,
        mode,
        syncTime,
        syncLocation: options.syncLocation,
        openArm,
        autofocus,
        target: options.target,
        observation,
      },
    })

    const connectFailure = await this.runSequenceConnectStep(loggers)
    if (connectFailure) return connectFailure

    const preflightResult = await this.runSequencePreflightStep(
      loggers,
      warnings,
    )
    if (!preflightResult.ok) return preflightResult.report
    preflight = preflightResult.summary

    if (preflight && isViewActive(preflight)) {
      return fail(
        'preflight',
        `Device is already busy in ${preflight.viewMode ?? 'unknown'}/${preflight.viewStage ?? 'unknown'}`,
      )
    }

    if (syncTime) {
      if (dryRun) {
        steps.push({
          name: 'sync_time',
          ok: true,
          skipped: true,
          summary: 'Would sync device time from the current host clock',
        })
        stepSkipped(
          'sync_time',
          'Would sync device time from the current host clock',
        )
      } else {
        try {
          stepStarted(
            'sync_time',
            'Syncing device time from the current host clock',
          )
          const ok = await this.setTime()
          if (!ok) return fail('sync_time', 'Device rejected time sync')
          steps.push({
            name: 'sync_time',
            ok: true,
            changed: true,
            summary: 'Synced device time from the current host clock',
          })
          stepCompleted(
            'sync_time',
            'Synced device time from the current host clock',
            true,
          )
        } catch (error) {
          return fail('sync_time', 'Failed to sync device time', error)
        }
      }
    }

    if (options.syncLocation) {
      const { lat, lon } = options.syncLocation
      if (dryRun) {
        steps.push({
          name: 'sync_location',
          ok: true,
          skipped: true,
          summary: `Would set device location to ${lat}, ${lon}`,
        })
        stepSkipped(
          'sync_location',
          `Would set device location to ${lat}, ${lon}`,
        )
      } else {
        try {
          stepStarted(
            'sync_location',
            `Setting device location to ${lat}, ${lon}`,
          )
          const ok = await this.setUserLocation(lat, lon)
          if (!ok)
            return fail('sync_location', 'Device rejected location update')
          steps.push({
            name: 'sync_location',
            ok: true,
            changed: true,
            summary: `Set device location to ${lat}, ${lon}`,
          })
          stepCompleted(
            'sync_location',
            `Set device location to ${lat}, ${lon}`,
            true,
          )
        } catch (error) {
          return fail('sync_location', 'Failed to set device location', error)
        }
      }
    }

    if (observation.settings && Object.keys(observation.settings).length > 0) {
      if (dryRun) {
        steps.push({
          name: 'settings',
          ok: true,
          skipped: true,
          summary: 'Would apply requested observation settings',
          data: observation.settings,
        })
        stepSkipped(
          'settings',
          'Would apply requested observation settings',
          observation.settings,
        )
      } else {
        try {
          stepStarted('settings', 'Applying requested observation settings')
          const ok = await this.setSetting(observation.settings)
          if (!ok)
            return fail('settings', 'Device rejected observation settings')
          steps.push({
            name: 'settings',
            ok: true,
            changed: true,
            summary: 'Applied requested observation settings',
            data: observation.settings,
          })
          stepCompleted(
            'settings',
            'Applied requested observation settings',
            true,
            observation.settings,
          )
        } catch (error) {
          return fail('settings', 'Failed to apply observation settings', error)
        }
      }
    }

    if (typeof observation.filterWheelPosition === 'number') {
      if (dryRun) {
        steps.push({
          name: 'filter_wheel',
          ok: true,
          skipped: true,
          summary: `Would set filter wheel to position ${observation.filterWheelPosition}`,
        })
        stepSkipped(
          'filter_wheel',
          `Would set filter wheel to position ${observation.filterWheelPosition}`,
        )
      } else {
        try {
          stepStarted(
            'filter_wheel',
            `Setting filter wheel to position ${observation.filterWheelPosition}`,
          )
          const ok = await this.setWheelPosition(
            observation.filterWheelPosition,
            {
              waitForCompletion: true,
            },
          )
          if (!ok)
            return fail('filter_wheel', 'Device rejected filter wheel change')
          steps.push({
            name: 'filter_wheel',
            ok: true,
            changed: true,
            summary: `Set filter wheel to position ${observation.filterWheelPosition}`,
          })
          stepCompleted(
            'filter_wheel',
            `Set filter wheel to position ${observation.filterWheelPosition}`,
            true,
          )
        } catch (error) {
          return fail('filter_wheel', 'Failed to set filter wheel', error)
        }
      }
    }

    if (openArm === 'never' && preflight?.mountClosed) {
      return fail('open_arm', 'Mount is closed and openArm is set to never')
    }

    const shouldOpenArm =
      openArm === 'always' ||
      (openArm === 'if_needed' && preflight?.mountClosed === true)

    if (shouldOpenArm) {
      if (dryRun) {
        steps.push({
          name: 'open_arm',
          ok: true,
          skipped: true,
          summary: 'Would move the arm to the horizon position',
        })
        stepSkipped('open_arm', 'Would move the arm to the horizon position')
      } else {
        try {
          stepStarted('open_arm', 'Moving the arm to the horizon position')
          const ok = await this.moveToHorizon({
            waitForCompletion: true,
            timeoutMs: 45000,
            pollIntervalMs: 500,
          })
          if (!ok)
            return fail('open_arm', 'Device rejected move-to-horizon request')
          steps.push({
            name: 'open_arm',
            ok: true,
            changed: true,
            summary: 'Moved the arm to the horizon position',
          })
          stepCompleted(
            'open_arm',
            'Moved the arm to the horizon position',
            true,
          )
        } catch (error) {
          return fail('open_arm', 'Failed to move the arm to horizon', error)
        }
      }
    } else {
      steps.push({
        name: 'open_arm',
        ok: true,
        skipped: true,
        summary: 'Arm already ready for observation',
      })
      stepSkipped('open_arm', 'Arm already ready for observation')
    }

    const targetRaDec = options.target
      ? ([options.target.ra, options.target.dec] as [number, number])
      : undefined
    const targetName =
      options.target?.name ?? (options.target ? 'Unknown' : undefined)

    if (dryRun) {
      steps.push({
        name: 'start_view',
        ok: true,
        skipped: true,
        summary: describeStartView(
          mode,
          targetName,
          observation.lpFilter ?? false,
        ),
      })
      stepSkipped(
        'start_view',
        describeStartView(mode, targetName, observation.lpFilter ?? false),
      )
    } else {
      try {
        stepStarted(
          'start_view',
          describeStartView(mode, targetName, observation.lpFilter ?? false),
        )
        const ok = await this.startViewDetailed(
          {
            mode,
            targetName,
            targetRaDec,
            lpFilter: observation.lpFilter,
          },
          { waitForCompletion: true, timeoutMs: 120000, pollIntervalMs: 500 },
        )
        if (!ok) return fail('start_view', 'Device rejected start-view request')
        steps.push({
          name: 'start_view',
          ok: true,
          changed: true,
          summary: describeStartView(
            mode,
            targetName,
            observation.lpFilter ?? false,
          ),
        })
        stepCompleted(
          'start_view',
          describeStartView(mode, targetName, observation.lpFilter ?? false),
          true,
        )
      } catch (error) {
        return fail('start_view', 'Failed to start observation view', error)
      }
    }

    if (autofocus === 'after_view') {
      if (dryRun) {
        steps.push({
          name: 'autofocus',
          ok: true,
          skipped: true,
          summary: 'Would start autofocus after the view is active',
        })
        stepSkipped(
          'autofocus',
          'Would start autofocus after the view is active',
        )
      } else {
        try {
          stepStarted(
            'autofocus',
            'Running autofocus after the view became active',
          )
          const ok = await this.startAutoFocus({
            waitForCompletion: true,
            timeoutMs: 180000,
            pollIntervalMs: 500,
          })
          if (!ok) return fail('autofocus', 'Device rejected autofocus request')
          steps.push({
            name: 'autofocus',
            ok: true,
            changed: true,
            summary: 'Completed autofocus after the view became active',
          })
          stepCompleted(
            'autofocus',
            'Completed autofocus after the view became active',
            true,
          )
        } catch (error) {
          return fail('autofocus', 'Failed to start autofocus', error)
        }
      }
    }

    if (observationKind === 'stack') {
      if (dryRun) {
        steps.push({
          name: 'start_stack',
          ok: true,
          skipped: true,
          summary: `Would start stacking (restart=${observation.restart ?? true})`,
        })
        stepSkipped(
          'start_stack',
          `Would start stacking (restart=${observation.restart ?? true})`,
        )
      } else {
        try {
          stepStarted(
            'start_stack',
            `Starting stacking (restart=${observation.restart ?? true})`,
          )
          const ok = await this.startStack(observation.restart ?? true, {
            waitForCompletion: true,
            timeoutMs: 120000,
            pollIntervalMs: 500,
          })
          if (!ok)
            return fail('start_stack', 'Device rejected start-stack request')
          steps.push({
            name: 'start_stack',
            ok: true,
            changed: true,
            summary: `Started stacking (restart=${observation.restart ?? true})`,
          })
          stepCompleted(
            'start_stack',
            `Started stacking (restart=${observation.restart ?? true})`,
            true,
          )
        } catch (error) {
          return fail('start_stack', 'Failed to start stacking', error)
        }
      }
    } else {
      steps.push({
        name: 'start_stack',
        ok: true,
        skipped: true,
        summary: 'Observation left in preview mode',
      })
      stepSkipped('start_stack', 'Observation left in preview mode')
    }

    this.log({
      level: 'info',
      event: 'startup.sequence.completed',
      component: 'startup',
      phase: 'startup',
      sequenceId,
      ok: true,
      summary: 'Startup sequence completed',
      data: { warningCount: warnings.length, dryRun },
    })

    return report(true)
  }

  private createSequenceStepLoggers(
    component: 'smoke' | 'startup',
    sequenceLabel: string,
    sequenceId: string,
    dryRun: boolean,
    steps: StartupStepReport[],
    warnings: string[],
    getPreflight: () => PreflightSummary | undefined,
  ): SequenceStepLoggers {
    const report = (ok: boolean): StartupSequenceReport => ({
      ok,
      dryRun,
      resolvedHost: this.host ?? '',
      preflight: getPreflight(),
      steps,
      warnings,
    })

    const stepStarted = (step: string, summary: string) => {
      this.log({
        level: 'info',
        event: `${component}.step.started`,
        component,
        phase: 'startup',
        sequenceId,
        step,
        summary,
      })
    }

    const stepCompleted = (
      step: string,
      summary: string,
      changed?: boolean,
      data?: unknown,
    ) => {
      this.log({
        level: 'info',
        event: `${component}.step.completed`,
        component,
        phase: 'startup',
        sequenceId,
        step,
        changed,
        ok: true,
        summary,
        data,
      })
    }

    const stepSkipped = (step: string, summary: string, data?: unknown) => {
      this.log({
        level: 'info',
        event: `${component}.step.skipped`,
        component,
        phase: 'startup',
        sequenceId,
        step,
        ok: true,
        summary,
        data,
      })
    }

    const fail = (
      name: string,
      summary: string,
      error?: unknown,
    ): StartupSequenceReport => {
      const detail = errorMessage(error)
      steps.push({ name, ok: false, summary, error: detail })
      this.log({
        level: 'error',
        event: `${component}.step.failed`,
        component,
        phase: 'startup',
        sequenceId,
        step: name,
        ok: false,
        summary,
        error: detail,
      })
      this.log({
        level: 'error',
        event: `${component}.sequence.failed`,
        component,
        phase: 'startup',
        sequenceId,
        ok: false,
        summary: `${sequenceLabel} failed at ${name}`,
        error: detail,
      })
      return report(false)
    }

    return { steps, report, stepStarted, stepCompleted, stepSkipped, fail }
  }

  private async runSequenceConnectStep(
    loggers: SequenceStepLoggers,
  ): Promise<StartupSequenceReport | undefined> {
    loggers.stepStarted('connect', 'Connecting and authenticating with device')
    try {
      await this.connect()
      const authenticated = await this.authenticate()
      if (!authenticated) {
        return loggers.fail('connect', 'Authentication failed')
      }
      loggers.steps.push({
        name: 'connect',
        ok: true,
        changed: true,
        summary: `Connected and authenticated at ${this.resolvedHost()}`,
      })
      loggers.stepCompleted(
        'connect',
        `Connected and authenticated at ${this.resolvedHost()}`,
        true,
      )
      return undefined
    } catch (error) {
      return loggers.fail(
        'connect',
        'Failed to connect and authenticate',
        error,
      )
    }
  }

  private async runSequencePreflightStep(
    loggers: SequenceStepLoggers,
    warnings: string[],
  ): Promise<
    | { ok: true; summary: PreflightSummary }
    | { ok: false; report: StartupSequenceReport }
  > {
    loggers.stepStarted('preflight', 'Collecting device status and warnings')
    try {
      const summary = await this.collectPreflightSummary()
      warnings.push(...summary.warnings)
      loggers.steps.push({
        name: 'preflight',
        ok: true,
        summary: summarizePreflight(summary),
        data: summary,
      })
      loggers.stepCompleted('preflight', summarizePreflight(summary), false, {
        warningCount: summary.warnings.length,
      })
      return { ok: true, summary }
    } catch (error) {
      return {
        ok: false,
        report: loggers.fail(
          'preflight',
          'Failed to collect device status',
          error,
        ),
      }
    }
  }

  // --- Album / Image ---

  async getAlbums(): Promise<AlbumsResult | null> {
    const resp = await this.client.sendSync('get_albums', '')
    if (!resp.result) return null
    const albums = parseAlbums(resp)
    if (albums) this.albumPath = albums.path
    return albums
  }

  /**
   * List the actual files inside an album folder using the Seestar SMB share.
   * Example: `listAlbumDirectory("Solar_video")`.
   */
  async listAlbumDirectory(albumDirectory: string): Promise<ShareEntry[]> {
    return listShareDirectory(
      this.resolvedHost(),
      `${this.albumPath}/${albumDirectory}`,
    )
  }

  /** Return full HTTP URLs for album images or videos. */
  resolveImageUrl(
    thumbPath: string,
    isThumb = false,
    extension = '.jpg',
  ): string {
    return buildImageUrl(
      this.resolvedHost(),
      this.albumPath,
      thumbPath,
      isThumb,
      extension,
    )
  }

  // --- Control commands ---

  async goto(
    ra: number,
    dec: number,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    assertFiniteRange(ra, 0, 24, 'ra')
    assertFiniteRange(dec, -90, 90, 'dec')
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('goto aborted before start')
      }
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('scope_goto', [ra, dec])
      const ok = resp.code === 0
      if (ok && wait.waitForCompletion) {
        await this.waitForGotoCompletion(ra, dec, wait)
      }
      return ok
    })
  }

  async moveToHorizon(wait: ActionWaitOptions = {}): Promise<boolean> {
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('move to horizon aborted before start')
      }
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('scope_move_to_horizon', '')
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForMountClosed(
            false,
            'ScopeMoveToHorizon',
            'move arm to horizon',
            wait,
          )
        }
        this.log({
          level: 'info',
          event: 'observation.arm.opened',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: 'Moved arm to horizon position',
        })
      }
      return ok
    })
  }

  async park(wait: ActionWaitOptions = {}): Promise<boolean> {
    return this.runRecovery(async () => {
      if (wait.signal?.aborted) {
        throw new Error('park aborted before start')
      }
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('scope_park', '')
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForMountClosed(true, 'ScopeHome', 'park arm', wait)
        }
        this.log({
          level: 'info',
          event: 'observation.arm.parked',
          component: 'observation',
          phase: 'shutdown',
          changed: true,
          ok: true,
          summary: 'Parked arm',
        })
      }
      return ok
    })
  }

  async sync(ra: number, dec: number): Promise<boolean> {
    assertFiniteRange(ra, 0, 24, 'ra')
    assertFiniteRange(dec, -90, 90, 'dec')
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('scope_sync', [ra, dec])
      return resp.code === 0
    })
  }

  async manualMove(options: ManualMoveOptions): Promise<boolean> {
    validateManualMoveOptions(options)
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('scope_speed_move', {
        speed: options.speed,
        angle: options.directionDeg,
        dur_sec: options.durationSec,
      })
      return resp.code === 0
    })
  }

  async startView(
    mode: SeestarViewMode,
    targetName?: string,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    return this.startViewDetailed(
      {
        mode,
        targetName,
      },
      wait,
    )
  }

  async startViewDetailed(
    options: StartViewOptions,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('start view aborted before start')
      }
      await this.ensureAuthenticated()
      const params: Record<string, unknown> = { mode: options.mode }
      if (options.targetName) params.target_name = options.targetName
      if (options.targetRaDec) {
        assertFiniteRange(options.targetRaDec[0], 0, 24, 'target_ra_dec[0]')
        assertFiniteRange(options.targetRaDec[1], -90, 90, 'target_ra_dec[1]')
        params.target_ra_dec = options.targetRaDec
      }
      if (typeof options.lpFilter === 'boolean')
        params.lp_filter = options.lpFilter
      const resp = await this.client.sendSync('iscope_start_view', params)
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForViewStarted(options, wait)
          if (options.targetRaDec) {
            await this.waitForGotoCompletion(
              options.targetRaDec[0],
              options.targetRaDec[1],
              wait,
            )
          }
        }
        this.log({
          level: 'info',
          event: 'observation.view.started',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: describeStartView(
            options.mode,
            options.targetName,
            options.lpFilter ?? false,
          ),
          data: {
            mode: options.mode,
            targetName: options.targetName,
            targetRaDec: options.targetRaDec,
            lpFilter: options.lpFilter,
          },
        })
      }
      return ok
    })
  }

  async stopView(
    stage?: string,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    return this.runRecovery(async () => {
      if (wait.signal?.aborted) {
        throw new Error('stop view aborted before start')
      }
      await this.ensureAuthenticated()
      const params = stage ? { stage } : ''
      const resp = await this.client.sendSync('iscope_stop_view', params)
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForViewStopped(wait)
        }
        this.log({
          level: 'info',
          event: 'observation.view.stopped',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: wait.waitForCompletion
            ? stage
              ? `Stopped ${stage} view stage`
              : 'Stopped active view'
            : stage
              ? `Requested stop of ${stage} view stage`
              : 'Requested stop of active view',
          data: {
            stage,
            waitForCompletion: wait.waitForCompletion ?? false,
          },
        })
      }
      return ok
    })
  }

  async startStack(
    restart = true,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('start stack aborted before start')
      }
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('iscope_start_stack', { restart })
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForStackStarted(wait)
        }
        this.log({
          level: 'info',
          event: 'observation.stack.started',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: `Started stacking (restart=${restart})`,
          data: { restart },
        })
      }
      return ok
    })
  }

  async stopStack(wait: ActionWaitOptions = {}): Promise<boolean> {
    return this.runRecovery(async () => {
      if (wait.signal?.aborted) {
        throw new Error('stop stack aborted before start')
      }
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('iscope_stop_view', {
        stage: 'Stack',
      })
      const ok = resp.code === 0
      if (ok) {
        if (wait.waitForCompletion) {
          await this.waitForStackStopped(wait)
        }
        this.log({
          level: 'info',
          event: 'observation.stack.stopped',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: wait.waitForCompletion
            ? 'Stopped stacking'
            : 'Requested stop of stacking',
          data: {
            waitForCompletion: wait.waitForCompletion ?? false,
          },
        })
      }
      return ok
    })
  }

  async setWheelPosition(
    position: number,
    wait: ActionWaitOptions = {},
  ): Promise<boolean> {
    if (!Number.isInteger(position) || position < 0 || position > 2) {
      throw new Error('filter wheel position must be an integer in [0, 2]')
    }
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('set filter wheel aborted before start')
      }
      await this.ensureAuthenticated()
      if (!wait.waitForCompletion) {
        const resp = await this.client.sendSync('set_wheel_position', position)
        return resp.code === 0
      }
      // Subscribe before sending so a fast WheelMove completion is not missed.
      const controller = new AbortController()
      const signal = wait.signal
        ? AbortSignal.any([controller.signal, wait.signal])
        : controller.signal
      const completion = this.waitForWheelPosition(position, {
        ...wait,
        signal,
      })
      try {
        const resp = await this.client.sendSync('set_wheel_position', position)
        const ok = resp.code === 0
        if (!ok) return false
        await completion
        return true
      } finally {
        controller.abort()
        await completion.catch(() => {})
      }
    })
  }

  async startAutoFocus(wait: ActionWaitOptions = {}): Promise<boolean> {
    return this.runMutation(async () => {
      if (wait.signal?.aborted) {
        throw new Error('autofocus aborted before start')
      }
      await this.ensureAuthenticated()
      const controller = new AbortController()
      const signal = wait.signal
        ? AbortSignal.any([controller.signal, wait.signal])
        : controller.signal
      const completion = wait.waitForCompletion
        ? this.waitForAutofocusCompletion({ ...wait, signal })
        : undefined
      try {
        const startedAt = Date.now()
        const resp = await this.client.sendSync('start_auto_focuse', '')
        const ok = resp.code === 0
        if (!ok) return ok
        this.log({
          level: 'info',
          event: 'observation.autofocus.started',
          component: 'observation',
          phase: 'observe',
          changed: true,
          ok: true,
          summary: 'Started autofocus',
        })
        if (completion) {
          await completion
          this.log({
            level: 'info',
            event: 'observation.autofocus.completed',
            component: 'observation',
            phase: 'observe',
            changed: true,
            ok: true,
            summary: 'Completed autofocus',
            data: {
              durationMs: Date.now() - startedAt,
            },
          })
        }
        return ok
      } finally {
        controller.abort()
        if (completion) await completion.catch(() => {})
      }
    })
  }

  async setSetting(params: Record<string, unknown>): Promise<boolean> {
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('set_setting', params)
      return resp.code === 0
    })
  }

  async setUserLocation(lat: number, lon: number): Promise<boolean> {
    assertFiniteRange(lat, -90, 90, 'lat')
    assertFiniteRange(lon, -180, 180, 'lon')
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('set_user_location', {
        lat,
        lon,
        force: true,
      })
      const ok = resp.code === 0
      if (ok) {
        this.log({
          level: 'info',
          event: 'observation.location.updated',
          component: 'observation',
          phase: 'startup',
          changed: true,
          ok: true,
          summary: `Updated device location to ${lat}, ${lon}`,
          data: { lat, lon },
        })
      }
      return ok
    })
  }

  async setTime(
    date = new Date(),
    timeZone = resolvedTimeZone(),
  ): Promise<boolean> {
    if (Number.isNaN(date.getTime())) {
      throw new Error('setTime date must be a valid Date')
    }
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const parts = toTimeZoneParts(date, timeZone)
      const resp = await this.client.sendSync('pi_set_time', [
        {
          year: parts.year,
          mon: parts.mon,
          day: parts.day,
          hour: parts.hour,
          min: parts.min,
          sec: parts.sec,
          time_zone: timeZone,
        },
      ])
      const ok = resp.code === 0
      if (ok) {
        this.log({
          level: 'info',
          event: 'observation.time.synced',
          component: 'observation',
          phase: 'startup',
          changed: true,
          ok: true,
          summary: 'Synced device time from host clock',
          data: {
            year: parts.year,
            mon: parts.mon,
            day: parts.day,
            hour: parts.hour,
            min: parts.min,
            sec: parts.sec,
            timeZone,
          },
        })
      }
      return ok
    })
  }

  async shutdown(): Promise<boolean> {
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('pi_shutdown', '')
      return resp.code === 0
    })
  }

  async reboot(): Promise<boolean> {
    return this.runMutation(async () => {
      await this.ensureAuthenticated()
      const resp = await this.client.sendSync('pi_reboot', '')
      return resp.code === 0
    })
  }

  /** Expose the low-level client for advanced use. */
  get rawClient(): SeestarClient {
    if (!this.client) {
      throw new Error('Seestar client is not configured; call connect() first')
    }
    return this.client
  }

  private async waitForMountClosed(
    closed: boolean,
    eventName: string,
    action: string,
    wait: ActionWaitOptions,
  ): Promise<void> {
    await this.waitForStateConvergence({
      action,
      wait,
      eventNames: [eventName],
      readState: async () => this.getDeviceState(['mount']),
      isComplete: (state) =>
        readMountClosed(state) === closed &&
        readMountMoveType(state) === 'none',
      getFailure: (_state, event) => failureFromPushEvent(event, [eventName]),
      summarizeState: (state) => ({
        mountClosed: readMountClosed(state),
        mountMoveType: readMountMoveType(state),
      }),
    })
  }

  private async parkWithRetries(
    wait: ActionWaitOptions,
    attempts = 3,
    delayMs = 2000,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const ok = await this.park(wait)
        if (ok) return true
      } catch {
        const state = await this.getDeviceState(['mount'])
        if (readMountClosed(state) === true) {
          return true
        }
      }

      if (attempt < attempts) {
        await delay(delayMs)
      }
    }

    const state = await this.getDeviceState(['mount'])
    return readMountClosed(state) === true
  }

  private async waitForViewStarted(
    options: StartViewOptions,
    wait: ActionWaitOptions,
  ): Promise<void> {
    await this.waitForStateConvergence({
      action: `start ${options.mode} view`,
      wait,
      eventNames: ['View', 'ContinuousExposure', 'Initialise'],
      readState: async () => this.getViewState(),
      isComplete: (state) => isRequestedViewActive(state, options.mode),
      getFailure: (state, event) => {
        const eventFailure = failureFromPushEvent(event, ['View'])
        if (eventFailure) return eventFailure
        if (readViewStateName(state) === 'cancel')
          return 'view cancelled before becoming active'
        return undefined
      },
      summarizeState: summarizeViewState,
    })
  }

  private async waitForViewStopped(wait: ActionWaitOptions): Promise<void> {
    await this.waitForStateConvergence({
      action: 'stop view',
      wait,
      eventNames: ['View'],
      readState: async () => this.getViewState(),
      isComplete: (state) => isViewStopped(state),
      summarizeState: summarizeViewState,
    })
  }

  private async waitForStackStarted(wait: ActionWaitOptions): Promise<void> {
    await this.waitForStateConvergence({
      action: 'start stack',
      wait,
      eventNames: ['Stack', 'View'],
      readState: async () => this.getViewState(),
      isComplete: (state) => isStackActive(state),
      getFailure: (_state, event) => failureFromPushEvent(event, ['Stack']),
      summarizeState: summarizeViewState,
    })
  }

  private async waitForStackStopped(wait: ActionWaitOptions): Promise<void> {
    await this.waitForStateConvergence({
      action: 'stop stack',
      wait,
      eventNames: ['Stack', 'View'],
      readState: async () => this.getViewState(),
      isComplete: (state) => !isStackActive(state),
      summarizeState: summarizeViewState,
    })
  }

  private async waitForWheelPosition(
    position: number,
    wait: ActionWaitOptions,
  ): Promise<void> {
    await this.waitForPushCompletion({
      action: `set filter wheel to ${position}`,
      wait,
      predicate: (event) => {
        if (event.Event !== 'WheelMove') return false
        const state = normalizeEventState(event)
        return state === 'complete' || state === 'fail'
      },
      getFailure: (event) => {
        if (normalizeEventState(event) === 'fail') {
          return (
            event.error ?? `filter wheel reported ${event.state ?? 'failure'}`
          )
        }
        const eventPosition = asNumber(event.position)
        if (typeof eventPosition === 'number' && eventPosition !== position) {
          return `filter wheel stopped at ${eventPosition} instead of ${position}`
        }
        return failureFromPushEvent(event, ['WheelMove'])
      },
    })
  }

  private async waitForGotoCompletion(
    ra: number,
    dec: number,
    wait: ActionWaitOptions,
  ): Promise<void> {
    await this.waitForStateConvergence({
      action: `goto ${ra}, ${dec}`,
      wait,
      eventNames: ['AutoGoto', 'ScopeGoto'],
      readState: async () => {
        await this.ensureAuthenticated()
        const [deviceState, currentRaDec] = await Promise.all([
          this.getDeviceState(['mount']),
          this.getEquCoord(),
        ])
        return { deviceState, currentRaDec }
      },
      isComplete: (state) =>
        readMountMoveType(state.deviceState) === 'none' &&
        isCoordinateNearTarget(state.currentRaDec, ra, dec),
      getFailure: (_state, event) =>
        failureFromPushEvent(event, ['AutoGoto', 'ScopeGoto']),
      summarizeState: (state) => ({
        currentRaDec: state.currentRaDec,
        mountClosed: readMountClosed(state.deviceState),
        mountMoveType: readMountMoveType(state.deviceState),
      }),
    })
  }

  private async waitForAutofocusCompletion(
    wait: ActionWaitOptions,
  ): Promise<void> {
    const timeoutMs = wait.timeoutMs ?? this.config.timeoutMs ?? 10000
    const pollIntervalMs = wait.pollIntervalMs ?? 500
    const quietPeriodMs = Math.max(1500, pollIntervalMs * 3)

    this.log({
      level: 'debug',
      event: 'observation.wait.started',
      component: 'observation',
      phase: 'observe',
      summary: 'Waiting for complete autofocus',
      data: {
        action: 'complete autofocus',
        timeoutMs,
        pollIntervalMs,
        quietPeriodMs,
        mode: 'event+poll',
        eventNames: ['AutoFocus', 'FocuserMove'],
      },
    })

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let currentCheck: Promise<void> | undefined
      let rerunCheck = false
      let sawAutofocusStart = false
      let sawBusyAutofocus = false
      let lastActivityAt = Date.now()
      let lastEvent: SeestarPushEvent | undefined
      let lastFocuserState: string | undefined

      const cleanup = () => {
        clearInterval(intervalHandle)
        clearTimeout(timeoutHandle)
        wait.signal?.removeEventListener('abort', onAbort)
        unsubscribe()
      }

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }

      const fail = (message: string) => {
        this.log({
          level: message.includes('Timed out') ? 'warn' : 'error',
          event: 'observation.wait.failed',
          component: 'observation',
          phase: 'observe',
          ok: false,
          summary: 'Failed while waiting for complete autofocus',
          error: message,
          data: {
            action: 'complete autofocus',
            mode: 'event+poll',
            eventName: lastEvent?.Event,
            state: lastEvent?.state,
            focuserState: lastFocuserState,
          },
        })
        finish(() => reject(new Error(message)))
      }

      const succeed = () => {
        this.log({
          level: 'debug',
          event: 'observation.wait.completed',
          component: 'observation',
          phase: 'observe',
          ok: true,
          summary: 'Finished waiting for complete autofocus',
          data: {
            action: 'complete autofocus',
            mode: 'event+poll',
            eventName: lastEvent?.Event,
            state: lastEvent?.state,
            focuserState: lastFocuserState,
            quietPeriodMs,
          },
        })
        finish(resolve)
      }

      const evaluate = () => {
        if (settled) return
        if (currentCheck) {
          rerunCheck = true
          return
        }

        currentCheck = (async () => {
          do {
            rerunCheck = false
            const state = await this.getDeviceState(['focuser'])
            lastFocuserState = readFocuserState(state)
            if (isBusyState(lastFocuserState)) {
              sawBusyAutofocus = true
              continue
            }
            if (!sawAutofocusStart || !sawBusyAutofocus) {
              continue
            }
            if (Date.now() - lastActivityAt < quietPeriodMs) {
              continue
            }
            succeed()
            return
          } while (rerunCheck && !settled)
        })()
          .catch((error) => {
            fail(errorMessage(error) ?? 'Autofocus wait failed')
          })
          .finally(() => {
            currentCheck = undefined
          })
      }

      const onAbort = () => {
        fail('Waiting for complete autofocus aborted')
      }

      const unsubscribe = this.client.subscribeToPushEvents((event) => {
        if (event.Event !== 'AutoFocus' && !isAutofocusFocuserEvent(event))
          return
        lastEvent = event
        lastActivityAt = Date.now()

        const eventState = normalizeEventState(event)
        if (event.Event === 'AutoFocus' || isAutofocusFocuserEvent(event)) {
          sawAutofocusStart = true
        }
        if (eventState === 'start' || eventState === 'working') {
          sawBusyAutofocus = true
        }

        this.log({
          level: 'debug',
          event: 'observation.wait.event',
          component: 'observation',
          phase: 'observe',
          summary: `Received ${event.Event} while waiting for complete autofocus`,
          data: {
            action: 'complete autofocus',
            eventName: event.Event,
            state: event.state,
            code: event.code,
            error: event.error,
          },
        })

        if (
          event.Event === 'AutoFocus' &&
          (eventState === 'fail' || eventState === 'cancel')
        ) {
          fail(event.error ?? `autofocus ${eventState}`)
          return
        }
        if (isAutofocusFocuserEvent(event) && eventState === 'fail') {
          fail(event.error ?? 'focuser move failed during autofocus')
          return
        }

        evaluate()
      })

      const intervalHandle = setInterval(() => {
        evaluate()
      }, pollIntervalMs)

      const timeoutHandle = setTimeout(() => {
        fail('Timed out waiting for complete autofocus')
      }, timeoutMs)

      if (wait.signal?.aborted) {
        onAbort()
        return
      }

      wait.signal?.addEventListener('abort', onAbort, { once: true })
      evaluate()
    })
  }

  private async waitForPushCompletion(config: {
    action: string
    wait: ActionWaitOptions
    predicate: (event: SeestarPushEvent) => boolean
    getFailure?: (event: SeestarPushEvent) => string | undefined
  }): Promise<SeestarPushEvent> {
    const timeoutMs = config.wait.timeoutMs ?? this.config.timeoutMs ?? 10000

    this.log({
      level: 'debug',
      event: 'observation.wait.started',
      component: 'observation',
      phase: 'observe',
      summary: `Waiting for ${config.action}`,
      data: { action: config.action, timeoutMs, mode: 'event' },
    })

    try {
      const event = await this.client.waitForPushEvent(config.predicate, {
        timeoutMs,
        signal: config.wait.signal,
      })
      const failure = config.getFailure?.(event)
      if (failure) {
        throw new Error(failure)
      }
      this.log({
        level: 'debug',
        event: 'observation.wait.completed',
        component: 'observation',
        phase: 'observe',
        ok: true,
        summary: `Finished waiting for ${config.action}`,
        data: {
          action: config.action,
          mode: 'event',
          eventName: event.Event,
          state: event.state,
          code: event.code,
        },
      })
      return event
    } catch (error) {
      this.log({
        level: errorMessage(error)?.includes('Timeout') ? 'warn' : 'error',
        event: 'observation.wait.failed',
        component: 'observation',
        phase: 'observe',
        ok: false,
        summary: `Failed while waiting for ${config.action}`,
        error: errorMessage(error),
        data: { action: config.action, mode: 'event' },
      })
      throw error
    }
  }

  private async waitForStateConvergence<TState>(config: {
    action: string
    wait: ActionWaitOptions
    eventNames: string[]
    readState: () => Promise<TState>
    isComplete: (state: TState, event?: SeestarPushEvent) => boolean
    getFailure?: (state: TState, event?: SeestarPushEvent) => string | undefined
    summarizeState?: (state: TState) => unknown
  }): Promise<TState> {
    const timeoutMs = config.wait.timeoutMs ?? this.config.timeoutMs ?? 10000
    const pollIntervalMs = config.wait.pollIntervalMs ?? 500
    const startedAt = Date.now()

    this.log({
      level: 'debug',
      event: 'observation.wait.started',
      component: 'observation',
      phase: 'observe',
      summary: `Waiting for ${config.action}`,
      data: {
        action: config.action,
        timeoutMs,
        pollIntervalMs,
        mode: 'event+poll',
        eventNames: config.eventNames,
      },
    })

    return new Promise<TState>((resolve, reject) => {
      let settled = false
      let currentCheck: Promise<void> | undefined
      let rerunCheck = false
      let lastState: TState | undefined
      let lastEvent: SeestarPushEvent | undefined
      let lastProgressSignature: string | undefined
      let progressObservedAt = startedAt
      let deadlineAt = startedAt + timeoutMs
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        clearInterval(intervalHandle)
        clearTimeout(timeoutHandle)
        config.wait.signal?.removeEventListener('abort', onAbort)
        unsubscribe()
      }

      const readEventNumber = (
        event: SeestarPushEvent | undefined,
        ...keys: Array<
          | 'percent'
          | 'lapse_ms'
          | 'lapseMs'
          | 'elapsed_ms'
          | 'elapsedMs'
        >
      ): number | undefined => {
        if (!event) return undefined
        for (const key of keys) {
          const value = event[key]
          if (typeof value === 'number') return value
        }
        return undefined
      }

      const summarizeProgress = (
        state: TState | undefined,
        event?: SeestarPushEvent,
      ) => ({
        action: config.action,
        eventName: event?.Event,
        eventState: normalizeEventState(event),
        percent: readEventNumber(event, 'percent'),
        lapseMs: readEventNumber(event, 'lapse_ms', 'lapseMs'),
        elapsedMs: readEventNumber(event, 'elapsed_ms', 'elapsedMs'),
        state: state === undefined ? undefined : config.summarizeState?.(state),
      })

      const logProgress = (
        source: 'initial' | 'poll' | 'event',
        state: TState | undefined,
        event?: SeestarPushEvent,
      ) => {
        if (settled) return
        const progress = summarizeProgress(state, event)
        const signature = stableStringify(progress)
        if (lastProgressSignature === undefined) {
          lastProgressSignature = signature
          return
        }
        if (signature === lastProgressSignature) return

        lastProgressSignature = signature
        progressObservedAt = Date.now()
        deadlineAt = progressObservedAt + timeoutMs
        scheduleTimeout()

        this.log({
          level: 'debug',
          event: 'observation.wait.progress',
          component: 'observation',
          phase: 'observe',
          summary: `Observed progress while waiting for ${config.action}`,
          data: {
            action: config.action,
            source,
            timeoutMs,
            remainingMs: Math.max(0, deadlineAt - Date.now()),
            progressObservedAt: new Date(progressObservedAt).toISOString(),
            progress,
          },
        })
      }

      const onTimeout = () => {
        this.log({
          level: 'warn',
          event: 'observation.wait.timeout',
          component: 'observation',
          phase: 'observe',
          ok: false,
          summary: `Timed out while waiting for ${config.action}`,
          data: {
            action: config.action,
            timeoutMs,
            remainingMs: 0,
            progressObservedAt: new Date(progressObservedAt).toISOString(),
            state: lastState ? config.summarizeState?.(lastState) : undefined,
            eventName: lastEvent?.Event,
            progress: lastState
              ? summarizeProgress(lastState, lastEvent)
              : undefined,
          },
        })
        finish(() =>
          reject(new Error(`Timed out waiting for ${config.action}`)),
        )
      }

      const scheduleTimeout = () => {
        clearTimeout(timeoutHandle)
        timeoutHandle = setTimeout(
          onTimeout,
          Math.max(0, deadlineAt - Date.now()),
        )
      }

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        callback()
      }

      const evaluateState = (
        source: 'initial' | 'poll' | 'event',
        event?: SeestarPushEvent,
      ) => {
        if (settled) return
        if (currentCheck) {
          rerunCheck = true
          return
        }

        currentCheck = (async () => {
          do {
            rerunCheck = false
            const state = await config.readState()
            if (settled) return
            lastState = state
            logProgress(source, state, event ?? lastEvent)
            const failure = config.getFailure?.(state, event ?? lastEvent)
            if (failure) {
              this.log({
                level: 'error',
                event: 'observation.wait.failed',
                component: 'observation',
                phase: 'observe',
                ok: false,
                summary: `Failed while waiting for ${config.action}`,
                error: failure,
                data: {
                  action: config.action,
                  mode: 'event+poll',
                  source,
                  state: config.summarizeState?.(state),
                  eventName: (event ?? lastEvent)?.Event,
                },
              })
              finish(() => reject(new Error(failure)))
              return
            }
            if (config.isComplete(state, event ?? lastEvent)) {
              this.log({
                level: 'debug',
                event: 'observation.wait.completed',
                component: 'observation',
                phase: 'observe',
                ok: true,
                summary: `Finished waiting for ${config.action}`,
                data: {
                  action: config.action,
                  mode: 'event+poll',
                  source,
                  state: config.summarizeState?.(state),
                  eventName: (event ?? lastEvent)?.Event,
                },
              })
              finish(() => resolve(state))
              return
            }
          } while (rerunCheck && !settled)
        })()
          .catch((error) => {
            this.log({
              level: 'error',
              event: 'observation.wait.failed',
              component: 'observation',
              phase: 'observe',
              ok: false,
              summary: `Failed while waiting for ${config.action}`,
              error: errorMessage(error),
              data: {
                action: config.action,
                mode: 'event+poll',
                source,
                state: lastState
                  ? config.summarizeState?.(lastState)
                  : undefined,
                eventName: (event ?? lastEvent)?.Event,
              },
            })
            finish(() => reject(error))
          })
          .finally(() => {
            currentCheck = undefined
          })
      }

      const onAbort = () => {
        finish(() => reject(new Error(`Waiting for ${config.action} aborted`)))
      }

      const unsubscribe = this.client.subscribeToPushEvents((event) => {
        if (!config.eventNames.includes(event.Event)) return
        if (settled) return
        lastEvent = event
        logProgress('event', lastState, event)
        this.log({
          level: 'debug',
          event: 'observation.wait.event',
          component: 'observation',
          phase: 'observe',
          summary: `Received ${event.Event} while waiting for ${config.action}`,
          data: {
            action: config.action,
            eventName: event.Event,
            state: event.state,
            code: event.code,
            error: event.error,
          },
        })
        evaluateState('event', event)
      })

      const intervalHandle = setInterval(() => {
        evaluateState('poll')
      }, pollIntervalMs)

      if (config.wait.signal?.aborted) {
        onAbort()
        return
      }

      config.wait.signal?.addEventListener('abort', onAbort, { once: true })
      scheduleTimeout()
      evaluateState('initial')
    })
  }

  private configureClient(host: string): void {
    this.client = new SeestarClient(
      host,
      this.config.port ?? 4700,
      this.config.timeoutMs,
      {
        logger: this.logger,
        sessionId: this.sessionId,
        traceProtocol: this.config.traceProtocol,
        deviceModel: this.deviceModel,
        deviceSn: this.deviceSn,
      },
    )
    this.auth = new SeestarAuth(
      this.client,
      this.config.pemPath,
      host,
      this.logger,
      this.sessionId,
      this.deviceModel,
      this.deviceSn,
    )
  }

  private async ensureAuthenticated(): Promise<void> {
    if (this.closed) {
      throw new Error('Seestar session is closed')
    }
    if (!this.isConnected()) {
      this.authenticated = false
      await this.connect()
    }
    if (this.closed) {
      throw new Error('Seestar session is closed')
    }
    const authenticated = await this.authenticate()
    if (!authenticated) {
      throw new Error('Seestar authentication failed')
    }
  }

  // Run a mutating operation after any prior mutation on this instance has
  // settled. The chain never breaks on rejection, so a failed command cannot
  // stall the next one. Once disconnect() has been called, queued mutations
  // reject before send instead of reaching the device or reconnecting.
  private runMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = (): Promise<T> => {
      if (this.closed) {
        return Promise.reject(new Error('Seestar session is closed'))
      }
      return fn()
    }
    const result = this.mutationChain.then(run, run)
    this.mutationChain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  // Recovery commands (stop/park) bypass the chain head so they can reach the
  // device even while a prior mutation is still waiting for completion, but
  // they still extend the chain tail so a later mutation cannot overlap with
  // a recovery that is still settling. Once disconnect() has been called,
  // recovery commands also reject before send.
  private runRecovery<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Seestar session is closed'))
    }
    const result = fn()
    this.mutationChain = Promise.all([this.mutationChain, result]).then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async collectPreflightSummary(): Promise<PreflightSummary> {
    const [
      deviceState,
      viewState,
      setting,
      diskVolume,
      piInfo,
      time,
      currentRaDec,
    ] = await Promise.all([
      this.getDeviceState(),
      this.getViewState(),
      this.getSetting(),
      this.getDiskVolume(),
      this.getPiInfo(),
      this.getTime(),
      this.getEquCoord(),
    ])

    const summary = buildPreflightSummary({
      host: this.resolvedHost(),
      deviceState,
      viewState,
      setting,
      diskVolume,
      piInfo,
      time,
      currentRaDec,
    })
    this.deviceModel = summary.productModel
    this.deviceSn = summary.serialNumber
    this.client.setDeviceIdentity(this.deviceModel, this.deviceSn)
    this.auth.setDeviceIdentity(this.deviceModel, this.deviceSn)
    this.log({
      level: 'info',
      event: 'preflight.summary.emitted',
      component: 'preflight',
      phase: 'preflight',
      summary: summarizePreflight(summary),
      data: {
        batteryPercent: summary.batteryPercent,
        storageFreeMb: summary.storageFreeMb,
        mountClosed: summary.mountClosed,
        deviceTimeLooksStale: summary.deviceTimeLooksStale,
      },
    })
    for (const warning of summary.warnings) {
      this.log({
        level: 'warn',
        event: 'preflight.warning.raised',
        component: 'preflight',
        phase: 'preflight',
        summary: warning,
        warning: warningCode(warning),
      })
    }
    return summary
  }

  private log(
    event: Omit<
      Parameters<typeof emitLog>[1],
      'sessionId' | 'host' | 'deviceModel' | 'deviceSn'
    >,
  ): void {
    emitLog(this.logger, {
      sessionId: this.sessionId,
      host: this.host,
      deviceModel: this.deviceModel,
      deviceSn: this.deviceSn,
      ...event,
    })
  }

  private resolvedHost(): string {
    if (!this.host) {
      throw new Error('Seestar host is not resolved; call connect() first')
    }
    return this.host
  }
}

function buildPreflightSummary(input: {
  host: string
  deviceState: DeviceState | null
  viewState: ViewStateResult | null
  setting: unknown
  diskVolume: unknown
  piInfo: unknown
  time: unknown
  currentRaDec: EquCoord | null
}): PreflightSummary {
  const deviceStateRecord = asRecord(input.deviceState)
  const device = asRecord(deviceStateRecord?.device)
  const piStatus = asRecord(deviceStateRecord?.pi_status)
  const mount = asRecord(deviceStateRecord?.mount)
  const station = asRecord(deviceStateRecord?.station)
  const view = asRecord(input.viewState?.View)
  const location = readLocation(deviceStateRecord?.location_lon_lat)
  const diskVolume = asRecord(input.diskVolume)
  const deviceTime = readDeviceTime(input.time)
  const warnings: string[] = []

  const summary: PreflightSummary = {
    host: input.host,
    productModel: asString(device?.product_model),
    serialNumber: asString(device?.sn),
    firmwareVersion: asString(device?.firmware_ver_string),
    isVerified: asBoolean(device?.is_verified),
    batteryPercent: asNumber(piStatus?.battery_capacity),
    deviceTempC: asNumber(piStatus?.temp),
    batteryTempC: asNumber(piStatus?.battery_temp),
    storageFreeMb: asNumber(diskVolume?.freeMB ?? diskVolume?.free_mb),
    storageTotalMb: asNumber(diskVolume?.totalMB ?? diskVolume?.total_mb),
    mountClosed: asBoolean(mount?.close),
    tracking: asBoolean(mount?.tracking),
    equMode: asBoolean(mount?.equ_mode),
    deviceTime,
    deviceTimeLooksStale: isDeviceTimeStale(deviceTime),
    viewMode: asString(view?.mode),
    viewStage: asString(view?.stage),
    viewState: asString(view?.state),
    targetName: asString(view?.target_name),
    location,
    stationSsid: asString(station?.ssid),
    currentRaDec: input.currentRaDec,
    raw: {
      deviceState: input.deviceState,
      viewState: input.viewState,
      setting: input.setting,
      diskVolume: input.diskVolume,
      piInfo: input.piInfo,
      time: input.time,
    },
    warnings,
  }

  if (
    typeof summary.batteryPercent === 'number' &&
    summary.batteryPercent < 20
  ) {
    warnings.push(`Battery is low at ${summary.batteryPercent}%`)
  }
  if (typeof summary.deviceTempC === 'number' && summary.deviceTempC >= 55) {
    warnings.push(`Device temperature is elevated at ${summary.deviceTempC}C`)
  }
  if (typeof summary.batteryTempC === 'number' && summary.batteryTempC >= 45) {
    warnings.push(`Battery temperature is elevated at ${summary.batteryTempC}C`)
  }
  if (
    typeof summary.storageFreeMb === 'number' &&
    summary.storageFreeMb < 1024
  ) {
    warnings.push(`Free storage is low at ${summary.storageFreeMb} MB`)
  }
  if (summary.mountClosed) {
    warnings.push('Mount is currently parked/closed')
  }
  if (summary.deviceTimeLooksStale && summary.deviceTime) {
    warnings.push(
      `Device clock appears stale at ${formatDeviceTime(summary.deviceTime)}`,
    )
  }
  if (!summary.location) {
    warnings.push('User location is not available in device state')
  }
  if (isViewActive(summary)) {
    warnings.push(
      `Device already has an active view in ${summary.viewMode ?? 'unknown'}/${summary.viewStage ?? 'unknown'}`,
    )
  }

  return summary
}

function summarizePreflight(summary: PreflightSummary): string {
  const parts = [
    summary.productModel,
    summary.firmwareVersion ? `fw ${summary.firmwareVersion}` : undefined,
    typeof summary.batteryPercent === 'number'
      ? `battery ${summary.batteryPercent}%`
      : undefined,
    typeof summary.storageFreeMb === 'number'
      ? `free ${summary.storageFreeMb} MB`
      : undefined,
    summary.deviceTimeLooksStale ? 'clock stale' : undefined,
    summary.mountClosed ? 'mount closed' : 'mount ready',
    summary.viewMode ? `view ${summary.viewMode}` : undefined,
  ].filter((part): part is string => Boolean(part))

  return parts.join(', ')
}

function describeStartView(
  mode: string,
  targetName?: string,
  lpFilter = false,
): string {
  const target = targetName ? ` target ${targetName}` : ' live preview'
  const filter = lpFilter ? ' with LP filter' : ''
  return `Start ${mode}${target}${filter}`
}

function isViewActive(summary: PreflightSummary): boolean {
  if (!summary.viewMode || summary.viewMode === 'none') return false
  return summary.viewState !== 'cancel'
}

function isRequestedViewActive(
  viewState: ViewStateResult | null,
  mode: string,
): boolean {
  const view = asRecord(viewState?.View)
  return (
    asString(view?.mode) === mode && readViewStateName(viewState) !== 'cancel'
  )
}

function isViewStopped(viewState: ViewStateResult | null): boolean {
  const view = asRecord(viewState?.View)
  const mode = asString(view?.mode)
  return !mode || mode === 'none' || readViewStateName(viewState) === 'cancel'
}

function isStackActive(viewState: ViewStateResult | null): boolean {
  const view = asRecord(viewState?.View)
  return (
    asString(view?.stage) === 'Stack' &&
    readViewStateName(viewState) !== 'cancel'
  )
}

function isCoordinateNearTarget(
  current: EquCoord | null,
  targetRa: number,
  targetDec: number,
): boolean {
  if (!current) return false
  const raDelta = Math.abs(current.ra - targetRa)
  const wrappedRaDelta = Math.min(raDelta, 24 - raDelta)
  const decDelta = Math.abs(current.dec - targetDec)
  return wrappedRaDelta <= 0.25 && decDelta <= 3
}

function summarizeViewState(viewState: ViewStateResult | null): unknown {
  const view = asRecord(viewState?.View)
  return {
    mode: asString(view?.mode),
    stage: asString(view?.stage),
    state: asString(view?.state),
    targetName: asString(view?.target_name),
  }
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function readViewStateName(
  viewState: ViewStateResult | null,
): string | undefined {
  const view = asRecord(viewState?.View)
  return asString(view?.state)
}

function readMountClosed(deviceState: DeviceState | null): boolean | undefined {
  const mount = asRecord(asRecord(deviceState)?.mount)
  return asBoolean(mount?.close)
}

function readMountMoveType(
  deviceState: DeviceState | null,
): string | undefined {
  const mount = asRecord(asRecord(deviceState)?.mount)
  return asString(mount?.move_type)
}

function readFocuserState(deviceState: DeviceState | null): string | undefined {
  const focuser = asRecord(asRecord(deviceState)?.focuser)
  return asString(focuser?.state)
}

function normalizeEventState(event?: SeestarPushEvent): string | undefined {
  return typeof event?.state === 'string'
    ? event.state.toLowerCase()
    : undefined
}

function isBusyState(state?: string): boolean {
  return state === 'working' || state === 'moving' || state === 'start'
}

function isAutofocusFocuserEvent(event?: SeestarPushEvent): boolean {
  if (!event || event.Event !== 'FocuserMove') return false
  return Array.isArray(event.route) && event.route.includes('AutoFocus')
}

function failureFromPushEvent(
  event: SeestarPushEvent | undefined,
  relevantEvents: string[],
): string | undefined {
  if (!event || !relevantEvents.includes(event.Event)) return undefined
  const state = normalizeEventState(event)
  if (state === 'fail' || state === 'cancel') {
    return event.error ?? `${event.Event} reported ${state}`
  }
  if (typeof event.code === 'number' && event.code !== 0) {
    return event.error ?? `${event.Event} reported code ${event.code}`
  }
  return undefined
}

function readDeviceTime(value: unknown): PreflightSummary['deviceTime'] {
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

function isDeviceTimeStale(time: PreflightSummary['deviceTime']): boolean {
  if (!time) return false
  return time.year < new Date().getFullYear() - 1
}

function formatDeviceTime(
  time: NonNullable<PreflightSummary['deviceTime']>,
): string {
  const parts = [
    String(time.year).padStart(4, '0'),
    String(time.mon).padStart(2, '0'),
    String(time.day).padStart(2, '0'),
  ]
  const clock = [time.hour, time.min, time.sec]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
  return `${parts.join('-')} ${clock}${time.timeZone ? ` ${time.timeZone}` : ''}`
}

function readLocation(
  value: unknown,
): { lat: number; lon: number } | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined
  const lon = asNumber(value[0])
  const lat = asNumber(value[1])
  if (typeof lat !== 'number' || typeof lon !== 'number') return undefined
  return { lat, lon }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function validateManualMoveOptions(options: ManualMoveOptions): void {
  if (!Number.isFinite(options.speed) || options.speed <= 0) {
    throw new Error('manualMove speed must be a positive number')
  }
  if (!Number.isInteger(options.speed)) {
    throw new Error('manualMove speed must be an integer')
  }
  if (!Number.isFinite(options.directionDeg)) {
    throw new Error('manualMove directionDeg must be a finite number')
  }
  if (
    !Number.isFinite(options.durationSec) ||
    !Number.isInteger(options.durationSec) ||
    options.durationSec <= 0
  ) {
    throw new Error('manualMove durationSec must be a positive integer')
  }
}

function assertFiniteRange(
  value: number,
  min: number,
  max: number,
  name: string,
): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be a finite number in [${min}, ${max}]`)
  }
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return undefined
}

function resolvedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

// Compute calendar components in the given timezone so they match the
// `time_zone` field sent to the device. `getHours()` etc. would return
// host-local components, which disagree with a non-host `timeZone`.
function toTimeZoneParts(
  date: Date,
  timeZone: string,
): {
  year: number
  mon: number
  day: number
  hour: number
  min: number
  sec: number
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')
  return {
    year: get('year'),
    mon: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    min: get('minute'),
    sec: get('second'),
  }
}

function buildSessionId(): string {
  return `ses_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}_${randomUUID().slice(0, 8)}`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function warningCode(warning: string): string {
  if (warning.includes('Battery is low')) return 'battery_low'
  if (warning.includes('temperature is elevated')) return 'temperature_elevated'
  if (warning.includes('Free storage is low')) return 'storage_low'
  if (warning.includes('parked/closed')) return 'mount_closed'
  if (warning.includes('clock appears stale')) return 'clock_stale'
  if (warning.includes('location is not available')) return 'location_missing'
  if (warning.includes('already has an active view')) return 'view_active'
  return 'warning'
}
