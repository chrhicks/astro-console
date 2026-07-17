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
import { OperationCoordinator, type OperationLease } from '../session/operation-coordinator'
import { AggregateStore } from '../state/aggregate-store'
import type { RigOperationContext } from '../rig/rig-model'
import { GeoService } from '../geo/geo-service'

export const runPointToTarget = (targetId: string) =>
  Effect.gen(function* () {
    const store = yield* AggregateStore
    const bus = yield* EventBus
    const sessions = yield* SessionManager
    const coordinator = yield* OperationCoordinator
    const catalog = yield* CatalogStore
    const geo = yield* GeoService

    const session = yield* sessions.getCurrent
    if (!session) {
      yield* store.updateIfSession(null, (current) => ({
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

    const lease = yield* coordinator.acquire(session, 'point')
    if (!lease) return

    yield* Effect.acquireUseRelease(
      Effect.void,
      () =>
        Effect.gen(function* () {
          const target = yield* catalog.getById(targetId)
          const summary = yield* catalog.getSummaryById(targetId)
          if (!target || !summary) {
            yield* coordinator.commitIfLease(lease, (current) => ({
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
            coordinator.commitIfLease(lease, (current) => ({
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
              yield* coordinator.commitIfLease(lease, (current) => ({
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

          const guardLease = (step: string, error: unknown) =>
            Effect.gen(function* () {
              if (lease.signal.aborted) return
              return yield* failStep(step, error)
            })

          yield* setStep('Resolving coordinates')

          const { location: observerLocation } = yield* geo.resolveObserverLocation(
            session.rig.observerLocation,
          )

          const coordinates = yield* resolvePointingCoordinates(
            target,
            observerLocation ?? undefined,
          ).pipe(
            Effect.catch((error) => failStep('Resolving coordinates', error)),
          )

          const pointing = session.rig.pointing
          if (!pointing) {
            return yield* failStep(
              'Preparing device for slew',
              new Error('Connected rig does not support pointing'),
            )
          }

          // Proven Seestar pre-slew sequence: sync device time and location,
          // then stop any active view so the mount is in a clean state before
          // slewing. The rig pointing workflow owns all readiness steps
          // including opening the arm if the mount is parked/closed.
          yield* setStep('Preparing device for slew')

          const ctx: RigOperationContext = { signal: lease.signal }

          yield* Effect.gen(function* () {
            if (!observerLocation) {
              return yield* Effect.fail(
                new Error('Need observer location before pointing'),
              )
            }
            yield* pointing.prepare(observerLocation, ctx)
          }).pipe(
            Effect.catch((error) => guardLease('Preparing device for slew', error)),
          )

          if (lease.signal.aborted) return

          yield* setStep('Slewing to target')

          yield* bus.publish('pointing.started', { targetId })

          yield* pointing
            .pointToCoordinates(
              {
                targetType: target.targetType,
                targetName: summary.name,
                raHours: coordinates.raHours,
                decDeg: coordinates.decDeg,
              },
              ctx,
            )
            .pipe(
              Effect.catch((error) => guardLease('Slewing to target', error)),
            )

          if (lease.signal.aborted) return

          // Prefer a rig-provided post-point override (e.g. fake device's
          // scenario-driven projection); fall back to a refresh round-trip.
          const afterPoint = pointing.afterPoint
            ? yield* pointing.afterPoint
            : null

          if (afterPoint) {
            const updated = yield* coordinator.commitIfLease(lease, (current) => ({
              ...current,
              pointing: { phase: 'arrived', target: summary, targetId, startedAt },
              currentTarget: summary,
              device: afterPoint.device ?? current.device,
              preview: afterPoint.preview,
              capture: afterPoint.capture,
              library: afterPoint.library,
            }))
            if (!updated) return
          } else {
            const refreshed = yield* session.rig.refresh
            if (lease.signal.aborted) return
            const updated = yield* coordinator.commitIfLease(lease, (current) => ({
              ...current,
              pointing: { phase: 'arrived', target: summary, targetId, startedAt },
              currentTarget: summary,
              device: { ...current.device, ...refreshed.device },
              preview: refreshed.preview,
              capture: refreshed.capture,
            }))
            if (!updated) return
          }

          yield* bus.publish('pointing.succeeded', { targetId })
        }),
      () => coordinator.release(lease),
    ).pipe(
      Effect.catch((error) =>
        lease.signal.aborted ? Effect.void : Effect.fail(error),
      ),
    )
  })

export const runAbortSlew = Effect.gen(function* () {
  const store = yield* AggregateStore
  const bus = yield* EventBus
  const sessions = yield* SessionManager
  const coordinator = yield* OperationCoordinator
  const session = yield* sessions.getCurrent

  if (!session) return yield* Effect.fail(new Error('No device connected'))

  const lease = yield* coordinator.acquireRecovery(session, 'abort-slew')
  if (!lease) return

  yield* Effect.acquireUseRelease(
    Effect.void,
    () =>
      Effect.gen(function* () {
        const current = yield* store.get
        if (current.pointing.phase !== 'slewing') {
          return yield* failAbortSlew(
            lease,
            new Error('No slew is in progress'),
            bus,
            coordinator,
          )
        }

        const stopMotion = session.rig.mount?.stopMotion
        if (!stopMotion) {
          return yield* failAbortSlew(
            lease,
            new Error('Connected rig does not support aborting slew'),
            bus,
            coordinator,
          )
        }

        yield* bus.publish('pointing.abort.started', {})
        const context: RigOperationContext = { signal: lease.signal }
        yield* stopMotion(context).pipe(
          Effect.catch((error) => failAbortSlew(lease, error, bus, coordinator)),
        )

        if (lease.signal.aborted) return

        const refreshed = yield* session.rig.refresh.pipe(
          Effect.catch((error) => failAbortSlew(lease, error, bus, coordinator)),
        )

        if (lease.signal.aborted) return

        const updated = yield* coordinator.commitIfLease(lease, (aggregate) => ({
          ...aggregate,
          session: { ...aggregate.session, lastError: undefined },
          device: { ...aggregate.device, ...refreshed.device },
          preview: refreshed.preview,
          capture: refreshed.capture,
          pointing: {
            phase: 'failed',
            target: aggregate.pointing.target,
            targetId: aggregate.pointing.targetId,
            startedAt: aggregate.pointing.startedAt,
            step: 'Slew aborted',
            lastError: 'Slew aborted by operator',
          },
        }))
        if (!updated) return

        yield* bus.publish('pointing.abort.succeeded', {})
      }),
    () => coordinator.release(lease),
  ).pipe(
    Effect.catch((error) =>
      lease.signal.aborted ? Effect.void : Effect.fail(error),
    ),
  )
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

function failAbortSlew(
  lease: OperationLease,
  error: unknown,
  bus: EventBus,
  coordinator: OperationCoordinator,
) {
  return Effect.gen(function* () {
    const message = toErrorMessage(error)
    const updated = yield* coordinator.commitIfLease(lease, (current) => ({
      ...current,
      session: { ...current.session, lastError: message },
    }))
    if (updated) yield* bus.publish('pointing.abort.failed', { error: message })
    return yield* Effect.fail(error)
  })
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
