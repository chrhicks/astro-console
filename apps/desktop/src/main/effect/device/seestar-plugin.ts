import { app } from 'electron'
import { Effect, Ref } from 'effect'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
  createConsoleLogger,
} from '../../../../../../sdk/dist/index.js'
import type {
  DeviceState,
  ViewStateResult,
} from '../../../../../../sdk/dist/index.js'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  LiveSessionHealthState,
  SeestarViewMode,
} from '../../../shared/api-v2'
import type {
  DevicePlugin,
  DeviceSession,
  DeviceSessionRefresh,
  LiveDeviceSession,
  PointToCoordinatesInput,
  PrepareForPointingInput,
} from './device-plugin'
import type { ConnectedRig } from '../rig/rig-model'
import { EventBus } from '../event/event-bus.js'

const SEESTAR_CAPABILITIES = {
  supportsStacking: true,
  supportsLivePreview: true,
  supportsFilterWheel: true,
  supportsAutofocus: true,
  supportsStorageAccess: true,
} as const

const DEFAULT_GOTO_WAIT = {
  waitForCompletion: true,
  timeoutMs: 120000,
  pollIntervalMs: 500,
} as const

function toSeestarDeviceId(device: { host: string; serialNumber?: string }) {
  return device.serialNumber
    ? `seestar:sn:${device.serialNumber}`
    : `seestar:host:${device.host}`
}

