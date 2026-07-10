import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer } from 'effect'
import { SessionManager } from './session-manager'
import { SessionManagerLive } from './session-manager.live'
import { RuntimeStateRefLive } from '../state/runtime-state-ref'
import { AggregateStore } from '../state/aggregate-store'
import { AggregateStoreLive } from '../state/aggregate-store'
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
  Layer.mergeAll(SessionManagerLive, AggregateStoreLive),
  RuntimeStateRefLive,
)

async function runWithSessionManager<A>(
  effect: Effect.Effect<A, unknown, SessionManager | AggregateStore>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(testLayer)))
}

const identity = <T>(v: T): T => v

describe('SessionManager generation-based ownership', () => {
  it('starts with no current session', async () => {
    const session = await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        return yield* sessions.getCurrent
      }),
    )
    assert.equal(session, null)
  })

  it('install succeeds for the current connect intent', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent } = yield* sessions.beginConnect
        const session = makeSession('s1')
        const committed = yield* sessions.install(intent, session, identity)
        assert.notEqual(committed, null)
        const current = yield* sessions.getCurrent
        assert.equal(current, session)
      }),
    )
  })

  it('install fails for a superseded connect intent', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent: intentA } = yield* sessions.beginConnect
        yield* sessions.beginConnect
        const session = makeSession('s1')
        const committed = yield* sessions.install(intentA, session, identity)
        assert.equal(committed, null)
        const current = yield* sessions.getCurrent
        assert.equal(current, null)
      }),
    )
  })

  it('beginConnect returns the superseded session for cleanup', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent: intentA } = yield* sessions.beginConnect
        const sessionA = makeSession('s1')
        yield* sessions.install(intentA, sessionA, identity)

        const { superseded } = yield* sessions.beginConnect
        assert.equal(superseded, sessionA)
        const current = yield* sessions.getCurrent
        assert.equal(current, null)
      }),
    )
  })

  it('beginDisconnect supersedes an in-flight connect', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent: connectIntent } = yield* sessions.beginConnect
        const disconnectIntent = yield* sessions.beginDisconnect
        const session = makeSession('s1')
        const committed = yield* sessions.install(connectIntent, session, identity)
        assert.equal(committed, null)
        assert.equal(disconnectIntent.session, null)
      }),
    )
  })

  it('beginDisconnect captures the current session for cleanup', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent: connectIntent } = yield* sessions.beginConnect
        const session = makeSession('s1')
        yield* sessions.install(connectIntent, session, identity)

        const disconnectIntent = yield* sessions.beginDisconnect
        assert.equal(disconnectIntent.session, session)
        const current = yield* sessions.getCurrent
        assert.equal(current, null)
      }),
    )
  })

  it('clear succeeds for the current disconnect intent', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        yield* sessions.beginConnect
        const intent = yield* sessions.beginDisconnect
        const committed = yield* sessions.clear(intent, identity)
        assert.notEqual(committed, null)
      }),
    )
  })

  it('clear fails when a newer intent supersedes the disconnect', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        yield* sessions.beginConnect
        const disconnectIntent = yield* sessions.beginDisconnect
        yield* sessions.beginConnect
        const committed = yield* sessions.clear(disconnectIntent, identity)
        assert.equal(committed, null)
      }),
    )
  })

  it('ownsSession returns true for the current session and false for a stale one', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent } = yield* sessions.beginConnect
        const sessionA = makeSession('s1')
        yield* sessions.install(intent, sessionA, identity)

        assert.equal(yield* sessions.ownsSession(sessionA), true)

        const { intent: intentB } = yield* sessions.beginConnect
        const sessionB = makeSession('s2')
        yield* sessions.install(intentB, sessionB, identity)

        assert.equal(yield* sessions.ownsSession(sessionA), false)
        assert.equal(yield* sessions.ownsSession(sessionB), true)
      }),
    )
  })

  it('isCurrent returns true for the current generation and false for a stale one', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const { intent } = yield* sessions.beginConnect
        assert.equal(yield* sessions.isCurrent(intent.generation), true)

        yield* sessions.beginConnect
        assert.equal(yield* sessions.isCurrent(intent.generation), false)
      }),
    )
  })

  it('concurrent connect/connect: latest intent wins', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager

        const { intent: intentA } = yield* sessions.beginConnect
        const { intent: intentB } = yield* sessions.beginConnect

        const sessionA = makeSession('s1')
        const sessionB = makeSession('s2')

        const committedA = yield* sessions.install(intentA, sessionA, identity)
        assert.equal(committedA, null)

        const committedB = yield* sessions.install(intentB, sessionB, identity)
        assert.notEqual(committedB, null)

        const current = yield* sessions.getCurrent
        assert.equal(current, sessionB)
      }),
    )
  })

  it('connect then disconnect then connect: each intent is distinct', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager

        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, identity)

        const d1 = yield* sessions.beginDisconnect
        assert.equal(d1.session, s1)
        yield* sessions.clear(d1, identity)

        const { intent: c2 } = yield* sessions.beginConnect
        const s2 = makeSession('s2')
        yield* sessions.install(c2, s2, identity)

        const current = yield* sessions.getCurrent
        assert.equal(current, s2)
        assert.equal(yield* sessions.ownsSession(s1), false)
        assert.equal(yield* sessions.ownsSession(s2), true)
      }),
    )
  })

  it('beginConnect atomically projects connecting phase in aggregate', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent } = yield* sessions.beginConnect
        const agg = yield* store.get
        assert.equal(agg.session.phase, 'connecting')
        assert.equal(agg.session.sessionId, undefined)
        assert.equal(agg.session.generation, intent.generation)
      }),
    )
  })

  it('beginDisconnect atomically projects disconnecting phase in aggregate', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, identity)

        const dIntent = yield* sessions.beginDisconnect
        const agg = yield* store.get
        assert.equal(agg.session.phase, 'disconnecting')
        assert.equal(agg.session.sessionId, undefined)
        assert.equal(agg.session.generation, dIntent.generation)
      }),
    )
  })

  it('install atomically projects connected phase with sessionId', async () => {
    await runWithSessionManager(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        const committed = yield* sessions.install(intent, s1, (current) => ({
          ...current,
          session: {
            ...current.session,
            phase: 'connected',
            sessionId: 's1',
          },
        }))
        assert.notEqual(committed, null)
        assert.equal(committed!.session.phase, 'connected')
        assert.equal(committed!.session.sessionId, 's1')

        const agg = yield* store.get
        assert.equal(agg.session.phase, 'connected')
        assert.equal(agg.session.sessionId, 's1')
      }),
    )
  })
})
