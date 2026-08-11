import { Context, Data, Effect, Layer, Schema } from 'effect'
import {
  IdempotencyKey,
  PlanCommandResult,
  PlanCommandRequest,
  PlanCommandResponse,
  PreviewId,
  type BootstrapSnapshot,
  type PlanWorkspaceProjection,
} from '@astro-console/protocol'
import { BootstrapClient, BootstrapClientState } from './bootstrap-client'

type IdempotencyKeyValue = typeof IdempotencyKey.Type
type PreviewIdValue = typeof PreviewId.Type
type PlanCommandResultValue = typeof PlanCommandResult.Type

export type PlanAction =
  | {
      readonly _tag: 'SaveDraft'
      readonly sequences: ReadonlyArray<
        PlanWorkspaceProjection['sequences'][number]
      >
    }
  | { readonly _tag: 'AcceptRunDefinition' }
  | { readonly _tag: 'StartAcceptedRun' }
  | {
      readonly _tag: 'PreviewRunMutation'
      readonly mutation: 'shortenSecond' | 'discardCurrent'
    }
  | { readonly _tag: 'ApplyRunMutation'; readonly previewId: PreviewIdValue }
  | {
      readonly _tag: 'ApproveDisruptiveRunMutation'
      readonly previewId: PreviewIdValue
      readonly approvalToken: string
    }

export type PlanCommandSubmission = Data.TaggedEnum<{
  Accepted: {
    readonly result: PlanCommandResultValue
    readonly safeNextAction: string
  }
  Rejected: { readonly reason: string; readonly safeNextAction: string }
  Unavailable: { readonly reason: string; readonly safeNextAction: string }
}>

export const PlanCommandSubmission = Data.taggedEnum<PlanCommandSubmission>()

export class PlanCommandTransportFailure extends Schema.TaggedErrorClass<PlanCommandTransportFailure>()(
  'Web.PlanCommandTransportFailure',
  { reason: Schema.NonEmptyString },
) {}

export class PlanCommandResponseInvalid extends Schema.TaggedErrorClass<PlanCommandResponseInvalid>()(
  'Web.PlanCommandResponseInvalid',
  { reason: Schema.NonEmptyString },
) {}

export interface PlanCommandTransportShape {
  readonly submit: (
    body: unknown,
  ) => Effect.Effect<
    { readonly status: number; readonly body: unknown },
    PlanCommandTransportFailure
  >
}

export class PlanCommandTransport extends Context.Service<
  PlanCommandTransport,
  PlanCommandTransportShape
>()('@astro-console/web/PlanCommandTransport') {}

export interface PlanCommandClientShape {
  readonly submit: (
    action: PlanAction,
    idempotencyKey: IdempotencyKeyValue,
  ) => Effect.Effect<PlanCommandSubmission>
}

export class PlanCommandClient extends Context.Service<
  PlanCommandClient,
  PlanCommandClientShape
>()('@astro-console/web/PlanCommandClient') {}

export const layer = Layer.effect(
  PlanCommandClient,
  Effect.gen(function* () {
    const bootstrap = yield* BootstrapClient
    const transport = yield* PlanCommandTransport
    const submit = Effect.fn('PlanCommandClient.submit')(
      function* (action: PlanAction, idempotencyKey: IdempotencyKeyValue) {
        const state = yield* bootstrap.read()
        if (!BootstrapClientState.$is('Current')(state))
          return PlanCommandSubmission.Unavailable({
            reason:
              'A current authoritative snapshot is required before submitting this action.',
            safeNextAction:
              'Wait for the current Plan projection before trying again.',
          })
        const plan = state.snapshot.plan
        if (plan === undefined)
          return PlanCommandSubmission.Unavailable({
            reason:
              'Plan detail is unavailable from the current service snapshot.',
            safeNextAction: 'Wait for a Plan projection before trying again.',
          })
        const eligibility = actionEligibility(action, plan.actions)
        if (eligibility !== undefined)
          return PlanCommandSubmission.Unavailable({
            reason: eligibility,
            safeNextAction:
              'Read the projected Plan availability before trying another action.',
          })
        const request = yield* Schema.decodeUnknownEffect(PlanCommandRequest)(
          requestFor(action, state.snapshot, idempotencyKey),
        ).pipe(
          Effect.mapError(
            () =>
              new PlanCommandResponseInvalid({
                reason: 'The Plan command could not be constructed.',
              }),
          ),
        )
        return yield* transport.submit(request).pipe(
          Effect.flatMap(({ body }) =>
            Schema.decodeUnknownEffect(PlanCommandResponse)(body).pipe(
              Effect.mapError(
                () =>
                  new PlanCommandResponseInvalid({
                    reason: 'The Plan command response was invalid.',
                  }),
              ),
            ),
          ),
          Effect.flatMap(
            (response): Effect.Effect<PlanCommandSubmission> =>
              PlanCommandResponse.guards.Accepted(response)
                ? (response.result._tag === 'RunMutationPreviewed'
                    ? bootstrap.refresh()
                    : Effect.void
                  ).pipe(
                    Effect.as(
                      PlanCommandSubmission.Accepted({
                        result: response.result,
                        safeNextAction:
                          'Await the next authoritative Plan projection before treating this action as complete.',
                      }),
                    ),
                  )
                : PlanCommandResponse.guards.Unavailable(response)
                  ? bootstrap.refresh().pipe(
                      Effect.as(
                        PlanCommandSubmission.Unavailable({
                          reason: response.failure.summary,
                          safeNextAction:
                            'Reconnect and recover a current Plan projection before trying again.',
                        }),
                      ),
                    )
                  : bootstrap.refresh().pipe(
                      Effect.as(
                        PlanCommandSubmission.Rejected({
                          reason: response.failure.summary,
                          safeNextAction:
                            'Read the current Plan projection before trying another action.',
                        }),
                      ),
                    ),
          ),
        )
      },
      (effect) =>
        effect.pipe(
          Effect.catchTags({
            'Web.PlanCommandTransportFailure': (error) =>
              Effect.succeed(
                PlanCommandSubmission.Unavailable({
                  reason: error.reason,
                  safeNextAction:
                    'Reconnect and read a current Plan projection before trying again.',
                }),
              ),
            'Web.PlanCommandResponseInvalid': (error) =>
              Effect.succeed(
                PlanCommandSubmission.Unavailable({
                  reason: error.reason,
                  safeNextAction:
                    'Wait for the authoritative Plan projection before trying again.',
                }),
              ),
          }),
        ),
    )
    return PlanCommandClient.of({ submit })
  }),
)

