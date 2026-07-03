import { Observer } from 'astronomy-engine'
import { Effect } from 'effect'
import type {
  DeepSkyTarget,
  SolarSystemTarget,
} from '../../../shared/catalog/catalog-schema'
import { computeSolarSystemCoordinates } from '../../../shared/visibility-engine'
import { CatalogStore } from '../catalog/catalog-store'
import { EventBus } from '../event/event-bus'
import { ObserverContextStore } from '../observer/observer-context-store'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runPointToTarget = (targetId: string) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const catalog = yield* CatalogStore
    const observerContextStore = yield* ObserverContextStore

    const session = yield* sessions.getCurrent
    if (!session) {
      yield* store.update((current) => ({
        ...current,
        pointing: {
          phase: 'failed',
          target: null,
          targetId,
          lastError: 'No device connected',
        },
      }))
      yield* bus.publish('pointing.failed', {
        targetId,
        error: 'No device connected',
      })
      return
    }

    const target = yield* catalog.getById(targetId)
    const summary = yield* catalog.getSummaryById(targetId)
    if (!target || !summary) {
      yield* store.update((current) => ({
        ...current,
        pointing: {
          phase: 'failed',
          target: null,
          targetId,
          lastError: 'Target not found in catalog',
        },
      }))
      yield* bus.publish('pointing.failed', {
        targetId,
        error: 'Target not found in catalog',
      })
      return
    }

    const startedAt = new Date().toISOString()
    const coordinates = yield* resolvePointingCoordinates(target, observerContextStore).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const message = toErrorMessage(error)
          yield* store.update((current) => ({
            ...current,
            pointing: {
              phase: 'failed',
              target: summary,
              targetId,
              startedAt,
              lastError: message,
            },
          }))
          yield* bus.publish('pointing.failed', { targetId, error: message })
          return yield* Effect.fail(error)
        }),
      ),
    )

    yield* store.update((current) => ({
      ...current,
      pointing: { phase: 'slewing', target: summary, targetId, startedAt },
    }))

    yield* bus.publish('pointing.started', { targetId })

    yield* session.pointToCoordinates(coordinates).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          // Session replaced or cleared mid-slew; the new state owns the aggregate.
          if ((yield* sessions.getCurrent) !== session) {
            return yield* Effect.fail(error)
          }
          const message = toErrorMessage(error)
          yield* store.update((current) => ({
            ...current,
            pointing: {
              phase: 'failed',
              target: summary,
              targetId,
              startedAt,
              lastError: message,
            },
          }))
          yield* bus.publish('pointing.failed', { targetId, error: message })
          return yield* Effect.fail(error)
        }),
      ),
    )

    // Session replaced or cleared mid-slew; don't restore arrived/currentTarget.
    if ((yield* sessions.getCurrent) !== session) {
      return
    }

    yield* store.update((current) => ({
      ...current,
      pointing: { phase: 'arrived', target: summary, targetId, startedAt },
      currentTarget: summary,
    }))

    yield* bus.publish('pointing.succeeded', { targetId })
  })

function resolvePointingCoordinates(
  target: DeepSkyTarget | SolarSystemTarget,
  observerContextStore: ObserverContextStore,
) {
  if (!('body' in target)) {
    return Effect.succeed({
      raHours: target.raHours,
      decDeg: target.decDeg,
    })
  }

  return observerContextStore.getCurrent().pipe(
    Effect.flatMap((observerContext) => {
      if (!observerContext) {
        return Effect.fail(
          new Error('Need observer location before pointing at solar-system targets'),
        )
      }

      const observer = new Observer(observerContext.lat, observerContext.lon, 0)
      return Effect.succeed(
        computeSolarSystemCoordinates(target.body, observer, new Date()),
      )
    }),
  )
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
