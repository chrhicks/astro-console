import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect, Layer, Deferred, Exit, Fiber } from 'effect'
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
  Layer.mergeAll(AggregateStoreLive, SessionManagerLive),
  RuntimeStateRefLive,
)

async function runWithBoth<A>(
  effect: Effect.Effect<A, unknown, AggregateStore | SessionManager>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(testLayer)))
}

const identity = <T>(v: T): T => v

// These tests verify the unified lifecycle coordinator semantics using the
// actual SessionManager + AggregateStore services backed by one shared Ref.
// Concurrent fiber tests use Deferred barriers to reproduce real interleavings.
describe('lifecycle coordinator interleavings (unified ref)', () => {
  it('connect A cleanup delayed, connect B finalizes, A resumes: aggregate stays B', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        // Connect A begins — atomically projects connecting at gen 1
        const { intent: intentA } = yield* sessions.beginConnect

        // Connect B begins — atomically projects connecting at gen 2,
        // superseding A
        const { intent: intentB } = yield* sessions.beginConnect

        // Connect B finalizes: install + reducer atomically projects connected
        const sessionB = makeSession('sB')
        const committedB = yield* sessions.install(intentB, sessionB, (current) => ({
          ...current,
          session: {
            ...current.session,
            phase: 'connected',
            sessionId: 'sB',
          },
        }))
        assert.notEqual(committedB, null)

        // Connect A resumes: install must fail (gen 1 < gen 2)
        const sessionA = makeSession('sA')
        const committedA = yield* sessions.install(intentA, sessionA, (current) => ({
          ...current,
          session: {
            ...current.session,
            phase: 'connected',
            sessionId: 'sA',
          },
        }))
        assert.equal(committedA, null)

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 'sB')
    assert.equal(result.session.generation, 2)
  })

  it('disconnect then connect reversal: connect wins', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        // Initial connected state
        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))

        // Disconnect begins — captures s1, projects disconnecting at gen 2
        const dIntent = yield* sessions.beginDisconnect
        assert.equal(dIntent.session, s1)

        // Connect begins — supersedes disconnect, projects connecting at gen 3
        const { intent: c2 } = yield* sessions.beginConnect

        // Connect succeeds
        const s2 = makeSession('s2')
        const committedC2 = yield* sessions.install(c2, s2, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's2' },
        }))
        assert.notEqual(committedC2, null)

        // Disconnect tries to clear — must fail (gen 2 < gen 3)
        const committedD = yield* sessions.clear(dIntent, (current) => ({
          ...current,
          session: { ...current.session, phase: 'disconnected' },
        }))
        assert.equal(committedD, null)

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 's2')
    assert.equal(result.session.generation, 3)
  })

  it('connect then disconnect: disconnect wins', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))

        const dIntent = yield* sessions.beginDisconnect
        const committed = yield* sessions.clear(dIntent, (current) => ({
          ...current,
          session: {
            ...current.session,
            phase: 'disconnected',
            sessionId: undefined,
          },
        }))
        assert.notEqual(committed, null)

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'disconnected')
    assert.equal(result.session.sessionId, undefined)
  })

  it('stale session update rejected immediately after begin intent', async () => {
    // After a newer beginConnect, an updateIfSession with the old session
    // object must be rejected immediately — no window where the old session
    // can write to the aggregate.
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        // Connect succeeds
        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))

        // A newer connect begins — atomically clears session and sessionId
        yield* sessions.beginConnect

        // Stale session s1 tries to update — must be rejected
        const updated = yield* store.updateIfSession(s1, (current) => ({
          ...current,
          capture: { phase: 'failed', lastError: 'stale' },
        }))
        assert.equal(updated, null)

        const agg = yield* store.get
        return agg
      }),
    )
    // The aggregate should still be in 'connecting' (from the newer beginConnect)
    assert.equal(result.session.phase, 'connecting')
    assert.equal(result.session.sessionId, undefined)
    assert.equal(result.capture.phase, 'idle')
  })

  it('connect failure only updates aggregate if generation still owns it', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent: intentA } = yield* sessions.beginConnect
        const { intent: intentB } = yield* sessions.beginConnect

        // Connect B succeeds
        const sessionB = makeSession('sB')
        yield* sessions.install(intentB, sessionB, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 'sB' },
        }))

        // Connect A fails — clear with failure reducer must be no-op
        const committed = yield* sessions.clear(
          { generation: intentA.generation, session: null },
          (current) => ({
            ...current,
            session: {
              ...current.session,
              phase: 'disconnected',
              lastError: 'A failed',
            },
          }),
        )
        assert.equal(committed, null)

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 'sB')
  })

  it('disconnect failure only updates aggregate if generation still owns it', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))

        const dIntent = yield* sessions.beginDisconnect
        const { intent: c2 } = yield* sessions.beginConnect
        const s2 = makeSession('s2')
        yield* sessions.install(c2, s2, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's2' },
        }))

        // Disconnect fails — clear with failure reducer must be no-op
        const committed = yield* sessions.clear(dIntent, (current) => ({
          ...current,
          session: {
            ...current.session,
            phase: 'disconnected',
            lastError: 'disconnect failed',
          },
        }))
        assert.equal(committed, null)

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 's2')
  })
})

