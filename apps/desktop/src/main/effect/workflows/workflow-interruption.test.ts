import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer, Deferred, Exit, Fiber, Context, Ref } from 'effect'
import { SessionManager } from '../session/session-manager'
import { SessionManagerLive } from '../session/session-manager.live'
import {
  OperationCoordinator,
  OperationCoordinatorLive,
} from '../session/operation-coordinator'
import { RuntimeStateRefLive } from '../state/runtime-state-ref'
import { AggregateStore } from '../state/aggregate-store'
import { AggregateStoreLive } from '../state/aggregate-store'
import { EventBus, type AppEvent } from '../event/event-bus'
import { EventBusLive } from '../event/event-bus'
import { DeviceRegistry } from '../device/device-registry'
import type { DevicePlugin } from '../device/device-plugin'
import type { DeviceSession } from '../device/device-plugin'
import type { ConnectRequestV2, DesktopDiscoveredDeviceV2 } from '../../../shared/api-v2'
import { runConnect, runDisconnect } from './session-workflows'
import { runStartCapture, runStopCapture } from './capture-workflows'

function makeSession(id: string, disconnectFn?: Effect.Effect<void>): DeviceSession {
  return {
    sessionId: id,
    pluginKind: 'fake-seestar',
    deviceId: `test:${id}`,
    health: { state: 'healthy', lastCheckedAt: new Date().toISOString() },
    disconnect: disconnectFn ?? Effect.void,
    rig: {
      identity: {
        rigId: `test:${id}`,
        pluginKind: 'fake-seestar',
        displayName: 'Test',
      },
      connect: {
        device: {},
        preview: { phase: 'none', source: 'none', active: false },
        capture: { phase: 'idle' },
        library: { scope: 'current_target', assets: [], polling: false },
      },
      refresh: Effect.succeed({
        device: {},
        preview: { phase: 'none', source: 'none', active: false },
        capture: { phase: 'idle' },
      }),
      capture: {
        start: () => Effect.void,
      },
      captureStop: { mode: 'native', stop: () => Effect.void },
    },
  }
}

function makeFakeRegistry(
  connectEffect: Effect.Effect<DeviceSession, unknown, EventBus>,
): Layer.Layer<DeviceRegistry> {
  const plugin: DevicePlugin = {
    kind: 'fake-seestar',
    discover: Effect.sync<DesktopDiscoveredDeviceV2[]>(() => []),
    connect: () => connectEffect,
  }
  return Layer.sync(DeviceRegistry, () => ({
    discoverAll: Effect.sync<DesktopDiscoveredDeviceV2[]>(() => []),
    get: (kind) =>
      kind === 'fake-seestar'
        ? Effect.succeed(plugin)
        : Effect.fail(new Error(`Unknown plugin kind: ${kind}`)),
  }))
}

const baseTestLayer = Layer.provide(
  Layer.mergeAll(AggregateStoreLive, SessionManagerLive),
  RuntimeStateRefLive,
)
const coordinatorTestLayer = Layer.provide(
  OperationCoordinatorLive,
  Layer.merge(baseTestLayer, RuntimeStateRefLive),
)

function makeTestLayer(
  registry: Layer.Layer<DeviceRegistry>,
  busLayer: Layer.Layer<EventBus> = EventBusLive,
): Layer.Layer<
  AggregateStore | SessionManager | OperationCoordinator | EventBus | DeviceRegistry
> {
  return Layer.mergeAll(baseTestLayer, coordinatorTestLayer, busLayer, registry)
}

// A fake EventBus that blocks publication of a specific event name on a
// Deferred. Used to test interruption at precise points in the workflow.
function makeBlockingEventBusLayer(
  blockOn: string,
  latch: Deferred.Deferred<void>,
): Layer.Layer<EventBus> {
  return Layer.effect(EventBus, Effect.succeed({
    publish: <A>(name: string, payload: A, options?: { sessionId?: string; host?: string }) =>
      Effect.gen(function* () {
        if (name === blockOn) {
          yield* Deferred.await(latch)
        }
        return {
          eventId: 0,
          ts: new Date().toISOString(),
          sessionId: options?.sessionId,
          host: options?.host,
          name,
          payload,
        } as AppEvent<A>
      }),
    listen: () => Effect.sync(() => () => {}),
    subscribe: () => Effect.succeed({} as never),
  } satisfies EventBus))
}

