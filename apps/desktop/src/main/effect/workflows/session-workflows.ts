import { Effect, Exit, Cause } from 'effect'
import type {
  ConnectRequestV2,
  LibraryProjection,
} from '../../../shared/api-v2'
import { DeviceRegistry } from '../device/device-registry'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'
import type { DeviceSession } from '../device/device-plugin'
import { readExternalLibraryFromDisk } from '../storage/external-library'
import { DEFAULT_EXPOSURE_DURATION_SEC } from './capture-workflows'

export const runDiscover = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const registry = yield* DeviceRegistry

  const intent = yield* store.beginDiscovery

  yield* bus.publish('session.discover.started', {})

  return yield* registry.discoverAll(intent.signal).pipe(
    Effect.tap((discovered) =>
      Effect.gen(function* () {
        const committed = yield* store.updateIfDiscovery(intent, (current) => ({
          ...current,
          session: {
            ...current.session,
            discovering: false,
            lastError: undefined,
          },
        }))

        if (!committed) return

        yield* bus.publish('session.discover.completed', {
          count: discovered.length,
        })
      }),
    ),
    Effect.catch((error) =>
      Effect.gen(function* () {
        const message = toErrorMessage(error)

        const committed = yield* store.updateIfDiscovery(intent, (current) => ({
          ...current,
          session: {
            ...current.session,
            discovering: false,
            lastError: message,
          },
        }))

        if (committed) {
          yield* bus.publish('session.discover.failed', {
            error: message,
          })
        }

        return yield* Effect.fail(error)
      }),
    ),
  )
})

// Disconnected projection reducer used by connect failure/cancel finalizers.
function disconnectedReducer(message?: string) {
  return (aggregate: import('../state/aggregate').SessionAggregate) => ({
    ...aggregate,
    session: {
      ...aggregate.session,
      phase: 'disconnected' as const,
      discovering: false,
      lastError: message,
      sessionId: undefined,
    },
    pointing: { phase: 'idle' as const, target: null },
    currentTarget: null,
    device: {},
    preview: { phase: 'none' as const, source: 'none' as const, active: false },
    capture: { phase: 'idle' as const },
    library: { scope: 'current_target' as const, assets: [], polling: false },
    camera: null,
    controls: null,
    sequence: { phase: 'idle' as const, completed: 0, failed: 0 },
  })
}

