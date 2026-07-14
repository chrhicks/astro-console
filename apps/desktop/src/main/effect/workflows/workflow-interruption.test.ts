import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer, Deferred, Either, Exit, Fiber, Context, Ref } from 'effect'
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
import { runPark } from './park-workflows'
import {
  runConfigureExternalSequence,
  runContinueExternalSequence,
  runFinishExternalSequence,
  runStartExternalSequence,
} from './external-sequence'
import { captureExternalFrame } from './external-exposure'
import type { RigCamera } from '../rig/rig-model'
import { FrameStorage } from '../storage/frame-storage'

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

function makeExternalSession(
  id: string,
  getExposureState: RigCamera['getExposureState'],
  stopExposure: () => Effect.Effect<void> = () => Effect.void,
  park: () => Effect.Effect<void> = () => Effect.void,
  startExposure: RigCamera['startExposure'] = () => Effect.void,
  getLatestFrame: RigCamera['getLatestFrame'] = () => Effect.fail(new Error('No frame')),
  supportsDark = true,
): DeviceSession {
  const camera: RigCamera = {
    startExposure,
    ...(supportsDark ? { startDarkExposure: (input, context) => startExposure({ ...input, light: false }, context) } : {}),
    stopExposure,
    getExposureState,
    getLatestFrame,
  }
  return {
    sessionId: id,
    pluginKind: 'alpaca-rig',
    deviceId: `test:${id}`,
    health: { state: 'healthy', lastCheckedAt: new Date().toISOString() },
    disconnect: Effect.void,
    rig: {
      identity: {
        rigId: `test:${id}`,
        pluginKind: 'alpaca-rig',
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
      camera,
      captureStop: { mode: 'external', stop: camera.stopExposure },
      mount: { park },
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
const frameStorageTestLayer = Layer.succeed(FrameStorage, {
  preflightExternalFrameStorage: () => Effect.void,
  saveExternalFrame: () => Effect.fail(new Error('Unexpected frame save')),
})

function makeTestLayer(
  registry: Layer.Layer<DeviceRegistry>,
  busLayer: Layer.Layer<EventBus> = EventBusLive,
  storageLayer: Layer.Layer<FrameStorage> = frameStorageTestLayer,
  coordinatorLayer: Layer.Layer<OperationCoordinator> = coordinatorTestLayer,
): Layer.Layer<
  AggregateStore | SessionManager | OperationCoordinator | EventBus | DeviceRegistry | FrameStorage
> {
  return Layer.mergeAll(baseTestLayer, Layer.provide(coordinatorLayer, baseTestLayer), busLayer, registry, storageLayer)
}

function makeDelayedSequenceCoordinatorLayer(
  entered: Deferred.Deferred<void>,
  resume: Deferred.Deferred<void>,
  released: Array<'sequence' | 'sequence-continue'>,
): Layer.Layer<OperationCoordinator> {
  return Layer.effect(OperationCoordinator, Effect.gen(function* () {
    const store = yield* AggregateStore
    return {
      acquire: (session, kind) => Effect.gen(function* () {
        Deferred.unsafeDone(entered, Effect.void)
        yield* Deferred.await(resume)
        const controller = new AbortController()
        return {
          id: `${kind}-${session.sessionId}`,
          sessionId: session.sessionId,
          kind,
          generation: 0,
          signal: controller.signal,
        }
      }),
      acquireRecovery: (session, kind) => Effect.sync(() => {
        const controller = new AbortController()
        return {
          id: `${kind}-${session.sessionId}`,
          sessionId: session.sessionId,
          kind,
          generation: 0,
          signal: controller.signal,
        }
      }),
      release: (lease) => Effect.sync(() => {
        if (lease.kind === 'sequence' || lease.kind === 'sequence-continue') released.push(lease.kind)
      }),
      isCurrent: () => Effect.succeed(true),
      commitIfLease: (_lease, f) => store.update(f),
    } satisfies OperationCoordinator
  }))
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

function makeObservingEventBusLayer(
  observedName: string,
  observed: Deferred.Deferred<void>,
): Layer.Layer<EventBus> {
  return Layer.effect(EventBus, Effect.succeed({
    publish: <A>(name: string, payload: A, options?: { sessionId?: string; host?: string }) =>
      Effect.sync(() => {
        if (name === observedName) Deferred.unsafeDone(observed, Effect.void)
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

function frame() {
  return {
    transfer: 'image-bytes' as const,
    width: 1,
    height: 1,
    pixelFormat: 'mono16' as const,
    data: new Uint8Array([0, 0]),
    imageBytes: { imageElementType: 3, transmissionElementType: 3, rank: 2 },
  }
}

function saved() {
  return { absolutePath: process.execPath, fileSize: 2880 }
}

function sequenceStorage(savedKinds: Array<'light' | 'dark' | undefined>) {
  return Layer.succeed(FrameStorage, {
    preflightExternalFrameStorage: () => Effect.void,
    saveExternalFrame: (input) => Effect.sync(() => {
      savedKinds.push(input.frameKind)
      return saved()
    }),
  })
}

function sequenceProgram(layer: Parameters<typeof Effect.provide>[1], program: () => Generator) {
  return Effect.gen(function* () {
    yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:sequence' })
    const store = yield* AggregateStore
    yield* store.update((current) => ({
      ...current,
      currentTarget: { id: 'target', name: 'Target', short: 'target' },
    }))
    yield* program()
    return yield* store.get
  }).pipe(Effect.provide(layer))
}

describe('workflow interruption safety', () => {
  for (const reason of [
    'External frame storage has insufficient free space',
    'External frame storage is not writable',
  ]) {
    it(`external storage preflight prevents camera start when ${reason.toLowerCase()}`, async () => {
      let startCalls = 0
      const session = makeExternalSession(
        'storage-preflight',
        () => Effect.succeed({ state: 'exposing', imageReady: false }),
        undefined,
        undefined,
        () => Effect.sync(() => { startCalls++ }),
      )
      const storageLayer = Layer.succeed(FrameStorage, {
        preflightExternalFrameStorage: () => Effect.fail(new Error(reason)),
        saveExternalFrame: () => Effect.fail(new Error('Unexpected frame save')),
      })
      const testLayer = makeTestLayer(
        makeFakeRegistry(Effect.succeed(session)),
        EventBusLive,
        storageLayer,
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:storage' })
          yield* runStartCapture.pipe(Effect.either)
          const store = yield* AggregateStore
          return yield* store.get
        }).pipe(Effect.provide(testLayer)),
      )

      assert.equal(startCalls, 0)
      assert.equal(result.capture.phase, 'failed')
      assert.equal(result.capture.lastError, `Storage preflight failed: ${reason}`)
    })
  }

  it('keeps a saved FITS asset and reports preview persistence failure', async () => {
    const partialPublished = Deferred.unsafeMake<void>(Symbol('partial-published'))
    const session = makeExternalSession(
      'preview-failure',
      () => Effect.succeed({ state: 'ready', imageReady: true }),
      undefined,
      undefined,
      undefined,
      () =>
        Effect.succeed({
          transfer: 'image-bytes',
          width: 1,
          height: 1,
          pixelFormat: 'mono16',
          data: new Uint8Array([0, 0]),
          imageBytes: { imageElementType: 3, transmissionElementType: 3, rank: 2 },
        }),
    )
    const storageLayer = Layer.succeed(FrameStorage, {
      preflightExternalFrameStorage: () => Effect.void,
      saveExternalFrame: () =>
        Effect.succeed({
          absolutePath: process.execPath,
          fileSize: 2880,
          previewError: 'JPEG encoder failed',
        }),
    })
    const testLayer = makeTestLayer(
      makeFakeRegistry(Effect.succeed(session)),
      makeObservingEventBusLayer('capture.partial', partialPublished),
      storageLayer,
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:preview' })
        yield* runStartCapture
        yield* Deferred.await(partialPublished)
        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result.capture.phase, 'partial')
    assert.equal(result.capture.lastError, 'JPEG encoder failed')
    assert.equal(result.library.assets.length, 1)
    assert.equal(result.library.assets[0].saved, true)
    assert.equal(result.library.assets[0].previewError, 'JPEG encoder failed')
  })

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

  it('external stop waits for the camera to become idle before projecting stopped', async () => {
    let stopCalls = 0
    const stateEntered = Deferred.unsafeMake<void>(Symbol('state-entered'))
    const allowIdle = Deferred.unsafeMake<void>(Symbol('allow-idle'))
    const session = makeExternalSession(
      's1',
      () =>
        Effect.gen(function* () {
          Deferred.unsafeDone(stateEntered, Effect.void)
          yield* Deferred.await(allowIdle)
          return { state: 'idle' as const, imageReady: false }
        }),
      () => Effect.sync(() => { stopCalls++ }),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })
        yield* runStartCapture
        const stopFiber = yield* Effect.fork(runStopCapture)
        yield* Deferred.await(stateEntered)

        const store = yield* AggregateStore
        const whileConfirming = yield* store.get
        Deferred.unsafeDone(allowIdle, Effect.void)
        yield* Fiber.join(stopFiber)
        const stopped = yield* store.get
        return { whileConfirming, stopped }
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result.whileConfirming.capture.phase, 'capturing')
    assert.equal(result.stopped.capture.phase, 'idle')
    assert.equal(stopCalls, 1)
  })

  it('park waits for an active external exposure to stop before parking', async () => {
    let parkCalls = 0
    const stateEntered = Deferred.unsafeMake<void>(Symbol('state-entered'))
    const allowIdle = Deferred.unsafeMake<void>(Symbol('allow-idle'))
    const session = makeExternalSession(
      's1',
      () =>
        Effect.gen(function* () {
          Deferred.unsafeDone(stateEntered, Effect.void)
          yield* Deferred.await(allowIdle)
          return { state: 'idle' as const, imageReady: false }
        }),
      undefined,
      () => Effect.sync(() => { parkCalls++ }),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })
        yield* runStartCapture
        const parkFiber = yield* Effect.fork(runPark)
        yield* Deferred.await(stateEntered)
        assert.equal(parkCalls, 0)
        Deferred.unsafeDone(allowIdle, Effect.void)
        yield* Fiber.join(parkFiber)
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(parkCalls, 1)
  })

  it('failed park clears a previously parked mount projection', async () => {
    const session = makeExternalSession(
      's1',
      () => Effect.succeed({ state: 'idle', imageReady: false }),
      undefined,
      () => Effect.fail(new Error('Park command failed')),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })
        const store = yield* AggregateStore
        yield* store.update((current) => ({
          ...current,
          device: { ...current.device, mountClosed: true },
        }))
        yield* runPark.pipe(Effect.either)
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(result.device.mountClosed, undefined)
    assert.ok(result.device.warnings?.includes('Park state is unconfirmed'))
  })

  it('external poller attempts stop before reporting a terminal camera error', async () => {
    let stateReads = 0
    let stopCalls = 0
    const session = makeExternalSession(
      's1',
      () =>
        Effect.sync(() => {
          stateReads++
          if (stateReads > 3) return { state: 'idle' as const, imageReady: false }
          return { state: 'error' as const, imageReady: false }
        }),
      () => Effect.sync(() => { stopCalls++ }),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: 'test:s1' })
        yield* runStartCapture
        yield* Effect.sleep('2 seconds')
        const store = yield* AggregateStore
        return yield* store.get
      }).pipe(Effect.provide(testLayer)),
    )

    assert.equal(stopCalls, 1)
    assert.equal(result.capture.phase, 'failed')
    assert.equal(result.capture.lastError, 'Camera reported exposure error')
  })

  it('external poll transport failure attempts stop and preserves the failure', async () => {
    let stopCalls = 0
    const camera: RigCamera = {
      startExposure: () => Effect.void,
      stopExposure: () => Effect.void,
      getExposureState: () => Effect.fail(new Error('Poll transport failed')),
      getLatestFrame: () => Effect.fail(new Error('Unexpected frame retrieval')),
    }

    const result = await Effect.runPromise(
      captureExternalFrame(
        camera,
        { mode: 'external', stop: () => Effect.sync(() => { stopCalls++ }) },
        { durationSec: 1 },
        {},
      ).pipe(Effect.either),
    )

    assert.equal(stopCalls, 1)
    assert.equal(Either.isLeft(result), true)
    if (Either.isLeft(result)) assert.equal(result.left.message, 'Poll transport failed')
  })

  it('does not start an exposure after its context was aborted', async () => {
    let starts = 0
    const controller = new AbortController()
    controller.abort()
    const result = await Effect.runPromise(captureExternalFrame({
      startExposure: () => Effect.sync(() => { starts++ }),
      stopExposure: () => Effect.void,
      getExposureState: () => Effect.succeed({ state: 'idle', imageReady: false }),
      getLatestFrame: () => Effect.fail(new Error('Unexpected frame retrieval')),
    }, { mode: 'external', stop: () => Effect.void }, { durationSec: 1 }, { signal: controller.signal }).pipe(Effect.either))
    assert.equal(starts, 0)
    assert.equal(Either.isLeft(result), true)
  })

  it('treats idle before ready as a stopped external exposure', async () => {
    const states: string[] = []
    const result = await Effect.runPromise(captureExternalFrame({
      startExposure: () => Effect.void,
      stopExposure: () => Effect.void,
      getExposureState: () => Effect.succeed({ state: 'idle', imageReady: false }),
      getLatestFrame: () => Effect.fail(new Error('Unexpected frame retrieval')),
    }, { mode: 'external', stop: () => Effect.void }, {
      durationSec: 1,
      onState: (state) => Effect.sync(() => { states.push(state.state) }),
    }, {}).pipe(Effect.either))
    assert.equal(Either.isLeft(result), true)
    if (Either.isLeft(result)) assert.equal(result.left.message, 'External exposure was stopped')
    assert.deepEqual(states, ['idle'])
  })

  it('rejects a dark plan when the rig has no dark exposure command', async () => {
    let starts = 0
    const session = makeExternalSession('sequence-no-dark', () => Effect.succeed({ state: 'ready', imageReady: true }), undefined, undefined, () => Effect.sync(() => { starts++ }), undefined, false)
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    let rejected = false
    const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
      rejected = Either.isLeft(yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 1, durationSec: 1 }).pipe(Effect.either))
    }))
    assert.equal(rejected, true)
    assert.equal(starts, 0)
  })

  it('runs one light, waits for cover confirmation, then runs one dark', async () => {
    const lights: boolean[] = []
    const savedKinds: Array<'light' | 'dark' | undefined> = []
    const session = makeExternalSession(
      'sequence-light-dark',
      () => Effect.succeed({ state: 'ready', imageReady: true }),
      undefined,
      undefined,
      (input) => Effect.sync(() => { lights.push(input.light ?? true) }),
      () => Effect.succeed(frame()),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage(savedKinds))
    const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 1, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Effect.sleep('700 millis')
      yield* runContinueExternalSequence
      yield* Effect.sleep('700 millis')
    }))
    assert.deepEqual(lights, [true, false])
    assert.deepEqual(savedKinds, ['light', 'dark'])
    assert.equal(result.sequence.phase, 'complete')
  })

  it('records a failed light and continues with the next frame', async () => {
    let starts = 0
    const session = makeExternalSession(
      'sequence-skip',
      () => Effect.succeed({ state: 'ready', imageReady: true }),
      undefined,
      undefined,
      () => Effect.sync(() => { starts++ }),
      () => starts === 1 ? Effect.fail(new Error('frame failed')) : Effect.succeed(frame()),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 2, darkCount: 0, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Effect.sleep('1300 millis')
    }))
    assert.equal(starts, 2)
    assert.equal(result.sequence.failed, 1)
    assert.equal(result.sequence.completed, 1)
  })

  it('stop prevents the next sequence frame from starting', async () => {
    let starts = 0
    let states = 0
    const entered = Deferred.unsafeMake<void>(Symbol('sequence-start'))
    const session = makeExternalSession('sequence-stop', () => Effect.gen(function* () {
      Deferred.unsafeDone(entered, Effect.void)
      states++
      return { state: states === 1 ? 'exposing' as const : 'idle' as const, imageReady: false }
    }), () => Effect.void, undefined, () => Effect.sync(() => { starts++ }))
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 2, darkCount: 0, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Deferred.await(entered)
      yield* runStopCapture
      yield* Effect.sleep('100 millis')
    }))
    assert.equal(starts, 1)
    assert.equal(result.sequence.phase, 'stopped')
  })

  for (const recovery of ['stop', 'park'] as const) {
    it(`${recovery} failure terminalizes an external sequence`, async () => {
      const entered = Deferred.unsafeMake<void>(Symbol(`sequence-${recovery}-failure`))
      const session = makeExternalSession(
        `sequence-${recovery}-failure`,
        () => Effect.sync(() => {
          Deferred.unsafeDone(entered, Effect.void)
          return { state: 'exposing' as const, imageReady: false }
        }),
        () => Effect.fail(new Error(`${recovery} failed`)),
        recovery === 'park' ? () => Effect.void : undefined,
      )
      const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
      const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
        yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 0, durationSec: 1 })
        yield* runStartExternalSequence
        yield* Deferred.await(entered)
        if (recovery === 'stop') yield* runStopCapture.pipe(Effect.either)
        else yield* runPark.pipe(Effect.either)
      }))
      assert.equal(result.sequence.phase, 'failed')
      assert.match(result.sequence.lastError ?? '', new RegExp(`${recovery} failed`))
    })
  }

  it('park stops a sequence before parking and prevents the next frame', async () => {
    const order: string[] = []
    let states = 0
    const entered = Deferred.unsafeMake<void>(Symbol('sequence-park'))
    const session = makeExternalSession('sequence-park', () => Effect.gen(function* () {
      Deferred.unsafeDone(entered, Effect.void)
      states++
      return { state: states === 1 ? 'exposing' as const : 'idle' as const, imageReady: false }
    }), () => Effect.sync(() => { order.push('stop') }), () => Effect.sync(() => { order.push('park') }), () => Effect.sync(() => { order.push('start') }))
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 2, darkCount: 0, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Deferred.await(entered)
      yield* runPark
      yield* Effect.sleep('100 millis')
    }))
    assert.deepEqual(order, ['start', 'stop', 'park'])
  })

  it('rejects sequence storage preflight before any camera start', async () => {
    let starts = 0
    const session = makeExternalSession('sequence-preflight', () => Effect.succeed({ state: 'ready', imageReady: true }), undefined, undefined, () => Effect.sync(() => { starts++ }))
    const storage = Layer.succeed(FrameStorage, { preflightExternalFrameStorage: () => Effect.fail(new Error('full')), saveExternalFrame: () => Effect.succeed(saved()) })
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, storage)
    await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 0, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Effect.sleep('100 millis')
    }))
    assert.equal(starts, 0)
  })

  it('finish during the cover pause cannot continue dark frames', async () => {
    let starts = 0
    const session = makeExternalSession('sequence-finish', () => Effect.succeed({ state: 'ready', imageReady: true }), undefined, undefined, () => Effect.sync(() => { starts++ }), () => Effect.succeed(frame()))
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 1, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Effect.sleep('700 millis')
      yield* runFinishExternalSequence
      yield* runContinueExternalSequence.pipe(Effect.either)
      yield* Effect.sleep('100 millis')
    }))
    assert.equal(starts, 1)
    assert.equal(result.sequence.phase, 'complete')
  })

  for (const action of ['finish', 'stop', 'park'] as const) {
    it(`${action} remains available during the dark-cover pause`, async () => {
      const session = makeExternalSession(
        `sequence-awaiting-${action}`,
        () => Effect.succeed({ state: 'idle', imageReady: false }),
      )
      const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
      const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
        const store = yield* AggregateStore
        yield* store.update((current) => ({
          ...current,
          sequence: {
            phase: 'awaiting-darks',
            plan: { lightCount: 1, darkCount: 1, durationSec: 1 },
            target: { id: 'target', name: 'Target', short: 'target' },
            completed: 1,
            failed: 0,
          },
        }))
        if (action === 'finish') yield* runFinishExternalSequence
        if (action === 'stop') yield* runStopCapture
        if (action === 'park') yield* runPark
      }))
      assert.equal(result.sequence.phase, action === 'finish' ? 'complete' : 'stopped')
    })
  }

  it('stop preempts a queued sequence start before it can start hardware', async () => {
    let starts = 0
    const session = makeExternalSession('sequence-queued-stop', () => Effect.succeed({ state: 'ready', imageReady: true }), undefined, undefined, () => Effect.sync(() => { starts++ }), () => Effect.succeed(frame()))
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 0, durationSec: 1 })
      yield* runStartExternalSequence
      yield* runStopCapture
      yield* Effect.sleep('600 millis')
    }))
    assert.equal(starts, 0)
  })

  it('finish preempts a queued dark continuation before it can start hardware', async () => {
    let starts = 0
    const session = makeExternalSession('sequence-queued-finish', () => Effect.succeed({ state: 'ready', imageReady: true }), undefined, undefined, () => Effect.sync(() => { starts++ }), () => Effect.succeed(frame()))
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 1, durationSec: 1 })
      yield* runStartExternalSequence
      yield* Effect.sleep('700 millis')
      yield* runContinueExternalSequence
      yield* runFinishExternalSequence
      yield* Effect.sleep('600 millis')
    }))
    assert.equal(starts, 1)
  })

  for (const request of ['start', 'continue'] as const) {
    for (const action of ['finish', 'stop', 'park'] as const) {
      it(`${action} terminalization between ${request} request and lease acquisition cannot start an exposure`, async () => {
        let starts = 0
        const entered = Deferred.unsafeMake<void>(Symbol(`sequence-${request}-${action}-entered`))
        const resume = Deferred.unsafeMake<void>(Symbol(`sequence-${request}-${action}-resume`))
        const released: Array<'sequence' | 'sequence-continue'> = []
        const session = makeExternalSession(
          `sequence-${request}-${action}`,
          () => Effect.succeed({ state: 'ready', imageReady: true }),
          undefined,
          undefined,
          () => Effect.sync(() => { starts++ }),
          () => Effect.succeed(frame()),
        )
        const testLayer = makeTestLayer(
          makeFakeRegistry(Effect.succeed(session)),
          EventBusLive,
          sequenceStorage([]),
          makeDelayedSequenceCoordinatorLayer(entered, resume, released),
        )
        const result = await Effect.runPromise(sequenceProgram(testLayer, function* () {
          const store = yield* AggregateStore
          yield* store.update((current) => ({
            ...current,
            sequence: request === 'start'
              ? { phase: 'idle', plan: { lightCount: 1, darkCount: 1, durationSec: 1 }, completed: 0, failed: 0 }
              : { phase: 'awaiting-darks', plan: { lightCount: 1, darkCount: 1, durationSec: 1 }, target: { id: 'target', name: 'Target', short: 'target' }, completed: 1, failed: 0 },
          }))
          const requestFiber = yield* Effect.fork(request === 'start' ? runStartExternalSequence : runContinueExternalSequence)
          yield* Deferred.await(entered)
          yield* store.update((current) => ({
            ...current,
            sequence: {
              ...current.sequence,
              phase: action === 'finish' ? 'awaiting-darks' : 'lights',
              target: current.sequence.target ?? { id: 'target', name: 'Target', short: 'target' },
            },
          }))
          if (action === 'finish') yield* runFinishExternalSequence
          if (action === 'stop') yield* runStopCapture
          if (action === 'park') yield* runPark
          Deferred.unsafeDone(resume, Effect.void)
          yield* requestFiber.await
          return yield* store.get
        }))

        assert.equal(starts, 0)
        assert.deepEqual(released, [request === 'start' ? 'sequence' : 'sequence-continue'])
        assert.equal(result.sequence.phase, action === 'finish' ? 'complete' : 'stopped')
      })
    }
  }

  it('rejects configuration and sequence start while capture owns the rig', async () => {
    let stopped = false
    const session = makeExternalSession(
      'sequence-capture-conflict',
      () => Effect.succeed(stopped ? { state: 'idle' as const, imageReady: false } : { state: 'exposing' as const, imageReady: false }),
      () => Effect.sync(() => { stopped = true }),
    )
    const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
    let configureRejected = false
    let startRejected = false
    await Effect.runPromise(sequenceProgram(testLayer, function* () {
      yield* runConfigureExternalSequence({ lightCount: 1, darkCount: 0, durationSec: 1 })
      yield* runStartCapture
      configureRejected = Either.isLeft(yield* runConfigureExternalSequence({ lightCount: 2, darkCount: 0, durationSec: 1 }).pipe(Effect.either))
      startRejected = Either.isLeft(yield* runStartExternalSequence.pipe(Effect.either))
      yield* runStopCapture
    }))
    assert.equal(configureRejected, true)
    assert.equal(startRejected, true)
  })

  for (const phase of ['lights', 'awaiting-darks'] as const) {
    it(`resets a ${phase} sequence when reconnecting`, async () => {
      const session = makeExternalSession(`sequence-reset-${phase}`, () => Effect.succeed(phase === 'lights' ? { state: 'exposing' as const, imageReady: false } : { state: 'ready' as const, imageReady: true }), undefined, undefined, () => Effect.void, () => Effect.succeed(frame()))
      const testLayer = makeTestLayer(makeFakeRegistry(Effect.succeed(session)), EventBusLive, sequenceStorage([]))
      const result = await Effect.runPromise(Effect.gen(function* () {
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: `test:${phase}` })
        const store = yield* AggregateStore
        yield* store.update((current) => ({ ...current, currentTarget: { id: 'target', name: 'Target', short: 'target' } }))
        yield* runConfigureExternalSequence({ lightCount: 1, darkCount: phase === 'awaiting-darks' ? 1 : 0, durationSec: 1 })
        yield* runStartExternalSequence
        yield* Effect.sleep(phase === 'lights' ? '100 millis' : '700 millis')
        yield* runDisconnect
        yield* runConnect({ pluginKind: 'fake-seestar', deviceId: `test:${phase}` })
        return yield* store.get
      }).pipe(Effect.provide(testLayer)))
      assert.deepEqual(result.sequence, { phase: 'idle', completed: 0, failed: 0 })
    })
  }

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