// Concurrent fiber tests using Deferred barriers to reproduce real async
// interleavings. These verify that the unified Ref.modify prevents races
// even when fibers yield at await points.
describe('lifecycle coordinator concurrent fibers', () => {
  it('delayed connect A, connect B finalizes, A resumes: aggregate stays B', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        // Barrier: A signals after beginConnect, waits for B to finalize
        const aBegan = yield* Deferred.make<void>()
        const bDone = yield* Deferred.make<void>()

        // Fiber A: beginConnect, then wait for B to finalize, then try install
        const fiberA = yield* Effect.forkChild(
          Effect.gen(function* () {
            const { intent: intentA } = yield* sessions.beginConnect
            yield* Deferred.succeed(aBegan, undefined)
            yield* Deferred.await(bDone)
            // A resumes and tries to install — must fail
            const sessionA = makeSession('sA')
            const committed = yield* sessions.install(intentA, sessionA, (current) => ({
              ...current,
              session: {
                ...current.session,
                phase: 'connected',
                sessionId: 'sA',
              },
            }))
            return committed
          }),
        )

        // Fiber B: wait for A to begin, then beginConnect + install
        const fiberB = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.await(aBegan)
            const { intent: intentB } = yield* sessions.beginConnect
            const sessionB = makeSession('sB')
            const committed = yield* sessions.install(intentB, sessionB, (current) => ({
              ...current,
              session: {
                ...current.session,
                phase: 'connected',
                sessionId: 'sB',
              },
            }))
            yield* Deferred.succeed(bDone, undefined)
            return committed
          }),
        )

        const exitA = yield* Fiber.await(fiberA)
        const exitB = yield* Fiber.await(fiberB)

        assert.equal(Exit.isSuccess(exitA), true)
        assert.equal(Exit.isSuccess(exitB), true)
        assert.equal(exitA.value, null) // A was superseded
        assert.notEqual(exitB.value, null) // B succeeded

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 'sB')
  })

  it('disconnect/connect reversal with fibers: connect wins', async () => {
    const result = await runWithBoth(
      Effect.gen(function* () {
        const sessions = yield* SessionManager
        const store = yield* AggregateStore

        // Initial connected state
        const { intent: c1 } = yield* sessions.beginConnect
        const s1 = makeSession('s1')
        yield* sessions.install(c1, s1, (current) => ({
          ...current,
          session: { ...current.session, phase: 'connected', sessionId: 's1' },
        }))

        // Barrier: disconnect signals after begin, connect waits
        const dBegan = yield* Deferred.make<void>()

        // Fiber D: beginDisconnect, signal, wait for C to finalize, try clear
        const fiberD = yield* Effect.forkChild(
          Effect.gen(function* () {
            const dIntent = yield* sessions.beginDisconnect
            yield* Deferred.succeed(dBegan, undefined)
            // Wait a bit for C to finalize
            yield* Effect.sleep('10 millis')
            const committed = yield* sessions.clear(dIntent, (current) => ({
              ...current,
              session: { ...current.session, phase: 'disconnected' },
            }))
            return committed
          }),
        )

        // Fiber C: wait for D to begin, then beginConnect + install
        const fiberC = yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Deferred.await(dBegan)
            const { intent: c2 } = yield* sessions.beginConnect
            const s2 = makeSession('s2')
            const committed = yield* sessions.install(c2, s2, (current) => ({
              ...current,
              session: { ...current.session, phase: 'connected', sessionId: 's2' },
            }))
            return committed
          }),
        )

        const exitD = yield* Fiber.await(fiberD)
        const exitC = yield* Fiber.await(fiberC)

        assert.equal(Exit.isSuccess(exitD), true)
        assert.equal(Exit.isSuccess(exitC), true)
        assert.equal(exitD.value, null) // D was superseded
        assert.notEqual(exitC.value, null) // C succeeded

        const agg = yield* store.get
        return agg
      }),
    )
    assert.equal(result.session.phase, 'connected')
    assert.equal(result.session.sessionId, 's2')
  })
})