export const runConnect = (input: ConnectRequestV2) =>
  Effect.gen(function* () {
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const registry = yield* DeviceRegistry

    // The entire connect lifecycle is one acquireUseRelease bracket.
    // Acquire is non-failing: beginConnect atomically supersedes any prior
    // intent, clears the current session, and projects phase='connecting' +
    // clears sessionId + records the new generation — all in one Ref.modify.
    // Use does all subsequent work (superseded cleanup, publication, plugin
    // connect, install). Release is an uninterruptible finalizer that
    // handles failure/cancel at any point.

    // Track state for the release finalizer.
    // - connectedSession: any DeviceSession returned by the plugin but not
    //   yet installed (or installed but publication still pending).
    // - installed: true only after exact-generation install succeeded.
    // - supersededSession: the session displaced by beginConnect. The use
    //   phase cleans it up; if interrupted before/during cleanup, the
    //   release must finish the job.
    // - supersededCleaned: true after superseded cleanup completed.
    let connectedSession: DeviceSession | null = null
    let installed = false
    let supersededSession: DeviceSession | null = null
    let supersededCleaned = false

    return yield* Effect.acquireUseRelease(
      // Acquire: non-failing. Atomically begins the connect intent.
      sessions.beginConnect,
      // Use: all work after beginConnect.
      ({ intent, superseded }) =>
        Effect.gen(function* () {
          // Track the displaced session so the release finalizer can
          // disconnect it if the use phase is interrupted before/during
          // cleanup. No displaced session may lose an owner: beginConnect
          // atomically clears the manager's reference, so the bracket is
          // the sole owner until cleanup completes.
          supersededSession = superseded

          // Best-effort superseded-session cleanup. Uninterruptible so a
          // fiber interrupt does not leak the old session. If this
          // completes, supersededCleaned is set so the release skips it.
          if (superseded) {
            yield* superseded.disconnect.pipe(
              Effect.catch(() => Effect.void),
              Effect.uninterruptible,
            )
            supersededCleaned = true
          }

          yield* bus.publish('session.connect.started', {
            pluginKind: input.pluginKind,
            deviceId: input.deviceId,
          })

          const connected = yield* registry
            .get(input.pluginKind)
            .pipe(
              Effect.flatMap((plugin) =>
                Effect.raceFirst(
                  plugin.connect(input),
                  interruptOnAbort(intent.signal),
                ),
              ),
            )

          // Track the session so the release finalizer can disconnect it
          // if install fails or is superseded.
          connectedSession = connected

          // External-camera rigs (Alpaca) start with an empty connect
          // library. Rehydrate saved assets from disk so prior captures
          // reappear without a new exposure.
          const library =
            connected.rig.camera && !connected.rig.capture
              ? yield* hydrateExternalLibrary(connected.rig.connect.library)
              : connected.rig.connect.library

          // Atomically install the session and project the final connected
          // state in one Ref.modify. Returns null if a newer intent
          // superseded this one.
          const committed = yield* sessions.install(
            intent,
            connected,
            (current) => ({
              ...current,
              session: {
                ...current.session,
                phase: 'connected',
                discovering: false,
                lastError: undefined,
                sessionId: connected.sessionId,
              },
              pointing: connected.rig.connect.pointing ?? { phase: 'idle', target: null },
              currentTarget: connected.rig.connect.pointing?.target ?? null,
              device: connected.rig.connect.device,
              preview: connected.rig.connect.preview,
              capture: connected.rig.connect.capture,
              library,
              camera: connected.rig.camera
                ? { exposureSec: DEFAULT_EXPOSURE_DURATION_SEC }
                : null,
              controls: connected.rig.controls?.() ?? null,
              sequence: { phase: 'idle', completed: 0, failed: 0 },
            }),
          )

          if (!committed) {
            // Superseded. Close the session; the newer intent owns the
            // aggregate.
            yield* connected.disconnect.pipe(Effect.catch(() => Effect.void))
            connectedSession = null
            return yield* Effect.fail(
              new Error('Connect superseded by a newer intent'),
            )
          }

          installed = true

          yield* bus.publish(
            'session.connect.succeeded',
            {
              pluginKind: connected.pluginKind,
              deviceId: connected.deviceId,
            },
            {
              sessionId: connected.sessionId,
              host: connected.rig.identity.host,
            },
          )

          return connected
        }),
      // Release: uninterruptible finalizer. Runs on success, failure, and
      // interruption. Behavior:
      // - Success after install: no cleanup (ownership transferred).
      // - Failure/interruption before/during superseded cleanup: disconnect
      //   the displaced session if cleanup did not complete.
      // - Failure/interruption before install: disconnect any returned-but-
      //   uninstalled session, then exact-generation clear to disconnected.
      // - Failure/interruption after install (e.g. succeeded-event
      //   publication): if this generation is still current, disconnect that
      //   installed session and exact-generation clear; if superseded, newer
      //   lifecycle already owns cleanup.
      // All cleanup is idempotent/best-effort.
      ({ intent }, exit) =>
        Effect.gen(function* () {
          if (installed && Exit.isSuccess(exit)) return

          // If the displaced session was not cleaned up (interrupted
          // before/during superseded cleanup), finish the job now. This is
          // best-effort and idempotent.
          if (supersededSession && !supersededCleaned) {
            yield* supersededSession.disconnect.pipe(
              Effect.catch(() => Effect.void),
            )
          }

          const reason = exitFailureReason(exit, 'Connect')

          // Disconnect any session that was returned but not successfully
          // installed + published. If installed but publication failed, we
          // still need to disconnect because the workflow did not complete.
          if (connectedSession && !installed) {
            yield* connectedSession.disconnect.pipe(
              Effect.catch(() => Effect.void),
            )
          } else if (connectedSession && installed && !Exit.isSuccess(exit)) {
            // Installed but the workflow failed/interrupted after install
            // (e.g. during succeeded-event publication). If this generation
            // is still current, disconnect and clear. If superseded, the
            // newer lifecycle owns cleanup.
            const stillCurrent = yield* sessions.isCurrent(intent.generation)
            if (stillCurrent) {
              yield* connectedSession.disconnect.pipe(
                Effect.catch(() => Effect.void),
              )
            }
          }

          // Exact-generation clear to disconnected. Returns null if
          // superseded (newer lifecycle owns the aggregate).
          const result = yield* sessions.clear(
            { generation: intent.generation, session: null },
            disconnectedReducer(reason),
          )

          if (result) {
            yield* bus.publish('session.connect.failed', {
              pluginKind: input.pluginKind,
              deviceId: input.deviceId,
              error: reason,
            })
          }
        }).pipe(Effect.uninterruptible),
    )
  })

