import { Effect } from 'effect'
import type {
  ConnectRequestV2,
} from '../../../shared/api-v2'
import { DeviceRegistry } from '../device/device-registry'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runDiscover = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const registry = yield* DeviceRegistry

  yield* store.update((current) => ({
    ...current,
    session: {
      ...current.session,
      discovering: true,
      lastError: undefined,
    },
  }))

  yield* bus.publish('session.discover.started', {})

  try {
    const discovered = yield* registry.discoverAll

    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        discovering: false,
        lastError: undefined,
      },
    }))

    yield* bus.publish('session.discover.completed', {
      count: discovered.length,
    })

    return discovered
  } catch (error) {
    const message = toErrorMessage(error)

    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        discovering: false,
        lastError: message,
      },
    }))

    yield* bus.publish('session.discover.failed', {
      error: message,
    })

    throw error
  }
})

export const runConnect = (input: ConnectRequestV2) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const registry = yield* DeviceRegistry

    const existing = yield* sessions.getCurrent
    if (existing) {
      yield* existing.disconnect
      yield* sessions.clearCurrent
    }

    yield* store.update((current) => ({
      ...current,
      session: {
        ...current.session,
        phase: 'connecting',
        discovering: false,
        lastError: undefined,
      },
    }))

    yield* bus.publish('session.connect.started', {
      pluginKind: input.pluginKind,
      deviceId: input.deviceId,
    })

    try {
      const plugin = yield* registry.get(input.pluginKind)
      const connected = yield* plugin.connect(input)

      yield* sessions.setCurrent(connected)

      yield* store.update((current) => ({
        ...current,
        session: {
          ...current.session,
          phase: 'connected',
          host: connected.host,
          productModel: connected.productModel,
          discovering: false,
          lastError: undefined,
        },
      }))

      yield* bus.publish(
        'session.connect.succeeded',
        {
          pluginKind: connected.pluginKind,
          deviceId: connected.deviceId,
        },
        {
          sessionId: connected.sessionId,
          host: connected.host,
        },
      )

      return connected
    } catch (error) {
      const message = toErrorMessage(error)

      yield* store.update((current) => ({
        ...current,
        session: {
          ...current.session,
          phase: 'disconnected',
          discovering: false,
          lastError: message,
        },
      }))

      yield* bus.publish('session.connect.failed', {
        pluginKind: input.pluginKind,
        deviceId: input.deviceId,
        error: message,
      })

      throw error
    }
  })

export const runDisconnect = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager

  const current = yield* sessions.getCurrent

  yield* store.update((aggregate) => ({
    ...aggregate,
    session: {
      ...aggregate.session,
      phase: 'disconnecting',
      lastError: undefined,
    },
  }))

  yield* bus.publish(
    'session.disconnect.started',
    {},
    current ? { sessionId: current.sessionId, host: current.host } : undefined,
  )

  try {
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
        lastError: undefined,
      },
    }))

    yield* bus.publish(
      'session.disconnect.succeeded',
      {},
      current ? { sessionId: current.sessionId, host: current.host } : undefined,
    )
  } catch (error) {
    const message = toErrorMessage(error)

    yield* sessions.clearCurrent

    yield* store.update((aggregate) => ({
      ...aggregate,
      session: {
        ...aggregate.session,
        phase: 'disconnected',
        discovering: false,
        lastError: message,
      },
    }))

    yield* bus.publish(
      'session.disconnect.failed',
      { error: message },
      current ? { sessionId: current.sessionId, host: current.host } : undefined,
    )

    throw error
  }
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