describe('workflow interruption safety', () => {
  it('interrupt connect while plugin blocks => disconnected aggregate + pluginCleanupCalled', async () => {
    // The fake plugin's connect blocks on a Deferred before returning a
    // session. The plugin brackets its internal work with acquireUseRelease
    // so that interruption during the blocked await cleans up. We fork
    // runConnect, interrupt it while blocked, and verify the aggregate
    // transitions to 'disconnected' and the plugin's cleanup ran.
    // All actions and assertions run within one Effect.provide so they
    // share the same RuntimeStateRef.
    let pluginCleanupCalled = false
    const connectBlocked = Deferred.unsafeMake<void>(Symbol('test'))

    const fakeRegistry = makeFakeRegistry(
      Effect.acquireUseRelease(
        Effect.void,
        () =>
          Effect.gen(function* () {
            const session = makeSession(
              'blocked',
              Effect.sync(() => { pluginCleanupCalled = true }),
            )
            yield* Deferred.await(connectBlocked)
            return session
          }),
        (_acquired, exit) => {
          if (Exit.isSuccess(exit)) return Effect.void
          pluginCleanupCalled = true
          return Effect.void
        },
      ),
    )

    const testLayer = makeTestLayer(fakeRegistry)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:blocked' }),
        )
        yield* Effect.sleep('50 millis')
        yield* Fiber.interrupt(fiber)
        yield* fiber.await

        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )
    assert.equal(result.session.phase, 'disconnected')
    assert.equal(result.session.sessionId, undefined)
    assert.equal(pluginCleanupCalled, true)
  })

  it('interrupt during blocked disconnect => finalizer completes cleanup and terminal clear', async () => {
    let cleanupCompleted = 0
    let cleanupEntries = 0
    const useCleanupEntered = Deferred.unsafeMake<void>(Symbol('use-cleanup'))
    const finalizerCleanupEntered = Deferred.unsafeMake<void>(Symbol('finalizer-cleanup'))
    const allowCleanup = Deferred.unsafeMake<void>(Symbol('allow-cleanup'))

    const session = makeSession(
      's1',
      Effect.gen(function* () {
        cleanupEntries++
        Deferred.unsafeDone(
          cleanupEntries === 1 ? useCleanupEntered : finalizerCleanupEntered,
          Effect.void,
        )
        yield* Deferred.await(allowCleanup)
        cleanupCompleted++
      }),
    )

    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })

        const fiber = yield* Effect.fork(runDisconnect)
        yield* Deferred.await(useCleanupEntered)

        // Fiber.interrupt waits for finalizers, so issue it in a separate
        // fiber. The first cleanup await is interrupted; the uninterruptible
        // release finalizer must enter cleanup again before we unblock it.
        const interruptFiber = yield* Effect.fork(Fiber.interrupt(fiber))
        yield* Deferred.await(finalizerCleanupEntered)
        Deferred.unsafeDone(allowCleanup, Effect.void)
        yield* Fiber.join(interruptFiber)
        yield* fiber.await

        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result.session.phase, 'disconnected')
    assert.equal(result.session.sessionId, undefined)
    assert.equal(cleanupEntries, 2)
    assert.equal(cleanupCompleted, 1)
  })

  it('interrupt after install but before succeeded event => installed session disconnect + disconnected aggregate', async () => {
    // A fake EventBus blocks publication of 'session.connect.succeeded' on
    // a Deferred. The plugin returns a session, runConnect installs it, then
    // blocks on the succeeded-event publication. We interrupt the fiber at
    // that point. The release finalizer must disconnect the installed
    // session and clear the aggregate to 'disconnected'.
    // All actions and assertions run within one Effect.provide so they
    // share the same RuntimeStateRef.
    let cleanupCalled = false
    const succeededLatch = Deferred.unsafeMake<void>(Symbol('test'))

    const session = makeSession(
      's1',
      Effect.sync(() => { cleanupCalled = true }),
    )

    const blockingBusLayer = makeBlockingEventBusLayer(
      'session.connect.succeeded',
      succeededLatch,
    )
    const testLayer = makeTestLayer(
      makeFakeRegistry(Effect.succeed(session)),
      blockingBusLayer,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' }),
        )
        yield* Effect.sleep('50 millis')
        yield* Fiber.interrupt(fiber)
        yield* fiber.await

        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )
    assert.equal(result.session.phase, 'disconnected')
    assert.equal(result.session.sessionId, undefined)
    assert.equal(cleanupCalled, true)
  })

  it('concurrent duplicate capture starts => one device start call', async () => {
    let startCallCount = 0
    const startLatch = Deferred.unsafeMake<void>(Symbol('test'))

    const session = makeSession('s1')
    session.rig.capture = {
      start: () =>
        Effect.gen(function* () {
          startCallCount++
          yield* Deferred.await(startLatch)
        }),
      stop: () => Effect.void,
    }

    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })

        const fiberA = yield* Effect.fork(runStartCapture)
        const fiberB = yield* Effect.fork(runStartCapture)

        yield* Effect.sleep('50 millis')
        Deferred.unsafeDone(startLatch, Effect.void)

        yield* fiberA.await
        yield* fiberB.await

        return startCallCount
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result, 1)
  })

  it('stop preemption makes an aborted capture start succeed quietly', async () => {
    const startEntered = Deferred.unsafeMake<void>(Symbol('start-entered'))
    const session = makeSession('s1')
    session.rig.capture = {
      start: (context) =>
        Effect.tryPromise({
          try: () => {
            Deferred.unsafeDone(startEntered, Effect.void)
            return new Promise<void>((_resolve, reject) => {
              context?.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Aborted', 'AbortError')),
                { once: true },
              )
            })
          },
          catch: (error) => error,
        }),
      stop: () => Effect.void,
    }

    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))
    const exit = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })
        const startFiber = yield* Effect.fork(runStartCapture)
        yield* Deferred.await(startEntered)
        yield* runStopCapture
        return yield* startFiber.await
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(Exit.isSuccess(exit), true)
  })

  it('interrupt during displaced-session cleanup => cleanup completes and ownership clears', async () => {
    let displacedDisconnectCompleted = false
    const displacedCleanupEntered = Deferred.unsafeMake<void>(Symbol('cleanup-entered'))
    const allowDisplacedCleanup = Deferred.unsafeMake<void>(Symbol('allow-cleanup'))

    const sessionA = makeSession(
      'sA',
      Effect.gen(function* () {
        Deferred.unsafeDone(displacedCleanupEntered, Effect.void)
        yield* Deferred.await(allowDisplacedCleanup)
        displacedDisconnectCompleted = true
      }),
    )
    const sessionB = makeSession('sB')

    // Registry that returns sessionA on first connect, sessionB on second.
    let connectCount = 0
    const fakeRegistry = makeFakeRegistry(
      Effect.gen(function* () {
        connectCount++
        if (connectCount === 1) return sessionA
        return sessionB
      }),
    )

    const testLayer = makeTestLayer(fakeRegistry)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        // Install A directly, then connect B. beginConnect B atomically
        // displaces A and immediately enters A's uninterruptible cleanup.
        const sessions = yield* SessionManager
        const { intent: intentA } = yield* sessions.beginConnect
        yield* sessions.install(intentA, sessionA, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 'sA' },
        }))

        const fiber = yield* Effect.fork(
          runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:sB' }),
        )

        yield* Deferred.await(displacedCleanupEntered)
        const interruptFiber = yield* Effect.fork(Fiber.interrupt(fiber))
        // The cleanup is uninterruptible, so it must finish before the
        // pending interruption can unwind the connect bracket.
        Deferred.unsafeDone(allowDisplacedCleanup, Effect.void)
        yield* Fiber.join(interruptFiber)
        yield* fiber.await

        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result.session.phase, 'disconnected')
    assert.equal(result.session.sessionId, undefined)
    assert.equal(displacedDisconnectCompleted, true)
  })
})
