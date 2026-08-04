import { Context, Effect, Layer, Schema } from 'effect'
import {
  ObserveCommandRequest,
  ObserveCommandResponse,
  ObserveIntent,
  ObserveCommandResult,
  type BootstrapSnapshot,
} from '@astro-console/v2-contracts'
import type { LocalIdentity } from './identity.ts'

export class ObserveCommandInputInvalid extends Schema.TaggedErrorClass<ObserveCommandInputInvalid>()(
  'Server.ObserveCommandInputInvalid',
  {},
) {}
export class ObserveServiceUnavailable extends Schema.TaggedErrorClass<ObserveServiceUnavailable>()(
  'Server.ObserveServiceUnavailable',
  {},
) {}
export type ObserveTransition = {
  readonly status: number
  readonly body: unknown
  readonly event?: { readonly type: string; readonly cursor: number }
}
export interface ObservePersistenceShape {
  readonly pause: (
    intent: Extract<typeof ObserveIntent.Type, { readonly _tag: 'PauseRun' }>,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly resume: (
    intent: Extract<typeof ObserveIntent.Type, { readonly _tag: 'ResumeRun' }>,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly stop: (
    intent: Extract<typeof ObserveIntent.Type, { readonly _tag: 'StopRun' }>,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly skip: (
    intent: Extract<
      typeof ObserveIntent.Type,
      { readonly _tag: 'SkipSequence' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly retry: (
    intent: Extract<typeof ObserveIntent.Type, { readonly _tag: 'RetryPhase' }>,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly park: (
    intent: Extract<
      typeof ObserveIntent.Type,
      { readonly _tag: 'RequestPark' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<ObserveTransition, unknown>
  readonly snapshot: (
    identity: LocalIdentity,
  ) => Effect.Effect<BootstrapSnapshot, unknown>
  readonly publish: (
    type: string,
    cursor: number,
  ) => Effect.Effect<void, unknown>
}
export class ObservePersistence extends Context.Service<
  ObservePersistence,
  ObservePersistenceShape
>()('@astro-console/server/ObservePersistence') {}
export const observePersistenceLayer = (
  implementation: ObservePersistenceShape,
) => Layer.succeed(ObservePersistence, ObservePersistence.of(implementation))

export class ObserveService extends Context.Service<
  ObserveService,
  {
    readonly execute: (
      intent: typeof ObserveIntent.Type,
      identity: LocalIdentity,
    ) => Effect.Effect<ObserveTransition, unknown>
  }
>()('@astro-console/server/ObserveService') {}
export const observeServiceLayer = Layer.effect(
  ObserveService,
  Effect.gen(function* () {
    const persistence = yield* ObservePersistence
    return ObserveService.of({
      execute: Effect.fn('ObserveService.execute')(
        function* (intent, identity) {
          if (ObserveIntent.guards.PauseRun(intent))
            return yield* persistence.pause(intent, identity)
          if (ObserveIntent.guards.ResumeRun(intent))
            return yield* persistence.resume(intent, identity)
          if (ObserveIntent.guards.StopRun(intent))
            return yield* persistence.stop(intent, identity)
          if (ObserveIntent.guards.SkipSequence(intent))
            return yield* persistence.skip(intent, identity)
          if (ObserveIntent.guards.RetryPhase(intent))
            return yield* persistence.retry(intent, identity)
          return yield* persistence.park(intent, identity)
        },
      ),
    })
  }),
)

export const executeObserveRequest = Effect.fn(
  'ObserveCommandService.executeRequest',
)(function* (
  request: Promise<unknown | undefined | symbol>,
  bodyTooLarge: symbol,
  identity: LocalIdentity,
) {
  const raw = yield* Effect.promise(() => request)
  if (raw === undefined || raw === bodyTooLarge)
    return yield* Effect.fail(new ObserveCommandInputInvalid())
  const decoded = yield* Schema.decodeUnknownEffect(ObserveCommandRequest)(
    raw,
  ).pipe(Effect.mapError(() => new ObserveCommandInputInvalid()))
  const persistence = yield* ObservePersistence
  const service = yield* ObserveService
  const transition = yield* service
    .execute(decoded.intent, identity)
    .pipe(Effect.mapError(() => new ObserveServiceUnavailable()))
  if (isRejected(transition.body)) {
    const snapshot = yield* persistence
      .snapshot(identity)
      .pipe(Effect.mapError(() => new ObserveServiceUnavailable()))
    return {
      status: transition.status,
      body: yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
        _tag: 'Rejected',
        failure: {
          _tag: 'Rejected',
          reason: transition.body.reason,
          summary: transition.body.message,
        },
        snapshot,
      }).pipe(Effect.mapError(() => new ObserveServiceUnavailable())),
    }
  }
  if (transition.event !== undefined)
    yield* persistence
      .publish(transition.event.type, transition.event.cursor)
      .pipe(Effect.mapError(() => new ObserveServiceUnavailable()))
  return {
    status: transition.status,
    body: yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
      _tag: 'Accepted',
      result: resultFor(decoded.intent),
    }).pipe(Effect.mapError(() => new ObserveServiceUnavailable())),
  }
})

function isRejected(value: unknown): value is {
  readonly outcome: 'rejected'
  readonly reason: string
  readonly message: string
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    'outcome' in value &&
    value.outcome === 'rejected' &&
    'reason' in value &&
    'message' in value &&
    typeof value.reason === 'string' &&
    typeof value.message === 'string'
  )
}

function resultFor(
  intent: typeof ObserveIntent.Type,
): typeof ObserveCommandResult.Type {
  const result = {
    PauseRun: 'PauseAccepted',
    ResumeRun: 'ResumeAccepted',
    StopRun: 'StopAccepted',
    SkipSequence: 'SequenceSkipped',
    RetryPhase: 'PhaseRetryAccepted',
    RequestPark: 'ParkRequested',
  } satisfies Record<typeof intent._tag, string>
  return Schema.decodeUnknownSync(ObserveCommandResult)({
    _tag: result[intent._tag],
  })
}
