import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer } from 'effect'
import { AggregateStore } from './aggregate-store'
import { AggregateStoreLive } from './aggregate-store'
import { RuntimeStateRefLive } from './runtime-state-ref'
import { SessionManager } from '../session/session-manager'
import { SessionManagerLive } from '../session/session-manager.live'
import type { DeviceSession } from '../device/device-plugin'

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
      refresh: Effect.succeed({
        device: {},
        preview: { phase: 'none', source: 'none', active: false },
        capture: { phase: 'idle' },
      }),
    },
  }
}

const testLayer = Layer.provide(
  Layer.mergeAll(AggregateStoreLive, SessionManagerLive),
  RuntimeStateRefLive,
)

async function runWithStore<A>(
  effect: Effect.Effect<A, unknown, AggregateStore | SessionManager>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(testLayer)))
}

const identity = <T>(v: T): T => v

describe('AggregateStore updateIfSession CAS', () => {
  it('applies the update when no current session and no aggregate sessionId', async () => {
    const result = await runWithStore(
      Effect.gen(function* () {
        const store = yield* AggregateStore
        const updated = yield* store.updateIfSession(null, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'test' },
        }))
        return updated
      }),
    )
    assert.notEqual(result, null)
    assert.equal(result!.capture.phase, 'failed')
  })

  it('does not apply the update when a session is current and expected is null', async () => {
    const result = await runWithStore(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore
        // Install a session so state.session is non-null
        const { intent } = yield* sessions.beginConnect
        yield* sessions.install(intent, makeSession('s1'), identity)
        const updated = yield* store.updateIfSession(null, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'test' },
        }))
        return updated
      }),
    )
    assert.equal(result, null)
  })

  it('applies the update when both session identity and sessionId match', async () => {
    const session = makeSession('s1')
    const result = await runWithStore(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore
        const { intent } = yield* sessions.beginConnect
        yield* sessions.install(intent, session, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))
        const updated = yield* store.updateIfSession(session, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'test' },
        }))
        return updated
      }),
    )
    assert.notEqual(result, null)
    assert.equal(result!.capture.phase, 'failed')
  })

  it('does not apply the update when session identity matches but sessionId does not', async () => {
    // This can happen if the aggregate sessionId was cleared by a newer
    // beginConnect/beginDisconnect but the old session object is still
    // referenced by the workflow. The CAS must reject.
    const session = makeSession('s1')
    const result = await runWithStore(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore
        const { intent } = yield* sessions.beginConnect
        yield* sessions.install(intent, session, identity)
        // Simulate a newer intent clearing sessionId
        yield* sessions.beginConnect
        const updated = yield* store.updateIfSession(session, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'test' },
        }))
        return updated
      }),
    )
    assert.equal(result, null)
  })

  it('does not apply the update when sessionId matches but session object identity does not', async () => {
    // Two sessions with the same sessionId string but different object
    // identity. The CAS must reject because the manager's current session
    // is a different object.
    const sessionA = makeSession('s1')
    const sessionB = makeSession('s1') // same sessionId, different object
    const result = await runWithStore(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore
        const { intent } = yield* sessions.beginConnect
        yield* sessions.install(intent, sessionB, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))
        // sessionA has same sessionId but is not the manager's current session
        const updated = yield* store.updateIfSession(sessionA, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'test' },
        }))
        return updated
      }),
    )
    assert.equal(result, null)
  })
})
