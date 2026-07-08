import { Effect } from 'effect'
import type { ConnectRequestV2 } from '../../../shared/api-v2'
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

  return yield* registry.discoverAll.pipe(
    Effect.tap((discovered) =>
      Effect.gen(function* () {
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
      }),
    ),
    Effect.catchAll((error) =>
      Effect.gen(function* () {
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

        return yield* Effect.fail(error)
      }),
    ),
  )
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

    return yield* registry.get(input.pluginKind).pipe(
      Effect.flatMap((plugin) => plugin.connect(input)),
      Effect.tap((connected) =>
        Effect.gen(function* () {
          yield* sessions.setCurrent(connected)

          yield* store.update((current) => ({
            ...current,
            session: {
              ...current.session,
              phase: 'connected',
              discovering: false,
              lastError: undefined,
            },
            pointing: { phase: 'idle', target: null },
            currentTarget: null,
            device: connected.rig.connect.device,
            preview: connected.rig.connect.preview,
            capture: connected.rig.connect.capture,
            library: connected.rig.connect.library,
          }))

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
        }),
      ),
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const message = toErrorMessage(error)

          yield* store.update((current) => ({
            ...current,
            session: {
              ...current.session,
              phase: 'disconnected',
              discovering: false,
              lastError: message,
            },
            pointing: { phase: 'idle', target: null },
            currentTarget: null,
            device: {},
            preview: { phase: 'none', source: 'none', active: false },
            capture: { phase: 'idle' },
            library: { scope: 'current_target', assets: [], polling: false },
          }))

          yield* bus.publish('session.connect.failed', {
            pluginKind: input.pluginKind,
            deviceId: input.deviceId,
            error: message,
          })

          return yield* Effect.fail(error)
        }),
      ),
    )
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
    current ? { sessionId: current.sessionId, host: current.rig.identity.host } : undefined,
  )

  return yield* Effect.gen(function* () {
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
        lastError: undefined,
      },
      pointing: { phase: 'idle', target: null },
      currentTarget: null,
      device: {},
      preview: { phase: 'none', source: 'none', active: false },
      capture: { phase: 'idle' },
      library: { scope: 'current_target', assets: [], polling: false },
    }))

    yield* bus.publish(
      'session.disconnect.succeeded',
      {},
      current
        ? { sessionId: current.sessionId, host: current.rig.identity.host }
        : undefined,
    )
  }).pipe(
    Effect.catchAll((error) =>
      Effect.gen(function* () {
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
          pointing: { phase: 'idle', target: null },
          currentTarget: null,
          device: {},
          preview: { phase: 'none', source: 'none', active: false },
          capture: { phase: 'idle' },
          library: { scope: 'current_target', assets: [], polling: false },
        }))

        yield* bus.publish(
          'session.disconnect.failed',
          { error: message },
          current
            ? { sessionId: current.sessionId, host: current.rig.identity.host }
            : undefined,
        )

        return yield* Effect.fail(error)
      }),
    ),
  )
})

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
