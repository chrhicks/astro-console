import { app } from 'electron'
import { Effect, Exit, Ref, Schema } from 'effect'
import {
  resolveSeestarPemPath,
  SeestarDevice,
  discoverSeestars,
  createConsoleLogger,
} from 'seestar-sdk'
import type { DeviceState, ViewStateResult } from 'seestar-sdk'
import type {
  ConnectRequestV2,
  DesktopDiscoveredDeviceV2,
  DeviceProjection,
  LiveSessionHealthState,
} from '../../../shared/api-v2'
import type {
  DevicePlugin,
  DeviceSession,
  DeviceSessionRefresh,
  PointToCoordinatesInput,
  PrepareForPointingInput,
  SeestarViewMode,
} from './device-plugin'
import { toSeestarViewMode } from './device-plugin'
import type { ConnectedRig } from '../rig/rig-model'
import { EventBus } from '../event/event-bus.js'

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
  const discoveredRef = Ref.makeUnsafe<Map<string, DesktopDiscoveredDeviceV2>>(
    new Map(),
  )
  const discover = (input: { signal: AbortSignal }) => Effect.gen(function* () {
    const discovered: Awaited<ReturnType<typeof discoverSeestars>> =
      yield* Effect.tryPromise(() =>
        discoverSeestars({ timeoutMs: 2500, signal: input.signal }),
      )

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
    discover: discover({ signal: new AbortController().signal }),
    discoverWithSignal: discover,

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

        // Resource-safety flag: set to true only when the session is
        // successfully returned. The release finalizer checks this flag; on
        // success it is a no-op (ownership transferred to the session's
        // disconnect). On failure/interruption it runs terminal cleanup.
        let sessionOwned = false

        // Keepalive and listener state — shared between the use phase and the
        // release finalizer. Declared before acquireUseRelease so both scopes
        // can reference them.
        let keepaliveHandle: ReturnType<typeof setTimeout> | undefined
        let keepaliveStopped = false
        let keepaliveInFlight: Promise<void> | undefined

        const stopKeepalive = async (): Promise<void> => {
          keepaliveStopped = true
          if (keepaliveHandle !== undefined) {
            clearTimeout(keepaliveHandle)
            keepaliveHandle = undefined
          }
          device.disconnect()
          if (keepaliveInFlight) {
            await keepaliveInFlight.catch(() => {})
          }
        }

        let unsubscribeStackEvents: (() => void) | undefined

        const stopStackEventListener = () => {
          if (unsubscribeStackEvents) {
            unsubscribeStackEvents()
            unsubscribeStackEvents = undefined
          }
        }

        // Terminal cleanup used by both the release finalizer (on failure) and
        // the session's disconnect (on success). Idempotent: safe to call
        // multiple times because stopKeepalive sets keepaliveStopped and
        // stopStackEventListener clears its reference.
        const terminalCleanup = Effect.promise(async () => {
          await stopKeepalive()
          stopStackEventListener()
        })

        return yield* Effect.acquireUseRelease(
          // Acquire: non-failing. Just enters the supervised scope so the
          // release finalizer is registered before any network work begins.
          Effect.void,
          // Use: device.connect, authenticate, preflight, keepalive/listener
          // setup, session construction. On success, sets sessionOwned = true
          // so the release is a no-op.
          () =>
            Effect.gen(function* () {
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
                Effect.catch((error) =>
                  bus
                    .publish('session.connect.step.failed', {
                      step: 'device.connect',
                      host,
                      deviceId: input.deviceId,
                      error: toErrorMessage(error),
                    })
                    .pipe(Effect.andThen(Effect.fail(error))),
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

              let lastViewMode: SeestarViewMode = 'star'
              let initialWarnings: string[] = []

              const delay = (ms: number) =>
                new Promise<void>((resolve) => setTimeout(resolve, ms))

              const readMountState = async (): Promise<{
                close: boolean | undefined
                moveType: string | undefined
              }> => {
                const state = await device.getDeviceState(['mount'])
                const mount = state ? decodeMountState(state.mount) : undefined
                return {
                  close: mount?.close,
                  moveType: mount?.move_type,
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
                if (keepaliveStopped) return
                keepaliveInFlight = (async () => {
                  try {
                    try {
                      await device.testConnection()
                      if (keepaliveStopped) return
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
                      if (keepaliveStopped) return
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
                        health.lastError =
                          'Authentication failed after reconnect'
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
                      if (keepaliveStopped) return
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
                    if (!keepaliveStopped) {
                      scheduleKeepalive()
                    }
                  }
                })()
                await keepaliveInFlight
              }

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
                Effect.catch((error) =>
                  bus
                    .publish('session.authenticate.step.failed', {
                      step: 'device.authenticate',
                      host,
                      deviceId: input.deviceId,
                      error: toErrorMessage(error),
                    })
                    .pipe(Effect.andThen(Effect.fail(error))),
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
                Effect.catch((error) =>
                  bus
                    .publish('session.preflightCheck.step.failed', {
                      step: 'device.preflightCheck',
                      host,
                      deviceId: input.deviceId,
                      error: toErrorMessage(error),
                    })
                    .pipe(Effect.andThen(Effect.fail(error))),
                ),
              )

              yield* bus.publish('session.preflightCheck.step.succeeded', {
                step: 'device.preflightCheck',
                host,
                deviceId: target.deviceId,
              })

              scheduleKeepalive()

              unsubscribeStackEvents = device.subscribeToLifecycleEvents(
                (event) => {
                  if (event.type !== 'capture.failed') return
                  Effect.runFork(
                    bus.publish(
                      'seestar.capture.stack.failed',
                      { error: event.error, deviceId: target.deviceId },
                      { sessionId, host },
                    ),
                  )
                },
              )

              initialWarnings = summary.warnings

              // The session's disconnect owns cleanup on success. The connect
              // bracket's release is a no-op once sessionOwned is set.
              const disconnect = terminalCleanup

              const prepareForPointing = (
                input: PrepareForPointingInput,
                signal?: AbortSignal,
              ) =>
                guardHealth(
                  Effect.tryPromise({
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
                        throw new Error(
                          'Device rejected set-user-location request',
                        )
                      }
                      const { deviceState, viewState } =
                        await device.getSnapshot()
                      if (
                        mapSeestarRefresh(
                          deviceState,
                          viewState,
                          initialWarnings,
                        ).preview.active
                      ) {
                        const stopOk = await device.stopView(undefined, {
                          waitForCompletion: true,
                          timeoutMs: 30000,
                          pollIntervalMs: 500,
                          signal,
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
                  }),
                )

              const openArm = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
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
                            signal,
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
                  }),
                )

              const parkArm = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
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
                            signal,
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
                  }),
                )

              const pointToCoordinates = (
                input: PointToCoordinatesInput,
                signal?: AbortSignal,
              ) =>
                guardHealth(
                  Effect.tryPromise({
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
                        {
                          ...DEFAULT_GOTO_WAIT,
                          signal,
                        },
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
                        signal,
                      })
                      if (!stopOk) {
                        throw new Error('Device rejected stop-view request')
                      }
                    },
                    catch: (error) =>
                      new Error(
                        `device.pointToCoordinates failed for ${host}: ${toErrorMessage(error)}`,
                      ),
                  }),
                )

              const startPreview = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
                    try: async () => {
                      // Use the last target-appropriate view mode (set by
                      // pointToCoordinates) so the preview->capture handoff can
                      // stack. Hardcoding 'scenery' broke stacking after a DSO
                      // point because startCapture expects a stackable star-mode
                      // view to already be active.
                      const ok = await device.startView(
                        lastViewMode,
                        undefined,
                        {
                          waitForCompletion: true,
                          timeoutMs: 30000,
                          pollIntervalMs: 500,
                          signal,
                        },
                      )
                      if (!ok) {
                        throw new Error('Device rejected start-view request')
                      }
                    },
                    catch: (error) =>
                      new Error(
                        `device.startView failed for ${host}: ${toErrorMessage(error)}`,
                      ),
                  }),
                )

              const stopPreview = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
                    try: async () => {
                      const ok = await device.stopView(undefined, {
                        waitForCompletion: true,
                        timeoutMs: 30000,
                        pollIntervalMs: 500,
                        signal,
                      })
                      if (!ok) {
                        throw new Error('Device rejected stop-view request')
                      }
                    },
                    catch: (error) =>
                      new Error(
                        `device.stopView failed for ${host}: ${toErrorMessage(error)}`,
                      ),
                  }),
                )

              const startCapture = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
                    try: async () => {
                      // Stacking requires an active view in a stackable mode
                      // (star/moon/sun/planet). After pointing the view is
                      // stopped; after preview it may be in the right mode or
                      // may have been left in a non-stackable state. Normalize:
                      // if no view is active, or the active view is in the wrong
                      // mode, (re)start it with the last target mode before
                      // stacking. No target_ra_dec is sent, so the mount stays
                      // at its current position instead of re-slewing.
                      const { deviceState, viewState } =
                        await device.getSnapshot()
                      const refreshState = mapSeestarRefresh(
                        deviceState,
                        viewState,
                        initialWarnings,
                      )
                      const needsViewRestart =
                        !refreshState.preview.active ||
                        (refreshState.viewMode !== undefined &&
                          refreshState.viewMode !== lastViewMode)
                      if (needsViewRestart) {
                        if (refreshState.preview.active) {
                          const stopOk = await device.stopView(undefined, {
                            waitForCompletion: true,
                            timeoutMs: 30000,
                            pollIntervalMs: 500,
                            signal,
                          })
                          if (!stopOk) {
                            throw new Error(
                              'Device rejected stop-view request before stacking',
                            )
                          }
                        }
                        const viewOk = await device.startView(
                          lastViewMode,
                          undefined,
                          {
                            waitForCompletion: true,
                            timeoutMs: 30000,
                            pollIntervalMs: 500,
                            signal,
                          },
                        )
                        if (!viewOk) {
                          throw new Error(
                            'Device rejected start-view request before stacking',
                          )
                        }
                      }
                      const ok = await device.startStack(true, {
                        waitForCompletion: true,
                        timeoutMs: 30000,
                        pollIntervalMs: 500,
                        signal,
                      })
                      if (!ok) {
                        throw new Error('Device rejected start-stack request')
                      }
                    },
                    catch: (error) =>
                      new Error(
                        `device.startStack failed for ${host}: ${toErrorMessage(error)}`,
                      ),
                  }),
                )

              const stopCapture = (signal?: AbortSignal) =>
                guardHealth(
                  Effect.tryPromise({
                    try: async () => {
                      const ok = await device.stopStack({
                        waitForCompletion: true,
                        timeoutMs: 30000,
                        pollIntervalMs: 500,
                        signal,
                      })
                      if (!ok) {
                        throw new Error('Device rejected stop-stack request')
                      }
                    },
                    catch: (error) =>
                      new Error(
                        `device.stopStack failed for ${host}: ${toErrorMessage(error)}`,
                      ),
                  }),
                )

              const refresh = guardHealth(
                Effect.tryPromise({
                  try: async () => {
                    const { deviceState, viewState } =
                      await device.getSnapshot()
                    return mapSeestarRefresh(
                      deviceState,
                      viewState,
                      initialWarnings,
                    )
                  },
                  catch: (error) =>
                    new Error(
                      `device.refresh failed for ${host}: ${toErrorMessage(error)}`,
                    ),
                }),
              )

              const deviceProjection: DeviceProjection = {
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
                activity: deriveSeestarActivity(
                  summary.viewMode,
                  summary.viewStage,
                  summary.viewState,
                ),
                storageFreeMb: summary.storageFreeMb,
                storageTotalMb: summary.storageTotalMb,
                warnings: summary.warnings,
              }

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
                observerLocation: summary.location,
                connect: {
                  device: deviceProjection,
                  preview: { phase: 'none', source: 'none', active: false },
                  capture: { phase: 'idle' },
                  library: {
                    scope: 'current_target',
                    assets: [],
                    polling: false,
                  },
                },
                refresh,
                mount: {
                  park: (context) => parkArm(context?.signal),
                },
                pointing: {
                  // prepare owns all readiness steps before slewing: sync time
                  // and location, stop any active view, and open the arm if the
                  // mount is parked/closed. The app-level pointing workflow no
                  // longer calls openArm() directly.
                  prepare: (input, context) =>
                    prepareForPointing(input, context?.signal).pipe(
                      Effect.andThen(refresh),
                      Effect.flatMap((refreshed) =>
                        refreshed.device.mountClosed
                          ? openArm(context?.signal)
                          : Effect.void,
                      ),
                    ),
                  pointToCoordinates: (input, context) =>
                    pointToCoordinates(
                      {
                        mode: toSeestarViewMode(
                          input.targetType,
                          input.targetName,
                        ),
                        targetName: input.targetName,
                        raHours: input.raHours,
                        decDeg: input.decDeg,
                      },
                      context?.signal,
                    ),
                },
                preview: {
                  start: (context) => startPreview(context?.signal),
                  stop: (context) => stopPreview(context?.signal),
                },
                capture: {
                  start: (context) => startCapture(context?.signal),
                },
                captureStop: {
                  mode: 'native',
                  stop: (context) => stopCapture(context?.signal),
                },
                autofocus: {
                  run: (context) =>
                    guardHealth(
                      Effect.tryPromise({
                        try: async () => {
                          const ok = await device.startAutoFocus({
                            waitForCompletion: true,
                            timeoutMs: 60000,
                            pollIntervalMs: 500,
                            signal: context?.signal,
                          })
                          if (!ok)
                            throw new Error('Device rejected autofocus request')
                        },
                        catch: (error) =>
                          new Error(
                            `device.autofocus failed for ${host}: ${toErrorMessage(error)}`,
                          ),
                      }),
                    ),
                },
              }

              const session: DeviceSession = {
                sessionId,
                pluginKind: 'seestar',
                deviceId: target.deviceId,
                health,
                disconnect,
                rig,
              }

              // Ownership transfers to the session's disconnect. The release
              // finalizer will see sessionOwned === true and skip cleanup.
              sessionOwned = true
              return session
            }),
          // Release: on failure/interruption, run terminal cleanup. On success
          // (sessionOwned === true), ownership has transferred to the session's
          // disconnect and the release is a no-op. The release is
          // uninterruptible by Effect's acquireUseRelease semantics.
          (_acquired, exit) => {
            if (sessionOwned && Exit.isSuccess(exit)) return Effect.void
            return terminalCleanup
          },
        )
      }),
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