export const browserPlanCommandTransportLayer = Layer.succeed(
  PlanCommandTransport,
  PlanCommandTransport.of({
    submit: Effect.fn('PlanCommandTransport.submit')(function* (body: unknown) {
      const response = yield* Effect.tryPromise({
        try: (signal) =>
          fetch('/api/plan/commands', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          }),
        catch: () =>
          new PlanCommandTransportFailure({
            reason: 'The Plan command service could not be reached.',
          }),
      })
      const parsedBody = yield* Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new PlanCommandTransportFailure({
            reason: 'The Plan command response could not be read.',
          }),
      })
      return { status: response.status, body: parsedBody }
    }),
  }),
)

function actionEligibility(
  action: PlanAction,
  actions: PlanWorkspaceProjection['actions'],
) {
  const eligibility =
    actions?.[
      action._tag === 'SaveDraft'
        ? 'saveDraft'
        : action._tag === 'AcceptRunDefinition'
          ? 'acceptRunDefinition'
          : action._tag === 'StartAcceptedRun'
            ? 'startAcceptedRun'
            : action._tag === 'PreviewRunMutation'
              ? 'previewRunMutation'
              : action._tag === 'ApplyRunMutation'
                ? 'applyRunMutation'
                : 'approveDisruptiveRunMutation'
    ]
  return eligibility?._tag === 'Eligible'
    ? undefined
    : 'This action is not available in the current Plan projection.'
}

function requestFor(
  action: PlanAction,
  snapshot: BootstrapSnapshot,
  idempotencyKey: IdempotencyKeyValue,
) {
  const plan = snapshot.plan
  if (plan === undefined) return {}
  const base = {
    planId: plan.planId,
    expectedPlanRevision: plan.revision,
    expectedLeaseRevision: snapshot.control.revision,
    idempotencyKey,
  }
  switch (action._tag) {
    case 'SaveDraft':
      return {
        intent: {
          _tag: action._tag,
          planId: plan.planId,
          expectedPlanRevision: plan.revision,
          idempotencyKey,
          sequences: action.sequences.map((sequence) => ({
            sequenceId: sequence.sequenceId,
            definition: sequence.definition,
          })),
        },
      }
    case 'AcceptRunDefinition':
      return { intent: { _tag: action._tag, ...base } }
    case 'StartAcceptedRun':
      return { intent: { _tag: action._tag, ...base } }
    case 'PreviewRunMutation':
      return {
        intent: {
          _tag: action._tag,
          mutation: action.mutation,
          expectedLeaseRevision: snapshot.control.revision,
          expectedRunRevision:
            snapshot.activeRun._tag === 'Active'
              ? snapshot.activeRun.run.revision
              : -1,
          idempotencyKey,
        },
      }
    case 'ApplyRunMutation':
      return {
        intent: {
          _tag: action._tag,
          previewId: action.previewId,
          expectedLeaseRevision: snapshot.control.revision,
          expectedRunRevision:
            snapshot.activeRun._tag === 'Active'
              ? snapshot.activeRun.run.revision
              : -1,
          idempotencyKey,
        },
      }
    case 'ApproveDisruptiveRunMutation':
      return {
        intent: {
          _tag: action._tag,
          previewId: action.previewId,
          approvalToken: action.approvalToken,
          expectedLeaseRevision: snapshot.control.revision,
          expectedRunRevision:
            snapshot.activeRun._tag === 'Active'
              ? snapshot.activeRun.run.revision
              : -1,
          idempotencyKey,
        },
      }
  }
}
