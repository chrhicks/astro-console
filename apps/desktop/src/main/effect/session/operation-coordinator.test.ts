import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Effect, Fiber, Layer } from 'effect'
import type { DeviceSession } from '../device/device-plugin'
import { AggregateStore, AggregateStoreLive } from '../state/aggregate-store'
import { RuntimeStateRefLive } from '../state/runtime-state-ref'
import { OperationCoordinator, OperationCoordinatorLive } from './operation-coordinator'
import { SessionManager } from './session-manager'
import { SessionManagerLive } from './session-manager.live'

const stateLayer = Layer.provide(
  Layer.mergeAll(AggregateStoreLive, SessionManagerLive),
  RuntimeStateRefLive,
)
const coordinatorLayer = Layer.provide(
  OperationCoordinatorLive,
  Layer.merge(stateLayer, RuntimeStateRefLive),
)
const testLayer = Layer.merge(stateLayer, coordinatorLayer)

function makeSession(id: string): DeviceSession {
  return {
    sessionId: id,
    pluginKind: 'fake-seestar',
    deviceId: `test:${id}`,
    health: { state: 'healthy', lastCheckedAt: new Date().toISOString() },
    disconnect: Effect.void,
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
      refresh: Effect.never,
    },
  }
}

const installSession = (session: DeviceSession) =>
  Effect.gen(function* () {
    const sessions = yield* SessionManager
    const intent = (yield* sessions.beginConnect).intent
    yield* sessions.install(intent, session, (current) => ({
      ...current,
      session: {
        ...current.session,
        phase: 'connected',
        sessionId: session.sessionId,
        generation: intent.generation,
      },
    }))
  })

describe('OperationCoordinator production semantics', () => {
  it('recovery preempts ordinary work and stale release cannot clear it', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = makeSession('preempt')
      yield* installSession(session)
      const coordinator = yield* OperationCoordinator
      const ordinary = yield* coordinator.acquire(session, 'capture-start')
      assert.ok(ordinary)
      const recovery = yield* coordinator.acquireRecovery(session, 'stop-capture')
      assert.ok(recovery)
      assert.equal(ordinary.signal.aborted, true)

      yield* coordinator.release(ordinary)
      assert.equal(yield* coordinator.acquire(session, 'preview-start'), null)
      yield* coordinator.release(recovery)
      assert.ok(yield* coordinator.acquire(session, 'preview-start'))
    }).pipe(Effect.provide(testLayer)))
  })

  it('park preempts stop and rejects all recovery while park owns the rig', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = makeSession('park')
      yield* installSession(session)
      const coordinator = yield* OperationCoordinator
      const stop = yield* coordinator.acquireRecovery(session, 'stop-preview')
      assert.ok(stop)
      const park = yield* coordinator.acquireRecovery(session, 'park')
      assert.ok(park)
      assert.equal(stop.signal.aborted, true)
      assert.equal(yield* coordinator.acquireRecovery(session, 'stop-capture'), null)
      assert.equal(yield* coordinator.acquireRecovery(session, 'park'), null)
      assert.equal(yield* coordinator.acquire(session, 'capture-start'), null)
    }).pipe(Effect.provide(testLayer)))
  })

  it('point commands serialize and disconnect invalidates the blocked owner', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = makeSession('point')
      yield* installSession(session)
      const coordinator = yield* OperationCoordinator
      const sessions = yield* SessionManager
      const first = yield* coordinator.acquire(session, 'point')
      assert.ok(first)
      const secondFiber = yield* Effect.forkChild(coordinator.acquire(session, 'point'), { startImmediately: true })
      yield* Effect.sleep('30 millis')
      yield* coordinator.release(first)
      const second = yield* Fiber.join(secondFiber)
      assert.ok(second)

      yield* sessions.beginDisconnect
      assert.equal(second.signal.aborted, true)
      assert.equal(yield* coordinator.commitIfLease(second, (current) => current), null)
      assert.equal(yield* coordinator.acquire(session, 'point'), null)
    }).pipe(Effect.provide(testLayer)))
  })

  it('rejects ordinary acquisition while aggregate hardware state is active', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = makeSession('active')
      yield* installSession(session)
      const store = yield* AggregateStore
      yield* store.updateIfSession(session, (current) => ({
        ...current,
        capture: { phase: 'capturing', startedAt: new Date().toISOString() },
      }))
      const coordinator = yield* OperationCoordinator
      assert.equal(yield* coordinator.acquire(session, 'point'), null)
    }).pipe(Effect.provide(testLayer)))
  })

  it('rejects ordinary work during the dark-cover pause but permits recovery and continuation', async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const session = makeSession('awaiting-darks')
      yield* installSession(session)
      const store = yield* AggregateStore
      yield* store.updateIfSession(session, (current) => ({
        ...current,
        sequence: { ...current.sequence, phase: 'awaiting-darks' },
      }))
      const coordinator = yield* OperationCoordinator

      assert.equal(yield* coordinator.acquire(session, 'point'), null)
      assert.equal(yield* coordinator.acquire(session, 'preview-start'), null)
      assert.equal(yield* coordinator.acquire(session, 'capture-start'), null)
      assert.equal(yield* coordinator.acquire(session, 'sequence'), null)
      const continuation = yield* coordinator.acquire(session, 'sequence-continue')
      assert.ok(continuation)
      yield* coordinator.release(continuation)
      const stop = yield* coordinator.acquireRecovery(session, 'stop-capture')
      assert.ok(stop)
      yield* coordinator.release(stop)
      const park = yield* coordinator.acquireRecovery(session, 'park')
      assert.ok(park)
    }).pipe(Effect.provide(testLayer)))
  })
})
