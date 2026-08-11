import { Effect, Layer, Schema } from 'effect'
import {
  CommandFailure,
  ObserveCommandResponse,
  PlanCommandResponse,
} from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  executePlanRequest,
  planPersistenceLayer,
  planServiceLayer,
} from '../services/plan-command-service.ts'
import {
  executeObserveRequest,
  observePersistenceLayer,
  observeServiceLayer,
} from '../services/observe-command-service.ts'
import type { RunSqliteRepositoryShape } from '../persistence/run-sqlite-repository.ts'
import type { StateSqliteRepositoryShape } from '../persistence/state-sqlite-repository.ts'
import { tracedSqliteOperation } from '../observability/sqlite-telemetry.ts'
import { BodyTooLarge } from './request-body.ts'

export const commandFailureStatuses = {
  AuthenticationFailure: 401,
  AuthorizationFailure: 403,
  FreshnessConflict: 409,
  InvalidInput: 400,
  ActionIneligible: 409,
  ReferenceUnavailable: 409,
  CapabilityUnavailable: 409,
  ResourceProtected: 409,
  IdempotencyConflict: 409,
} satisfies Record<CommandFailure['_tag'], number>
const sqlitePlanPersistenceLayer = (
  runRepository: RunSqliteRepositoryShape,
  stateRepository: StateSqliteRepositoryShape,
  publish: (type: string, cursor: number) => Effect.Effect<void, unknown>,
) =>
  planPersistenceLayer({
    saveDraft: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.saveDraft(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    acceptRunDefinition: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.acceptRunDefinition(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    startAcceptedRun: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.startAcceptedRun(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    previewRunMutation: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.previewRunMutation(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    applyRunMutation: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.applyRunMutation(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    snapshot: (identity) => stateRepository.bootstrapSnapshot(identity),
    publish,
  })
export const planCommandFromRequest = Effect.fnUntraced(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    runRepository: RunSqliteRepositoryShape,
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => Effect.Effect<void, unknown>,
  ) {
    void runRepository
    void stateRepository
    void identity
    void publish
    return yield* executePlanRequest(request, BodyTooLarge, identity)
  },
  (effect, _request, runRepository, stateRepository, identity, publish) =>
    effect.pipe(
      Effect.provide(
        Layer.merge(
          sqlitePlanPersistenceLayer(runRepository, stateRepository, publish),
          planServiceLayer.pipe(
            Layer.provide(
              sqlitePlanPersistenceLayer(
                runRepository,
                stateRepository,
                publish,
              ),
            ),
          ),
        ),
      ),
    ),
)
const sqliteObservePersistenceLayer = (
  runRepository: RunSqliteRepositoryShape,
  stateRepository: StateSqliteRepositoryShape,
  publish: (type: string, cursor: number) => Effect.Effect<void, unknown>,
) =>
  observePersistenceLayer({
    pause: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.pause(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    resume: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.resume(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    stop: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.stop(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    skip: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.skip(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    retry: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.retry(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    park: (intent, identity) =>
      sqliteCommandTransaction(
        Effect.try({
          try: () => runRepository.park(intent, identity),
          catch: (cause) => cause,
        }),
      ),
    snapshot: (identity) => stateRepository.bootstrapSnapshot(identity),
    publish,
  })

const sqliteCommandTransaction = <A, E>(effect: Effect.Effect<A, E>) =>
  tracedSqliteOperation('command.state.transaction', effect)
export const observeCommandFromRequest = Effect.fnUntraced(
  function* (
    request: Promise<unknown | undefined | typeof BodyTooLarge>,
    runRepository: RunSqliteRepositoryShape,
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
    publish: (type: string, cursor: number) => Effect.Effect<void, unknown>,
  ) {
    void runRepository
    void stateRepository
    void identity
    void publish
    return yield* executeObserveRequest(request, BodyTooLarge, identity)
  },
  (effect, _request, runRepository, stateRepository, identity, publish) =>
    effect.pipe(
      Effect.provide(
        Layer.merge(
          sqliteObservePersistenceLayer(
            runRepository,
            stateRepository,
            publish,
          ),
          observeServiceLayer.pipe(
            Layer.provide(
              sqliteObservePersistenceLayer(
                runRepository,
                stateRepository,
                publish,
              ),
            ),
          ),
        ),
      ),
    ),
)
export const observeServiceResponse = Effect.fnUntraced(function* (
  _failure: 'ObserveServiceUnavailable',
  summary: string,
) {
  const body = yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
    _tag: 'Unavailable',
    failure: { _tag: 'ObserveServiceUnavailable', summary },
  })
  return { status: 503, body }
})
export const observeInvalidResponse = Effect.fnUntraced(function* (
  stateRepository: StateSqliteRepositoryShape,
  identity: LocalIdentity,
) {
  const snapshot = yield* stateRepository.bootstrapSnapshot(identity)
  const body = yield* Schema.decodeUnknownEffect(ObserveCommandResponse)({
    _tag: 'Rejected',
    failure: {
      _tag: 'InvalidInput',
      summary: 'The Observe command is invalid.',
    },
    snapshot,
  })
  return { status: 400, body }
})
export const planServiceResponse = Effect.fn('Server.planServiceResponse')(
  function* (failure: 'PlanServiceUnavailable', summary: string) {
    const body = yield* Schema.decodeUnknownEffect(PlanCommandResponse)({
      _tag: 'Unavailable',
      failure: { _tag: 'PlanServiceUnavailable', summary },
    })
    return { status: 503, body }
  },
)
export const planInvalidResponse = Effect.fn('Server.planInvalidResponse')(
  function* (
    stateRepository: StateSqliteRepositoryShape,
    identity: LocalIdentity,
  ) {
    const snapshot = yield* stateRepository.bootstrapSnapshot(identity)
    const body = yield* Schema.decodeUnknownEffect(PlanCommandResponse)({
      _tag: 'Rejected',
      failure: {
        _tag: 'InvalidInput',
        summary: 'The Plan command is invalid.',
      },
      snapshot,
    })
    return { status: 400, body }
  },
)
