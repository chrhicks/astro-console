import { Effect } from "effect"
import type { LiveDeviceSession } from "../device/device-plugin"
import { AggregateStore } from "../state/aggregate-store"
import { EventBus } from "../event/event-bus"
import { SessionManager } from "../session/session-manager"

export const runFakeConnect = (input: { host: string }) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const host = input.host.trim()
    
    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        phase: 'connecting',
        host,
        lastError: undefined,
      }
    }))

    const started = yield* bus.publish('session.fake-connect.started', {
      host,
    })
    
    yield* Effect.sleep('500 millis')

    const connected = {
      sessionId: crypto.randomUUID(),
      pluginKind: 'fake-seestar',
      deviceId: 'fake-seestar-s30',
      host,
      productModel: 'Seestar S30 (fake)',
      openedAt: new Date().toISOString(),
      disconnect: Effect.sleep('200 millis').pipe(Effect.asVoid),
    } satisfies LiveDeviceSession

    yield* sessions.setCurrent(connected)

    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        phase: 'connected',
        host: connected.host,
        productModel: 'Seestar S30 (fake)',
        lastError: undefined
      }
    }))

    yield* bus.publish(
      'session.fake-connect.succeeded', 
      {
        host: connected.host
      }, {
        sessionId: connected.sessionId,
        host: connected.host
      }
    )

    return started.eventId
  })

export const runFakeDisconnect = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

    const current = yield* sessions.getCurrent

    yield* store.update((aggregate) => ({
      ...aggregate,
      session: {
        ...aggregate.session,
        phase: 'disconnecting',
        lastError: undefined
      }
    }))

    yield* bus.publish(
      'session.fake-disconnect.started',
      {},
      current ? { sessionId: current.sessionId, host: current.host } : undefined
    )

  yield* Effect.sleep('300 millis')
  if (current) {
    yield* current.disconnect
  }
  yield* sessions.clearCurrent

    yield* store.update((aggregate) => ({
      ...aggregate,
      session: {
        ...aggregate.session,
        phase: 'disconnected',
        discovering: false,
        host: undefined,
        productModel: undefined,
        lastError: undefined
      }
    }))

    yield* bus.publish('session.fake-disconnect.succeeded', 
      {},
      current ? { sessionId: current.sessionId, host: current.host } : undefined 
    )
  })