export function createSeestarPlugin(): DevicePlugin {
  const discoveredRef = Ref.unsafeMake<Map<string, DesktopDiscoveredDeviceV2>>(
    new Map(),
  )
  const discover = Effect.gen(function* () {
    const discovered: Awaited<ReturnType<typeof discoverSeestars>> =
      yield* Effect.tryPromise(() => discoverSeestars({ timeoutMs: 2500 }))

    const mapped: DesktopDiscoveredDeviceV2[] = discovered.map((device) => {
      const productModel =
        typeof device.result.product_model === 'string'
          ? device.result.product_model
          : 'Seestar'
      const serialNumber =
        typeof device.result.sn === 'string' ? device.result.sn : undefined

      return {
        pluginKind: 'seestar',
        deviceId: toSeestarDeviceId({
          host: device.host,
          serialNumber,
        }),
        displayName: productModel,
        host: device.host,
        productModel,
        serialNumber,
      }
    })

    yield* Ref.set(
      discoveredRef,
      new Map(mapped.map((device) => [device.deviceId, device])),
    )

    return mapped
  })

  return {
    kind: 'seestar',
    discover,

    connect: (input: ConnectRequestV2) =>
      Effect.gen(function* () {
        const bus = yield* EventBus

        const discovered = yield* Ref.get(discoveredRef)
        const target = discovered.get(input.deviceId)

        if (!target) {
          return yield* Effect.fail(
            new Error(
              `Seestar device not found for deviceId ${input.deviceId}`,
            ),
          )
        }

        const host = target.host
        if (!host) {
          return yield* Effect.fail(
            new Error(
              `Discovered Seestar target ${target.deviceId} has no host`,
            ),
          )
        }

        const device = new SeestarDevice({
          host,
          pemPath: resolveSeestarPemPath({
            fallbackCandidates: [
              app.isPackaged
                ? `${process.resourcesPath}/seestar_3.1.2_fw_7.32_interop.pem`
                : `${app.getAppPath()}/seestar_3.1.2_fw_7.32_interop.pem`,
            ],
          }),
          discoveryTimeoutMs: 2500,
          logger: createConsoleLogger('debug'),
        })

        yield* bus.publish('session.connect.step.started', {
          step: 'device.connect',
          host,
          deviceId: input.deviceId,
        })

        yield* Effect.tryPromise({
          try: () => device.connect(),
          catch: (error) =>
            new Error(
              `device.connect failed for ${host}: ${toErrorMessage(error)}`,
            ),
        }).pipe(
          Effect.catchAll((error) =>
            bus
              .publish('session.connect.step.failed', {
                step: 'device.connect',
                host,
                deviceId: input.deviceId,
                error: toErrorMessage(error),
              })
              .pipe(Effect.zipRight(Effect.fail(error))),
          ),
        )

        yield* bus.publish('session.connect.step.succeeded', {
          step: 'device.connect',
          host,
          deviceId: target.deviceId,
        })

        const sessionId = crypto.randomUUID()

        const health: LiveSessionHealthState = {
          state: 'healthy',
          lastCheckedAt: new Date().toISOString(),
        }

        // Last view mode used by pointing; startCapture restarts a view with
        // this mode so stacking begins without re-slewing to the target.
        let lastViewMode: SeestarViewMode = 'star'

        // Connect-time warnings. Refresh filters out the "parked/closed"
        // warning from this set once the mount is no longer closed, so the
        // projection does not keep showing a stale parked warning after the
        // arm opens.
        let initialWarnings: string[] = []

        const delay = (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms))

        // Reads the mount sub-object from getDeviceState for convergence
        // checks. Returns close and move_type so callers can decide whether
        // the mount has reached the expected state.
        const readMountState = async (): Promise<{
          close: boolean | undefined
          moveType: string | undefined
        }> => {
          const state = await device.getDeviceState(['mount'])
          const mount =
            state &&
            typeof state.mount === 'object' &&
            state.mount !== null
              ? (state.mount as Record<string, unknown>)
              : undefined
          return {
            close:
              mount && typeof mount.close === 'boolean'
                ? mount.close
                : undefined,
            moveType:
              mount && typeof mount.move_type === 'string'
                ? mount.move_type
                : undefined,
          }
        }

        let keepaliveHandle: ReturnType<typeof setTimeout> | undefined
        let keepaliveStopped = false

        const stopKeepalive = () => {
          keepaliveStopped = true
          if (keepaliveHandle !== undefined) {
            clearTimeout(keepaliveHandle)
            keepaliveHandle = undefined
          }
        }

        const scheduleKeepalive = () => {
          if (keepaliveStopped) return
          keepaliveHandle = setTimeout(() => {
            void runKeepalive()
          }, 3000)
        }

        const runKeepalive = async () => {
          keepaliveHandle = undefined
          try {
            try {
              await device.testConnection()
              health.state = 'healthy'
              health.lastCheckedAt = new Date().toISOString()
              health.lastError = undefined
              return
            } catch {
              if (keepaliveStopped) return
            }

            health.state = 'stale'
            health.lastCheckedAt = new Date().toISOString()

            Effect.runFork(
              bus.publish(
                'session.keepalive.stale',
                { deviceId: target.deviceId, host },
                { sessionId, host },
              ),
            )
            try {
              health.state = 'recovering'
              const recovered = await device.connectAndAuth()
              if (recovered) {
                health.state = 'healthy'
                health.lastCheckedAt = new Date().toISOString()
                health.lastError = undefined
                Effect.runFork(
                  bus.publish(
                    'session.keepalive.recovered',
                    { deviceId: target.deviceId, host },
                    { sessionId, host },
                  ),
                )
              } else {
                health.state = 'failed'
                health.lastError = 'Authentication failed after reconnect'
                Effect.runFork(
                  bus.publish(
                    'session.keepalive.failed',
                    {
                      deviceId: target.deviceId,
                      host,
                      error: 'Authentication failed after reconnect',
                    },
                    { sessionId, host },
                  ),
                )
              }
            } catch (error) {
              health.state = 'failed'
              health.lastError = toErrorMessage(error)
              Effect.runFork(
                bus.publish(
                  'session.keepalive.failed',
                  {
                    deviceId: target.deviceId,
                    host,
                    error: toErrorMessage(error),
                  },
                  { sessionId, host },
                ),
              )
            }
          } finally {
            scheduleKeepalive()
          }
        }

        // Foreground commands consult the keepalive-maintained health state
        // before issuing device commands. A failed session fails fast with a
        // useful error; healthy/stale/recovering sessions proceed normally.
        const guardHealth = <A, E>(
          run: Effect.Effect<A, E>,
        ): Effect.Effect<A, E | Error> =>
          Effect.gen(function* () {
            if (health.state === 'failed') {
              return yield* Effect.fail(
                new Error(
                  `Session is failed: ${health.lastError ?? 'unknown error'}`,
                ),
              )
            }
            return yield* run
          })

        return yield* Effect.gen(function* () {
          yield* bus.publish('session.authenticate.step.started', {
            step: 'device.authenticate',
            host,
            deviceId: input.deviceId,
          })

          const authenticated = yield* Effect.tryPromise({
            try: () => device.authenticate(),
            catch: (error) =>
              new Error(
                `device.authenticate failed for ${host}: ${toErrorMessage(error)}`,
              ),
          }).pipe(
            Effect.catchAll((error) =>
              bus
                .publish('session.authenticate.step.failed', {
                  step: 'device.authenticate',
                  host,
                  deviceId: input.deviceId,
                  error: toErrorMessage(error),
                })
                .pipe(Effect.zipRight(Effect.fail(error))),
            ),
          )

          yield* bus.publish('session.authenticate.step.succeeded', {
            step: 'device.authenticate',
            host,
            deviceId: target.deviceId,
          })

          if (!authenticated) {
            return yield* Effect.fail(
              new Error(
                'Authentication failed. Verify the PEM key and device firmware.',
              ),
            )
          }

          yield* bus.publish('session.preflightCheck.step.started', {
            step: 'device.preflightCheck',
            host,
            deviceId: input.deviceId,
          })

          const summary = yield* Effect.tryPromise({
            try: () => device.preflightCheck(),
            catch: (error) =>
              new Error(
                `device.preflightCheck failed for ${host}: ${toErrorMessage(error)}`,
              ),
          }).pipe(
            Effect.catchAll((error) =>
              bus
                .publish('session.preflightCheck.step.failed', {
                  step: 'device.preflightCheck',
                  host,
                  deviceId: input.deviceId,
                  error: toErrorMessage(error),
                })
                .pipe(Effect.zipRight(Effect.fail(error))),
            ),
          )

          yield* bus.publish('session.preflightCheck.step.succeeded', {
            step: 'device.preflightCheck',
            host,
            deviceId: target.deviceId,
          })

          scheduleKeepalive()

          initialWarnings = summary.warnings

          const session = {
            sessionId,
            pluginKind: 'seestar',
            deviceId: target.deviceId,
            host,
            productModel: target.productModel,
            openedAt: new Date().toISOString(),
            capabilities: SEESTAR_CAPABILITIES,
            health,
            disconnect: Effect.sync(() => {
              stopKeepalive()
              device.disconnect()
            }),
            prepareForPointing: (input: PrepareForPointingInput) =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  const timeOk = await device.setTime()
                  if (!timeOk) {
                    throw new Error('Device rejected set-time request')
                  }
                  const locationOk = await device.setUserLocation(
                    input.lat,
                    input.lon,
                  )
                  if (!locationOk) {
                    throw new Error('Device rejected set-user-location request')
                  }
                  const [deviceState, viewState] = await Promise.all([
                    device.getDeviceState(),
                    device.getViewState(),
                  ])
                  if (mapSeestarRefresh(deviceState, viewState, initialWarnings).preview.active) {
                    const stopOk = await device.stopView(undefined, {
                      waitForCompletion: true,
                      timeoutMs: 30000,
                      pollIntervalMs: 500,
                    })
                    if (!stopOk) {
                      throw new Error('Device rejected stop-view request')
                    }
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.prepareForPointing failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            openArm: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  // moveToHorizon already waits for mount convergence
                  // internally, but can return false or throw on a
                  // timeout-ish push event. Re-command toward the open
                  // state and treat success as reaching mount.close ===
                  // false with move_type === 'none', not merely a true
                  // return value.
                  for (let attempt = 1; attempt <= 3; attempt += 1) {
                    let ok = false
                    try {
                      ok = await device.moveToHorizon({
                        waitForCompletion: true,
                        timeoutMs: 60000,
                        pollIntervalMs: 500,
                      })
                    } catch {
                      ok = false
                    }
                    if (ok) {
                      const { close, moveType } = await readMountState()
                      if (close === false && moveType === 'none') return
                    }
                    if (attempt < 3) {
                      await delay(2000)
                    }
                  }
                  // Final convergence check after the last attempt.
                  const { close, moveType } = await readMountState()
                  if (close === false && moveType === 'none') return
                  throw new Error(
                    `Mount did not converge to open state (close=${close}, move_type=${moveType})`,
                  )
                },
                catch: (error) =>
                  new Error(
                    `device.moveToHorizon failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            parkArm: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  // park() can return false or throw on a timeout-ish push
                  // event even when the mount actually ended up closed.
                  // Re-command toward the closed state and treat success as
                  // reaching mount.close === true, not merely a true return
                  // value. Mirrors the SDK's private parkWithRetries pattern.
                  for (let attempt = 1; attempt <= 3; attempt += 1) {
                    let ok = false
                    try {
                      ok = await device.park({
                        waitForCompletion: true,
                        timeoutMs: 60000,
                        pollIntervalMs: 500,
                      })
                    } catch {
                      ok = false
                    }
                    if (ok) return
                    const { close } = await readMountState()
                    if (close === true) return
                    if (attempt < 3) {
                      await delay(2000)
                    }
                  }
                  // Final convergence check after the last attempt.
                  const { close } = await readMountState()
                  if (close !== true) {
                    throw new Error('Device rejected park request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.park failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            pointToCoordinates: (input: PointToCoordinatesInput) =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  // Verified live-device sequence: start a target-aware star
                  // view (which slews to target_ra_dec), then stop the view so
                  // the device stays pointed without an active view session.
                  // Raw scope_goto is not sufficient from a parked/closed mount.
                  lastViewMode = input.mode
                  const viewOk = await device.startViewDetailed(
                    {
                      mode: input.mode,
                      targetName: input.targetName,
                      targetRaDec: [input.raHours, input.decDeg],
                    },
                    DEFAULT_GOTO_WAIT,
                  )
                  if (!viewOk) {
                    throw new Error(
                      `Device rejected start-view request for ${input.targetName ?? 'target'}`,
                    )
                  }
                  const stopOk = await device.stopView(undefined, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!stopOk) {
                    throw new Error('Device rejected stop-view request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.pointToCoordinates failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            startPreview: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  // Use the last target-appropriate view mode (set by
                  // pointToCoordinates) so the preview->capture handoff can
                  // stack. Hardcoding 'scenery' broke stacking after a DSO
                  // point because startCapture expects a stackable star-mode
                  // view to already be active.
                  const ok = await device.startView(lastViewMode, undefined, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected start-view request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.startView failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            stopPreview: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  const ok = await device.stopView(undefined, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected stop-view request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.stopView failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            startCapture: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  // Stacking requires an active view in a stackable mode
                  // (star/moon/sun/planet). After pointing the view is
                  // stopped; after preview it may be in the right mode or
                  // may have been left in a non-stackable state. Normalize:
                  // if no view is active, or the active view is in the wrong
                  // mode, (re)start it with the last target mode before
                  // stacking. No target_ra_dec is sent, so the mount stays
                  // at its current position instead of re-slewing.
                  const [deviceState, viewState] = await Promise.all([
                    device.getDeviceState(),
                    device.getViewState(),
                  ])
                  const refresh = mapSeestarRefresh(deviceState, viewState, initialWarnings)
                  const needsViewRestart =
                    !refresh.preview.active ||
                    (refresh.device.viewMode !== undefined &&
                      refresh.device.viewMode !== lastViewMode)
                  if (needsViewRestart) {
                    if (refresh.preview.active) {
                      const stopOk = await device.stopView(undefined, {
                        waitForCompletion: true,
                        timeoutMs: 30000,
                        pollIntervalMs: 500,
                      })
                      if (!stopOk) {
                        throw new Error('Device rejected stop-view request before stacking')
                      }
                    }
                    const viewOk = await device.startView(lastViewMode, undefined, {
                      waitForCompletion: true,
                      timeoutMs: 30000,
                      pollIntervalMs: 500,
                    })
                    if (!viewOk) {
                      throw new Error('Device rejected start-view request before stacking')
                    }
                  }
                  const ok = await device.startStack(true, {
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected start-stack request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.startStack failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            stopCapture: () =>
              guardHealth(Effect.tryPromise({
                try: async () => {
                  const ok = await device.stopStack({
                    waitForCompletion: true,
                    timeoutMs: 30000,
                    pollIntervalMs: 500,
                  })
                  if (!ok) {
                    throw new Error('Device rejected stop-stack request')
                  }
                },
                catch: (error) =>
                  new Error(
                    `device.stopStack failed for ${host}: ${toErrorMessage(error)}`,
                  ),
              })),
            refresh: guardHealth(Effect.tryPromise({
              try: async () => {
                const [deviceState, viewState] = await Promise.all([
                  device.getDeviceState(),
                  device.getViewState(),
                ])
                return mapSeestarRefresh(deviceState, viewState, initialWarnings)
              },
              catch: (error) =>
                new Error(
                  `device.refresh failed for ${host}: ${toErrorMessage(error)}`,
                ),
            })),
            device: {
              pluginKind: 'seestar',
              deviceId: target.deviceId,
              displayName: target.displayName,
              host,
              productModel: summary.productModel ?? target.productModel,
              serialNumber: summary.serialNumber ?? target.serialNumber,
              firmwareVersion: summary.firmwareVersion,
              batteryPercent: summary.batteryPercent,
              deviceTempC: summary.deviceTempC,
              batteryTempC: summary.batteryTempC,
              tracking: summary.tracking,
              mountClosed: summary.mountClosed,
              connectedAt: new Date().toISOString(),
              location: summary.location,
              deviceTime: summary.deviceTime,
              deviceTimeLooksStale: summary.deviceTimeLooksStale,
              viewMode: summary.viewMode,
              viewStage: summary.viewStage,
              viewState: summary.viewState,
              storageFreeMb: summary.storageFreeMb,
              storageTotalMb: summary.storageTotalMb,
              warnings: summary.warnings,
            },
            preview: { phase: 'none', source: 'none', active: false },
            capture: { phase: 'idle' },
            library: { scope: 'current_target', assets: [], polling: false },
          } satisfies Omit<LiveDeviceSession, 'rig'>

          // Seestar's slew/imaging are view-based orchestration, not direct
          // component commands, so generic camera/focuser/filterWheel/storage
          // are not exposed on the rig. Parking is a real mount capability,
          // so mount is populated with park only; direct slew/stop stay
          // omitted (they surface via the pointing workflow instead). A
          // future Alpaca rig would populate the generic component slots
          // and mount.slewToCoordinates/stopMotion directly.
          const rig: ConnectedRig = {
            identity: {
              rigId: target.deviceId,
              pluginKind: 'seestar',
              displayName: target.displayName,
              host,
            },
            connection: { disconnect: session.disconnect },
            observerLocation: summary.location,
            capabilities: SEESTAR_CAPABILITIES,
            connect: {
              device: session.device,
              preview: session.preview,
              capture: session.capture,
              library: session.library,
            },
            refresh: session.refresh,
            mount: {
              park: () => session.parkArm(),
            },
            pointing: {
              // prepare owns all readiness steps before slewing: sync time
              // and location, stop any active view, and open the arm if the
              // mount is parked/closed. The app-level pointing workflow no
              // longer calls session.openArm() directly.
              prepare: (input) =>
                session.prepareForPointing(input).pipe(
                  Effect.zipRight(session.refresh),
                  Effect.flatMap((refreshed) =>
                    refreshed.device.mountClosed
                      ? session.openArm()
                      : Effect.void,
                  ),
                ),
              // Boundary cast: the rig model keeps mode generic (string) while
              // the Seestar session requires its narrower SeestarViewMode union.
              pointToCoordinates: (input) =>
                session.pointToCoordinates({
                  mode: input.mode as SeestarViewMode,
                  targetName: input.targetName,
                  raHours: input.raHours,
                  decDeg: input.decDeg,
                }),
            },
            preview: {
              start: () => session.startPreview(),
              stop: () => session.stopPreview(),
            },
            capture: {
              start: () => session.startCapture(),
              stop: () => session.stopCapture(),
            },
          }

          return { ...session, rig } satisfies DeviceSession
        }).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              stopKeepalive()
              device.disconnect()
            }).pipe(Effect.zipRight(Effect.fail(error))),
          ),
        )
      }),
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function mapSeestarRefresh(
  deviceState: DeviceState | null,
  viewState: ViewStateResult | null,
  initialWarnings: string[],
): DeviceSessionRefresh {
  const mount =
    deviceState &&
    typeof deviceState.mount === 'object' &&
    deviceState.mount !== null
      ? (deviceState.mount as Record<string, unknown>)
      : undefined
  const tracking =
    mount && typeof mount.tracking === 'boolean' ? mount.tracking : undefined
  const mountClosed =
    mount && typeof mount.close === 'boolean' ? mount.close : undefined
  const view = viewState?.View
  const viewMode = view && typeof view.mode === 'string' ? view.mode : undefined
  const viewStage =
    view && typeof view.stage === 'string' ? view.stage : undefined
  const viewStateName =
    view && typeof view.state === 'string' ? view.state : undefined
  const viewActive =
    Boolean(viewMode) && viewMode !== 'none' && viewStateName !== 'cancel'
  const stacking = viewStage === 'Stack' && viewStateName !== 'cancel'
  // Drop the connect-time "parked/closed" warning once the mount is no
  // longer closed. Other connect-time warnings (stale clock, low battery,
  // etc.) are preserved; only the mount-state warning is volatile.
  const warnings =
    mountClosed === false
      ? initialWarnings.filter((w) => w !== 'Mount is currently parked/closed')
      : initialWarnings
  return {
    device: { viewMode, viewStage, viewState: viewStateName, tracking, mountClosed, warnings },
    preview: viewActive
      ? { phase: 'active', source: 'rtsp', active: true }
      : { phase: 'none', source: 'none', active: false },
    capture: stacking ? { phase: 'capturing' } : { phase: 'idle' },
  }
}
