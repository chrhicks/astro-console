import { Context, Effect, Layer, Option, Schema } from 'effect'
import {
  PlanCommandRequest,
  PlanCommandResponse,
  PlanIntent,
  type BootstrapSnapshot,
} from '@astro-console/protocol'
import type { LocalIdentity } from '../auth/identity.ts'
import {
  tracedPlanCommand,
  tracedPlanCommandStage,
} from '../observability/plan-telemetry.ts'

export class PlanCommandInputInvalid extends Schema.TaggedErrorClass<PlanCommandInputInvalid>()(
  'Server.PlanCommandInputInvalid',
  {},
) {}
export class PlanServiceUnavailable extends Schema.TaggedErrorClass<PlanServiceUnavailable>()(
  'Server.PlanServiceUnavailable',
  {},
) {}

export type PlanTransition = {
  readonly status: number
  readonly body: unknown
  readonly event?: { readonly type: string; readonly cursor: number }
}
export interface PlanPersistenceShape {
  readonly saveDraft: (
    intent: Extract<typeof PlanIntent.Type, { readonly _tag: 'SaveDraft' }>,
    identity: LocalIdentity,
  ) => Effect.Effect<PlanTransition, unknown>
  readonly acceptRunDefinition: (
    intent: Extract<
      typeof PlanIntent.Type,
      { readonly _tag: 'AcceptRunDefinition' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<PlanTransition, unknown>
  readonly startAcceptedRun: (
    intent: Extract<
      typeof PlanIntent.Type,
      { readonly _tag: 'StartAcceptedRun' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<PlanTransition, unknown>
  readonly previewRunMutation: (
    intent: Extract<
      typeof PlanIntent.Type,
      { readonly _tag: 'PreviewRunMutation' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<PlanTransition, unknown>
  readonly applyRunMutation: (
    intent: Extract<
      typeof PlanIntent.Type,
      | { readonly _tag: 'ApplyRunMutation' }
      | { readonly _tag: 'ApproveDisruptiveRunMutation' }
    >,
    identity: LocalIdentity,
  ) => Effect.Effect<PlanTransition, unknown>
  readonly snapshot: (
    identity: LocalIdentity,
  ) => Effect.Effect<BootstrapSnapshot, unknown>
  readonly publish: (
    type: string,
    cursor: number,
  ) => Effect.Effect<void, unknown>
}
export class PlanPersistence extends Context.Service<
  PlanPersistence,
  PlanPersistenceShape
>()('@astro-console/server/PlanPersistence') {}
export const planPersistenceLayer = (implementation: PlanPersistenceShape) =>
  Layer.succeed(PlanPersistence, PlanPersistence.of(implementation))

export class PlanService extends Context.Service<
  PlanService,
  {
    readonly execute: (
      intent: typeof PlanIntent.Type,
      identity: LocalIdentity,
    ) => Effect.Effect<PlanTransition, unknown>
  }
>()('@astro-console/server/PlanService') {}
export const planServiceLayer = Layer.effect(
  PlanService,
  Effect.gen(function* () {
    const persistence = yield* PlanPersistence
    return PlanService.of({
      execute: Effect.fnUntraced(function* (intent, identity) {
        const applyIntent = (): Effect.Effect<PlanTransition, unknown> => {
          if (PlanIntent.guards.SaveDraft(intent))
            return persistence.saveDraft(intent, identity)
          if (PlanIntent.guards.AcceptRunDefinition(intent))
            return persistence.acceptRunDefinition(intent, identity)
          if (PlanIntent.guards.StartAcceptedRun(intent))
            return persistence.startAcceptedRun(intent, identity)
          if (PlanIntent.guards.PreviewRunMutation(intent))
            return persistence.previewRunMutation(intent, identity)
          return persistence.applyRunMutation(intent, identity)
        }
        const transition = applyIntent()
        return yield* tracedPlanCommandStage(transition, 'applyIntent')
      }),
    })
  }),
)

export const executePlanRequest = Effect.fnUntraced(function* (
  request: Promise<unknown | undefined | symbol>,
  bodyTooLarge: symbol,
  identity: LocalIdentity,
) {
  const raw = yield* Effect.promise(() => request)
  if (raw === undefined || raw === bodyTooLarge)
    return yield* Effect.fail(new PlanCommandInputInvalid())
  const decoded = yield* Schema.decodeUnknownEffect(PlanCommandRequest)(
    raw,
  ).pipe(Effect.mapError(() => new PlanCommandInputInvalid()))
  return yield* tracedPlanCommand(
    Effect.gen(function* () {
      const service = yield* PlanService
      const persistence = yield* PlanPersistence
      const transition = yield* service
        .execute(decoded.intent, identity)
        .pipe(Effect.mapError(() => new PlanServiceUnavailable()))
      if (transition.event !== undefined)
        yield* tracedPlanCommandStage(
          persistence.publish(transition.event.type, transition.event.cursor),
          'publishChange',
        )
      const snapshot = yield* tracedPlanCommandStage(
        persistence
          .snapshot(identity)
          .pipe(Effect.mapError(() => new PlanServiceUnavailable())),
        'readSnapshot',
      )
      return {
        status: transition.status,
        body: yield* responseFor(
          decoded.intent,
          transition.body,
          snapshot,
        ).pipe(Effect.mapError(() => new PlanServiceUnavailable())),
      }
    }),
    decoded.intent._tag,
  )
})

const responseFor = Effect.fnUntraced(function* (
  intent: typeof PlanIntent.Type,
  raw: unknown,
  snapshot: BootstrapSnapshot,
) {
  const rejected = Schema.decodeUnknownOption(
    Schema.Struct({
      outcome: Schema.Literal('rejected'),
      reason: Schema.NonEmptyString,
      message: Schema.NonEmptyString,
    }),
  )(raw)
  return yield* Option.match(rejected, {
    onNone: () =>
      Schema.decodeUnknownEffect(PlanCommandResponse)({
        _tag: 'Accepted',
        result: resultFor(intent, raw),
        snapshot,
      }),
    onSome: (failure) =>
      Schema.decodeUnknownEffect(PlanCommandResponse)({
        _tag: 'Rejected',
        failure: {
          _tag: 'Rejected',
          reason: failure.reason,
          summary: failure.message,
        },
        snapshot,
      }),
  })
})

function resultFor(intent: typeof PlanIntent.Type, raw: unknown) {
  if (PlanIntent.guards.SaveDraft(intent))
    return { _tag: 'DraftSaved' as const }
  if (PlanIntent.guards.AcceptRunDefinition(intent))
    return { _tag: 'RunDefinitionAccepted' as const }
  if (PlanIntent.guards.StartAcceptedRun(intent))
    return { _tag: 'RunStarted' as const }
  if (
    PlanIntent.guards.ApplyRunMutation(intent) ||
    PlanIntent.guards.ApproveDisruptiveRunMutation(intent)
  )
    return { _tag: 'RunMutationApplied' as const }
  const preview = Schema.decodeUnknownSync(
    Schema.Struct({
      outcome: Schema.Literal('accepted'),
      preview: Schema.Struct({
        previewId: Schema.NonEmptyString,
        classification: Schema.Literals([
          'nonDisruptive',
          'notice',
          'disruptive',
        ]),
        consequences: Schema.NonEmptyString,
        expiresAt: Schema.NonEmptyString,
        approvalRequired: Schema.Boolean,
      }),
      approvalToken: Schema.optionalKey(Schema.NonEmptyString),
    }),
  )(raw)
  return {
    _tag: 'RunMutationPreviewed' as const,
    ...preview.preview,
    ...(preview.approvalToken === undefined
      ? {}
      : { approvalToken: preview.approvalToken }),
  }
}