// Adapter-internal refresh shape: the public DeviceSessionRefresh plus the
// raw Seestar view mode, which startCapture needs to decide whether to
// restart the view before stacking. The raw field stays adapter-local and
// is not surfaced on the public DeviceProjection.
interface SeestarRefresh extends DeviceSessionRefresh {
  viewMode?: string
}

function deriveSeestarActivity(
  viewMode: string | undefined,
  viewStage: string | undefined,
  viewStateName: string | undefined,
): 'idle' | 'previewing' | 'capturing' {
  const viewActive =
    Boolean(viewMode) && viewMode !== 'none' && viewStateName !== 'cancel'
  const stacking = viewStage === 'Stack' && viewStateName !== 'cancel'
  if (stacking) return 'capturing'
  if (viewActive) return 'previewing'
  return 'idle'
}

// Mount sub-object from getDeviceState. The device returns this as a nested
// JSON object; decoding it with Schema validates the trust boundary instead
// of casting the unknown shape.
const SeestarMountState = Schema.Struct({
  close: Schema.optional(Schema.Boolean),
  move_type: Schema.optional(Schema.String),
  tracking: Schema.optional(Schema.Boolean),
})

function decodeMountState(value: unknown) {
  const decoded = Schema.decodeUnknownOption(SeestarMountState)(value)
  if (decoded._tag === 'None') return undefined
  return decoded.value
}

function mapSeestarRefresh(
  deviceState: DeviceState | null,
  viewState: ViewStateResult | null,
  initialWarnings: string[],
): SeestarRefresh {
  const mount = deviceState ? decodeMountState(deviceState.mount) : undefined
  const tracking = mount?.tracking
  const mountClosed = mount?.close
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
    viewMode,
    device: {
      activity: deriveSeestarActivity(viewMode, viewStage, viewStateName),
      tracking,
      mountClosed,
      warnings,
    },
    preview: viewActive
      ? { phase: 'active', source: 'native', active: true }
      : { phase: 'none', source: 'none', active: false },
    capture: stacking ? { phase: 'capturing' } : { phase: 'idle' },
  }
}