export const runDisconnect = Effect.gen(function* () {
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  // The entire disconnect lifecycle is one acquireUseRelease bracket.
  // Acquire is non-failing: beginDisconnect atomically supersedes any
  // in-flight connect, captures the session to close, and projects
  // phase='disconnecting' + clears sessionId + records the new generation.
  // Use does all subsequent work (publication, session close, clear).
  // Release is an uninterruptible finalizer that always terminally
  // disconnects the captured session and exact-generation clears out of
  // 'disconnecting' on failure/interruption.

  return yield* Effect.acquireUseRelease(
    // Acquire: non-failing. Atomically begins the disconnect intent.
    sessions.beginDisconnect,
    // Use: publication, session close, clear.
    (intent) =>
      Effect.gen(function* () {
        const current = intent.session

        yield* bus.publish(
          'session.disconnect.started',
          {},
          current
            ? { sessionId: current.sessionId, host: current.rig.identity.host }
            : undefined,
        )

        if (current) {
          yield* current.disconnect.pipe(Effect.catch(() => Effect.void))
        }

        // Atomically clear the session and project the final disconnected
        // state. Returns null if a newer intent superseded this one.
        const committed = yield* sessions.clear(
          intent,
          disconnectedReducer(undefined),
        )

        if (!committed) return

        yield* bus.publish(
          'session.disconnect.succeeded',
          {},
          current
            ? { sessionId: current.sessionId, host: current.rig.identity.host }
            : undefined,
        )
      }),
    // Release: uninterruptible finalizer. On failure/interruption, always
    // terminally disconnect the captured session and exact-generation clear
    // out of 'disconnecting'. A newer intent may supersede and clear should
    // no-op, but cleanup of the captured old session still completes.
    (intent, exit) =>
      Effect.gen(function* () {
        if (Exit.isSuccess(exit)) return

        const current = intent.session
        const reason = exitFailureReason(exit, 'Disconnect')

        // Always terminally disconnect the captured session, even if a
        // newer intent has superseded. The session is closed regardless.
        if (current) {
          yield* current.disconnect.pipe(Effect.catch(() => Effect.void))
        }

        // Exact-generation clear to disconnected with error. Returns null
        // if superseded (newer lifecycle owns the aggregate).
        const result = yield* sessions.clear(
          intent,
          disconnectedReducer(reason),
        )

        if (result) {
          yield* bus.publish(
            'session.disconnect.failed',
            { error: reason },
            current
              ? {
                  sessionId: current.sessionId,
                  host: current.rig.identity.host,
                }
              : undefined,
          )
        }
      }).pipe(Effect.uninterruptible),
  )
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function interruptOnAbort(signal: AbortSignal): Effect.Effect<never, unknown> {
  return Effect.tryPromise({
    try: (effectSignal) =>
      new Promise<never>((_resolve, reject) => {
        const cleanup = () => {
          signal.removeEventListener('abort', abort)
          effectSignal.removeEventListener('abort', cleanup)
        }
        const abort = () => {
          cleanup()
          reject(new Error('Connect superseded by a newer intent'))
        }
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
        effectSignal.addEventListener('abort', cleanup, { once: true })
      }),
    catch: (error) => error,
  })
}

function exitFailureReason(
  exit: Exit.Exit<unknown, unknown>,
  action: string,
): string {
  if (!Exit.isFailure(exit)) return `${action} failed`
  if (exit.cause.reasons.some(Cause.isInterruptReason))
    return `${action} interrupted`
  return toErrorMessage(Cause.squash(exit.cause))
}

// Rehydrates the aggregate library from saved external assets on disk. Falls
// back to the connect-time library on any failure so connect never breaks on a
// corrupt or unreadable library directory.
function hydrateExternalLibrary(
  base: LibraryProjection,
): Effect.Effect<LibraryProjection> {
  return Effect.tryPromise(() => readExternalLibraryFromDisk()).pipe(
    Effect.map((assets) => ({ ...base, assets })),
    Effect.catch(() => Effect.succeed(base)),
  )
}
