import { Observer } from 'astronomy-engine'
import { Effect } from 'effect'
import type {
  DeepSkyTarget,
  SolarSystemTarget,
} from '../../../shared/catalog/catalog-schema'
import { computeSolarSystemCoordinates } from '../../../shared/visibility-engine'
import { CatalogStore } from '../catalog/catalog-store'
import { EventBus } from '../event/event-bus'
import { SessionManager } from '../session/session-manager'
import { AggregateStore } from '../state/aggregate-store'

export const runPointToTarget = (targetId: string) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const catalog = yield* CatalogStore

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

    const setStep = (step: string) =>
      store.update((current) => ({
        ...current,
        pointing: {
          phase: 'slewing',
          target: summary,
          targetId,
          startedAt,
          step,
        },
      }))

    const failStep = (step: string, error: unknown) =>
      Effect.gen(function* () {
        const message = toErrorMessage(error)
        yield* store.update((current) => ({
          ...current,
          pointing: {
            phase: 'failed',
            target: summary,
            targetId,
            startedAt,
            step,
            lastError: message,
          },
        }))
        yield* bus.publish('pointing.failed', { targetId, error: message })
        return yield* Effect.fail(error)
      })

    const guardSession = (step: string, error: unknown) =>
      Effect.gen(function* () {
        if ((yield* sessions.getCurrent) !== session) {
          return yield* Effect.fail(error)
        }
        return yield* failStep(step, error)
      })

    yield* setStep('Resolving coordinates')

    const observerLocation = session.rig.observerLocation

    const coordinates = yield* resolvePointingCoordinates(
      target,
      observerLocation,
    ).pipe(
      Effect.catchAll((error) => failStep('Resolving coordinates', error)),
    )

    const pointing = session.rig.pointing
    if (!pointing) {
      return yield* failStep(
        'Preparing device for slew',
        new Error('Connected rig does not support pointing'),
      )
    }

    // Proven Seestar pre-slew sequence: sync device time and location, then
    // stop any active view so the mount is in a clean state before slewing.
    // The rig pointing workflow owns all readiness steps including opening
    // the arm if the mount is parked/closed.
    yield* setStep('Preparing device for slew')

    yield* Effect.gen(function* () {
      if (!observerLocation) {
        return yield* Effect.fail(
          new Error('Need observer location before pointing'),
        )
      }
      yield* pointing.prepare(observerLocation)
    }).pipe(
      Effect.catchAll((error) => guardSession('Preparing device for slew', error)),
    )

    if ((yield* sessions.getCurrent) !== session) {
      return
    }

    yield* setStep('Slewing to target')

    yield* bus.publish('pointing.started', { targetId })

    yield* pointing
      .pointToCoordinates({
        mode: target.viewMode,
        targetName: summary.name,
        raHours: coordinates.raHours,
        decDeg: coordinates.decDeg,
      })
      .pipe(
        Effect.catchAll((error) => guardSession('Slewing to target', error)),
      )

    // Session replaced or cleared mid-slew; don't restore arrived/currentTarget.
    if ((yield* sessions.getCurrent) !== session) {
      return
    }

    // Prefer a rig-provided post-point override (e.g. fake device's
    // scenario-driven projection); fall back to a refresh round-trip.
    const afterPoint = pointing.afterPoint
      ? yield* pointing.afterPoint
      : null

    if (afterPoint) {
      yield* store.update((current) => ({
        ...current,
        pointing: { phase: 'arrived', target: summary, targetId, startedAt },
        currentTarget: summary,
        device: afterPoint.device ?? current.device,
        preview: afterPoint.preview,
        capture: afterPoint.capture,
        library: afterPoint.library,
      }))
    } else {
      const refreshed = yield* session.rig.refresh
      if ((yield* sessions.getCurrent) !== session) {
        return
      }
      yield* store.update((current) => ({
        ...current,
        pointing: { phase: 'arrived', target: summary, targetId, startedAt },
        currentTarget: summary,
        device: { ...current.device, ...refreshed.device },
        preview: refreshed.preview,
        capture: refreshed.capture,
      }))
    }

    yield* bus.publish('pointing.succeeded', { targetId })
  })

function resolvePointingCoordinates(
  target: DeepSkyTarget | SolarSystemTarget,
  deviceLocation: { lat: number; lon: number } | undefined,
): Effect.Effect<{ raHours: number; decDeg: number }, Error> {
  if (!('body' in target)) {
    return Effect.succeed({
      raHours: target.raHours,
      decDeg: target.decDeg,
    })
  }

  if (!deviceLocation) {
    return Effect.fail(
      new Error('Need observer location before pointing at solar-system targets'),
    )
  }

  const observer = new Observer(deviceLocation.lat, deviceLocation.lon, 0)
  return Effect.succeed(
    computeSolarSystemCoordinates(target.body, observer, new Date()),
  )
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
